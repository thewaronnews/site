#!/usr/bin/env python3
"""
newsdesk.py -- the daily News Desk run (spec section 7).

Runs on the Mac Studio at 06:30 and 16:30 America/Toronto. This script is
NOT Betty and does not decide voice or facts; it gathers, scores, gates and
publishes News Desk notes that a separate drafting model has already
written (this script never calls Claude itself -- see stage (d)).

Stages (spec section 7.1), each independently runnable and logged:
  (a) gather   -- RSS feeds (desk/feeds.yaml) + ops/candidates/YYYY-MM-DD.json
                  (written by a Chrome/Perplexity sweep, outside this script)
  (b) dedupe   -- drop candidates already covered by a note or incident
  (c) jev      -- classify with the section 7.2 question set and thresholds
  (d) draft    -- write ops/drafts/YYYY-MM-DD-<n>.json requests for the
                  drafting model; read completed drafts back from
                  ops/drafts/done/
  (e) gates    -- section 7.3 gates G1-G10 (G7 is noted, not automated --
                  it requires a fresh Sonnet call this script does not make)
  (f) publish  -- desk-scoped token, then wayback.py + indexnow.py
  (g) digest   -- ops/digests/YYYY-MM-DD.md, printed to stdout
  (h) apply-commands -- ops/inbox/commands.txt: revert/publish/pause/resume

Kill switches (checked before any write): ~/twon/DESK_PAUSED (local file)
and the server's desk:paused flag (POST /admin/desk/notes then returns 423,
handled as a hard stop for this run).

Usage:
  python3 newsdesk.py --dry-run
  python3 newsdesk.py                       # full run, writes and publishes
  python3 newsdesk.py --apply-commands      # only stage (h)
  python3 newsdesk.py --stage gather        # run one stage for debugging

Limits: 6 notes per run, 8 per day (the Worker separately caps 12/day).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import wayback  # noqa: E402
import indexnow  # noqa: E402

SCRIPT = "newsdesk"
OPS_DIR = Path(__file__).resolve().parent
DESK_DIR = OPS_DIR / "desk"
CANDIDATES_DIR = OPS_DIR / "candidates"
DRAFTS_DIR = OPS_DIR / "drafts"
DRAFTS_DONE_DIR = DRAFTS_DIR / "done"
DIGESTS_DIR = OPS_DIR / "digests"
INBOX_DIR = OPS_DIR / "inbox"
STATE_PATH = DESK_DIR / "state.json"
FEEDS_PATH = DESK_DIR / "feeds.yaml"
JEV_QUESTIONS_PATH = DESK_DIR / "jev_questions.json"
PAUSE_FILE = Path.home() / "twon" / "DESK_PAUSED"

MAX_NOTES_PER_RUN = 6
MAX_NOTES_PER_DAY = 8
DEDUPE_WINDOW_DAYS = 14
DEDUPE_TITLE_JACCARD = 0.50

ATTRIBUTION_VERBS = {"said", "wrote", "stated", "announced", "told", "filed", "ruled", "argued", "alleged"}


# ---------------------------------------------------------------------------
# Small file helpers


def today_str() -> str:
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")


def load_state() -> Dict[str, Any]:
    if STATE_PATH.exists():
        return common.load_json(STATE_PATH)
    return {"days": {}}  # days[YYYY-MM-DD] = {"published": int, "note_ids": [...]}


def save_state(state: Dict[str, Any]) -> None:
    common.save_json(STATE_PATH, state)


def parse_feeds_yaml(path: Path) -> List[Dict[str, str]]:
    """Tiny indentation-based YAML reader for desk/feeds.yaml's fixed shape
    (a `feeds:` list of `{org, url}` maps). Avoids a PyYAML dependency."""
    feeds: List[Dict[str, str]] = []
    current: Dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        m = re.match(r"^\s*-\s*org:\s*\"?(.*?)\"?\s*$", line)
        if m:
            if current:
                feeds.append(current)
            current = {"org": m.group(1)}
            continue
        m = re.match(r"^\s*url:\s*\"?(.*?)\"?\s*$", line)
        if m and current:
            current["url"] = m.group(1)
    if current:
        feeds.append(current)
    return feeds


# ---------------------------------------------------------------------------
# (a) Gather


def fetch_feed(url: str, timeout: float = 15.0) -> List[Dict[str, str]]:
    req = urllib.request.Request(url, headers={"User-Agent": "twon-desk/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    # Some feeds (observed: Nieman Lab) emit a leading newline/whitespace
    # before the XML declaration, which is invalid XML that ET.fromstring
    # rejects outright ("XML or text declaration not at start of entity")
    # even though the feed itself is well-formed otherwise. Strip leading
    # whitespace/BOM so a real, working feed isn't misreported as broken.
    raw = raw.lstrip(b"\xef\xbb\xbf \t\r\n")
    root = ET.fromstring(raw)
    items: List[Dict[str, str]] = []

    for item in root.iter():
        tag = item.tag.split("}")[-1]
        if tag == "item":  # RSS 2.0
            link = (item.findtext("link") or "").strip()
            title = (item.findtext("title") or "").strip()
            desc = (item.findtext("description") or "").strip()
            pub = (item.findtext("pubDate") or "").strip()
            if link:
                items.append({"url": link, "title": title, "summary": strip_html(desc), "published_raw": pub})
        elif tag == "entry":  # Atom
            title = (item.findtext("{http://www.w3.org/2005/Atom}title") or item.findtext("title") or "").strip()
            link_el = item.find("{http://www.w3.org/2005/Atom}link")
            if link_el is None:
                link_el = item.find("link")
            link = link_el.get("href", "").strip() if link_el is not None else ""
            summary = (
                item.findtext("{http://www.w3.org/2005/Atom}summary")
                or item.findtext("summary")
                or ""
            ).strip()
            pub = (
                item.findtext("{http://www.w3.org/2005/Atom}updated")
                or item.findtext("updated")
                or ""
            ).strip()
            if link:
                items.append({"url": link, "title": title, "summary": strip_html(summary), "published_raw": pub})
    return items


def strip_html(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


def gather_candidates(date: str) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []

    if FEEDS_PATH.exists():
        for feed in parse_feeds_yaml(FEEDS_PATH):
            try:
                items = fetch_feed(feed["url"])
            except Exception as exc:  # noqa: BLE001
                common.log(SCRIPT, "feed_error", org=feed.get("org"), url=feed.get("url"), error=str(exc))
                continue
            for it in items:
                candidates.append(
                    {
                        "url": it["url"],
                        "title": it["title"],
                        "summary": it["summary"],
                        "source": feed["org"],
                        "origin": "rss",
                    }
                )
            common.log(SCRIPT, "feed_fetched", org=feed.get("org"), count=len(items))
    else:
        common.log(SCRIPT, "feeds_yaml_missing", path=str(FEEDS_PATH))

    sweep_path = CANDIDATES_DIR / f"{date}.json"
    if sweep_path.exists():
        try:
            sweep_items = common.load_json(sweep_path)
            for it in sweep_items:
                it = dict(it)
                it.setdefault("origin", "sweep")
                candidates.append(it)
            common.log(SCRIPT, "sweep_loaded", count=len(sweep_items), path=str(sweep_path))
        except Exception as exc:  # noqa: BLE001
            common.log(SCRIPT, "sweep_error", path=str(sweep_path), error=str(exc))
    else:
        common.log(SCRIPT, "sweep_missing", path=str(sweep_path))

    # normalize URLs (strip fragment/utm/fbclid/gclid, matching sources
    # upsert normalization in spec section 6) and drop exact duplicates
    seen = set()
    normalized: List[Dict[str, Any]] = []
    for c in candidates:
        nurl = normalize_url(c["url"])
        if nurl in seen:
            continue
        seen.add(nurl)
        c["url"] = nurl
        normalized.append(c)

    return normalized


def normalize_url(url: str) -> str:
    parts = urlsplit(url)
    host = parts.netloc.lower()
    query = re.sub(r"(?:^|&)(utm_[^=&]*|fbclid|gclid)=[^&]*", "", parts.query)
    query = query.strip("&")
    return f"{parts.scheme}://{host}{parts.path}" + (f"?{query}" if query else "")


# ---------------------------------------------------------------------------
# (b) Dedupe


def fetch_existing_titles(base: Optional[str]) -> Tuple[List[Dict[str, str]], List[str]]:
    """Best-effort fetch of existing incident titles and existing note
    primary-source URLs from the public JSON twins, for dedupe. Network or
    parse failures degrade to empty lists (logged), never crash the run --
    dedupe then relies on the Jev `novelty` question alone."""
    base = (base or "https://thewaronnews.com").rstrip("/")
    incidents: List[Dict[str, str]] = []
    note_urls: List[str] = []
    try:
        req = urllib.request.Request(f"{base}/incidents.json", headers={"User-Agent": "twon-desk/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        for row in data.get("incidents", data if isinstance(data, list) else []):
            incidents.append({"slug": row.get("slug", ""), "title": row.get("title", "")})
    except Exception as exc:  # noqa: BLE001
        common.log(SCRIPT, "fetch_incidents_error", error=str(exc))

    try:
        req = urllib.request.Request(f"{base}/news.json", headers={"User-Agent": "twon-desk/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        for row in data.get("notes", data if isinstance(data, list) else []):
            src = row.get("primary_source") or {}
            if src.get("url"):
                note_urls.append(normalize_url(src["url"]))
    except Exception as exc:  # noqa: BLE001
        common.log(SCRIPT, "fetch_notes_error", error=str(exc))

    return incidents, note_urls


def dedupe_candidates(
    candidates: List[Dict[str, Any]], incidents: List[Dict[str, str]], note_urls: List[str]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    kept: List[Dict[str, Any]] = []
    dropped: List[Dict[str, Any]] = []
    note_url_set = set(note_urls)

    for c in candidates:
        if c["url"] in note_url_set:
            dropped.append({**c, "drop_reason": "url already used by a published note"})
            continue
        best_title_match = 0.0
        for inc in incidents:
            overlap = common.title_token_overlap(c.get("title", ""), inc.get("title", ""))
            best_title_match = max(best_title_match, overlap)
        if best_title_match >= DEDUPE_TITLE_JACCARD:
            c = {**c, "closest_incident_hint": True}
        kept.append(c)

    return kept, dropped


# ---------------------------------------------------------------------------
# (c) Jev classification


def top_novelty_candidates(title: str, incidents: List[Dict[str, str]], k: int = 6) -> Dict[str, str]:
    scored = sorted(
        incidents,
        key=lambda inc: common.title_token_overlap(title, inc.get("title", "")),
        reverse=True,
    )
    criteria = {inc["slug"]: inc["title"] for inc in scored[:k] if inc.get("slug")}
    criteria["new"] = "not one of the recorded incidents above"
    return criteria


def jev_classify_candidate(
    jev: common.JevClient, questions_cfg: dict, candidate: Dict[str, Any], incidents: List[Dict[str, str]]
) -> Dict[str, Any]:
    headline = candidate.get("title", "")
    outlet = candidate.get("source", "")
    date = candidate.get("published_raw", "")
    text = candidate.get("summary", "")
    state = f"Headline: {headline}\nOutlet: {outlet}\nDate: {date}\nText: {text}"

    questions = dict(questions_cfg["questions"])
    questions["novelty"] = {
        "type": "choice",
        "instructions": "Is this story about one of these recorded incidents, or a new one?",
        "criteria": top_novelty_candidates(headline, incidents),
    }

    try:
        answers = jev.classify(state, questions)
    except common.JevError as exc:
        common.log(SCRIPT, "jev_error", url=candidate.get("url"), error=str(exc))
        return {"error": str(exc)}
    return answers


def apply_jev_thresholds(answers: Dict[str, Any], cfg: dict) -> Dict[str, Any]:
    """Returns {"disposition": eligible|held|dropped, "reasons": [...],
    "incident_id": slug|None, "proposed_incident": bool}."""
    th = cfg["thresholds"]
    if "error" in answers:
        return {"disposition": "dropped", "reasons": ["jev unavailable"], "incident_id": None, "proposed_incident": False}

    reasons: List[str] = []
    in_scope = answers.get("in_scope", {}).get("noul", 0.0)
    if in_scope < th["in_scope"]["hold"]:
        return {"disposition": "dropped", "reasons": [f"in_scope {in_scope:.2f} below hold threshold"], "incident_id": None, "proposed_incident": False}

    disposition = "eligible" if in_scope >= th["in_scope"]["eligible"] else "held"
    if disposition == "held":
        reasons.append(f"in_scope {in_scope:.2f} in hold band")

    type_conf = answers.get("type", {}).get("confidence", 0.0)
    if type_conf < th["type_confidence_hold_below"]:
        disposition = "held"
        reasons.append(f"type confidence {type_conf:.2f} below {th['type_confidence_hold_below']}")

    development = answers.get("development", {}).get("choice")
    dev_conf = answers.get("development", {}).get("confidence", 0.0)
    if development == "analysis" and dev_conf >= th["development_analysis_drop_at_or_above"]:
        return {"disposition": "dropped", "reasons": ["development=analysis"], "incident_id": None, "proposed_incident": False}

    private = answers.get("private_allegation", {}).get("noul", 0.0)
    if private >= th["private_allegation_hold_at_or_above"]:
        disposition = "held"
        reasons.append(f"private_allegation {private:.2f}")

    novelty = answers.get("novelty", {})
    novelty_choice = novelty.get("choice")
    novelty_conf = novelty.get("confidence", 0.0)
    incident_id = None
    proposed_incident = False
    if novelty_choice and novelty_choice != "new" and novelty_conf >= th["novelty_match_at_or_above"]:
        incident_id = novelty_choice
    elif novelty_choice == "new" and development == "new_action":
        proposed_incident = True

    return {"disposition": disposition, "reasons": reasons, "incident_id": incident_id, "proposed_incident": proposed_incident}


# ---------------------------------------------------------------------------
# (d) Draft request / read-back


def draft_request_path(date: str, n: int) -> Path:
    return DRAFTS_DIR / f"{date}-{n}.json"


def draft_done_path(date: str, n: int) -> Path:
    return DRAFTS_DONE_DIR / f"{date}-{n}.json"


NOTE_TEMPLATE = (
    "60-120 words. Order: (1) the dated fact -- what happened, who did it "
    "(office and full name); (2) the stated reason, quoted verbatim, with "
    "medium and date (e.g. 'in a post on Truth Social on September 18, "
    "2026'), or 'The White House did not give a reason' if none was given; "
    "(3) what changed for reporting, concretely; (4) a status sentence if a "
    "case or rule is involved; (5) end with a Markdown link to the primary "
    "report. Verbs of record only (see voice-guide.md). No motive "
    "attribution, no banned phrase or quotation-only word outside quotes, "
    "no em/en dashes. Title <=110 characters, a noun phrase with a date, "
    "not a headline with a verb."
)


def write_draft_requests(date: str, eligible: List[Dict[str, Any]], start_n: int) -> List[int]:
    written = []
    for i, item in enumerate(eligible, start=start_n):
        path = draft_request_path(date, i)
        if path.exists() or draft_done_path(date, i).exists():
            continue
        request = {
            "id": f"{date}-{i}",
            "candidate": {
                "url": item["url"],
                "title": item.get("title", ""),
                "summary": item.get("summary", ""),
                "source": item.get("source", ""),
            },
            "jev": item.get("jev_answers", {}),
            "incident_id": item.get("incident_id"),
            "proposed_incident": item.get("proposed_incident", False),
            "note_template": NOTE_TEMPLATE,
            "requested_at": common.iso_now(),
        }
        common.save_json(path, request)
        written.append(i)
        common.log(SCRIPT, "draft_requested", id=request["id"], url=item["url"])
    return written


def read_completed_drafts(date: str) -> Dict[int, Dict[str, Any]]:
    completed: Dict[int, Dict[str, Any]] = {}
    if not DRAFTS_DONE_DIR.exists():
        return completed
    for path in sorted(DRAFTS_DONE_DIR.glob(f"{date}-*.json")):
        try:
            n = int(path.stem.split("-")[-1])
        except ValueError:
            continue
        try:
            completed[n] = common.load_json(path)
        except Exception as exc:  # noqa: BLE001
            common.log(SCRIPT, "draft_read_error", path=str(path), error=str(exc))
    return completed


# ---------------------------------------------------------------------------
# (e) Gates


def check_links_live_or_archived(draft: Dict[str, Any]) -> Tuple[bool, str]:
    source = draft.get("candidate", {})
    url = source.get("url")
    if not url:
        return False, "no primary source url"
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": common.CHROME_UA})
        with urllib.request.urlopen(req, timeout=15) as resp:
            if 200 <= resp.status < 300:
                return True, f"HTTP {resp.status}"
    except urllib.error.HTTPError as exc:
        if 200 <= exc.code < 300:
            return True, f"HTTP {exc.code}"
    except Exception:  # noqa: BLE001
        pass
    if draft.get("wayback_url"):
        return True, "archived"
    return False, "not live (2xx) and no wayback_url"


def gate_length(note_text: str, title: str) -> Tuple[bool, str]:
    wc = common.word_count(note_text)
    if not (60 <= wc <= 120):
        return False, f"{wc} words (need 60-120)"
    if len(title) > 110:
        return False, f"title {len(title)} chars (max 110)"
    return True, f"{wc} words, title {len(title)} chars"


def gate_lint(lint: common.Lint, note_text: str) -> Tuple[bool, str]:
    violations = lint.check(note_text)
    if violations:
        detail = "; ".join(f"{v['kind']}:{v['text']}" for v in violations[:5])
        return False, detail
    return True, "clean"


def gate_voice(note_text: str) -> Tuple[bool, str]:
    problems = []
    if re.search(r"\bI\b|\bwe\b|\bour\b", note_text, re.IGNORECASE) and "we" in note_text.lower().split():
        problems.append("first person")
    if "?" in note_text:
        problems.append("question mark")
    if "!" in note_text:
        problems.append("exclamation mark")
    # attribution verbs: any "<Capitalized word> <verb>ed/says/etc" pattern
    # outside the allowed set is flagged loosely -- a coarse check, not a
    # substitute for editorial review.
    for m in re.finditer(r"\b(said|wrote|stated|announced|told|filed|ruled|argued|alleged|claimed|admitted|insisted|touted|slammed|blasted)\b", note_text, re.IGNORECASE):
        verb = m.group(1).lower()
        if verb not in ATTRIBUTION_VERBS:
            problems.append(f"attribution verb '{verb}' not in allowed list")
    if problems:
        return False, "; ".join(problems)
    return True, "clean"


def gate_dedupe(draft: Dict[str, Any], state: Dict[str, Any], date: str) -> Tuple[bool, str]:
    incident_id = draft.get("incident_id")
    development = draft.get("jev", {}).get("development", {}).get("choice")
    title = draft.get("title", "")
    cutoff = (datetime.strptime(date, "%Y-%m-%d") - timedelta(days=DEDUPE_WINDOW_DAYS)).strftime("%Y-%m-%d")

    for day, day_state in state.get("days", {}).items():
        if day < cutoff:
            continue
        for note in day_state.get("notes", []):
            if note.get("incident_id") == incident_id and note.get("development") == development and incident_id:
                return False, f"same incident_id+development within {DEDUPE_WINDOW_DAYS}d ({note.get('id')})"
            if common.title_token_overlap(title, note.get("title", "")) >= DEDUPE_TITLE_JACCARD:
                return False, f"title overlap >= {DEDUPE_TITLE_JACCARD} with {note.get('id')}"
    return True, "no match in window"


def gate_source_kind(draft: Dict[str, Any]) -> Tuple[bool, str]:
    kind = draft.get("candidate", {}).get("source_kind", "outlet_report")
    advocacy_markers = {"advocacy", "press_release_advocacy", "opinion"}
    if kind in advocacy_markers:
        return False, f"primary source kind '{kind}' is advocacy"
    return True, kind


def run_gates(
    draft: Dict[str, Any], jev_result: Dict[str, Any], lint: common.Lint, state: Dict[str, Any], date: str
) -> Dict[str, Dict[str, Any]]:
    note_text = draft.get("note", "")
    title = draft.get("title", "")

    gates: Dict[str, Dict[str, Any]] = {}
    gates["G1_scope"] = {"pass": jev_result["disposition"] != "dropped", "detail": "; ".join(jev_result["reasons"]) or "ok"}
    ok, detail = gate_dedupe(draft, state, date)
    gates["G2_dedupe"] = {"pass": ok, "detail": detail}
    gates["G3_verbatim"] = {
        "pass": all(q in draft.get("candidate", {}).get("summary", "") for q in draft.get("quotes", [])) if draft.get("quotes") else True,
        "detail": "checked against fetched candidate text" if draft.get("quotes") else "no quotes listed to check",
    }
    ok, detail = check_links_live_or_archived(draft)
    gates["G4_links"] = {"pass": ok, "detail": detail}
    ok, detail = gate_length(note_text, title)
    gates["G5_length"] = {"pass": ok, "detail": detail}
    ok, detail = gate_lint(lint, note_text)
    gates["G6_banned_words"] = {"pass": ok, "detail": detail}
    gates["G7_quote_only_evaluation"] = {
        "pass": True,
        "detail": "not independently verified: requires a fresh Sonnet call this script does not make; G6/G8 lint is the mechanical proxy",
    }
    ok, detail = gate_voice(note_text)
    gates["G8_voice_lint"] = {"pass": ok, "detail": detail}
    ok, detail = gate_source_kind(draft)
    gates["G9_source_kind"] = {"pass": ok, "detail": detail}
    private = jev_result.get("private_score", 0.0)
    gates["G10_private_allegation"] = {"pass": private < 0.50, "detail": f"{private:.2f}"}

    return gates


def gate_outcome(gates: Dict[str, Dict[str, Any]]) -> str:
    """'publish', 'hold', or 'drop' per spec 7.1 step 5: only G1's hold band,
    G9 or G10 failing makes a held note; any other failure drops it."""
    hold_only_gates = {"G1_scope", "G9_source_kind", "G10_private_allegation"}
    failing = [name for name, g in gates.items() if not g["pass"]]
    if not failing:
        return "publish"
    if all(name in hold_only_gates for name in failing):
        return "hold"
    return "drop"


# ---------------------------------------------------------------------------
# (f) Publish


def publish_note(client: common.AdminClient, draft: Dict[str, Any], gates: Dict[str, Any], run_id: str) -> Dict[str, Any]:
    body = {
        "title": draft["title"],
        "note": draft["note"],
        "word_count": common.word_count(draft["note"]),
        "source_ids": draft.get("source_ids", []),
        "incident_id": draft.get("incident_id"),
        "story_date": draft.get("story_date", today_str()),
        "jev_model": common.JevClient.DEFAULT_MODEL,
        "jev_scores": draft.get("jev_answers", {}),
        "gates_passed": gates,
        "run_id": run_id,
        "state": "published",
    }
    return client.post("/admin/desk/notes", body)


def archive_and_ping(base: Optional[str], urls: List[str]) -> None:
    for url in urls:
        try:
            wayback.archive_one(url)
        except Exception as exc:  # noqa: BLE001
            common.log(SCRIPT, "archive_error", url=url, error=str(exc))
    try:
        indexnow.ping(urls, dry_run=False)
    except Exception as exc:  # noqa: BLE001
        common.log(SCRIPT, "indexnow_error", error=str(exc))


# ---------------------------------------------------------------------------
# (g) Digest


def write_digest(date: str, published: list, held: list, dropped_counts: dict, dead_sources: list, proposed: list, commands: list, paused: bool) -> Path:
    lines = [f"# TWON desk {date}", ""]
    lines.append(f"Published: {len(published)}. Held: {len(held)}. Paused: {'yes' if paused else 'no'}.")
    lines.append("")
    lines.append("## Published")
    if not published:
        lines.append("- none")
    for n in published:
        gates_summary = ", ".join(f"{k}:{'ok' if v['pass'] else 'FAIL'}" for k, v in n["gates"].items())
        lines.append(f"- **{n['title']}** ({n.get('slug', n.get('id'))}) -- {n['url']} -- in_scope={n['in_scope']:.2f} -- {gates_summary}")
    lines.append("")
    lines.append("## Held")
    if not held:
        lines.append("- none")
    for n in held:
        lines.append(f"- **{n['title']}** ({n['id']}) -- failing: {n['failing_gate']}")
    lines.append("")
    lines.append("## Dropped, by reason")
    if not dropped_counts:
        lines.append("- none")
    for reason, count in dropped_counts.items():
        lines.append(f"- {reason}: {count}")
    lines.append("")
    lines.append("## New dead sources")
    if not dead_sources:
        lines.append("- none")
    for s in dead_sources:
        lines.append(f"- {s}")
    lines.append("")
    lines.append("## Proposed new incidents")
    if not proposed:
        lines.append("- none")
    for p in proposed:
        lines.append(f"- {p['title']} -- {p['url']}")
    lines.append("")
    lines.append("## Commands executed")
    if not commands:
        lines.append("- none")
    for c in commands:
        lines.append(f"- {c}")
    lines.append("")
    lines.append("Reply with: revert <id> <reason> | publish <id> | pause | resume")

    text = "\n".join(lines) + "\n"
    path = DIGESTS_DIR / f"{date}.md"
    path.write_text(text, encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# (h) Apply commands


def apply_commands(base: Optional[str], dry_run: bool) -> List[str]:
    path = INBOX_DIR / "commands.txt"
    if not path.exists():
        return []
    lines = [l.strip() for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not lines:
        return []

    client = common.AdminClient("TWON_TOKEN_FILE_DESK", base_url=base)
    applied = []
    for line in lines:
        parts = line.split(maxsplit=2)
        cmd = parts[0].lower() if parts else ""
        try:
            if cmd == "revert" and len(parts) >= 3:
                note_id, reason = parts[1], parts[2]
                if not dry_run:
                    client.post(f"/admin/desk/notes/{note_id}/revert", {"reason": reason})
                applied.append(f"revert {note_id}: {reason}")
            elif cmd == "publish" and len(parts) >= 2:
                note_id = parts[1]
                if not dry_run:
                    client.post(f"/admin/desk/notes/{note_id}/publish", {})
                applied.append(f"publish {note_id}")
            elif cmd == "pause":
                if not dry_run:
                    client.post("/admin/desk/pause", {"paused": True})
                applied.append("pause")
            elif cmd == "resume":
                if not dry_run:
                    client.post("/admin/desk/pause", {"paused": False})
                applied.append("resume")
            else:
                common.log(SCRIPT, "command_unrecognized", line=line)
        except Exception as exc:  # noqa: BLE001
            common.log(SCRIPT, "command_error", line=line, error=str(exc))
            applied.append(f"ERROR on '{line}': {exc}")

    if not dry_run:
        path.rename(INBOX_DIR / f"commands-{common.iso_now().replace(':', '')}.done.txt")
    common.log(SCRIPT, "commands_applied", count=len(applied))
    return applied


# ---------------------------------------------------------------------------
# Orchestration


def is_paused() -> bool:
    return PAUSE_FILE.exists()


def run(dry_run: bool, base: Optional[str], stage_only: Optional[str], apply_cmds_only: bool) -> int:
    date = today_str()
    run_id = f"{date}-{int(time.time())}"
    lint = common.Lint()

    if apply_cmds_only:
        applied = apply_commands(base, dry_run)
        for line in applied:
            print(line)
        return 0

    commands_applied = apply_commands(base, dry_run)

    if is_paused():
        print(f"newsdesk: DESK_PAUSED present at {PAUSE_FILE}; stopping before any write")
        common.log(SCRIPT, "paused_locally")
        write_digest(date, [], [], {}, [], [], commands_applied, paused=True)
        return 0

    incidents, note_urls = fetch_existing_titles(base)
    candidates = gather_candidates(date)
    common.log(SCRIPT, "gathered", count=len(candidates))
    if stage_only == "gather":
        print(f"gather: {len(candidates)} candidate(s)")
        return 0

    kept, dropped = dedupe_candidates(candidates, incidents, note_urls)
    common.log(SCRIPT, "deduped", kept=len(kept), dropped=len(dropped))
    if stage_only == "dedupe":
        print(f"dedupe: kept {len(kept)}, dropped {len(dropped)}")
        return 0

    jev = common.JevClient()
    jev_cfg = common.load_json(JEV_QUESTIONS_PATH)
    dropped_counts: Dict[str, int] = {}
    for d in dropped:
        dropped_counts[d["drop_reason"]] = dropped_counts.get(d["drop_reason"], 0) + 1

    eligible: List[Dict[str, Any]] = []
    for c in kept:
        answers = jev_classify_candidate(jev, jev_cfg, c, incidents)
        result = apply_jev_thresholds(answers, jev_cfg)
        c["jev_answers"] = answers
        c["in_scope"] = answers.get("in_scope", {}).get("noul", 0.0) if "error" not in answers else 0.0
        c["incident_id"] = result["incident_id"]
        c["proposed_incident"] = result["proposed_incident"]
        c["jev_disposition"] = result["disposition"]
        c["jev_reasons"] = result["reasons"]
        if result["disposition"] == "dropped":
            dropped_counts[", ".join(result["reasons"]) or "in_scope below threshold"] = dropped_counts.get(
                ", ".join(result["reasons"]) or "in_scope below threshold", 0
            ) + 1
        else:
            eligible.append(c)

    common.log(SCRIPT, "jev_done", eligible=len(eligible))
    if stage_only == "jev":
        print(f"jev: {len(eligible)} eligible/held of {len(kept)}")
        return 0

    state = load_state()
    day_state = state["days"].setdefault(date, {"published": 0, "notes": []})

    written = write_draft_requests(date, eligible, start_n=len(day_state["notes"]) + 1)
    completed = read_completed_drafts(date)
    common.log(SCRIPT, "drafts", requested=len(written), completed_available=len(completed))
    if stage_only == "draft":
        print(f"draft: {len(written)} new request(s), {len(completed)} completed draft(s) on disk")
        return 0

    published: List[Dict[str, Any]] = []
    held: List[Dict[str, Any]] = []
    proposed_incidents: List[Dict[str, Any]] = []
    dead_sources: List[str] = []
    client = None if dry_run else common.AdminClient("TWON_TOKEN_FILE_DESK", base_url=base)

    for n, draft in completed.items():
        if day_state["published"] >= MAX_NOTES_PER_DAY or len(published) >= MAX_NOTES_PER_RUN:
            common.log(SCRIPT, "run_cap_reached", published_today=day_state["published"], published_this_run=len(published))
            break

        jev_answers = draft.get("jev", {})
        jev_result = apply_jev_thresholds(jev_answers, jev_cfg)
        jev_result["private_score"] = jev_answers.get("private_allegation", {}).get("noul", 0.0)
        if draft.get("proposed_incident"):
            proposed_incidents.append({"title": draft.get("title", draft.get("candidate", {}).get("title", "")), "url": draft.get("candidate", {}).get("url", "")})

        gates = run_gates(draft, jev_result, lint, state, date)
        outcome = gate_outcome(gates)
        common.log(SCRIPT, "gated", id=draft.get("id", n), outcome=outcome, gates={k: v["pass"] for k, v in gates.items()})

        if outcome == "drop":
            failing = [k for k, v in gates.items() if not v["pass"]]
            reason = f"gate failure: {', '.join(failing)}"
            dropped_counts[reason] = dropped_counts.get(reason, 0) + 1
            if not gates["G4_links"]["pass"]:
                dead_sources.append(draft.get("candidate", {}).get("url", ""))
            continue

        if outcome == "hold":
            failing = [k for k, v in gates.items() if not v["pass"]]
            held.append({"title": draft.get("title", ""), "id": draft.get("id", n), "failing_gate": ", ".join(failing)})
            if not dry_run and client is not None:
                body = {
                    "title": draft["title"],
                    "note": draft["note"],
                    "word_count": common.word_count(draft["note"]),
                    "source_ids": draft.get("source_ids", []),
                    "incident_id": draft.get("incident_id"),
                    "story_date": draft.get("story_date", date),
                    "jev_model": common.JevClient.DEFAULT_MODEL,
                    "jev_scores": jev_answers,
                    "gates_passed": gates,
                    "run_id": run_id,
                    "state": "held",
                }
                try:
                    client.post("/admin/desk/notes", body)
                except Exception as exc:  # noqa: BLE001
                    common.log(SCRIPT, "hold_post_error", id=draft.get("id", n), error=str(exc))
            continue

        # outcome == publish
        if dry_run:
            published.append({"title": draft["title"], "slug": "(dry-run)", "url": draft.get("candidate", {}).get("url", ""), "in_scope": jev_result.get("private_score", 0.0), "gates": gates})
            continue

        try:
            result = publish_note(client, draft, gates, run_id)
            slug = (result or {}).get("slug", draft.get("id", n))
            urls_to_sync = [f"https://thewaronnews.com/news/{slug}", "https://thewaronnews.com/news"]
            if draft.get("incident_id"):
                urls_to_sync.append(f"https://thewaronnews.com/incidents/{draft['incident_id']}")
            archive_and_ping(base, urls_to_sync)

            published.append(
                {
                    "title": draft["title"],
                    "slug": slug,
                    "url": draft.get("candidate", {}).get("url", ""),
                    "in_scope": jev_answers.get("in_scope", {}).get("noul", 0.0),
                    "gates": gates,
                }
            )
            day_state["published"] += 1
            day_state["notes"].append(
                {
                    "id": draft.get("id", n),
                    "slug": slug,
                    "title": draft["title"],
                    "incident_id": draft.get("incident_id"),
                    "development": jev_answers.get("development", {}).get("choice"),
                    "published_at": common.iso_now(),
                }
            )
        except Exception as exc:  # noqa: BLE001
            common.log(SCRIPT, "publish_error", id=draft.get("id", n), error=str(exc))
            dropped_counts[f"publish failed: {exc}"] = dropped_counts.get(f"publish failed: {exc}", 0) + 1

    if not dry_run:
        save_state(state)

    digest_path = write_digest(date, published, held, dropped_counts, dead_sources, proposed_incidents, commands_applied, paused=False)
    print(digest_path.read_text(encoding="utf-8"))
    common.log(SCRIPT, "run_complete", published=len(published), held=len(held), dropped=sum(dropped_counts.values()))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="run every stage but make no admin-API writes, no publish, no archive/indexnow pings")
    ap.add_argument("--base", default=None, help="override TWON_BASE")
    ap.add_argument("--stage", default=None, choices=["gather", "dedupe", "jev", "draft"], help="run through one stage only, for debugging")
    ap.add_argument("--apply-commands", action="store_true", help="only run stage (h): apply ops/inbox/commands.txt")
    args = ap.parse_args()
    try:
        return run(args.dry_run, args.base, args.stage, args.apply_commands)
    except Exception as exc:  # noqa: BLE001
        common.log(SCRIPT, "fatal", error=str(exc))
        print(f"newsdesk: FATAL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
