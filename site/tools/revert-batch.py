#!/usr/bin/env python3
"""
Revert a claims/changes publish batch logged by publish-claims.py.

Reads claims/publish-log-2026-09-14.md (or a --log-file you pass), finds the
fenced ```json machine-readable record for the given --batch label, and
deletes the changes rows first, then the claims rows, by the exact ids
logged. Prints before/after counts. Safe to re-run: a second run finds
nothing left to delete and reports zero.

Usage:
  python3 revert-batch.py --batch p03-seed-2026-09-14 --dry-run
  python3 revert-batch.py --batch p03-seed-2026-09-14 --live
"""
import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error

ROOT = os.path.expanduser("~/mnt/rattlesnakesbymail.com")
DEFAULT_LOG = os.path.join(ROOT, "claims", "publish-log-2026-09-14.md")
D1_UUID = "92b99e81-233c-4c97-b787-d8eb71ef876d"


def d1_query(sql, params=None):
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{D1_UUID}/query"
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


def find_batch_records(log_text, batch_label):
    """A publish log may contain more than one machine-readable block
    (multiple runs appended). Return every record matching batch_label."""
    records = []
    for m in re.finditer(r"```json\s*\n(.*?)\n```", log_text, re.S):
        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        if data.get("batch_label") == batch_label:
            records.append(data)
    return records


def chunked(seq, size=80):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def count_present(table, ids):
    total = 0
    for chunk in chunked(ids):
        placeholders = ",".join("?" for _ in chunk)
        res = d1_query(f"SELECT COUNT(*) AS n FROM {table} WHERE id IN ({placeholders})", chunk)
        total += res["result"][0]["results"][0]["n"]
    return total


def delete_by_ids(table, ids):
    total = 0
    for chunk in chunked(ids):
        placeholders = ",".join("?" for _ in chunk)
        res = d1_query(f"DELETE FROM {table} WHERE id IN ({placeholders})", chunk)
        result0 = res["result"][0]
        if not result0.get("success"):
            print(f"DELETE {table} failed:", res, file=sys.stderr)
            sys.exit(1)
        total += result0["meta"].get("changes", 0)
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", required=True, help="batch label, e.g. p03-seed-2026-09-14")
    ap.add_argument("--log-file", default=DEFAULT_LOG)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--live", action="store_true")
    args = ap.parse_args()

    with open(args.log_file, encoding="utf-8") as f:
        log_text = f.read()

    records = find_batch_records(log_text, args.batch)
    if not records:
        print(f"No machine-readable record found for batch {args.batch!r} in {args.log_file}", file=sys.stderr)
        sys.exit(1)

    claim_ids = sorted({cid for r in records for cid in r.get("claim_ids", [])})
    change_ids = sorted({chid for r in records for chid in r.get("change_ids", [])})

    print(f"Batch {args.batch}: {len(claim_ids)} claim ids, {len(change_ids)} change ids logged "
          f"across {len(records)} run record(s).")

    if args.dry_run:
        if change_ids:
            print("changes rows currently present matching these ids:", count_present("changes", change_ids))
        if claim_ids:
            print("claims rows currently present matching these ids:", count_present("claims", claim_ids))
        return

    # live: delete changes first (FK-ish ordering), then claims
    deleted_changes = delete_by_ids("changes", change_ids) if change_ids else 0
    deleted_claims = delete_by_ids("claims", claim_ids) if claim_ids else 0

    print(f"Deleted {deleted_changes} changes rows and {deleted_claims} claims rows for batch {args.batch}.")


if __name__ == "__main__":
    main()
