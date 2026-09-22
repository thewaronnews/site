#!/usr/bin/env python3
"""
linkcheck.py -- nightly link-integrity pass (spec section 6).

Runs on the Mac Studio (launchd 02:30 America/Toronto). The Worker never
fetches third-party news URLs itself, so this script does the fetching and
only *reports* results; the Worker applies the 3-failures-over-48h hysteresis
that turns a source `dead` (never this script).

Pipeline:
  1. GET /admin/sources/due (sources unchecked for >=20 hours).
  2. Tier 1: stdlib urllib GET, current desktop Chrome UA, 15s timeout,
     follow redirects (capped), classify by status/URL/title.
  3. Tier 2 (optional): Playwright Chromium fallback for challenge-marker
     403/429/503s, only if the `playwright` package is installed (import is
     guarded; the whole tier is skipped otherwise, logged, not fatal).
  4. Jev (ambiguous pages only): one `choice` question, `page_state`, per
     section 6 step 5. Below 0.80 confidence the state is recorded as
     `error` and the prior state is kept.
  5. POST batches of 200 checks to /admin/sources/checks.

Usage:
  python3 linkcheck.py [--limit N] [--dry-run] [--base URL] [--all]

Env:
  TWON_BASE, TWON_TOKEN_FILE_TRIAGE (triage-scope token is sufficient for
  GET /admin/sources/due and POST /admin/sources/checks).

--all: the admin API's only source-listing endpoint is GET
  /admin/sources/due (spec section 8, linkstate.js dueSources()), which
  returns sources unchecked for >=20 hours. There is no "all sources"
  admin endpoint. --all instead reads the public, unauthenticated
  Frictionless export at {base}/data/json/sources.json (spec section 4.5,
  refreshed by POST /admin/export) and classifies every row there,
  regardless of last_checked. Use this for a full backfill pass (e.g. the
  first run of the day, or right after a bulk of sources was added) when
  waiting for the 20-hour due window is not what's wanted; the export
  should be run (POST /admin/export, operator scope) shortly before so the
  list is current. Ordinary nightly runs should omit --all and rely on
  /admin/sources/due as designed.
"""
from __future__ import annotations

import argparse
import gzip
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import common  # noqa: E402

SCRIPT = "linkcheck"
TIER1_TIMEOUT = 15.0  # seconds, per the task brief (the spec's own nightly
                       # job uses 20s/httpx; this urllib client uses 15s)
MAX_REDIRECTS = 5
MAX_PER_HOST_PER_SEC = 2.0
BATCH_SIZE = 200

PAYWALL_MARKERS = [
    "isaccessibleforfree\":false",
    "meter-paywall",
    "piano-paywall",
    "subscribe to continue reading",
    "subscribe to read",
    "you have reached your article limit",
]
CHALLENGE_MARKERS = [
    "cf-mitigated",
    "just a moment",
    "attention required! | cloudflare",
    "access denied",  # Akamai
    "datadome",
    "perimeterx",
    "px-captcha",
]


def build_request(url: str) -> urllib.request.Request:
    return urllib.request.Request(
        url,
        headers={
            "User-Agent": common.CHROME_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
        method="GET",
    )


def fetch(url: str, host_last_fetch: Dict[str, float]) -> Dict[str, Any]:
    """Tier-1 fetch. Returns dict with http_status, final_url, body_snippet,
    error. Rate-limits to MAX_PER_HOST_PER_SEC per host."""
    host = urlsplit(url).netloc
    last = host_last_fetch.get(host, 0.0)
    wait = (1.0 / MAX_PER_HOST_PER_SEC) - (time.monotonic() - last)
    if wait > 0:
        time.sleep(wait)
    host_last_fetch[host] = time.monotonic()

    try:
        req = build_request(url)
        with urllib.request.urlopen(req, timeout=TIER1_TIMEOUT) as resp:
            raw = resp.read(1_000_000)
            if resp.headers.get("Content-Encoding") == "gzip":
                try:
                    raw = gzip.decompress(raw)
                except OSError:
                    pass
            body = raw.decode("utf-8", "replace")
            return {
                "http_status": resp.status,
                "final_url": resp.geturl(),
                "body": body,
                "error": None,
            }
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read(200_000).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            pass
        return {
            "http_status": exc.code,
            "final_url": exc.geturl() if hasattr(exc, "geturl") else url,
            "body": body,
            "error": None,
        }
    except urllib.error.URLError as exc:
        reason = str(exc.reason)
        kind = "tls_failure" if "certificate" in reason.lower() or "ssl" in reason.lower() else "network_error"
        return {"http_status": None, "final_url": url, "body": "", "error": kind, "detail": reason}
    except TimeoutError:
        return {"http_status": None, "final_url": url, "body": "", "error": "timeout"}


def extract_title(body: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", body, re.IGNORECASE | re.DOTALL)
    if not m:
        return ""
    return re.sub(r"\s+", " ", m.group(1)).strip()


def is_homepage_or_section(final_url: str) -> bool:
    path = urlsplit(final_url).path.strip("/")
    if path == "":
        return True
    segments = [s for s in path.split("/") if s]
    # A single short segment with no file-looking suffix reads as a section
    # front rather than an article (e.g. /politics, /media).
    return len(segments) == 1 and "-" not in segments[0] and not segments[0].isdigit()


def has_marker(body: str, markers: List[str]) -> bool:
    lower = body.lower()
    return any(marker in lower for marker in markers)


def classify_tier1(
    http_status: Optional[int],
    error: Optional[str],
    final_url: str,
    original_url: str,
    body: str,
    source_title: str,
) -> str:
    """Classify per spec section 6 step 3. Returns one of:
    paywalled, dead, tier2, ambiguous, redirected, live.
    Exposed separately (not just inline) so tests can exercise it directly.
    """
    if error in ("tls_failure", "network_error", "timeout"):
        return "dead"
    if http_status is None:
        return "dead"
    if http_status in (404, 410):
        return "dead"
    if http_status in (401, 402):
        return "paywalled"
    if has_marker(body, PAYWALL_MARKERS):
        return "paywalled"
    if http_status in (403, 429, 503):
        if has_marker(body, CHALLENGE_MARKERS):
            return "tier2"
        return "dead"
    if http_status == 200:
        page_title = extract_title(body)
        overlap = common.title_token_overlap(page_title, source_title) if page_title else 0.0
        if is_homepage_or_section(final_url) or overlap < 0.30:
            return "ambiguous"
        if final_url.rstrip("/") != original_url.rstrip("/"):
            return "redirected"
        return "live"
    if 300 <= http_status < 400:
        # urllib already followed redirects; a bare 3xx here means the
        # redirect chain ended without a 200 (rare, but treat as ambiguous).
        return "ambiguous"
    return "ambiguous"


def tier2_check(url: str) -> Optional[str]:
    """Playwright Chromium fallback. Returns 'live', 'bot_blocked', or None
    if Playwright is not installed (import-guarded, never fatal)."""
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError:
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False)
            try:
                page = browser.new_page(user_agent=common.CHROME_UA)
                page.goto(url, timeout=30_000, wait_until="load")
                title = page.title()
                content = page.content()
                if title and len(title) > 4 and not has_marker(content, CHALLENGE_MARKERS):
                    return "live"
                return "bot_blocked"
            finally:
                browser.close()
    except Exception as exc:  # noqa: BLE001
        common.log(SCRIPT, "tier2_error", url=url, error=str(exc))
        return "bot_blocked"


def jev_page_state(jev: "common.JevClient", final_url: str, title: str, body: str) -> Tuple[Optional[str], float]:
    text = re.sub(r"<[^>]+>", " ", body)
    text = re.sub(r"\s+", " ", text).strip()[:1500]
    state = f"URL: {final_url}\nTitle: {title}\nText: {text}"
    questions = {
        "page_state": {
            "type": "choice",
            "instructions": "What is the state of this fetched web page?",
            "criteria": {
                "article": "a full news article or document page",
                "paywall": "a paywall or subscription gate",
                "block": "a bot-block, CAPTCHA or access-denied page",
                "not_found": "a 404 / not-found / removed page",
                "homepage": "a site homepage or section front, not a specific article",
            },
        }
    }
    try:
        answers = jev.classify(state, questions)
    except common.JevError as exc:
        common.log(SCRIPT, "jev_error", url=final_url, error=str(exc))
        return None, 0.0
    ans = answers.get("page_state", {})
    return ans.get("choice"), float(ans.get("confidence", 0.0))


PAGE_STATE_TO_OBSERVED = {
    "article": "live",
    "paywall": "paywalled",
    "block": "bot_blocked",
    "not_found": "dead",
    "homepage": "dead",  # ambiguous 200s that resolve to a homepage/section
}


def fetch_all_sources_from_export(base: Optional[str]) -> List[Dict[str, Any]]:
    """Public, unauthenticated fallback used by --all: the sources table of
    the latest Frictionless export (see module docstring). Not scoped by
    last_checked, unlike /admin/sources/due."""
    root = (base or "https://thewaronnews.com").rstrip("/")
    req = urllib.request.Request(
        f"{root}/data/json/sources.json",
        headers={"User-Agent": common.CHROME_UA, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        import json as _json

        return _json.loads(resp.read().decode("utf-8"))


def run(limit: int, dry_run: bool, base: Optional[str], all_sources: bool) -> int:
    client = common.AdminClient("TWON_TOKEN_FILE_TRIAGE", base_url=base)
    if all_sources:
        sources = fetch_all_sources_from_export(base)
        common.log(SCRIPT, "start", due_count=len(sources), dry_run=dry_run, mode="all")
    else:
        due = client.get(f"/admin/sources/due?limit={limit}") or {"sources": []}
        sources = due.get("sources", due if isinstance(due, list) else [])
        common.log(SCRIPT, "start", due_count=len(sources), dry_run=dry_run, mode="due")

    jev = common.JevClient()
    host_last_fetch: Dict[str, float] = {}
    checks: List[Dict[str, Any]] = []
    counts = {"live": 0, "paywalled": 0, "bot_blocked": 0, "dead": 0, "redirected": 0, "error": 0}
    checked_at = common.iso_now()

    for src in sources:
        source_id = src["id"]
        url = src["url"]
        title = src.get("title", "")

        result = fetch(url, host_last_fetch)
        state = classify_tier1(
            result.get("http_status"), result.get("error"), result.get("final_url", url), url, result.get("body", ""), title
        )
        detail = result.get("detail")

        if state == "tier2":
            tier2_state = tier2_check(result.get("final_url", url))
            if tier2_state is None:
                common.log(SCRIPT, "tier2_unavailable", source_id=source_id, url=url)
                state = "error"
                detail = "tier2 challenge marker seen; Playwright not installed"
            else:
                state = tier2_state

        elif state == "ambiguous":
            choice, confidence = jev_page_state(jev, result.get("final_url", url), extract_title(result.get("body", "")), result.get("body", ""))
            if choice and confidence >= 0.80:
                state = PAGE_STATE_TO_OBSERVED.get(choice, "error")
                detail = f"jev:{choice}:{confidence:.2f}"
            else:
                state = "error"
                detail = f"jev below threshold ({confidence:.2f})" if choice else "jev unavailable"

        counts[state] = counts.get(state, 0) + 1
        checks.append(
            {
                "source_id": source_id,
                "checked_at": checked_at,
                "checker": "twon-linkcheck/1.0",
                "http_status": result.get("http_status"),
                "final_url": result.get("final_url", url),
                "observed_state": state,
                "detail": detail,
            }
        )
        common.log(SCRIPT, "checked", source_id=source_id, url=url, state=state, http_status=result.get("http_status"))

    if not dry_run:
        for i in range(0, len(checks), BATCH_SIZE):
            batch = checks[i : i + BATCH_SIZE]
            client.post("/admin/sources/checks", {"checks": batch})
            common.log(SCRIPT, "posted_batch", size=len(batch))

    summary = {"due": len(sources), **counts, "dry_run": dry_run}
    common.log(SCRIPT, "summary", **summary)
    print(f"linkcheck: {len(sources)} due; " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=500, help="max sources to pull from /admin/sources/due")
    ap.add_argument("--dry-run", action="store_true", help="fetch and classify but do not POST results")
    ap.add_argument("--base", default=None, help="override TWON_BASE")
    ap.add_argument("--all", action="store_true", help="classify every source from the public data export, ignoring the 20h due window (see module docstring)")
    args = ap.parse_args()
    try:
        return run(args.limit, args.dry_run, args.base, args.all)
    except Exception as exc:  # noqa: BLE001
        common.log(SCRIPT, "fatal", error=str(exc))
        print(f"linkcheck: FATAL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
