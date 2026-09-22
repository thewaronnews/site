#!/usr/bin/env python3
"""
Editor command: set (or clear) a question's matched_claim_ids and its gap
flag, via the D1 HTTP query API, the same way publish-claims.py does.

Usage:
  set-matched-claims.py <question-hash-or-id> <claim_id> [<claim_id> ...] [--dry-run]
  set-matched-claims.py <question-hash-or-id> --clear [--dry-run]

<question-hash-or-id> is the question's hash (as it appears in the URL
/questions/<hash>) or its numeric questions.id.

Semantics (matches how gap and matched_claim_ids are read elsewhere in the
codebase -- see routes.js questionsHandler/questionDetailHandler and
crawlerDetailHandler's entity-to-question join):
  - matched_claim_ids is a JSON array of claims.id values.
  - gap = 0 when matched_claim_ids is non-empty (the question resolves to
    at least one claim); gap = 1 when it is empty (--clear, or nothing was
    ever matched). gap is independent of the `published` flag: a
    published question can still be gap=1, and an unpublished question can
    already carry matched_claim_ids.
  - every claim id given must exist and have status='current'. A
    superseded or disputed claim is never a valid new match; an editor
    who wants to point a question at the claim that replaced it passes
    the new claim's id instead.

Every edit appends one line to claims/matched-claims-log.md (UTC
timestamp, question hash, old value, new value), so a bad edit can be
found and reverted by hand.

Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the
environment (source secrets.env first), exactly like publish-claims.py.
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

# RSBM_ROOT overrides the checkout location (the mount moved to
# ~/mnt/Crank/rattlesnakesbymail.com); the default matches
# publish-claims.py's own default and is unchanged.
ROOT = os.environ.get("RSBM_ROOT") or os.path.expanduser("~/mnt/rattlesnakesbymail.com")
CLAIMS_DIR = os.path.join(ROOT, "claims")
LOG_PATH = os.path.join(CLAIMS_DIR, "matched-claims-log.md")
D1_UUID = "92b99e81-233c-4c97-b787-d8eb71ef876d"


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


def d1_rows(sql, params=None):
    res = d1_query(sql, params)
    result = res.get("result") or [{}]
    return (result[0] or {}).get("results") or []


def isoNow():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def find_question(ref):
    if ref.isdigit():
        rows = d1_rows("SELECT * FROM questions WHERE id = ?", [int(ref)])
    else:
        rows = d1_rows("SELECT * FROM questions WHERE hash = ?", [ref])
    return rows[0] if rows else None


def find_current_claim(claim_id):
    rows = d1_rows("SELECT * FROM claims WHERE id = ? AND status = 'current'", [claim_id])
    return rows[0] if rows else None


def append_log(question_hash, old_value, new_value):
    os.makedirs(CLAIMS_DIR, exist_ok=True)
    line = f"- {isoNow()} question={question_hash} old={old_value} new={new_value}\n"
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line)
    return line


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("question_ref", help="question hash (from /questions/<hash>) or numeric questions.id")
    ap.add_argument("claim_ids", nargs="*", type=int, help="one or more claims.id values, each must be status='current'")
    ap.add_argument("--clear", action="store_true", help="clear matched_claim_ids to [] and set gap=1")
    ap.add_argument("--dry-run", action="store_true", help="validate and print, but do not write")
    args = ap.parse_args()

    if args.clear and args.claim_ids:
        ap.error("--clear takes no claim ids")
    if not args.clear and not args.claim_ids:
        ap.error("at least one claim_id is required, or pass --clear")

    question = find_question(args.question_ref)
    if not question:
        print(f"No question found for {args.question_ref!r}.", file=sys.stderr)
        sys.exit(1)

    old_matched_raw = question.get("matched_claim_ids") or "[]"
    try:
        old_matched = json.loads(old_matched_raw)
    except (TypeError, ValueError):
        old_matched = []

    print("Before:")
    print(f"  question id={question['id']} hash={question['hash']}")
    print(f"  text_raw={question.get('text_raw')!r}")
    print(f"  matched_claim_ids={old_matched_raw}  gap={question.get('gap')}")

    if args.clear:
        new_ids = []
    else:
        new_ids = []
        seen = set()
        for cid in args.claim_ids:
            if cid in seen:
                continue
            seen.add(cid)
            claim = find_current_claim(cid)
            if not claim:
                print(f"claim {cid} does not exist, or is not status='current'. Aborting; nothing was written.", file=sys.stderr)
                sys.exit(1)
            print(f"  validated claim {cid}: entity_id={claim.get('entity_id')} field={claim.get('field')!r} statement={claim.get('statement')!r}")
            new_ids.append(cid)

    new_gap = 0 if new_ids else 1
    new_matched_raw = json.dumps(new_ids)

    print("\nAfter (pending write)" if not args.dry_run else "\nAfter (dry run, not written)")
    print(f"  matched_claim_ids={new_matched_raw}  gap={new_gap}")

    if args.dry_run:
        print("\nDry run: no write performed, nothing logged.")
        return

    d1_query(
        "UPDATE questions SET matched_claim_ids = ?, gap = ? WHERE id = ?",
        [new_matched_raw, new_gap, question["id"]],
    )
    line = append_log(question["hash"], old_matched_raw, new_matched_raw)

    confirm_rows = d1_rows("SELECT matched_claim_ids, gap FROM questions WHERE id = ?", [question["id"]])
    confirmed = confirm_rows[0] if confirm_rows else {}
    print(f"\nWritten. Confirmed from D1: matched_claim_ids={confirmed.get('matched_claim_ids')}  gap={confirmed.get('gap')}")
    print(f"Logged: {line.strip()}")


if __name__ == "__main__":
    main()
