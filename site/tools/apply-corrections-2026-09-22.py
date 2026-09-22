#!/usr/bin/env python3
"""Apply the dated corrections from verification/perplexity-2026-09-22.md
("Corrections to apply", items 1 to 4) through the admin API.

Each correction: add the cited source if missing (POST /admin/sources),
supersede the incident's occurred_on claim with reason "correction" and a
verbatim quote from that source, then revise the incident (occurred_on,
prose dates, {c:old} -> {c:new}) with is_correction so the change appears
in the correction log. Quotes were read from the pages on 2026-09-22.

Where the source hierarchy disagreed with the Perplexity note, the source
wins and the difference is recorded in the reason:
  - Louisiana: the Legislature's bill history (primary document) gives
    05/24 for the governor's signature, as Perplexity said; the v1 claim
    (WVUE, "signed into law Tuesday (May 28)") is superseded.
  - Pentagon: NPR (2025-09-20) dates the officials' confirmation and
    Hegseth's post to Friday, 2025-09-19; The Guardian says the memo was
    "issued Thursday" (2025-09-18). The record uses 2025-09-19, the date
    the rules were made public, and says so in the claim.
  - Hong Kong (Lai): the record already carried 2025-12-15; only the claim
    value (2025-12-14, contradicting its own quote) is corrected.

Idempotent: a correction whose claim already carries the new value is
skipped. Publish-scope token; never printed.
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("TWON_BASE", "https://thewaronnews.com")
TOKEN = open(os.environ.get("TWON_TOKEN_FILE_PUBLISH", "/home/claude/.twon/admin-token-publish.txt")).read().strip()
VERIFIED = "2026-09-22"


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN, "User-Agent": "twon-ops/1.0", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


CORRECTIONS = [
    {
        "slug": "2025-white-house-bars-ap-gulf-of-america",
        "old_date": "2025-02-16", "new_date": "2025-02-11",
        "source": {"url": "https://www.voanews.com/a/white-house-blocks-ap-reporter-from-oval-office-event-over-gulf-of-america-policy/7972268.html",
                   "title": "White House blocks AP reporter from Oval Office event over 'Gulf of America' policy", "publisher": "Voice of America",
                   "source_kind": "reporting", "published_on": "2025-02-12"},
        "statement": "The White House first barred an Associated Press reporter from an Oval Office event on Tuesday, February 11, 2025.",
        "quote": "The White House blocked an Associated Press reporter from an event in the Oval Office on Tuesday because the news agency has not altered its style on the Gulf of Mexico",
        "evidence_date": "2025-02-12", "method": "outlet_report", "confidence": "high",
        "prose": [("On February 16, 2025, the White House began excluding", "On February 11, 2025, the White House began excluding")],
        "reason": "Correction: the exclusion of AP began on 2025-02-11 (VOA, 2025-02-12, reporting the Tuesday Oval Office event), not 2025-02-16.",
    },
    {
        "slug": "2025-pentagon-issues-new-press-credentialing-rules",
        "old_date": "2025-09-21", "new_date": "2025-09-19",
        "source": {"url": "https://www.npr.org/2025/09/20/g-s1-89713/pentagon-new-strict-guidelines-for-media",
                   "title": "Defense Secretary Hegseth requires new 'pledge' for Pentagon reporters", "publisher": "NPR",
                   "source_kind": "reporting", "published_on": "2025-09-20"},
        "statement": "The Pentagon's new press rules were made public on Friday, September 19, 2025, when officials confirmed them to reporters.",
        "quote": "The Pentagon will drastically change its rules for journalists who cover the Department of Defense, two U.S. officials who are not authorized to speak publicly confirmed to NPR Friday.",
        "evidence_date": "2025-09-20", "method": "outlet_report", "confidence": "medium",
        "prose": [("On September 21, 2025, the Pentagon", "On September 19, 2025, the Pentagon")],
        "reason": "Correction: the rules were made public on 2025-09-19 (NPR, 2025-09-20), not 2025-09-21. The Guardian (2025-09-20) reports the memo was issued the day before.",
    },
    {
        "slug": "2024-louisiana-enacts-police-buffer-zone-law",
        "old_date": "2024-05-28", "new_date": "2024-05-24",
        "source": {"url": "https://legis.la.gov/legis/BillInfo.aspx?s=24RS&b=HB173&sbi=y",
                   "title": "HB173, 2024 Regular Session: bill history", "publisher": "Louisiana State Legislature",
                   "source_kind": "primary_document", "published_on": "2024-05-24"},
        "statement": "Governor Jeff Landry signed HB 173 into law as Act No. 259 on May 24, 2024; it took effect on August 1, 2024.",
        "quote": "05/24 H Effective date: 08/01/2024. 05/24 H Signed by the Governor. Becomes Act No. 259.",
        "evidence_date": "2024-05-24", "method": "primary_document", "confidence": "high",
        "prose": [("On May 28, 2024, Louisiana enacted", "On May 24, 2024, Louisiana enacted")],
        "reason": "Correction: the Louisiana Legislature's bill history records the governor's signature on 2024-05-24 (Act 259, effective 2024-08-01); the earlier date came from a news report.",
    },
    {
        "slug": "2025-hong-kong-convicts-jimmy-lai-under-national-security-law",
        "old_date": "2025-12-14", "new_date": "2025-12-15",
        "source": None,  # keep the claim's own source (Human Rights Watch, 2025-12-15)
        "statement": None, "quote": None, "evidence_date": "2025-12-15", "method": None, "confidence": None,
        "prose": [],
        "reason": "Correction: the conviction date is 2025-12-15, as the cited source states; the claim value read 2025-12-14.",
    },
]


def main():
    report = []
    for c in CORRECTIONS:
        slug = c["slug"]
        st, rec = call("GET", f"/admin/records/incident/{slug}")
        if st != 200:
            report.append({"slug": slug, "error": st})
            continue
        claim = next((x for x in rec["claims"] if x["status"] == "current" and x["field"] == "occurred_on"), None)
        if not claim:
            report.append({"slug": slug, "error": "no current occurred_on claim"})
            continue
        if claim["value"] == c["new_date"] and rec["occurred_on"] == c["new_date"]:
            report.append({"slug": slug, "status": "already applied", "claim": claim["id"]})
            continue
        source_id = claim["source_id"]
        added = False
        if c["source"]:
            st, s = call("POST", "/admin/sources", {**c["source"], "batch_label": "corrections-2026-09-22"})
            if st != 200:
                report.append({"slug": slug, "error": ["source", st, s]})
                continue
            source_id, added = s["id"], bool(s.get("created"))
        body = {
            "reason": "correction",
            "note": c["reason"],
            "value": c["new_date"],
            "statement": c["statement"] or claim["statement"],
            "attribution": claim.get("attribution"),
            "source_id": source_id,
            "evidence_quote": c["quote"] or claim["evidence_quote"],
            "evidence_date": c["evidence_date"],
            "method": c["method"] or claim["method"],
            "verified_at": VERIFIED,
            "confidence": c["confidence"] or claim["confidence"],
            "batch_label": "corrections-2026-09-22",
        }
        if claim["value"] != c["new_date"]:
            st, r = call("POST", f"/admin/claims/{claim['id']}/supersede", body)
            if st != 200:
                report.append({"slug": slug, "error": ["supersede", st, r]})
                continue
            new_id = r["id"]
        else:
            new_id = claim["id"]
        patch = {"reason": c["reason"], "is_correction": True, "occurred_on": c["new_date"]}
        for col in ["summary", "what_happened", "stated_justification", "effect_on_reporting"]:
            v = rec.get(col) or ""
            nv = v.replace("{c:%d}" % claim["id"], "{c:%d}" % new_id)
            for a, b in c["prose"]:
                nv = nv.replace(a, b)
            if nv != v:
                patch[col] = nv
        st, r = call("PUT", f"/admin/records/incident/{slug}", patch)
        report.append({"slug": slug, "old_claim": claim["id"], "new_claim": new_id, "source_id": source_id, "source_added": added,
                       "occurred_on": f"{rec['occurred_on']} -> {c['new_date']}", "revise": st, **({"error": r} if st != 200 else {"revision": r.get("revision")})})
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    sys.exit(main())
