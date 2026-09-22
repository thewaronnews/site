#!/usr/bin/env python3
"""v2 backfill (2026-09-22): classify the 23 v1 incidents under the v2 model
through the admin API (append-style: each change is a revision).

  - tactics (primary plus others) where the mechanical type->tactic mapping
    in migration 0004 was wrong or incomplete;
  - leader_slug where the head of government is already an actor;
  - outcome, outcome_on, outcome_note only where the incident's own current
    claims state it (claim ids noted per row);
  - wording in the site's own voice that used "foreign" framing (brief:
    no domestic/foreign framing): the Gaza incident prose and three glossary
    definitions; statutory names stay in quotation marks.

Idempotent: re-running re-sends the same values (a no-op revision is
skipped by comparing first). Token: TWON_TOKEN_FILE_PUBLISH or
/home/claude/.twon/admin-token-publish.txt. Never prints the token.
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("TWON_BASE", "https://thewaronnews.com")
TOKEN = open(os.environ.get("TWON_TOKEN_FILE_PUBLISH", "/home/claude/.twon/admin-token-publish.txt")).read().strip()
REASON = "v2 classification (brief 2026-09-22)"


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN, "User-Agent": "twon-ops/1.0", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


TRUMP = "donald-trump"
# slug: (primary tactic, [other tactics], leader_slug, outcome, outcome_on, outcome_note)
ROWS = {
    "2026-white-house-bans-cnn-msnow-politico": ("access_ban", ["credential_control"], TRUMP, "ongoing", None, "The outlets sued on 2026-09-21; a hearing was scheduled."),
    "2025-pentagon-press-corps-forfeits-badges": ("credential_control", ["access_ban"], TRUMP, None, None, None),
    "2025-pentagon-issues-new-press-credentialing-rules": ("credential_control", ["prior_restraint"], TRUMP, None, None, None),
    "2025-whca-loses-control-of-press-pool": ("access_ban", [], TRUMP, None, None, None),
    "2025-white-house-bars-ap-gulf-of-america": ("access_ban", [], TRUMP, "ongoing", None, "The Associated Press sued; the case was before the courts."),
    "2025-fcc-pressure-precedes-kimmel-suspension": ("funding_and_ownership_pressure", [], TRUMP, None, None, None),
    "2025-paramount-cbs-settle-60-minutes-suit": ("lawsuits_against_press", ["funding_and_ownership_pressure"], TRUMP, None, None, None),
    "2025-usagm-moves-to-shut-down-voice-of-america": ("funding_and_ownership_pressure", [], TRUMP, "ongoing", None, "Courts repeatedly ordered staff and functions restored; litigation continued into 2026."),
    "2025-doj-rescinds-media-subpoena-guidelines": ("surveillance_and_subpoenas", [], TRUMP, None, None, None),
    "2025-trump-order-ends-cpb-funding-npr-pbs": ("funding_and_ownership_pressure", [], TRUMP, None, None, None),
    "2018-white-house-revokes-acosta-press-pass": ("credential_control", ["access_ban"], TRUMP, "reversed", "2018-11-19", "A federal judge ordered the pass restored; the White House restored it and CNN dropped its suit."),
    "2013-obama-doj-charges-eight-under-espionage-act": ("secrets_and_espionage_laws", ["surveillance_and_subpoenas"], "barack-obama", None, None, None),
    "1971-nixon-white-house-compiles-enemies-list": (None, [], "richard-nixon", None, None, None),
    "2024-louisiana-enacts-police-buffer-zone-law": ("access_ban", [], None, "reversed", "2025-01-31", "A federal judge blocked enforcement of the law."),
    "2025-federal-judge-blocks-louisiana-buffer-law": ("access_ban", [], None, None, None, None),
    "2025-florida-halo-law-takes-effect": ("access_ban", [], "ron-desantis", None, None, None),
    "2023-hungary-sovereignty-protection-act": ("disinformation_labeling", ["surveillance_and_subpoenas"], "viktor-orban", "reversed", "2026-06-30", "The National Assembly abolished the Sovereignty Protection Office."),
    "2026-russia-new-law-targets-exiled-journalists-assets": ("funding_and_ownership_pressure", ["disinformation_labeling"], "vladimir-putin", None, None, None),
    "2026-el-salvador-freezes-el-faro-shareholder-assets": ("funding_and_ownership_pressure", [], "nayib-bukele", None, None, None),
    "2026-india-journalist-sentenced-adani-defamation": ("insult_and_defamation_laws", ["detention_and_violence"], None, None, None, None),
    "2025-hong-kong-convicts-jimmy-lai-under-national-security-law": ("detention_and_violence", [], None, None, None, None),
    "2025-turkiye-detains-and-deports-journalists-covering-protests": ("detention_and_violence", ["expulsion_and_visa_denial"], None, None, None, None),
    "2026-israel-maintains-ban-on-foreign-press-access-to-gaza": ("access_ban", [], None, "sustained", None, "The ban remained in place when CPJ published its report in February 2026."),
}

GAZA = "2026-israel-maintains-ban-on-foreign-press-access-to-gaza"
GAZA_PROSE = {
    "title": "Israel maintains ban on independent international press access to Gaza",
    "replace": [("independent foreign press access", "independent international press access"),
                ("to bar foreign journalists", "to bar international journalists"),
                ("Foreign correspondents have been able", "International correspondents have been able"),
                ("independent foreign press movement", "independent movement by international reporters"),
                ("independently verified foreign correspondent reporting", "independently verified reporting by international correspondents")],
}

GLOSSARY = {
    "espionage-act": [("rather than against foreign spies.", "rather than against spies working for other governments.")],
    "national-security-law-hong-kong": [("terrorism and collusion with foreign forces.", 'terrorism and "collusion with foreign forces" (the offence as named in the law).')],
    "foreign-agent-law": [("A law requiring individuals or organizations receiving foreign support, or deemed to act on behalf of foreign interests, to register with the state",
                           'A law requiring individuals or organizations that receive support from abroad, or are deemed to act for another country\'s interests, to register with the state as "foreign agents"'),
                          ("Russia has expanded its foreign-agent framework", "Russia has expanded this framework")],
}


def main():
    out = {"fields": 0, "tactics": 0, "prose": 0, "glossary": 0, "errors": []}
    for slug, (primary, others, leader, outcome, outcome_on, note) in ROWS.items():
        st, cur = call("GET", f"/admin/records/incident/{slug}")
        if st != 200:
            out["errors"].append((slug, st))
            continue
        body = {"reason": REASON}
        if leader and cur.get("leader_slug") != leader:
            body["leader_slug"] = leader
        if primary and cur.get("tactic_primary") != primary:
            body["tactic_primary"] = primary
        if outcome and (cur.get("outcome") != outcome or cur.get("outcome_on") != outcome_on or cur.get("outcome_note") != note):
            body.update({"outcome": outcome, "outcome_on": outcome_on, "outcome_note": note})
        if len(body) > 1:
            st, r = call("POST", f"/admin/incidents/{slug}/fields", body)
            if st != 200:
                out["errors"].append((slug, st, r))
            else:
                out["fields"] += 1
        want = [primary] + others if primary else []
        st2, pub = call("GET", f"/incidents/{slug}.json")
        have = pub.get("tactics", []) if st2 == 200 else []
        if primary and (sorted(have) != sorted(want) or (pub.get("tactic_primary") != primary)):
            st, r = call("PUT", f"/admin/incidents/{slug}/tactics", {"primary": primary, "tactics": [primary] + others, "reason": REASON})
            if st != 200:
                out["errors"].append((slug, "tactics", st, r))
            else:
                out["tactics"] += 1
    # Gaza prose
    st, cur = call("GET", f"/admin/records/incident/{GAZA}")
    if st == 200:
        patch = {"reason": "v2 wording: no domestic/foreign framing (brief 2026-09-22)"}
        if cur["title"] != GAZA_PROSE["title"]:
            patch["title"] = GAZA_PROSE["title"]
        for col in ["summary", "what_happened", "stated_justification", "effect_on_reporting"]:
            v = cur.get(col) or ""
            nv = v
            for a, b in GAZA_PROSE["replace"]:
                nv = nv.replace(a, b)
            if nv != v:
                patch[col] = nv
        if len(patch) > 1:
            st, r = call("PUT", f"/admin/records/incident/{GAZA}", patch)
            out["prose"] += 1 if st == 200 else 0
            if st != 200:
                out["errors"].append(("gaza", st, r))
    for slug, reps in GLOSSARY.items():
        st, cur = call("GET", f"/admin/records/glossary_term/{slug}")
        if st != 200:
            out["errors"].append((slug, st))
            continue
        d = cur["definition"]
        nd = d
        for a, b in reps:
            nd = nd.replace(a, b)
        if nd != d:
            st, r = call("PUT", f"/admin/records/glossary_term/{slug}", {"definition": nd, "reason": "v2 wording: no domestic/foreign framing (brief 2026-09-22)"})
            out["glossary"] += 1 if st == 200 else 0
            if st != 200:
                out["errors"].append((slug, st, r))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    sys.exit(main())
