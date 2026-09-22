#!/usr/bin/env python3
"""
P0.6 question-ledger seeder for rattlesnakesbymail.com.

Reads the "Part 2: distinct questions extracted" markdown table out of
docs/prompt-batch-2026-09-15.md (a copy of the prompt-batch output file) and
inserts one row per distinct question into the questions table via the D1
HTTP query API, skipping any question whose hash already exists.

Normalisation and hashing exactly mirror src/util.js normalizeQuestion() and
sha256Hex() so these seeded rows dedupe correctly against future organic
/search and /mcp traffic:
  - normalizeQuestion: lowercase, strip everything but letters/digits/space,
    collapse whitespace, light stemming (drop trailing "es" on words > 4
    chars, else drop trailing "s" on words > 4 chars).
  - hash: sha256 hex digest of the normalised string (not the raw text).

Each inserted row gets:
  ts_first = ts_last = now (UTC, ISO 8601 "...Z")
  text_raw = the question exactly as written in the table
  text_norm = normalizeQuestion(text_raw)
  hash = sha256 hex of text_norm
  count = number of engines listed for that row
  sources = ["prompt_batch", "engine:<name>", ...] one engine: entry per
            engine in the row's engines column
  matched_claim_ids = []
  gap = 1
  published = 1

Usage:
  python3 seed-questions.py --dry-run
  python3 seed-questions.py --live
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

ROOT = os.path.expanduser("~/mnt/rattlesnakesbymail.com") if os.path.expanduser("~") != "/root" else os.path.expanduser("~")
# Prefer the repo-relative layout this script actually ships in: it lives at
# <root>/site/tools/seed-questions.py, and the batch doc lives at
# <root>/docs/prompt-batch-2026-09-15.md.
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(TOOLS_DIR)
REPO_ROOT = os.path.dirname(SITE_DIR)
DOC_PATH = os.path.join(REPO_ROOT, "docs", "prompt-batch-2026-09-15.md")
LOG_PATH = os.path.join(REPO_ROOT, "docs", "seed-questions-log-2026-09-15.md")
D1_UUID = "92b99e81-233c-4c97-b787-d8eb71ef876d"

VALID_ENGINES = {"chatgpt", "perplexity", "claude", "gemini", "copilot"}


def d1_api():
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    return f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{D1_UUID}/query", token


def d1_query(sql, params=None):
    url, token = d1_api()
    body = {"sql": sql}
    if params is not None:
        body["params"] = params
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print("D1 HTTP error:", e.read().decode(), file=sys.stderr)
        raise


def iso_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_question(text):
    """Mirror of src/util.js normalizeQuestion() exactly."""
    t = (text or "").lower()
    t = re.sub(r"[^\w\s]|_", " ", t, flags=re.UNICODE)
    # \w includes digits/underscore/letters; util.js strips anything that is
    # not a unicode letter or number, so also strip underscores (handled
    # above) and collapse.
    t = re.sub(r"\s+", " ", t).strip()

    def stem(w):
        if len(w) > 4 and w.endswith("es"):
            return w[:-2]
        if len(w) > 4 and w.endswith("s"):
            return w[:-1]
        return w

    return " ".join(stem(w) for w in t.split(" ") if w)


def sha256_hex(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def parse_table(path):
    """Parses the '| n | question | engines | notes |' table from the batch
    doc. Returns a list of dicts: {n, question, engines: [...]}."""
    rows = []
    in_table = False
    seen_sep = False
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if line.strip().startswith("| n | question | engines | notes |"):
                in_table = True
                seen_sep = False
                continue
            if not in_table:
                continue
            if line.strip().startswith("|---"):
                seen_sep = True
                continue
            if not seen_sep:
                continue
            if not line.strip().startswith("|"):
                # table ended
                break
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 3:
                continue
            n_cell, question, engines_cell = cells[0], cells[1], cells[2]
            if not n_cell.isdigit():
                continue
            engines = [e.strip().lower() for e in engines_cell.split(",") if e.strip()]
            unknown = [e for e in engines if e not in VALID_ENGINES]
            if unknown:
                raise ValueError(f"row {n_cell}: unknown engine name(s) {unknown} in {engines_cell!r}")
            rows.append({"n": int(n_cell), "question": question, "engines": engines})
    return rows


def existing_hash(h):
    res = d1_query("SELECT id, hash FROM questions WHERE hash = ?", [h])
    try:
        results = res["result"][0]["results"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError(f"unexpected D1 response shape: {res}")
    return results[0]["id"] if results else None


def insert_question(row, ts):
    text_raw = row["question"]
    text_norm = normalize_question(text_raw)
    h = sha256_hex(text_norm)
    engines = row["engines"]
    sources = ["prompt_batch"] + [f"engine:{e}" for e in engines]
    sql = (
        "INSERT INTO questions "
        "(ts_first, ts_last, text_raw, text_norm, hash, count, sources, matched_claim_ids, gap, published) "
        "VALUES (?,?,?,?,?,?,?,?,1,1)"
    )
    params = [ts, ts, text_raw, text_norm, h, len(engines), json.dumps(sources), json.dumps([])]
    res = d1_query(sql, params)
    try:
        meta = res["result"][0]["meta"]
        row_id = meta.get("last_row_id")
    except (KeyError, IndexError, TypeError):
        row_id = None
    return row_id, h, text_norm, sources


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--live", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(DOC_PATH):
        print(f"batch doc not found at {DOC_PATH}", file=sys.stderr)
        sys.exit(1)

    rows = parse_table(DOC_PATH)
    if not rows:
        print("no question rows parsed from the batch doc table", file=sys.stderr)
        sys.exit(1)

    # em dash guard: refuse to seed any text containing an em dash.
    em_dash_rows = [r["n"] for r in rows if "—" in r["question"]]
    if em_dash_rows:
        print(f"refusing to run: em dash found in question row(s) {em_dash_rows}", file=sys.stderr)
        sys.exit(1)

    print(f"parsed {len(rows)} question rows from {DOC_PATH}")

    ts = iso_now()
    to_insert = []
    skipped = []
    seen_hashes_this_run = set()

    for row in rows:
        text_norm = normalize_question(row["question"])
        h = sha256_hex(text_norm)
        if h in seen_hashes_this_run:
            skipped.append((row["n"], row["question"], h, "duplicate within batch"))
            continue
        seen_hashes_this_run.add(h)
        existing_id = existing_hash(h)
        if existing_id is not None:
            skipped.append((row["n"], row["question"], h, f"already in DB as id {existing_id}"))
            continue
        to_insert.append(row)

    print(f"to insert: {len(to_insert)}")
    print(f"to skip (already present or duplicate): {len(skipped)}")
    for n, q, h, reason in skipped:
        print(f"  skip n={n} hash={h[:12]} reason={reason} question={q!r}")

    if args.dry_run:
        print("\n--dry-run: no writes performed")
        for row in to_insert:
            text_norm = normalize_question(row["question"])
            h = sha256_hex(text_norm)
            sources = ["prompt_batch"] + [f"engine:{e}" for e in row["engines"]]
            print(f"  would insert n={row['n']} hash={h[:12]} count={len(row['engines'])} "
                  f"sources={sources} text_raw={row['question']!r}")
        return

    inserted = []
    for row in to_insert:
        row_id, h, text_norm, sources = insert_question(row, ts)
        inserted.append({
            "id": row_id, "n": row["n"], "hash": h, "text_raw": row["question"],
            "text_norm": text_norm, "sources": sources, "count": len(row["engines"]),
        })
        print(f"inserted id={row_id} n={row['n']} hash={h[:12]} text_raw={row['question']!r}")

    # Appends a dated run section to the log; never truncates it. Earlier
    # runs' sections (including ones added by hand, such as merged-row
    # tables) stay intact below the file's single leading H1.
    log_lines = []
    log_lines.append(f"## Run at {ts}")
    log_lines.append("")
    log_lines.append("Source table: docs/prompt-batch-2026-09-15.md.")
    log_lines.append(f"Inserted {len(inserted)}, skipped {len(skipped)} (already present or duplicate within batch).")
    log_lines.append("")
    log_lines.append("| id | n | hash | count | sources | text_raw |")
    log_lines.append("|---|---|---|---|---|---|")
    for r in inserted:
        log_lines.append(
            f"| {r['id']} | {r['n']} | {r['hash'][:12]} | {r['count']} | "
            f"{', '.join(r['sources'])} | {r['text_raw']} |"
        )
    log_lines.append("")
    log_lines.append("### Skipped")
    log_lines.append("")
    log_lines.append("| n | hash | reason | text_raw |")
    log_lines.append("|---|---|---|---|")
    for n, q, h, reason in skipped:
        log_lines.append(f"| {n} | {h[:12]} | {reason} | {q} |")
    log_lines.append("")

    is_new_file = not os.path.exists(LOG_PATH)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        if is_new_file:
            f.write("# Seed questions log (2026-09-15)\n\n")
        f.write("\n".join(log_lines) + "\n")
    print(f"\nappended run to {LOG_PATH}")


if __name__ == "__main__":
    main()
