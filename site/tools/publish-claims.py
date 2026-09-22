#!/usr/bin/env python3
"""
P0.3 claims publisher for rattlesnakesbymail.com.

Parses entity claim tables under claims/ and inserts one claims row plus
one changes row per table row via the D1 HTTP query API. Every claim row
and change row inserted is appended to a publish log (default
claims/publish-log-2026-09-14.md, override with --log) under a batch
label so it can be found and reverted later with revert-batch.py.

Table format: markdown pipe table with either 9 columns
  field | value | statement | evidence_url | evidence_quote | verified_at | confidence | flag | note
or 10 columns (evidence_date inserted after evidence_quote)
  field | value | statement | evidence_url | evidence_quote | evidence_date | verified_at | confidence | flag | note
Column count is auto-detected per file. When the file has no evidence_date
column, evidence_date is looked up from the harvested URL map instead
(claims/evidence-dates-2026-09-14.json, or the --evidence-dates path).
When the file DOES have an evidence_date column, that column's value is
used as-is (blank = NULL) and the URL map is not consulted for that row.

Default behaviour (no --files/--batch-label/etc): publishes all entity
tables except bingbot.md (held) and the googlebot.md reads_llms_txt row
(held, draft-then-promote), exactly as the original P0.3 batch did.
Method defaults to vendor_doc; pass --method to write a different one
(observed_here, third_party, test_here) for every row in the run.

Multi-entity files (P1.1): a file that holds more than one entity's
table under separate '## <slug>' H2 headings (instead of the usual one
file per entity, named by slug) is parsed with --multi-entity-file. Each
heading that looks like an entity slug (lowercase letters, digits and
hyphens, no spaces) starts a new entity's table; any other heading
(e.g. a '/method paragraph (draft)' or 'Owner's rulings' section) is not
an entity slug and its lines are ignored for claim parsing.

Usage:
  python3 publish-claims.py --dry-run
  python3 publish-claims.py --live
  # second batch: bingbot only, all 11 rows, its own evidence_date column
  python3 publish-claims.py --files bingbot.md --batch-label p03-bing-2026-09-14 \
      --changed-at 2026-09-14 --dry-run
  # second batch: promote just the googlebot reads_llms_txt row
  python3 publish-claims.py --files googlebot.md --only-fields googlebot:reads_llms_txt \
      --batch-label p03-google-llms-2026-09-14 --changed-at 2026-09-14 --dry-run
  # observed_here batch: one file, five entities under H2 headings
  python3 publish-claims.py --files observed-here-2026-09-17.md --multi-entity-file \
      --method observed_here --batch-label p1-observed-here-2026-09-17 \
      --log claims/publish-log-2026-09-17.md --dry-run
"""
import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

# RSBM_ROOT overrides the checkout location (the mount moved to
# ~/mnt/Crank/rattlesnakesbymail.com); the default is unchanged.
ROOT = os.environ.get("RSBM_ROOT") or os.path.expanduser("~/mnt/rattlesnakesbymail.com")
CLAIMS_DIR = os.path.join(ROOT, "claims")
DEFAULT_LOG_PATH = os.path.join(CLAIMS_DIR, "publish-log-2026-09-14.md")
DEFAULT_EVIDENCE_DATES_PATH = os.path.join(CLAIMS_DIR, "evidence-dates-2026-09-14.json")
D1_UUID = "92b99e81-233c-4c97-b787-d8eb71ef876d"
METHOD_CHOICES = ["vendor_doc", "observed_here", "third_party", "test_here"]
DEFAULT_METHOD = "vendor_doc"

EXCLUDE_FILES = {
    "bingbot.md",
    "architect-decisions-2026-09-13.md",
    "for-architect-2026-09-13.md",
    "review-pack-2026-09-13.md",
    "sources-2026-09-13.md",
    "googlebot-llms-txt-2026-09-14.md",
}

DEFAULT_HELD_ROWS = {("googlebot", "reads_llms_txt")}

# Matches an H2 heading that looks like an entity slug: lowercase letters,
# digits and hyphens only, no spaces. Used by --multi-entity-file to split
# one file into several entities' tables and to skip non-entity sections
# (a heading with spaces, punctuation or a leading slash never matches).
ENTITY_HEADING_RE = re.compile(r"^##\s+([a-z0-9][a-z0-9-]*)\s*$")


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


def isoNow():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_changed_at(value):
    """Accepts a bare date, a full UTC timestamp, or nothing (defaults to
    now in UTC). changes.changed_at is a full UTC timestamp for every row
    written from 2026-09-17 on (migration 0009 backfilled the earlier
    date-only rows to midnight UTC), so a bare date given here gets the
    same normalisation applied at write time."""
    if not value:
        return isoNow()
    v = value.strip()
    if len(v) == 10 and v[4] == "-" and v[7] == "-":
        return f"{v}T00:00:00Z"
    return v


def parse_table_lines(lines):
    """Auto-detects 9-column (no evidence_date) or 10-column (with
    evidence_date, after evidence_quote) pipe tables in an iterable of
    lines. Shared by parse_table (whole file) and the --multi-entity-file
    per-section parser."""
    rows = []
    seen_sep = False
    for line in lines:
        line = line.rstrip("\n")
        if line.startswith("|---"):
            seen_sep = True
            continue
        if not seen_sep:
            continue
        if not line.startswith("| "):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 10:
            (field, value, statement, evidence_url, evidence_quote,
             evidence_date_cell, verified_at, confidence, flag, note) = cells
            has_date_col = True
        elif len(cells) == 9:
            (field, value, statement, evidence_url, evidence_quote,
             verified_at, confidence, flag, note) = cells
            evidence_date_cell = ""
            has_date_col = False
        else:
            raise ValueError(f"expected 9 or 10 cells, got {len(cells)}: {line}")
        rows.append({
            "field": field,
            "value": value,
            "statement": statement,
            "evidence_url": evidence_url if evidence_url and evidence_url != "(none)" else None,
            "evidence_quote_raw": evidence_quote,
            "evidence_date_cell": evidence_date_cell,
            "has_date_col": has_date_col,
            "verified_at_raw": verified_at,
            "confidence_raw": confidence,
            "flag": flag,
            "note": note,
        })
    return rows


def parse_table(path):
    with open(path, encoding="utf-8") as f:
        return parse_table_lines(f.readlines())


def split_multi_entity_sections(path):
    """Splits a markdown file on '## <slug>' H2 headings that match
    ENTITY_HEADING_RE. Returns a list of (slug, [lines]) pairs, one per
    matching heading, in file order. Any content before the first
    matching heading, and any section whose heading does not match (for
    example a '/method paragraph (draft)' or 'Owner's rulings' section),
    is not an entity slug and is left out entirely."""
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    sections = []
    current_slug = None
    current_lines = []
    for line in lines:
        m = ENTITY_HEADING_RE.match(line.rstrip("\n"))
        if m:
            if current_slug is not None:
                sections.append((current_slug, current_lines))
            current_slug = m.group(1)
            current_lines = []
            continue
        if current_slug is not None:
            current_lines.append(line)
    if current_slug is not None:
        sections.append((current_slug, current_lines))
    return sections


def clean_quote(raw):
    if raw is None or raw.strip() == "(none)" or raw.strip() == "":
        return None
    return raw.replace('\\"', '"')


def clean_confidence(raw):
    v = raw.strip()
    if v == "n/a":
        return None
    if v in ("high", "medium", "low"):
        return v
    raise ValueError(f"unexpected confidence value: {raw!r}")


def entity_slug_from_filename(fn):
    return fn[:-3]  # strip .md


def load_evidence_dates(path):
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


def get_entity_map():
    res = d1_query("SELECT id, slug FROM entities")
    results = res["result"][0]["results"]
    return {r["slug"]: r["id"] for r in results}


def build_batch(files, held_rows, only_fields, evidence_dates_path, evidence_date_override=None,
                 multi_entity_file=False):
    evidence_dates = load_evidence_dates(evidence_dates_path)
    override_url, override_date = (None, None)
    if evidence_date_override:
        override_url, override_date = evidence_date_override.split("=", 1)
    batch = []  # list of (entity_slug, [rows])
    for fn in files:
        path = os.path.join(CLAIMS_DIR, fn)
        if multi_entity_file:
            file_sections = split_multi_entity_sections(path)
        else:
            file_sections = [(entity_slug_from_filename(fn), None)]
        for slug, section_lines in file_sections:
            rows = parse_table_lines(section_lines) if multi_entity_file else parse_table(path)
            kept = []
            for r in rows:
                if only_fields is not None:
                    if (slug, r["field"]) not in only_fields:
                        continue
                else:
                    if (slug, r["field"]) in held_rows:
                        continue
                r["entity_slug"] = slug
                r["evidence_quote"] = clean_quote(r["evidence_quote_raw"])
                r["confidence"] = clean_confidence(r["confidence_raw"])
                r["verified_at"] = r["verified_at_raw"].strip()
                if r["has_date_col"]:
                    cell = r["evidence_date_cell"].strip()
                    r["evidence_date"] = cell if cell else None
                else:
                    r["evidence_date"] = evidence_dates.get(r["evidence_url"]) if r["evidence_url"] else None
                if r["evidence_date"] is None and override_url and r["evidence_url"] == override_url:
                    r["evidence_date"] = override_date
                kept.append(r)
            batch.append((slug, kept))
    return batch


def resolve_files(args):
    if args.files:
        return [f.strip() for f in args.files.split(",") if f.strip()]
    return sorted(
        f for f in os.listdir(CLAIMS_DIR)
        if f.endswith(".md") and f not in EXCLUDE_FILES
    )


def resolve_only_fields(args):
    if not args.only_fields:
        return None
    out = set()
    for pair in args.only_fields.split(","):
        pair = pair.strip()
        if not pair:
            continue
        slug, field = pair.split(":", 1)
        out.add((slug.strip(), field.strip()))
    return out


def resolve_held_rows(args):
    if args.held is None:
        return DEFAULT_HELD_ROWS
    out = set()
    for pair in args.held.split(","):
        pair = pair.strip()
        if not pair:
            continue
        slug, field = pair.split(":", 1)
        out.add((slug.strip(), field.strip()))
    return out


def resolve_log_path(args):
    return args.log if args.log else DEFAULT_LOG_PATH


def dry_run(args):
    files = resolve_files(args)
    held_rows = resolve_held_rows(args)
    only_fields = resolve_only_fields(args)
    batch = build_batch(files, held_rows, only_fields, args.evidence_dates, args.evidence_date_override,
                         multi_entity_file=args.multi_entity_file)
    total = 0
    print(f"method={args.method} log={resolve_log_path(args)}")
    print(f"{'entity':<20} {'rows':>5}")
    for slug, rows in batch:
        print(f"{slug:<20} {len(rows):>5}")
        for r in rows:
            print(f"    {r['field']:<40} value={r['value']!r} confidence={r['confidence']!r} "
                  f"evidence_date={r['evidence_date']!r} verified_at={r['verified_at']!r}")
        total += len(rows)
    print(f"{'TOTAL':<20} {total:>5}")
    return batch


def live_run(args):
    files = resolve_files(args)
    held_rows = resolve_held_rows(args)
    only_fields = resolve_only_fields(args)
    batch = build_batch(files, held_rows, only_fields, args.evidence_dates, args.evidence_date_override,
                         multi_entity_file=args.multi_entity_file)
    entity_map = get_entity_map()
    now = isoNow()
    method = args.method
    log_path = resolve_log_path(args)
    log_lines = []
    all_claim_ids = []
    all_change_ids = []
    per_entity_summary = []

    for slug, rows in batch:
        if not rows:
            continue
        entity_id = entity_map.get(slug)
        if entity_id is None:
            print(f"ERROR: no entity found for slug {slug}", file=sys.stderr)
            sys.exit(1)
        entity_claim_ids = []
        entity_change_ids = []
        for r in rows:
            claim_slug = f"{slug}/{r['field']}"
            insert_sql = (
                "INSERT INTO claims "
                "(entity_id, slug, field, value, statement, evidence_url, evidence_quote, "
                "evidence_date, method, verified_at, confidence, status, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            )
            params = [
                entity_id, claim_slug, r["field"], r["value"], r["statement"],
                r["evidence_url"], r["evidence_quote"], r["evidence_date"],
                method, r["verified_at"], r["confidence"], "current", now, now,
            ]
            res = d1_query(insert_sql, params)
            result0 = res["result"][0]
            if not result0.get("success"):
                print(f"INSERT FAILED for {claim_slug}: {res}", file=sys.stderr)
                sys.exit(1)
            claim_id = result0["meta"]["last_row_id"]
            entity_claim_ids.append((claim_id, r["field"]))

            changes_sql = (
                "INSERT INTO changes (claim_id, entity_id, changed_at, kind, old_value, new_value, evidence_url, note) "
                "VALUES (?,?,?,?,?,?,?,?)"
            )
            cparams = [claim_id, entity_id, args.changed_at, "new", None, r["value"], r["evidence_url"], args.change_note]
            cres = d1_query(changes_sql, cparams)
            cresult0 = cres["result"][0]
            if not cresult0.get("success"):
                print(f"CHANGES INSERT FAILED for claim {claim_id}: {cres}", file=sys.stderr)
                sys.exit(1)
            change_id = cresult0["meta"]["last_row_id"]
            entity_change_ids.append(change_id)

        # verify count for this entity for THIS batch's rows specifically,
        # since an entity may already carry claims from an earlier batch.
        placeholders = ",".join("?" for _ in entity_claim_ids)
        count_res = d1_query(
            f"SELECT COUNT(*) AS n FROM claims WHERE id IN ({placeholders})",
            [cid for cid, _ in entity_claim_ids],
        )
        n = count_res["result"][0]["results"][0]["n"]
        expected = len(rows)
        ok = "OK" if n == expected else "MISMATCH"
        print(f"{slug}: inserted {len(rows)} claims, DB count present for these ids = {n} ({ok})")
        per_entity_summary.append((slug, len(rows), n, ok))

        all_claim_ids.extend(cid for cid, _ in entity_claim_ids)
        all_change_ids.extend(entity_change_ids)

        log_lines.append(f"### {slug}")
        for (cid, field), chid in zip(entity_claim_ids, entity_change_ids):
            log_lines.append(f"- claim_id={cid} change_id={chid} field={field}")
        log_lines.append("")

    if not all_claim_ids:
        print("Nothing to publish (batch was empty).")
        return

    header = [
        f"# Publish log: batch {args.batch_label}",
        "",
        f"Run at {now}. Published {len(all_claim_ids)} claims and {len(all_change_ids)} changes "
        f"across {len([b for b in batch if b[1]])} entities. method={method}. changed_at={args.changed_at}.",
        "",
        "## Per-entity summary",
        "",
        "| entity | rows published | DB count after | check |",
        "|---|---|---|---|",
    ]
    for slug, published, n, ok in per_entity_summary:
        header.append(f"| {slug} | {published} | {n} | {ok} |")
    header.append("")
    header.append("## Inserted ids by entity")
    header.append("")

    footer = [
        "",
        "## Machine-readable batch record (used by revert-batch.py)",
        "",
        "```json",
        json.dumps({
            "batch_label": args.batch_label,
            "run_at": now,
            "method": method,
            "claim_ids": all_claim_ids,
            "change_ids": all_change_ids,
        }, indent=2),
        "```",
        "",
    ]

    with open(log_path, "a", encoding="utf-8") as f:
        f.write("\n".join(header + log_lines + footer))

    print(f"\nLogged to {log_path}")
    print(f"Total claims inserted: {len(all_claim_ids)} (ids {min(all_claim_ids)}-{max(all_claim_ids)})")
    print(f"Total changes inserted: {len(all_change_ids)} (ids {min(all_change_ids)}-{max(all_change_ids)})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--live", action="store_true")
    ap.add_argument("--files", default=None,
                    help="comma-separated list of claims/*.md filenames to publish from "
                         "(default: all except bingbot.md and non-table docs)")
    ap.add_argument("--batch-label", default="p03-seed-2026-09-14")
    ap.add_argument("--changed-at", default=None,
                    help="an ISO date (YYYY-MM-DD) or a full UTC timestamp "
                         "(YYYY-MM-DDTHH:MM:SSZ); a bare date is normalised to "
                         "midnight UTC. Defaults to now, in UTC.")
    ap.add_argument("--change-note", default="P0.3 seed batch")
    ap.add_argument("--held", default=None,
                    help="comma-separated slug:field pairs to exclude "
                         "(default: googlebot:reads_llms_txt); ignored if --only-fields is set")
    ap.add_argument("--only-fields", default=None,
                    help="comma-separated slug:field pairs; when set, ONLY these rows are "
                         "published (overrides --held) -- used to promote a single held row")
    ap.add_argument("--evidence-dates", default=DEFAULT_EVIDENCE_DATES_PATH,
                    help="path to the url->evidence_date JSON map, used only for rows in "
                         "tables that have no evidence_date column of their own")
    ap.add_argument("--evidence-date-override", default=None,
                    help="single 'url=date' override applied only when a row's evidence_url "
                         "matches and no date was found via its table column or the url map")
    ap.add_argument("--method", default=DEFAULT_METHOD, choices=METHOD_CHOICES,
                    help=f"claims.method value written for every row in this run "
                         f"(default: {DEFAULT_METHOD})")
    ap.add_argument("--log", default=None,
                    help="path to the publish log file to append to "
                         f"(default: {DEFAULT_LOG_PATH})")
    ap.add_argument("--multi-entity-file", action="store_true",
                    help="treat each --files entry as holding several entities' tables under "
                         "'## <slug>' H2 headings, instead of one entity per file named by slug")
    args = ap.parse_args()
    args.changed_at = normalize_changed_at(args.changed_at)
    if args.dry_run:
        dry_run(args)
    else:
        live_run(args)
