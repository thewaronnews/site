#!/usr/bin/env python3
"""
indexnow.py -- ping IndexNow for changed URLs (spec sections 4.4 and 6).

IndexNow pings run from the Mac, never the Worker (L-139, L-142). Two ways
to get URLs:

  1. `--since ISO8601` (or `--since-hours N`): calls
     GET {TWON_BASE}/admin/changed-urls?since=<iso> on the admin API
     (operator, desk or publish scope) and pings every URL returned.
  2. `--urls-file PATH` or positional URLs: ping an explicit list, e.g. the
     handful of URLs a News Desk publish just touched (note, /news,
     incident).

POSTs to https://api.indexnow.org/indexnow with the site's IndexNow key
(env INDEXNOW_KEY) and keyLocation https://thewaronnews.com/<key>.txt, per
IndexNow's bulk submission format (host + key + keyLocation + urlList, one
call for up to 10,000 URLs).

Usage:
  python3 indexnow.py --since-hours 24
  python3 indexnow.py --since 2026-09-21T00:00:00Z
  python3 indexnow.py https://thewaronnews.com/news/some-note
  python3 indexnow.py --urls-file urls.txt
  python3 indexnow.py --dry-run --since-hours 24
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import common  # noqa: E402

SCRIPT = "indexnow"
INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"
MAX_URLS_PER_CALL = 10_000
SITE_HOST = "thewaronnews.com"


def get_key() -> str:
    key = os.environ.get("INDEXNOW_KEY", "").strip()
    if not key:
        raise RuntimeError("INDEXNOW_KEY is not set (see ops/README.md)")
    return key


def fetch_changed_urls(since_iso: str, base: Optional[str]) -> List[str]:
    client = common.AdminClient("TWON_TOKEN_FILE_PUBLISH", base_url=base)
    resp = client.get(f"/admin/changed-urls?since={since_iso}")
    if isinstance(resp, dict):
        return list(resp.get("urls", []))
    if isinstance(resp, list):
        return list(resp)
    return []


def ping(urls: List[str], dry_run: bool) -> int:
    if not urls:
        print("indexnow: no URLs to ping")
        common.log(SCRIPT, "noop", reason="empty url list")
        return 0

    key = get_key()
    body = {
        "host": SITE_HOST,
        "key": key,
        "keyLocation": f"https://{SITE_HOST}/{key}.txt",
        "urlList": urls[:MAX_URLS_PER_CALL],
    }

    if dry_run:
        print(f"indexnow: DRY RUN, would ping {len(body['urlList'])} URL(s)")
        for u in body["urlList"][:20]:
            print(f"  {u}")
        if len(body["urlList"]) > 20:
            print(f"  ... and {len(body['urlList']) - 20} more")
        common.log(SCRIPT, "dry_run", count=len(body["urlList"]))
        return 0

    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        INDEXNOW_ENDPOINT,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": "twon-indexnow/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
    except urllib.error.HTTPError as exc:
        status = exc.code

    common.log(SCRIPT, "pinged", count=len(body["urlList"]), status=status)
    print(f"indexnow: pinged {len(body['urlList'])} URL(s), HTTP {status}")
    # IndexNow returns 200 (OK) or 202 (Accepted, key not yet crawled); both
    # are success. 400/403/422/429 indicate a problem worth surfacing.
    return 0 if status in (200, 202) else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("urls", nargs="*", help="explicit URLs to ping")
    ap.add_argument("--urls-file", default=None, help="file with one URL per line")
    ap.add_argument("--since", default=None, help="ISO8601 timestamp; pings everything changed since then")
    ap.add_argument("--since-hours", type=float, default=None, help="shorthand for --since <now minus N hours>")
    ap.add_argument("--base", default=None, help="override TWON_BASE")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    urls: List[str] = list(args.urls)

    if args.urls_file:
        urls.extend(
            line.strip()
            for line in Path(args.urls_file).read_text(encoding="utf-8").splitlines()
            if line.strip()
        )

    since_iso = args.since
    if args.since_hours is not None:
        since_iso = (datetime.now(timezone.utc) - timedelta(hours=args.since_hours)).strftime("%Y-%m-%dT%H:%M:%SZ")

    if since_iso:
        try:
            urls.extend(fetch_changed_urls(since_iso, args.base))
        except Exception as exc:  # noqa: BLE001
            common.log(SCRIPT, "changed_urls_error", error=str(exc))
            print(f"indexnow: could not fetch changed-urls: {exc}", file=sys.stderr)
            if not urls:
                return 1

    # de-duplicate, preserve order
    seen = set()
    deduped = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            deduped.append(u)

    try:
        return ping(deduped, args.dry_run)
    except Exception as exc:  # noqa: BLE001
        common.log(SCRIPT, "fatal", error=str(exc))
        print(f"indexnow: FATAL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
