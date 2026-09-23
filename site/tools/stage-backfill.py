#!/usr/bin/env python3
"""v3 stage backfill (brief v3-ladder-brief-2026-09-22): set `stage` on every
published incident through POST /admin/incidents/<slug>/ladder.

Stages (content/page-notes.json has the public definitions):
  restrict   limiting access or credentials for particular reporters/outlets
  pressure   state power short of prosecution to change coverage
  punish     legal or physical action against individual journalists/sources
  silence    removing outlets or channels from the public sphere
  eliminate  long imprisonment, killing, disappearance or forced exile of
             journalists, with state involvement as the sources state it

How a stage is chosen, in order:
  1. REVIEWED: an explicit stage for incidents where the tactic alone does
     not decide it (read against summary and what_happened on 2026-09-22),
     each with the reason for the choice. Reviewed notes (LADDER_NOTES) are
     restatements of the record's own text, never new facts.
  2. Text rule: for tactics that act on people (detention_and_violence,
     expulsion_and_visa_denial), words in the record that the brief assigns
     to eliminate ("shot dead", "forced into exile", "stateless", a prison
     sentence of five years or more) lift the stage to eliminate.
  3. Tactic rule (TACTIC_STAGE) on tactic_primary.

Usage:
  stage-backfill.py            dry run: print slug, rule stage, final stage, why
  stage-backfill.py --apply    write through the admin API (publish scope)
Env: TWON_BASE (default https://thewaronnews.com), TWON_TOKEN or
TWON_TOKEN_FILE_PUBLISH (default /home/claude/.twon/admin-token-publish.txt).
Idempotent: the endpoint skips a call that changes nothing. Never prints the token.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("TWON_BASE", "https://thewaronnews.com")
TOKEN = os.environ.get("TWON_TOKEN") or open(os.environ.get("TWON_TOKEN_FILE_PUBLISH", "/home/claude/.twon/admin-token-publish.txt")).read().strip()
REASON = "v3 escalation stage (brief v3-ladder-brief-2026-09-22)"
BATCH = "v3-stage-backfill-2026-09-22"

# The brief's rule: access/credentials -> restrict; regulatory pressure,
# funding, lawsuits, labels -> pressure; subpoenas, arrests, prosecutions,
# expulsions -> punish; closures, licensing removal, blocking, prior
# restraint -> silence. Criminal speech laws (insult, defamation, "false
# news", secrets) are prosecutions -> punish.
TACTIC_STAGE = {
    "access_ban": "restrict",
    "credential_control": "restrict",
    "funding_and_ownership_pressure": "pressure",
    "lawsuits_against_press": "pressure",
    "disinformation_labeling": "pressure",
    "surveillance_and_subpoenas": "punish",
    "expulsion_and_visa_denial": "punish",
    "detention_and_violence": "punish",
    "secrets_and_espionage_laws": "punish",
    "insult_and_defamation_laws": "punish",
    "outlet_licensing": "silence",
    "shutdowns_and_blocking": "silence",
    "prior_restraint": "silence",
}

ELIMINATE_TEXT = re.compile(r"shot dead|was killed|forced (?:him |her |them )?into exile|forced into exile|stateless|sentenced [^.]{0,60}?\b(?:[5-9]|[1-9]\d|five|six|seven|eight|nine|ten|twenty) years", re.I)
PEOPLE_TACTICS = {"detention_and_violence", "expulsion_and_visa_denial"}

# slug: (stage, why). Read against summary and what_happened, 2026-09-22.
REVIEWED = {
    # access_ban rows that went beyond access
    "2020-federal-officers-target-journalists-portland-injunction": ("punish", "federal officers used tear gas, pepper spray and rubber bullets on journalists; assault by government actors"),
    "2021-rcmp-restricts-press-fairy-creek-court-order": ("restrict", "the court case concerns exclusion zones; arrests are secondary"),
    "1991-gulf-war-us-military-press-pools": ("restrict", "escorted pools and review of dispatches; detentions were of reporters who left the pools"),
    "2003-us-pentagon-embedding-rules-iraq": ("restrict", "ground rules for embedded reporters; access terms, not removal"),
    "2026-israel-maintains-ban-on-foreign-press-access-to-gaza": ("restrict", "entry to Gaza refused except on escorted trips; access ban"),
    # credential regimes that removed people from the profession
    "1933-germany-editors-law": ("silence", "state register of editors, exclusion of non-Aryans from the profession and directions to omit content: structural control of the whole press"),
    "1938-spain-franco-press-law": ("silence", "government permission to found papers or work as a journalist, with pre-publication control"),
    "2025-pentagon-issues-new-press-credentialing-rules": ("restrict", "conditions attached to press credentials at one building"),
    # detention_and_violence: sentence length and killing decide
    "1976-argentina-junta-press-decrees": ("eliminate", "hundreds of journalists detained, killed or forced into exile"),
    "1995-nigeria-abacha-journalists-tribunal": ("eliminate", "military tribunal, lengthy prison terms, no appeal"),
    "2006-russia-politkovskaya-killed": ("eliminate", "journalist shot dead; former police officers convicted; who ordered it not established in court"),
    "2018-saudi-arabia-khashoggi-killed-consulate": ("eliminate", "journalist killed by Saudi agents inside a consulate"),
    "2013-egypt-al-jazeera-journalists-jailed": ("punish", "arrest and prosecution; three-year sentences, pardoned in 2015"),
    "2023-guatemala-convicts-zamora-money-laundering": ("eliminate", "six-year prison sentence for a newspaper founder"),
    "2025-hong-kong-convicts-jimmy-lai-under-national-security-law": ("eliminate", "20-year prison sentence for a newspaper founder"),
    "2024-venezuela-post-election-press-crackdown": ("punish", "detentions and expulsions of correspondents; blocking of X is secondary"),
    "2025-bangladesh-journalists-attacked-interim-government": ("punish", "physical attacks on journalists as the record states them"),
    # expulsion: exile and statelessness are eliminate
    "1981-haiti-duvalier-radio-haiti-inter-exile": ("eliminate", "staff arrested and deported; the director forced into exile"),
    "2023-nicaragua-strips-journalists-citizenship": ("eliminate", "exiled journalists stripped of citizenship"),
    # funding and ownership: takeovers and closures are silence
    "1960-egypt-nasser-nationalizes-press": ("silence", "nationalisation of every newspaper and magazine"),
    "2001-russia-gazprom-takeover-ntv": ("silence", "forced change of ownership of the last major independent network"),
    "2024-argentina-milei-closes-telam": ("silence", "closure of the state news agency"),
    "2025-usagm-moves-to-shut-down-voice-of-america": ("silence", "moves to shut down a public broadcaster"),
    "2015-poland-public-media-law-firings": ("pressure", "government appointment of public broadcaster heads; dismissals followed"),
    "2010-hungary-media-law-content-authority": ("pressure", "government-appointed regulator with power to fine"),
    "2013-ecuador-communications-law-supercom": ("pressure", "regulator issuing sanctions"),
    # outlet_licensing: licence requirements and restructuring are pressure
    "2002-zimbabwe-aippa-media-licensing": ("pressure", "licence requirement for journalists and media; no withdrawal in this entry"),
    "2018-tanzania-online-content-regulations": ("pressure", "registration and fee requirement for online publishers"),
    "2024-slovakia-dissolves-rtvs-creates-stvr": ("pressure", "public broadcaster restructured under more direct political control"),
    "1988-uk-broadcasting-ban-sinn-fein": ("silence", "broadcast ban on the voices of named groups; prior restraint"),
    # criminal speech laws and labels
    "1998-serbia-public-information-act-fines": ("punish", "court fines against newspapers under the act"),
    "2025-pakistan-amends-peca-cybercrime-law": ("punish", "prison terms of up to three years for information deemed false"),
    "2023-zimbabwe-patriotic-act-criminalizes-foreign-contact": ("punish", "criminal law with prison terms"),
    "2026-russia-new-law-targets-exiled-journalists-assets": ("pressure", "freezing of assets and denial of consular services to people in exile"),
    # prior_restraint that was not compulsory, or not aimed at the press
    "1941-us-office-of-censorship-wartime-press-code": ("pressure", "voluntary code asking the press to withhold information"),
    "2020-hhs-officials-alter-cdc-covid-guidance-before-publication": ("restrict", "officials altered the government's own publications; no action against an outlet"),
    # surveillance_and_subpoenas: lists, raids for tax, and policy changes
    "1971-us-nixon-enemies-list": ("pressure", "list for possible action through federal agencies; no action against a journalist in this entry"),
    "1971-nixon-white-house-compiles-enemies-list": ("pressure", "list for possible action through federal agencies, such as tax audits"),
    "1998-malaysia-anwar-arrest-press-restrictions": ("pressure", "pressure on staff, police visits and monitoring"),
    "2023-india-tax-authorities-raid-bbc-offices": ("pressure", "tax searches of offices"),
    "2025-doj-rescinds-media-subpoena-guidelines": ("pressure", "policy change that allows subpoenas; no subpoena to a reporter in this entry"),
    "2021-doj-bans-seizing-reporters-records-garland": ("punish", "the underlying act is the secret seizure of reporters' records"),
    # secrets laws against sources (eliminate is for journalists)
    "2010-us-chelsea-manning-espionage-act-wikileaks": ("punish", "prosecution of a source"),
    "2018-myanmar-reuters-journalists-official-secrets-act": ("eliminate", "seven-year prison sentences for two reporters; 511 days served"),
    "1917-us-espionage-act-bars-the-masses-from-the-mail": ("silence", "magazine barred from the mail"),
}

LADDER_NOTES = {
    "2006-russia-politkovskaya-killed": "Who ordered the killing was never conclusively established in court.",
    # None clears a note set by an earlier run (the Khashoggi summary already says it).
    "2018-saudi-arabia-khashoggi-killed-consulate": None,
    "2018-myanmar-reuters-journalists-official-secrets-act": "Both reporters were pardoned in May 2019 after 511 days in prison.",
}


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN, "User-Agent": "twon-ops/1.0", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def plain(s):
    return re.sub(r"\{c:\d+\}", "", s or "")


def rule_stage(rec):
    t = rec.get("tactic_primary")
    stage = TACTIC_STAGE.get(t, "pressure")
    if t in PEOPLE_TACTICS and ELIMINATE_TEXT.search(plain(rec.get("summary")) + " " + plain(rec.get("what_happened"))):
        stage = "eliminate"
    return stage


def published_slugs():
    out, page = [], 1
    while True:
        req = urllib.request.Request(f"{BASE}/incidents.json?per_page=100&page={page}", headers={"User-Agent": "twon-ops/1.0"})
        d = json.load(urllib.request.urlopen(req, timeout=60))
        out += [r["slug"] for r in d["results"]]
        if page >= d["pages"]:
            return out
        page += 1


def main():
    apply = "--apply" in sys.argv
    report, dist = [], {}
    for slug in published_slugs():
        st, rec = call("GET", f"/admin/records/incident/{slug}")
        if st != 200:
            report.append({"slug": slug, "error": st})
            continue
        ruled = rule_stage(rec)
        stage, why = REVIEWED.get(slug, (ruled, f"rule: tactic {rec.get('tactic_primary')}"))
        dist[stage] = dist.get(stage, 0) + 1
        row = {"slug": slug, "tactic": rec.get("tactic_primary"), "rule": ruled, "stage": stage, "reviewed": slug in REVIEWED, "why": why}
        if apply:
            body = {"stage": stage, "reason": REASON, "batch_label": BATCH}
            if slug in LADDER_NOTES:
                body["ladder_note"] = LADDER_NOTES[slug] or ""
            st, r = call("POST", f"/admin/incidents/{slug}/ladder", body)
            row["write"] = "unchanged" if st == 200 and r.get("unchanged") else st
            if st != 200:
                row["error"] = r
            time.sleep(float(os.environ.get("TWON_SLEEP", "0.6")))  # admin API allows 120 requests a minute per token
        report.append(row)
    missing = [s for s in REVIEWED if s not in {r["slug"] for r in report}]
    print(json.dumps({"distribution": dist, "reviewed": sum(1 for r in report if r.get("reviewed")),
                      "reviewed_changed_from_rule": sum(1 for r in report if r.get("reviewed") and r["rule"] != r["stage"]),
                      "reviewed_slugs_not_found": missing, "rows": report}, indent=1))


if __name__ == "__main__":
    sys.exit(main())
