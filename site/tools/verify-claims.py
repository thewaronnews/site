#!/usr/bin/env python3
"""
Real-request verification of the P0.3 claims publish against
https://rattlesnakesbymail.com. No assumptions: every check below is a live
HTTP GET. Cache-busting query strings are used throughout since the site
sends Cache-Control: public, max-age=60.
"""
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

BASE = "https://rattlesnakesbymail.com"
CB = str(int(time.time()))

ENTITY_SLUGS_ALL = [
    "applebot", "applebot-extended", "bingbot", "chatgpt-user", "claude-searchbot",
    "claude-user", "claudebot", "google-extended", "googlebot", "googleother",
    "gptbot", "oai-adsbot", "oai-searchbot", "perplexity-user", "perplexitybot",
]
PUBLISHED_SLUGS = [s for s in ENTITY_SLUGS_ALL if s != "bingbot"]

EM_DASH = "—"

failures = []
notes = []


def get(path, cb=True):
    url = f"{BASE}{path}"
    url += ("&" if "?" in url else "?") + f"_cb={CB}" if cb else ""
    req = urllib.request.Request(url, headers={"User-Agent": "rsbm-smoke/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.status, resp.read().decode("utf-8", errors="replace"), dict(resp.headers)


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {label}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append((label, detail))
    return cond


# ---------- gather published claim ids from the live data ----------
status, body, _ = get("/data/latest.json")
data = json.loads(body)
published_claims = [c for c in data["claims"] if c["status"] == "current"]
published_ids = sorted(c["id"] for c in published_claims)
print(f"live /data/latest.json reports {len(published_claims)} current claims, "
      f"id range {published_ids[0]}-{published_ids[-1]}" if published_ids else "no current claims")

# ============================================================
# Check 1: /changes.json row count equals number of claims published
# ============================================================
status, body, _ = get("/changes.json")
changes_data = json.loads(body)
changes_count = len(changes_data.get("changes", []))
check(
    "1. /changes.json count == claims published",
    changes_count == len(published_claims),
    f"changes.json={changes_count} claims={len(published_claims)}",
)

# ============================================================
# Check 2: every published /claims/<id>.md: 200, has statement, has quote
#          (when not null), has "source dated" when evidence_date set,
#          and no HTML tag.
# ============================================================
claim2_ok = True
html_tag_re = re.compile(r"<[a-zA-Z!/][^>]*>")
for c in published_claims:
    status, body, _ = get(f"/claims/{c['id']}.md")
    ok = status == 200
    if c["statement"] not in body:
        ok = False
    if c.get("evidence_quote"):
        if c["evidence_quote"] not in body:
            ok = False
    if c.get("evidence_quote") and c.get("evidence_date"):
        if "source dated" not in body:
            ok = False
    if html_tag_re.search(body):
        ok = False
    if not ok:
        claim2_ok = False
        print(f"  claim {c['id']} ({c['field']}) failed detail check, status={status}")
check("2. all published /claims/<id>.md pass content checks", claim2_ok,
      "see per-id failures above" if not claim2_ok else "")

# ============================================================
# Check 3: each of the 14 published entity pages /crawlers/<slug> in
#          HTML, .md, .json shows the claims (count matches).
# ============================================================
claim3_ok = True
per_entity_expected = {}
for c in published_claims:
    pass  # entity_id in claim, need slug lookup from data
entity_by_id = {e["id"]: e for e in data["entities"]}
for c in published_claims:
    slug = entity_by_id[c["entity_id"]]["slug"]
    per_entity_expected[slug] = per_entity_expected.get(slug, 0) + 1

PUBLISHED_SLUGS = sorted(per_entity_expected.keys())
print(f"entities with published claims: {PUBLISHED_SLUGS}")

def count_md_table_rows(md_body, heading):
    """Count data rows in the markdown table under a '## heading' section
    (a pipe-table row, excluding the header and separator rows)."""
    lines = md_body.split("\n")
    try:
        start = next(i for i, l in enumerate(lines) if l.strip() == f"## {heading}")
    except StopIteration:
        return 0
    count = 0
    seen_header = False
    for l in lines[start + 1:]:
        stripped = l.strip()
        if stripped.startswith("## "):
            break
        if stripped.startswith("|"):
            if not seen_header:
                seen_header = True  # first pipe line is the markdown table header
                continue
            if set(stripped.replace("|", "").strip()) <= {"-", " "}:
                continue  # separator line, if renderMarkdown ever adds one
            count += 1
    return count


for slug in PUBLISHED_SLUGS:
    expected = per_entity_expected.get(slug, 0)
    status_j, body_j, _ = get(f"/crawlers/{slug}.json")
    ent_json = json.loads(body_j)
    got_json = len(ent_json.get("claims", []))
    status_h, body_h, _ = get(f"/crawlers/{slug}")
    status_m, body_m, _ = get(f"/crawlers/{slug}.md")
    ok = (status_j == 200 and status_h == 200 and status_m == 200 and got_json == expected)
    # HTML: count /claims/<id> hrefs. Markdown: table links only carry link
    # text (render.js blockToMd uses c.text, not the href), so count table
    # data rows under "Current claims" instead.
    html_claim_links = len(re.findall(r'/claims/\d+', body_h))
    md_row_count = count_md_table_rows(body_m, "Current claims")
    if expected > 0:
        if html_claim_links != expected or md_row_count != expected:
            ok = False
    if not ok:
        claim3_ok = False
        print(f"  {slug}: expected={expected} json={got_json} html_links={html_claim_links} md_rows={md_row_count}")
check(f"3. all {len(PUBLISHED_SLUGS)} published entity pages show matching claim counts (html/md/json)", claim3_ok)

# ============================================================
# Check 4: sitewide grep for ** and em dash across home, all 15 entity
#          pages, /changes, every published /claims/<id>, /llms-full.txt,
#          in all formats where they exist.
# ============================================================
pages_to_check = []
pages_to_check.append(("/", ["", ".md", ".json"]))
for slug in ENTITY_SLUGS_ALL:
    pages_to_check.append((f"/crawlers/{slug}", ["", ".md", ".json"]))
pages_to_check.append(("/changes", ["", ".md", ".json"]))
for cid in published_ids:
    pages_to_check.append((f"/claims/{cid}", ["", ".md", ".json"]))

check4_ok = True
bad_hits = []
for path, suffixes in pages_to_check:
    for suf in suffixes:
        full = path if suf == "" else f"{path}{suf}"
        try:
            status, body, _ = get(full)
        except Exception as e:
            bad_hits.append((full, f"fetch error: {e}"))
            check4_ok = False
            continue
        if status != 200:
            bad_hits.append((full, f"status {status}"))
            check4_ok = False
            continue
        if "**" in body:
            bad_hits.append((full, "contains **"))
            check4_ok = False
        if EM_DASH in body:
            bad_hits.append((full, "contains em dash"))
            check4_ok = False

status, llms_full, _ = get("/llms-full.txt")
if "**" in llms_full:
    bad_hits.append(("/llms-full.txt", "contains **"))
    check4_ok = False
if EM_DASH in llms_full:
    bad_hits.append(("/llms-full.txt", "contains em dash"))
    check4_ok = False

for path, reason in bad_hits[:30]:
    print(f"  {path}: {reason}")
check("4. zero ** and zero em dashes sitewide across checked pages", check4_ok,
      f"{len(bad_hits)} bad hits (showing up to 30 above)" if not check4_ok else "")
print(f"   total pages/formats checked: {sum(len(s) for _, s in pages_to_check) + 1}")

# ============================================================
# Check 5: /crawlers/<slug>.json for every entity: notes does not
#          contain "Respects robots.txt"
# ============================================================
check5_ok = True
for slug in ENTITY_SLUGS_ALL:
    status, body, _ = get(f"/crawlers/{slug}.json")
    ent = json.loads(body)
    entity_notes = (ent.get("entity") or {}).get("notes") or ""
    if "Respects robots.txt" in entity_notes:
        check5_ok = False
        print(f"  {slug}: notes still contains 'Respects robots.txt': {entity_notes!r}")
check("5. notes field on every /crawlers/<slug>.json has no 'Respects robots.txt'", check5_ok)

# ============================================================
# Check 6: confidence for a not_documented claim renders as n/a in
#          HTML and Markdown.
# ============================================================
nd_claims = [c for c in published_claims if c.get("confidence") is None]
check6_ok = False
example = None
if nd_claims:
    c = nd_claims[0]
    status_h, body_h, _ = get(f"/claims/{c['id']}")
    status_m, body_m, _ = get(f"/claims/{c['id']}.md")
    if "n/a" in body_h and "n/a" in body_m:
        check6_ok = True
    example = c["id"]
check("6. confidence renders as n/a for a not_documented claim (html+md)", check6_ok,
      f"example claim id {example}" if not check6_ok else f"example claim id {example}")

print()
print("=" * 60)
if failures:
    print(f"RESULT: {len(failures)} check(s) FAILED")
    for label, detail in failures:
        print(f" - {label}: {detail}")
    sys.exit(1)
else:
    print("RESULT: all checks PASSED")
