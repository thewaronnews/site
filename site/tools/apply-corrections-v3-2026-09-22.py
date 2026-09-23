#!/usr/bin/env python3
"""Apply research-v3/corrections-sources.json (6 corrections: Grenada,
Haiti, South Africa occurred_on and outcome_on, Hungary, Serbia) through
the admin API. Same rule as apply-corrections-v2-2026-09-22.py: a
correction is applied only when a source, fetched on 2026-09-22 (curl,
browser UA, 15s, via the egress proxy), states the new value in words that
can be quoted verbatim.

Two of the six repeat the prior session's SKIPPED reasons even with a new
URL: apps.dtic.mil/sti/tr/pdf/ADA225841.pdf (Grenada) 307-redirects to
/landingpage/maint.html (an Azure blob "site under maintenance" page, 1408
bytes, no report content) on every fetch; loc.gov (Hungary) answers every
fetch, with or without extra headers, 403. Not changed; SKIPPED below.

The other four are live and confirmed by direct quote match (Haiti:
amnesty.org PDF via pdftotext; South Africa x2: sabctrc.saha.org.za and
omalley.nelsonmandela.org; Serbia: 2009-2017.state.gov, all fetched
2026-09-22, all 200). Applied: the source is added and attached; a claim
carries the new value (POST /admin/claims/<id>/supersede where the
incident already carries a current claim on that exact field -- only
Haiti's occurred_on does; the two South Africa fields and Serbia's outcome
have no prior claim on that field in this corpus, so a new current claim
is posted directly, matching apply-corrections-v2's own default path);
the incident is revised with is_correction=True (dates, dated prose),
batch_label "v3-corrections-2026-09-22".

Idempotent: a row whose incident record already carries the new value is
skipped. Publish-scope token; never printed."""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("TWON_BASE", "https://thewaronnews.com")
TOKEN = os.environ.get("TWON_TOKEN") or open(os.environ.get("TWON_TOKEN_FILE_PUBLISH", "/home/claude/.twon/admin-token-publish.txt")).read().strip()
VERIFIED = "2026-09-22"
BATCH = "v3-corrections-2026-09-22"

AMNESTY = {"url": "https://www.amnesty.org/en/wp-content/uploads/2021/06/amr360012002en.pdf",
           "title": "HAITI (Amnesty International report)", "publisher": "Amnesty International",
           "source_kind": "reporting", "published_on": "2002"}
SABCTRC = {"url": "https://sabctrc.saha.org.za/originals/finalreport/volume1/chapters/volume1_ch30.pdf",
           "title": "Chronology of Apartheid Legislation (TRC Final Report, Vol. 1, Ch. 13)",
           "publisher": "South African Truth and Reconciliation Commission / SAHA", "source_kind": "official_statement", "published_on": "1998"}
OMALLEY = {"url": "https://omalley.nelsonmandela.org/cis/omalley/OMalleyWeb/03lv02039/04lv02040/05lv02042.htm",
           "title": "1991 (Chronology, O'Malley Archive)", "publisher": "Nelson Mandela Foundation / O'Malley Archives",
           "source_kind": "reference", "published_on": "1991"}
STATE_SERBIA = {"url": "https://2009-2017.state.gov/j/drl/rls/hrrpt/2002/18401.htm",
                "title": "Yugoslavia, Federal Republic of - Country Reports on Human Rights Practices",
                "publisher": "U.S. Department of State", "source_kind": "official_statement", "published_on": "2002"}

ROWS = [
    {"n": 2, "slug": "1981-haiti-duvalier-radio-haiti-inter-exile", "set": {"occurred_on": "1980-11-28"},
     "check": ("occurred_on", "1980-11-28"), "old_claim_id": 141,
     "claim": {"field": "occurred_on", "value": "station raided November 28, 1980", "source": AMNESTY, "method": "outlet_report",
               "confidence": "high", "evidence_date": "2002",
               "statement": "Amnesty International's Haiti report says Radio Haiti Inter was raided by Duvalier's security forces, which destroyed equipment and arrested Jean Dominique's wife and daughters, on November 28, 1980.",
               "quote": "Radio Haïti Inter was raided by the Duvalier security forces on 28 November 1980. They destroyed equipment and arrested Jean's wife and daughters"},
     "prose": [("In 1981, authorities arrested and deported Dominique's wife, journalist Michaèle Montas, along with other Radio Haiti-Inter staff, and Dominique himself was forced into exile the same year.",
                "On November 28, 1980, authorities raided the station, arrested and deported Dominique's wife, journalist Michaèle Montas, along with other Radio Haiti-Inter staff, and Dominique himself was forced into exile shortly after."),
               ("forcing its director, journalist Jean Dominique, into exile in 1981.",
                "forcing its director, journalist Jean Dominique, into exile after security forces raided the station on November 28, 1980."),
               ("Radio Haiti-Inter lost its director and other staff to arrest, deportation and exile in 1981,",
                "Radio Haiti-Inter lost its director and other staff to arrest, deportation and exile after the station was raided on November 28, 1980,")],
     "reason": "Correction: the raid, arrests and Dominique's exile began on 1980-11-28 (Amnesty International, Haiti report, \"raided by the Duvalier security forces on 28 November 1980\"), not generically \"1981\"."},
    {"n": 3, "slug": "1950-south-africa-suppression-of-communism-act", "set": {"occurred_on": "1950-07-17"},
     "check": ("occurred_on", "1950-07-17"), "old_claim_id": None,
     "claim": {"field": "occurred_on", "value": "act commenced July 17, 1950", "source": SABCTRC, "method": "official_statement",
               "confidence": "high", "evidence_date": "1998",
               "statement": "The Truth and Reconciliation Commission's chronology of apartheid legislation states the Suppression of Communism Act (No. 44 of 1950) commenced on July 17, 1950.",
               "quote": "1950 Internal Security Act (Suppression of Communism Act) No 44: ... Commenced: 17 July 1950"},
     "prose": [("approved the Suppression of Communism Act on March 17, 1950, two years after the party came to power",
                "approved the Suppression of Communism Act, which commenced on July 17, 1950, two years after the party came to power")],
     "reason": "Correction: the Act commenced on 1950-07-17 (South African TRC Final Report, Vol. 1, chronology of apartheid legislation, \"Commenced: 17 July 1950\"), not March 17, 1950."},
    {"n": 4, "slug": "1950-south-africa-suppression-of-communism-act", "set": {"outcome_on": "1991-07-31",
        "outcome_note": "The \"Internal Security and Intimidation Amendment Act\" repealed section 55 of the Suppression of Communism Act, which had prohibited furthering the aims of communism, on July 31, 1991; broader banning orders under the act and its successors had already been lifted the year before, in February 1990."},
     "check": ("outcome_on", "1991-07-31"), "old_claim_id": None,
     "claim": {"field": "status", "value": "section 55 repealed July 31, 1991", "source": OMALLEY, "method": "official_statement",
               "confidence": "high", "evidence_date": "1991",
               "statement": "The O'Malley Archive's chronology says the Internal Security and Intimidation Amendment Act abolished section 55 of the Suppression of Communism Act, which had prohibited furthering the aims of communism, on July 31, 1991.",
               "quote": "31 July 1991 Internal Security and Intimidation Amendment Act No 138: ... Abolished s 55, which had prohibited the furthering of the aims of communism"},
     "prose": [],
     "reason": "Correction: the Act's own communism-suppression provision (s55) was repealed on 1991-07-31 (O'Malley Archive chronology, \"31 July 1991 ... Abolished s 55\"), a more precise outcome date than the general February 1990 lifting of banning orders under the act and its successors, which remains true and is kept in the outcome note."},
    {"n": 8, "slug": "1998-serbia-public-information-act-fines", "set": {"outcome_on": "2000-10-01"},
     "check": ("outcome_on", "2000-10-01"), "old_claim_id": None,
     "claim": {"field": "status", "value": "law abolished October 2000", "source": STATE_SERBIA, "method": "official_statement",
               "confidence": "high", "evidence_date": "2002",
               "statement": "The U.S. State Department's human rights report says Serbia's government abolished the Law on Public Information, which Milosevic had used to silence independent media, in October 2000.",
               "quote": "In October 2000, the Government abolished the Law on Public Information, which former President Milosevic used to silence the independent media during the Kosovo crisis."},
     "prose": [],
     "reason": "Correction: the outcome_on column is corrected to 2000-10-01 (month known, day not stated in the source; the 1st is used as this schema's day-precision placeholder for a month-only date, as elsewhere in this corpus, e.g. occurred_on_precision \"month\" records) to match the record's own outcome note, already correct (\"The law was suspended after Milosevic lost power in October 2000\"), now directly sourced (U.S. Department of State, 2002 country report)."},
]

SKIPPED = [
    {"n": 1, "slug": "1983-us-grenada-press-exclusion", "field": "outcome_on",
     "why": "The new source (apps.dtic.mil/sti/tr/pdf/ADA225841.pdf) 307-redirects to /landingpage/maint.html on every fetch attempted 2026-09-22 (an Azure blob \"site under maintenance\" placeholder, 1408 bytes, no report content reachable). Not changed."},
    {"n": 6, "slug": "2010-hungary-media-law-content-authority", "field": "occurred_on",
     "why": "The new source (loc.gov/item/global-legal-monitor/...) answers 403 on every fetch attempted 2026-09-22, with and without extra Accept/Accept-Language headers and over HTTP/1.1. Not changed."},
]


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN, "User-Agent": "twon-ops/1.0", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def mcp_sources(slug):
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_sources_for", "arguments": {"incident_slug": slug}}}
    req = urllib.request.Request(BASE + "/mcp", data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "twon-smoke/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["result"]["structuredContent"]["sources"]


def ensure_source(src):
    st, s = call("POST", "/admin/sources", {**src, "batch_label": BATCH})
    if st != 200:
        raise SystemExit(json.dumps({"source": src["url"], "error": [st, s]}))
    return s["id"], bool(s.get("created"))


def attach_source(slug, source_id):
    current = mcp_sources(slug)
    if any(s["id"] == source_id for s in current):
        return False
    body = {"sources": [{"source_id": s["id"], "role": s.get("role") or "reporting", "sort": i} for i, s in enumerate(current)] + [{"source_id": source_id, "role": "reporting", "sort": len(current)}], "batch_label": BATCH}
    st, r = call("PUT", f"/admin/incidents/{slug}/links", body)
    if st != 200:
        raise SystemExit(json.dumps({"links": slug, "error": [st, r]}))
    return True


def main():
    report = []
    for row in ROWS:
        slug = row["slug"]
        st, rec = call("GET", f"/admin/records/incident/{slug}")
        if st != 200:
            report.append({"n": row["n"], "slug": slug, "error": st}); continue
        k, v = row["check"]
        if rec.get(k) == v:
            report.append({"n": row["n"], "slug": slug, "status": "already applied"}); continue
        c = row["claim"]
        source_id, added = ensure_source(c["source"])
        attached = attach_source(slug, source_id)
        claim_body = {"field": c["field"], "value": c["value"], "statement": c["statement"], "source_id": source_id,
                      "evidence_quote": c["quote"], "evidence_date": c["evidence_date"], "method": c["method"],
                      "verified_at": VERIFIED, "confidence": c["confidence"], "batch_label": BATCH}
        if row["old_claim_id"]:
            st, r = call("POST", f"/admin/claims/{row['old_claim_id']}/supersede", {**claim_body, "reason": "correction", "note": row["reason"]})
        else:
            st, r = call("POST", "/admin/claims", {**claim_body, "subject_type": "incident", "subject_slug": slug})
        if st != 200:
            report.append({"n": row["n"], "slug": slug, "error": ["claim", st, r]}); continue
        new_id = r["id"]
        prose_hits = 0
        row_set = dict(row["set"])
        if "outcome_note" in row_set:
            row_set["outcome_note"] = row_set["outcome_note"] + ("{c:%d}" % new_id)
        patch = {"reason": row["reason"], "is_correction": True, "batch_label": BATCH, **row_set}
        old_ref = "{c:%d}" % row["old_claim_id"] if row["old_claim_id"] else None
        new_ref = "{c:%d}" % new_id
        for col in ["summary", "what_happened", "stated_justification", "effect_on_reporting"]:
            val = rec.get(col) or ""
            nv = val
            changed = False
            for a, b in row["prose"]:
                if a in nv:
                    prose_hits += 1
                    nv = nv.replace(a, b)
                    changed = True
            # a superseded claim can no longer be cited; repoint every {c:old}
            # in this record to the new claim that replaces it (matches
            # apply-corrections-v2's ref_map treatment of a superseded claim).
            if old_ref and old_ref in nv:
                nv = nv.replace(old_ref, new_ref)
                changed = True
            if changed and nv != val:
                patch[col] = nv + ("" if new_ref in nv else new_ref)
            elif changed:
                patch[col] = nv
        st, rv = call("PUT", f"/admin/records/incident/{slug}", patch)
        report.append({"n": row["n"], "slug": slug, "set": row["set"], "new_claim": new_id, "source_id": source_id,
                        "source_added": added, "source_attached": attached, "prose_replaced": f"{prose_hits}/{len(row['prose'])}",
                        "revise": st, **({"error": rv} if st != 200 else {"revision": rv.get("revision")})})
        time.sleep(0.5)
    print(json.dumps({"applied": report, "skipped": SKIPPED}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
