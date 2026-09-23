#!/usr/bin/env python3
"""One-off cleanup: re-decode HTML entities and strip tags in the title and
summary of every existing coverage_items row (WORKLOG TODO 28: literal
entities such as "&mdash;" and double-encoded ones such as "&amp;#8217;"
from some feeds, e.g. the Knight Institute's, were stored verbatim before
coverage.js's decodeEntities() was fixed to handle named entities and
double-encoding in the same session). Mirrors that fixed decodeEntities()
in Python so the D1 rows end up byte-identical to what a fresh ingest would
now produce. Idempotent: a row already clean is left untouched (no UPDATE
sent, no bump to updated_at). Direct D1 HTTP API (same pattern as
deploy.sh's d1_query), since no admin endpoint edits coverage_items text.

Usage: python3 tools/cleanup-coverage-entities-2026-09-22.py [--dry-run]
"""
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def load_secrets():
    for f in [os.environ.get("SECRETS_FILE"), os.path.join(HERE, "..", "..", "secrets.env"),
              os.path.expanduser("~/.twon/secrets.env"), "/home/claude/.twon/secrets.env"]:
        if f and os.path.isfile(f):
            env = {}
            for line in open(f):
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
            return env
    print("no secrets file found", file=sys.stderr)
    sys.exit(1)


SECRETS = load_secrets()
ACCOUNT_ID = SECRETS["CLOUDFLARE_ACCOUNT_ID"]
API_TOKEN = SECRETS["CLOUDFLARE_API_TOKEN"]
D1_NAME = "twon-db"
API = "https://api.cloudflare.com/client/v4"

# Same table as coverage.js's NAMED_ENTITIES (named entities feeds actually
# use beyond XML's predefined five).
NAMED_ENTITIES = {
    "quot": '"', "apos": "'", "lt": "<", "gt": ">", "amp": "&", "nbsp": " ",
    "mdash": "—", "ndash": "–", "minus": "−", "hellip": "…",
    "lsquo": "‘", "rsquo": "’", "sbquo": "‚",
    "ldquo": "“", "rdquo": "”", "bdquo": "„",
    "copy": "©", "reg": "®", "trade": "™", "middot": "·", "bull": "•",
}
NUM_RE = re.compile(r"&#(\d+);")
HEX_RE = re.compile(r"&#x([0-9a-fA-F]+);")
NAME_RE = re.compile(r"&([a-zA-Z]+);")
CDATA_RE = re.compile(r"<!\[CDATA\[([\s\S]*?)\]\]>")
TAG_RE = re.compile(r"<[^>]*>")
WS_RE = re.compile(r"\s+")


def decode_entities_once(s):
    s = NUM_RE.sub(lambda m: chr(int(m.group(1))), s)
    s = HEX_RE.sub(lambda m: chr(int(m.group(1), 16)), s)
    s = NAME_RE.sub(lambda m: NAMED_ENTITIES.get(m.group(1).lower(), m.group(0)), s)
    return s


def decode_entities(s):
    once = decode_entities_once(CDATA_RE.sub(r"\1", s or ""))
    return decode_entities_once(once)


def strip_tags(s):
    t = decode_entities(str(s or ""))
    t = TAG_RE.sub(" ", t)
    t = WS_RE.sub(" ", t).strip()
    return t


def undash_title(s):
    s = re.sub(r"\s*[—―]\s*", ": ", s)
    s = re.sub(r"\s+–\s+", ": ", s)
    return s


def undash_summary(s):
    s = re.sub(r"\s*[—―]\s*", ", ", s)
    s = re.sub(r"\s+–\s+", ", ", s)
    return s


def clean_title(raw):
    return undash_title(strip_tags(raw))[:300]


def clean_summary(raw):
    return undash_summary(strip_tags(raw))


def title_key(title):
    import unicodedata
    t = (title or "").lower()
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    stop = {"the", "and", "for", "with", "from", "that", "this", "are", "was", "has", "have",
            "its", "into", "over", "after", "amid", "says", "said", "new", "news"}
    words = sorted(w for w in t.split() if len(w) > 2 and w not in stop)
    return " ".join(words)[:300]


def d1_query(sql, params=None):
    body = {"sql": sql}
    if params is not None:
        body["params"] = params
    req = urllib.request.Request(
        f"{API}/accounts/{ACCOUNT_ID}/d1/database/{D1_UUID}/query",
        data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def find_d1_uuid():
    req = urllib.request.Request(
        f"{API}/accounts/{ACCOUNT_ID}/d1/database?name={D1_NAME}",
        headers={"Authorization": f"Bearer {API_TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    for d in data.get("result") or []:
        if d.get("name") == D1_NAME:
            return d["uuid"]
    print("D1 database twon-db not found", file=sys.stderr)
    sys.exit(1)


D1_UUID = find_d1_uuid()


def main():
    dry_run = "--dry-run" in sys.argv
    res = d1_query("SELECT id, title, summary, title_key FROM coverage_items ORDER BY id")
    rows = (res.get("result") or [{}])[0].get("results") or []
    changed = 0
    for row in rows:
        new_title = clean_title(row["title"])
        new_summary = clean_summary(row["summary"]) if row.get("summary") else row.get("summary")
        new_key = title_key(new_title)
        if new_title == row["title"] and new_summary == row.get("summary") and new_key == row["title_key"]:
            continue
        changed += 1
        print(f"row {row['id']}: {row['title']!r} -> {new_title!r}")
        if row.get("summary") != new_summary:
            print(f"         summary {row['summary']!r} -> {new_summary!r}")
        if not dry_run:
            d1_query(
                "UPDATE coverage_items SET title = ?1, summary = ?2, title_key = ?3 WHERE id = ?4",
                [new_title, new_summary, new_key, row["id"]])
    print(f"{'would change' if dry_run else 'changed'} {changed} of {len(rows)} coverage_items rows")


if __name__ == "__main__":
    main()
