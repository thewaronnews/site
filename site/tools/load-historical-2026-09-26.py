#!/usr/bin/env python3
"""Load verified historical anchor incidents (research pass 2026-09-26) through
the admin API. Input: JSON files shaped like content-sources/research-v2
anchors files, already filtered to claims whose evidence_quote was verified
verbatim against the fetched source page. Idempotent: a state file records
claim ids per incident so re-runs do not duplicate claims.

Usage: python3 load-historical-2026-09-26.py STATE.json FILE.json [FILE.json ...]
Env: TWON_BASE (default https://thewaronnews.com), TWON_TOKEN_FILE_PUBLISH.
"""
import json, os, sys, urllib.request, urllib.error

BASE = os.environ.get("TWON_BASE", "https://thewaronnews.com")
TOK = open(os.environ["TWON_TOKEN_FILE_PUBLISH"]).read().strip()
BL = "historical-2026-09-26"
TODAY = "2026-09-26"
ROLE_MAP = {"adjudicated": "ruled", "ruled": "ruled", "ordered": "ordered", "announced": "announced", "implemented": "implemented",
            "enforced": "enforced", "defended": "defended", "legislated": "legislated"}
KIND_MAP = {"reporting": "reporting", "primary_document": "primary_document", "court_record": "court_record",
            "official_statement": "official_statement", "dataset": "dataset", "reference": "reference", "org_report": "reference"}
OUTLET_KINDS = ["newspaper", "broadcaster", "cable_news", "wire_service", "digital", "magazine", "public_media", "press_association", "other"]


import re as _re
US_STATES = {"alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY"}
JUR_RE = _re.compile(r"^([A-Z]{2}(-[A-Z0-9]{1,3})?)(:[a-z0-9-]+)?$")


def jurisdiction(inc):
    j = inc.get("jurisdiction") or ""
    if JUR_RE.match(j):
        return j
    c = inc.get("country") or "US"
    if c == "US" and inc.get("level") in ("state_or_province", "municipal"):
        text = (j + " " + inc.get("title", "")).lower()
        for name in sorted(US_STATES, key=len, reverse=True):
            if name in text and not (name == "washington" and "washington, d.c" in text):
                return "US-" + US_STATES[name]
    return c


def call(m, p, body=None, ok404=False):
    d = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + p, data=d, method=m, headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json", "User-Agent": "twon-ops"})
    try:
        x = json.load(urllib.request.urlopen(r, timeout=60))
        return x.get("result", x) if isinstance(x, dict) else x
    except urllib.error.HTTPError as e:
        if ok404 and e.code == 404:
            return None
        raise RuntimeError(f"{m} {p} -> {e.code} {e.read()[:1200].decode()}")


def pub_json(name):
    x = json.load(urllib.request.urlopen(urllib.request.Request(f"{BASE}/data/json/{name}.json", headers={"User-Agent": "twon-ops"}), timeout=60))
    return x.get("rows", x) if isinstance(x, dict) else x


def refs(ids):
    return "".join("{c:%d}" % i for i in ids)


def main():
    state_path, files = sys.argv[1], sys.argv[2:]
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    actors = {a["slug"] for a in pub_json("actors")}
    outlets = {o["slug"] for o in pub_json("outlets")}
    report = []
    for f in files:
        d = json.load(open(f))
        srcdef = {s["id"]: s for s in d.get("sources", [])}
        new_actors = {a["slug"]: a for a in d.get("actors", [])}
        new_outlets = {o["slug"]: o for o in d.get("outlets", [])}
        for inc in d["incidents"]:
            slug = inc["slug"]
            st = state.setdefault(slug, {})
            try:
                # sources
                sid = {}
                for k in inc["sources"]:
                    s = srcdef[k]
                    r = call("POST", "/admin/sources", {"url": s["url"], "title": s["title"], "publisher": s.get("publisher") or s["title"],
                                                         "source_kind": KIND_MAP.get(s.get("kind"), "reference"), "published_on": s.get("published_on") or None, "batch_label": BL})
                    sid[k] = r["id"]
                # actors / outlets (create + publish when new)
                for a in inc.get("actors", []) + ([inc["leader_slug"]] if inc.get("leader_slug") else []):
                    if a in actors or a not in new_actors:
                        continue
                    na = new_actors[a]
                    body_type = None
                    if na.get("kind") == "body":
                        nm = (na["name"] + " " + (na.get("role_or_office") or "")).lower()
                        body_type = ("court" if "court" in nm else "legislature" if any(w in nm for w in ("parliament", "congress", "reichstag", "senate", "assembly", "legislature", "diet", "committee", "subcommittee"))
                                     else "law_enforcement" if any(w in nm for w in ("police", "sheriff", "kgb", "gestapo", "security")) else "executive_office" if ("government" in nm or "cabinet" in nm) else "agency")
                    call("PUT", f"/admin/records/actor/{a}", {"name": na["name"], "kind": na.get("kind", "person"), "role": na.get("role_or_office") or "Official",
                                                              "jurisdiction": na.get("jurisdiction") if JUR_RE.match(na.get("jurisdiction") or "") else (na.get("country") or "US"), "country": na.get("country"), "body_type": body_type,
                                                              "reason": "historical research 2026-09-26", "batch_label": BL})
                    call("POST", f"/admin/records/actor/{a}/publish", {"reviewed_on": TODAY})
                    actors.add(a)
                for o in inc.get("outlets", []):
                    if o in outlets or o not in new_outlets:
                        continue
                    no = new_outlets[o]
                    call("PUT", f"/admin/records/outlet/{o}", {"name": no["name"], "kind": no.get("kind") if no.get("kind") in OUTLET_KINDS else "other", "country": no.get("country"),
                                                               "reason": "historical research 2026-09-26", "batch_label": BL})
                    call("POST", f"/admin/records/outlet/{o}/publish", {"reviewed_on": TODAY})
                    outlets.add(o)
                leader = inc.get("leader_slug") if inc.get("leader_slug") in actors else None
                row = {k: inc.get(k) for k in ["title", "occurred_on", "occurred_on_precision", "ended_on", "jurisdiction", "country", "level", "tactic_primary",
                                               "issue_of_the_day", "outcome", "outcome_on", "outcome_note", "stage", "unknowns"]}
                row["jurisdiction"] = jurisdiction(inc)
                row.update({"leader_slug": leader, "granularity": "anchor", "status": "historical", "status_updated_on": TODAY,
                            "summary": inc["summary"], "what_happened": inc["what_happened"], "stated_justification": inc.get("stated_justification"),
                            "effect_on_reporting": inc.get("effect_on_reporting"), "next_review_on": "2027-03-26",
                            "reason": "historical research 2026-09-26", "is_correction": False, "batch_label": BL})
                for dk in ("occurred_on", "outcome_on"):
                    v = row.get(dk)
                    if v and len(v) == 4: row[dk] = v + "-01-01"
                    elif v and len(v) == 7: row[dk] = v + "-01"
                row = {k: v for k, v in row.items() if v is not None}
                if "claims" not in st:
                    call("PUT", f"/admin/records/incident/{slug}", row)
                # claims
                if "claims" not in st:
                    ids = []
                    for c in inc["claims"]:
                        s = srcdef[c["source_id"]]
                        kind = KIND_MAP.get(s.get("kind"), "reference")
                        method = {"court_record": "court_record", "primary_document": "primary_document", "official_statement": "official_statement"}.get(kind, "outlet_report")
                        r = call("POST", "/admin/claims", {"subject_type": "incident", "subject_slug": slug, "field": c["field"], "value": c["value"][:120],
                                                           "statement": c["statement"], "source_id": sid[c["source_id"]], "evidence_quote": c["evidence_quote"],
                                                           "evidence_date": s.get("published_on") or None, "method": method, "verified_at": TODAY,
                                                           "confidence": "high" if method in ("court_record", "primary_document") else "medium", "batch_label": BL})
                        ids.append({"id": r["id"], "field": c["field"]})
                    st["claims"] = ids
                    json.dump(state, open(state_path, "w"), indent=1)
                ids = st["claims"]
                allr = refs([c["id"] for c in ids])
                by = lambda *fs: refs([c["id"] for c in ids if c["field"] in fs]) or allr
                paras = inc["what_happened"].split("\n\n")
                patch = {"summary": inc["summary"] + by("action", "occurred_on", "announced_by", "scope_of_action"),
                         "what_happened": "\n\n".join(paras[:-1] + [paras[-1] + allr]),
                         "reason": "attach claim references", "batch_label": BL}
                patch = {**row, **patch}
                if inc.get("stated_justification"): patch["stated_justification"] = inc["stated_justification"] + by("stated_justification")
                if inc.get("effect_on_reporting"): patch["effect_on_reporting"] = inc["effect_on_reporting"] + by("effect_on_reporting", "outlet_affected", "journalist_affected")
                call("PUT", f"/admin/records/incident/{slug}", patch)
                tactics = [t for t in (inc.get("tactics") or [inc["tactic_primary"]])]
                if inc["tactic_primary"] not in tactics: tactics.insert(0, inc["tactic_primary"])
                call("PUT", f"/admin/incidents/{slug}/tactics", {"primary": inc["tactic_primary"], "tactics": tactics, "reason": "historical research 2026-09-26"})
                links = {"sources": [{"source_id": sid[k], "role": "primary" if KIND_MAP.get(srcdef[k].get("kind")) in ("court_record", "primary_document") else "reporting", "sort": i} for i, k in enumerate(inc["sources"])],
                         # Only people and bodies that acted; affected people (role "other") stay out of "Who acted".
                         "actors": [{"slug": a, "role": ROLE_MAP[(inc.get("actor_roles") or {}).get(a)]} for a in inc.get("actors", [])
                                    if a in actors and (inc.get("actor_roles") or {}).get(a) in ROLE_MAP],
                         "outlets": [{"slug": o, "relation": "affected"} for o in inc.get("outlets", []) if o in outlets],
                         "reason": "historical research 2026-09-26"}
                call("PUT", f"/admin/incidents/{slug}/links", links)
                call("POST", f"/admin/records/incident/{slug}/publish", {"reviewed_on": TODAY, "next_review_on": "2027-03-26"})
                st["published"] = True
                report.append((slug, "published", len(ids)))
            except Exception as e:  # noqa: BLE001
                st["error"] = str(e)[:600]
                report.append((slug, "ERROR", str(e)[:400]))
            json.dump(state, open(state_path, "w"), indent=1)
    for r in report:
        print(*r)


if __name__ == "__main__":
    main()
