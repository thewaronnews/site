#!/usr/bin/env python3
"""Apply the corrections in verification/perplexity-v2-2026-09-22.md
("Corrections to apply", 15 rows on 14 incidents, plus the two "outcome
characterization" notes) through the admin API, v3 step 5.

Rule: a correction is applied only when a journalistic-quality or primary
source, fetched on 2026-09-22 (curl), states the new value in words that can
be quoted verbatim. Each applied row: the source is added (POST
/admin/sources) and attached to the incident; a claim carries the new value
(superseding the claim that held the old value where one exists, reason
"correction"); the incident is revised with is_correction (dates, dated
prose, {c:old} -> {c:new}), so it appears in the correction log.

SKIPPED lists the rows not applied and why (source not journalistic-quality
or primary, not reachable, or not stating the new value).

Idempotent: a row whose incident already carries the new value is skipped.
Publish-scope token; never printed.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("TWON_BASE", "https://thewaronnews.com")
TOKEN = os.environ.get("TWON_TOKEN") or open(os.environ.get("TWON_TOKEN_FILE_PUBLISH", "/home/claude/.twon/admin-token-publish.txt")).read().strip()
VERIFIED = "2026-09-22"
BATCH = "corrections-v2-2026-09-22"


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


CPJ_TUTBY = {"url": "https://cpj.org/2021/05/belarusian-authorities-raid-3-offices-of-tut-by-detain-journalists-in-tax-case/",
             "title": "Belarusian authorities raid 3 offices of Tut.by, detain journalists in tax case", "publisher": "Committee to Protect Journalists",
             "source_kind": "reporting", "published_on": "2021-05-18"}
GOVINFO_CPB = {"url": "https://www.govinfo.gov/content/pkg/PLAW-119publ28/html/PLAW-119publ28.htm",
               "title": "Public Law 119-28, Rescissions Act of 2025 (H.R. 4)", "publisher": "U.S. Government Publishing Office",
               "source_kind": "primary_document", "published_on": "2025-07-24"}
ACLU_TRO = {"url": "https://www.aclu-or.org/press-releases/federal-court-issues-restraining-order-federal-agents-portland/",
            "title": "Federal Court Issues Restraining Order on Federal Agents in Portland", "publisher": "ACLU of Oregon",
            "source_kind": "official_statement", "published_on": "2020-07-23"}
ARCOTEL = {"url": "https://www.arcotel.gob.ec/listado-de-concesionarios-que-cuentan-con-informes-favorables-para-la-renovacion-en-cumplimiento-al-primer-inciso-de-la-disposicion-transitoria-octava-de-la-ley-organica-reformatoria-a-la-ley-organica/",
           "title": "Listado de concesionarios ... Disposición Transitoria Octava de la Ley Orgánica Reformatoria a la Ley Orgánica de Comunicación",
           "publisher": "Agencia de Regulación y Control de las Telecomunicaciones (ARCOTEL), Ecuador", "source_kind": "official_statement"}
MERLIN = {"url": "https://merlin.obs.coe.int/article/10128", "title": "Slovakia: The Act on the public broadcaster enters into force (IRIS 2024-8:1/24)",
          "publisher": "European Audiovisual Observatory (IRIS Merlin)", "source_kind": "reference", "published_on": "2024-08"}

# Each row: slug, fields to set, claim (new value, statement, quote, source), prose replacements.
ROWS = [
    {"n": 13, "slug": "2021-belarus-blocks-tutby-arrests-staff", "set": {"occurred_on": "2021-05-18"}, "check": ("occurred_on", "2021-05-18"),
     "claim": {"field": "occurred_on", "value": "2021-05-18", "source": CPJ_TUTBY, "method": "outlet_report", "confidence": "high", "evidence_date": "2021-05-18",
               "statement": "Belarusian financial investigators raided Tut.by's offices and detained staff on May 18, 2021, the day CPJ reported the raids and the site went offline.",
               "quote": "Today, officers of the Belarus Financial Investigation Department raided Tut.by’s headquarters in Minsk, the capital, its regional offices in the western cities of Brest and Hrodna, and the homes of several of its journalists and detained at least three of them"},
     "prose": [("On May 19, 2021, Belarusian authorities", "On May 18, 2021, Belarusian authorities")],
     "reason": "Correction: the raids, blocking and arrests took place on 2021-05-18 (CPJ, 2021-05-18: \"Today, officers ... raided\"), not 2021-05-19. The later \"extremist\" designation of August 2021 is a separate event."},
    {"n": 14, "slug": "2023-nicaragua-strips-journalists-citizenship", "set": {"occurred_on": "2023-02-15"}, "check": ("occurred_on", "2023-02-15"),
     "claim": {"field": "occurred_on", "value": "2023-02-15", "source_id": 301, "method": "outlet_report", "confidence": "high", "evidence_date": "2023-02-16",
               "statement": "The appeals court justice announced the loss of citizenship of the 94 people on Wednesday, February 15, 2023, according to Al Jazeera's report of February 16.",
               "quote": "The 94 people were “traitors” and would have their properties confiscated, Appeals Court Justice Ernesto Rodríguez Mejía said in a statement on Wednesday."},
     "prose": [("On February 16, 2023, a Nicaraguan appeals court", "On February 15, 2023, a Nicaraguan appeals court")],
     "reason": "Correction: the appeals court announced the decision on Wednesday, 2023-02-15 (Al Jazeera, 2023-02-16, \"said in a statement on Wednesday\"), not 2023-02-16."},
    {"n": 12, "slug": "2025-trump-sues-new-york-times-15-billion", "set": {"occurred_on": "2025-09-15"}, "check": ("occurred_on", "2025-09-15"),
     "claim": {"field": "occurred_on", "value": "2025-09-15", "source_id": 275, "method": "court_record", "confidence": "high", "evidence_date": "2025-09-15",
               "statement": "Trump filed the suit in the U.S. District Court for the Middle District of Florida on September 15, 2025; the docket entry for the complaint is dated 09/15/2025.",
               "quote": "On September 15, 2025, Donald Trump filed this lawsuit in the U.S. District Court for the Middle District of Florida against the New York Times Company, Penguin Random House LLC, and individual authors."},
     "prose": [("On September 16, 2025, Trump filed", "On September 15, 2025, Trump filed")],
     "reason": "Correction: the complaint was filed on 2025-09-15 (docket entry and case summary, Civil Rights Litigation Clearinghouse); 2025-09-16 is the date of The New York Times Company's public response."},
    {"n": 10, "slug": "2025-fcc-carr-news-distortion-complaints-nbc-cbs", "set": {"occurred_on": "2025-01-22"}, "check": ("occurred_on", "2025-01-22"),
     "claim": {"field": "occurred_on", "value": "2025-01-22", "source_id": 268, "method": "outlet_report", "confidence": "high", "evidence_date": "2025-01-22",
               "statement": "FCC Chair Brendan Carr reinstated the dismissed complaints against the networks on January 22, 2025; the demand for the CBS transcript followed on January 29.",
               "quote": "Jan. 22, 2025 | FCC chair reinstates complaints against three news outlets"},
     "prose": [("On January 29, 2025, newly installed FCC Chair Brendan Carr revived", "On January 22, 2025, newly installed FCC Chair Brendan Carr revived")],
     "reason": "Correction: Carr reinstated the complaints on 2025-01-22 (U.S. Press Freedom Tracker entry dated 2025-01-22); 2025-01-29 is the date of the demand for the CBS transcript."},
    {"n": 11, "slug": "2025-congress-rescinds-cpb-funding", "set": {"outcome_on": "2025-07-24", "outcome_note": "The rescission became law on July 24, 2025 (Public Law 119-28), eliminating CPB's federal appropriation; no restoration of the funding had occurred in the sources reviewed."},
     "check": ("outcome_on", "2025-07-24"),
     "claim": {"field": "status", "value": "2025-07-24", "source": GOVINFO_CPB, "method": "primary_document", "confidence": "high", "evidence_date": "2025-07-24",
               "statement": "The Rescissions Act of 2025, which rescinded the Corporation for Public Broadcasting's appropriations, was approved (signed into law) on July 24, 2025, as Public Law 119-28.",
               "quote": "(B) Amounts made available for ``Corporation for Public Broadcasting'' for fiscal year 2027 by Public Law 119-4 are rescinded. Approved July 24, 2025."},
     "prose": [("the measure became law on July 18, 2025.", "the measure became law on July 24, 2025, when the president signed it.")],
     "reason": "Correction: the rescission became law on 2025-07-24 (Public Law 119-28, \"Approved July 24, 2025\"); 2025-07-18 was the date of final congressional action as reported."},
    {"n": 9, "slug": "2020-federal-officers-target-journalists-portland-injunction", "set": {"occurred_on": "2020-07-23", "outcome_on": "2020-07-23", "outcome_note": "On July 23, 2020, the court ordered federal agents to stop dispersing, arresting or using force against identified journalists and legal observers; the order was later extended."},
     "check": ("occurred_on", "2020-07-23"),
     "claim": {"field": "occurred_on", "value": "2020-07-23", "source": ACLU_TRO, "method": "official_statement", "confidence": "high", "evidence_date": "2020-07-23",
               "statement": "On July 23, 2020, Judge Michael Simon's temporary restraining order barred federal agents in Portland from dispersing, arresting or using force against journalists and legal observers; the July 16 order had applied to the Portland police.",
               "quote": "U.S. District Judge Michael Simon today blocked federal agents in Portland from dispersing, arresting, threatening to arrest, or targeting force against journalists or legal observers at protests."},
     # the July 16 claim stays as the record of the police order, refiled as a status claim
     "refile_old": {"claim_id": 331, "field": "status", "note": "Refiled as a status claim: the 2020-07-16 preliminary injunction applied to the Portland police; the order covering federal agents is dated 2020-07-23."},
     "prose": [("The order, later extended and applied against federal officers as well, ran through the fall of 2020.",
                "On July 23, 2020, he applied the same limits to federal agents of the Department of Homeland Security and the U.S. Marshals Service in a temporary restraining order, which was later extended; the orders ran through the fall of 2020.")],
     "reason": "Correction: the order covering federal officers was issued on 2020-07-23 (ACLU of Oregon, 2020-07-23); the 2020-07-16 preliminary injunction applied to the Portland police."},
    {"n": 7, "slug": "2013-ecuador-communications-law-supercom", "set": {"outcome_on": "2019-02-20", "outcome_note": "President Lenin Moreno's government moved to eliminate SUPERCOM in 2018, and the reform of the Communication Law was published in the Official Register on February 20, 2019; Fundamedios director Cesar Ricaurte said the surrounding legal framework nonetheless remained \"intact.\""},
     "check": ("outcome_on", "2019-02-20"),
     "claim": {"field": "reversed_on", "value": "2019-02-20", "source": ARCOTEL, "method": "official_statement", "confidence": "high", "evidence_date": "2019-02-20",
               "statement": "The Organic Law Reforming the Organic Communication Law was published in Ecuador's Official Register No. 432 (supplement) on February 20, 2019.",
               "quote": "Ley Orgánica Reformatoria a la Ley Orgánica de Comunicación, publicada en el Registro Oficial No. 432 – Suplemento de 20 de febrero de 2019"},
     "prose": [],
     "reason": "Correction: the reform of the Communication Law was published on 2019-02-20 (Registro Oficial No. 432, supplement, as cited by ARCOTEL); no source supports 2018-07-24."},
    {"n": 15, "slug": "2024-slovakia-dissolves-rtvs-creates-stvr", "set": {"outcome_on": "2024-07-01"}, "check": ("outcome_on", "2024-07-01"),
     "claim": {"field": "status", "value": "2024-07-01", "source": MERLIN, "method": "outlet_report", "confidence": "high", "evidence_date": "2024-08",
               "statement": "The Act on Slovak Television and Radio was adopted by parliament on June 20, 2024 and promulgated on July 1, 2024, when STVR succeeded RTVS.",
               "quote": "The Act on Slovak Television and Radio and on Amendments to Certain Acts was adopted by the National Council (the Parliament) on 20 June 2024 and promulgated on 1 July 2024."},
     "prose": [("which took effect on July 4, 2024.", "which was promulgated on July 1, 2024.")],
     "reason": "Correction: the act was promulgated and STVR succeeded RTVS on 2024-07-01 (European Audiovisual Observatory, IRIS 2024-8:1/24), not 2024-07-04."},
    # outcome characterization note (not a date): Smethurst
    {"n": "note-1", "slug": "2020-australia-high-court-invalidates-smethurst-warrant", "correction": False,
     "set": {"outcome_note": "The High Court found the 2019 warrant invalid but declined to order the AFP to return or destroy the material it had seized; weeks later the AFP announced it would not charge Smethurst."},
     "check": ("outcome_note", "The High Court found the 2019 warrant invalid but declined to order the AFP to return or destroy the material it had seized; weeks later the AFP announced it would not charge Smethurst."),
     "claim": {"field": "status", "value": "warrant quashed; seized material kept", "source_id": 322, "method": "outlet_report", "confidence": "high", "evidence_date": "2020-04-15",
               "statement": "The High Court quashed the warrant but did not order the AFP to hand back or destroy the material seized in the raid.",
               "quote": "was thrown out by the High Court on Wednesday, but police will be allowed to keep the materials they seized in the raid."},
     "prose": [],
     "reason": "Update: the outcome note now states that the High Court quashed the warrant without ordering the seized material returned or destroyed (verification note, ABC News 2020-04-15)."},
]

SKIPPED = [
    {"n": 1, "slug": "1983-us-grenada-press-exclusion", "field": "outcome_on", "why": "The verification offers two alternative dates (1984-10-09 or 1984-08-23) and cites \"apps.dtic.mil (Sidle Commission report)\" without a document address; the Sidle report is the recommendation, not the pool's establishment. No source stating a single date could be fetched. Not changed."},
    {"n": 2, "slug": "1981-haiti-duvalier-radio-haiti-inter-exile", "field": "occurred_on", "why": "Cited source is \"amnesty.org\" with no document address; none could be located. The record's own source (RSF) says Dominique was forced into exile in 1981. Not changed."},
    {"n": 3, "slug": "1950-south-africa-suppression-of-communism-act", "field": "occurred_on", "why": "Cited sources are en.wikisource.org (a wiki, not an accepted source type) and sabctrc.saha.org.za (the glossary page answers \"Page Not Found\"). Not changed."},
    {"n": 4, "slug": "1950-south-africa-suppression-of-communism-act", "field": "outcome_on", "why": "Cited source sabctrc.saha.org.za (chronology) could not be reached (\"Page Not Found\"); no other qualifying source fetched. Not changed."},
    {"n": 5, "slug": "2006-russia-politkovskaya-killed", "field": "outcome description", "why": "Cited sources include en.wikipedia.org (not accepted). No change needed: the live record already names Dmitry Pavlyuchenkov as the former police officer (claim 267, RFE/RL 2012) and says five men were convicted; 2014-06-09 is the sentencing of the others."},
    {"n": 6, "slug": "2010-hungary-media-law-content-authority", "field": "occurred_on", "why": "Cited sources europarl.europa.eu and loc.gov refuse automated fetches (202 challenge, robots); no document address was given. Not changed."},
    {"n": 8, "slug": "1998-serbia-public-information-act-fines", "field": "outcome_on", "why": "Cited source 2009-2017.state.gov (Yugoslavia country report) answers every fetch with a \"Technical Difficulties\" error page; the value (\"2000-10\") could not be read. Not changed."},
    {"n": "note-2", "slug": "2023-zimbabwe-patriotic-act-criminalizes-foreign-contact", "field": "summary wording", "why": "The note concerns how the act's text is described, not an outcome field; the record already says the act criminalizes meeting foreign officials \"with intent to harm Zimbabwe's sovereignty\". Not loaded."},
]


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
        added = False
        if "source" in c:
            source_id, added = ensure_source(c["source"])
        else:
            source_id = c["source_id"]
        attached = attach_source(slug, source_id)
        claim_body = {"field": c["field"], "value": c["value"], "statement": c["statement"], "source_id": source_id, "evidence_quote": c["quote"],
                      "evidence_date": c["evidence_date"], "method": c["method"], "verified_at": VERIFIED, "confidence": c["confidence"], "batch_label": BATCH}
        ref_map = {}
        refile = row.get("refile_old")
        if refile:
            old = next(x for x in rec["claims"] if x["id"] == refile["claim_id"])
            if old["status"] == "current":
                st, r = call("POST", f"/admin/claims/{old['id']}/supersede", {"reason": "correction", "note": refile["note"], "field": refile["field"], "value": old["value"],
                         "statement": old["statement"], "attribution": old.get("attribution"), "source_id": old["source_id"], "evidence_quote": old["evidence_quote"],
                         "evidence_date": old.get("evidence_date"), "method": old["method"], "verified_at": VERIFIED, "confidence": old["confidence"], "batch_label": BATCH})
                if st != 200:
                    report.append({"n": row["n"], "slug": slug, "error": ["refile", st, r]}); continue
                ref_map[old["id"]] = r["id"]
        st, r = call("POST", "/admin/claims", {**claim_body, "subject_type": "incident", "subject_slug": slug})
        if st != 200:
            report.append({"n": row["n"], "slug": slug, "error": ["claim", st, r]}); continue
        new_id = r["id"]
        prose_hits = 0
        patch = {"reason": row["reason"], "is_correction": row.get("correction", True), "batch_label": BATCH, **row["set"]}
        for col in ["summary", "what_happened", "stated_justification", "effect_on_reporting"]:
            val = rec.get(col) or ""
            nv = val
            for o, n in ref_map.items():
                nv = nv.replace("{c:%d}" % o, "{c:%d}" % n)
            for a, b in row["prose"]:
                if a in nv:
                    prose_hits += 1
                    # cite the new claim at the end of the paragraph holding the corrected text
                    paras = nv.split("\n\n")
                    paras = [p.replace(a, b) + ("{c:%d}" % new_id if a in p else "") for p in paras]
                    nv = "\n\n".join(paras)
            if nv != val:
                patch[col] = nv
        st, rv = call("PUT", f"/admin/records/incident/{slug}", patch)
        report.append({"n": row["n"], "slug": slug, "set": row["set"], "new_claim": new_id, "refiled": ref_map or None, "source_id": source_id, "source_added": added,
                       "source_attached": attached, "prose_replaced": f"{prose_hits}/{len(row['prose'])}", "revise": st, **({"error": rv} if st != 200 else {"revision": rv.get("revision")})})
        time.sleep(0.5)
    print(json.dumps({"applied": report, "skipped": SKIPPED}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
