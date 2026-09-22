#!/usr/bin/env python3
"""
wayback.py -- Save Page Now archiving (spec section 6, "At publish").

Two modes:

  1. Batch (default): for every source the admin API reports has no
     wayback_url, try to archive it and POST wayback_url + wayback_saved_at
     back to /admin/sources/<id>/wayback. Used by the nightly/backfill run
     and by newsdesk.py after a publish.
  2. Single URL (`--url URL [--source-id ID]`): archive one URL at publish
     time. Without --source-id, prints the snapshot URL to stdout instead
     of posting (so a caller can capture it) -- with --source-id, posts it.

Method, per spec section 6:
  - Query http://archive.org/wayback/available?url=<url> first; reuse a
    snapshot under 7 days old.
  - Otherwise GET https://web.archive.org/save/<url> (UA twon-archive/1.0,
    60s timeout), or SPN2 (POST https://web.archive.org/save with
    `Authorization: LOW key:secret`, poll /save/status/<job_id> every 5s
    for up to 2 minutes) when WAYBACK_ACCESS_KEY/WAYBACK_SECRET_KEY are set.
  - Re-query the availability API and take archived_snapshots.closest.url.
  - One save per 15 seconds. Failures increment archive_attempts; retried
    up to 5 attempts total (tracked by the admin API, not locally).

Usage:
  python3 wayback.py [--limit N] [--dry-run] [--base URL] [--max-failures N]
  python3 wayback.py --url https://example.com/story [--source-id 123]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import common  # noqa: E402

SCRIPT = "wayback"
AVAILABLE_URL = "http://archive.org/wayback/available"
SAVE_URL = "https://web.archive.org/save/"
SPN2_URL = "https://web.archive.org/save"
SPN2_STATUS_URL = "https://web.archive.org/save/status/"
SAVE_UA = "twon-archive/1.0"
SAVE_TIMEOUT = 60.0
SECONDS_BETWEEN_SAVES = 8  # sleep 5-10s between saves, per the brief
MAX_SNAPSHOT_AGE_DAYS = 7


def _get_json(url: str, headers: Optional[dict] = None, timeout: float = 20.0) -> Any:
    req = urllib.request.Request(url, headers=headers or {"User-Agent": SAVE_UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def check_available(url: str) -> Optional[Dict[str, Any]]:
    """Query the availability API. Returns the closest snapshot dict, or
    None if there isn't one (or under MAX_SNAPSHOT_AGE_DAYS old check is
    left to the caller, which compares timestamp)."""
    q = urllib.parse.urlencode({"url": url})
    try:
        data = _get_json(f"{AVAILABLE_URL}?{q}")
    except Exception as exc:  # noqa: BLE001
        common.log(SCRIPT, "available_error", url=url, error=str(exc))
        return None
    closest = data.get("archived_snapshots", {}).get("closest")
    if closest and closest.get("available"):
        return closest
    return None


def snapshot_is_fresh(snapshot: Dict[str, Any]) -> bool:
    ts = snapshot.get("timestamp", "")  # YYYYMMDDHHMMSS
    try:
        saved = time.strptime(ts[:14], "%Y%m%d%H%M%S")
    except ValueError:
        return False
    age_days = (time.time() - time.mktime(saved)) / 86400.0
    return age_days <= MAX_SNAPSHOT_AGE_DAYS


def save_simple(url: str) -> bool:
    """GET https://web.archive.org/save/<url>. Returns True on apparent
    success (2xx/3xx); does not itself return the snapshot URL -- caller
    re-queries the availability API."""
    target = SAVE_URL + url
    req = urllib.request.Request(target, headers={"User-Agent": SAVE_UA})
    try:
        with urllib.request.urlopen(req, timeout=SAVE_TIMEOUT) as resp:
            return 200 <= resp.status < 400
    except urllib.error.HTTPError as exc:
        # Save Page Now often 302s through a job page, and 429 usually
        # means "already captured / try the availability API"; treat both
        # as soft successes. Anything else is a failure.
        return exc.code in (302, 429)
    except Exception as exc:  # noqa: BLE001
        common.log(SCRIPT, "save_simple_error", url=url, error=str(exc))
        return False


def save_spn2(url: str, access_key: str, secret_key: str) -> bool:
    """POST https://web.archive.org/save with SPN2, poll job status."""
    data = urllib.parse.urlencode({"url": url}).encode("utf-8")
    req = urllib.request.Request(
        SPN2_URL,
        data=data,
        method="POST",
        headers={
            "Authorization": f"LOW {access_key}:{secret_key}",
            "Accept": "application/json",
            "User-Agent": SAVE_UA,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=SAVE_TIMEOUT) as resp:
            job = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        common.log(SCRIPT, "spn2_submit_error", url=url, error=str(exc))
        return False

    job_id = job.get("job_id")
    if not job_id:
        return False

    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        time.sleep(5)
        try:
            status = _get_json(
                SPN2_STATUS_URL + job_id,
                headers={"Authorization": f"LOW {access_key}:{secret_key}", "User-Agent": SAVE_UA},
            )
        except Exception as exc:  # noqa: BLE001
            common.log(SCRIPT, "spn2_status_error", url=url, job_id=job_id, error=str(exc))
            continue
        state = status.get("status")
        if state == "success":
            return True
        if state == "error":
            common.log(SCRIPT, "spn2_error", url=url, job_id=job_id, detail=status)
            return False
    common.log(SCRIPT, "spn2_timeout", url=url, job_id=job_id)
    return False


def archive_one(url: str) -> Optional[Dict[str, str]]:
    """Full archive-one-URL flow. Returns {"wayback_url", "wayback_saved_at"}
    on success, None on failure."""
    fresh = check_available(url)
    if fresh and snapshot_is_fresh(fresh):
        return {
            "wayback_url": fresh["url"],
            "wayback_saved_at": common.iso_now(),
        }

    access_key = os.environ.get("WAYBACK_ACCESS_KEY", "").strip()
    secret_key = os.environ.get("WAYBACK_SECRET_KEY", "").strip()
    if access_key and secret_key:
        ok = save_spn2(url, access_key, secret_key)
    else:
        ok = save_simple(url)

    if not ok:
        return None

    snapshot = check_available(url)
    if not snapshot:
        return None
    return {"wayback_url": snapshot["url"], "wayback_saved_at": common.iso_now()}


def run_batch(limit: int, dry_run: bool, base: Optional[str], max_failures: int) -> int:
    client = common.AdminClient("TWON_TOKEN_FILE_TRIAGE", base_url=base)
    due = client.get(f"/admin/sources/without-wayback?limit={limit}") or {"sources": []}
    sources = due.get("sources", due if isinstance(due, list) else [])
    common.log(SCRIPT, "start", count=len(sources), dry_run=dry_run)

    saved = 0
    failed = 0
    consecutive_failures = 0

    for src in sources:
        if consecutive_failures >= max_failures:
            common.log(SCRIPT, "stopping_after_failures", consecutive_failures=consecutive_failures)
            break

        source_id = src["id"]
        url = src["url"]
        result = archive_one(url)

        if result:
            saved += 1
            consecutive_failures = 0
            common.log(SCRIPT, "saved", source_id=source_id, url=url, wayback_url=result["wayback_url"])
            if not dry_run:
                client.post(f"/admin/sources/{source_id}/wayback", result)
        else:
            failed += 1
            consecutive_failures += 1
            common.log(SCRIPT, "failed", source_id=source_id, url=url)
            if not dry_run:
                client.post(f"/admin/sources/{source_id}/wayback", {"wayback_url": None})

        time.sleep(SECONDS_BETWEEN_SAVES)

    summary = {"total": len(sources), "saved": saved, "failed": failed, "dry_run": dry_run}
    common.log(SCRIPT, "summary", **summary)
    print(f"wayback: {len(sources)} due, {saved} saved, {failed} failed")
    return 0


def run_single(url: str, source_id: Optional[int], dry_run: bool, base: Optional[str]) -> int:
    result = archive_one(url)
    if not result:
        print(f"wayback: FAILED to archive {url}", file=sys.stderr)
        common.log(SCRIPT, "single_failed", url=url)
        return 1

    print(json.dumps(result))
    common.log(SCRIPT, "single_saved", url=url, **result)

    if source_id is not None and not dry_run:
        client = common.AdminClient("TWON_TOKEN_FILE_TRIAGE", base_url=base)
        client.post(f"/admin/sources/{source_id}/wayback", result)
        common.log(SCRIPT, "single_posted", source_id=source_id)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--base", default=None)
    ap.add_argument("--max-failures", type=int, default=8, help="stop the batch after this many consecutive failures")
    ap.add_argument("--url", default=None, help="archive a single URL instead of the batch queue")
    ap.add_argument("--source-id", type=int, default=None, help="with --url, also POST the result for this source id")
    args = ap.parse_args()

    try:
        if args.url:
            return run_single(args.url, args.source_id, args.dry_run, args.base)
        return run_batch(args.limit, args.dry_run, args.base, args.max_failures)
    except Exception as exc:  # noqa: BLE001
        common.log(SCRIPT, "fatal", error=str(exc))
        print(f"wayback: FATAL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
