#!/usr/bin/env python3
"""Load the P1 seed (crank3/seed/*.json) through the live admin API.

Everything goes through the admin endpoints of spec section 8, so validation,
revisions, the change ledger and the voice lint all apply. Nothing is written
to D1 directly. Claims are created only where the seed carries a verbatim
evidence quote (the schema requires one); nothing is superseded.

Order: sources (+ seed link check) -> outlets -> actors -> journalists ->
cases (draft) -> incidents (draft, links, claims, prose with {c:ID}
references, publish) -> case links, prose, publish -> glossary.

A record whose prose fails the voice lint, or that has no quoted claim to
publish on, stays unpublished (or is not stored) and is listed in the report.

Usage:
  load-seed.py --base https://thewaronnews.com --token-file ~/.twon/admin-token-publish.txt \
               --seed /home/claude/crank3/seed [--report out.json]
Re-runnable: sources upsert by URL, records upsert by slug, claims are
skipped when one with the same field, source and quote already exists.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

UA = "twon-seed/1.0"
BATCH = "seed-2026-09-22"
REASON = "Seed load from the P1 research pass (seed/*.json, 2026-09-22)"
REVIEWED_ON = "2026-09-22"
NEXT_REVIEW = "2026-12-22"
STATUS_AS_OF = "2026-09-22"

SOURCE_KIND = {
    "outlet_report": "reporting", "org_report": "reference", "official_statement": "official_statement",
    "court_record": "court_record", "primary_document": "primary_document", "other": "reference",
}
CLAIM_METHOD = {
    "outlet_report": "outlet_report", "org_report": "outlet_report", "official_statement": "official_statement",
    "court_record": "court_record", "primary_document": "primary_document", "other": "outlet_report",
}
OUTLET_KIND = {"wire": "wire_service"}
ACTOR_KIND = {
    "person": ("person", None), "court": ("body", "court"), "agency": ("body", "agency"),
    "legislature": ("body", "legislature"), "office": ("body", "executive_office"), "other": ("body", "other"),
}
JURISDICTION = {
    "United States, federal": "US", "Louisiana, United States": "US-LA", "Florida, United States": "US-FL",
}
# Incident status enum per seed slug, from each seed status line.
INCIDENT_STATUS = {
    "white-house-bans-cnn-msnow-politico": "in_litigation",
    "white-house-bars-ap-gulf-of-america": "in_litigation",
    "pentagon-issues-new-press-credentialing-rules": "in_effect",
    "pentagon-press-corps-forfeits-badges": "in_effect",
    "whca-loses-control-of-press-pool": "in_effect",
    "fcc-pressure-precedes-kimmel-suspension": "reversed",
    "paramount-cbs-settle-60-minutes-suit": "resolved",
    "trump-order-ends-cpb-funding-npr-pbs": "in_effect",
    "usagm-moves-to-shut-down-voice-of-america": "in_litigation",
    "doj-rescinds-media-subpoena-guidelines": "in_effect",
    "white-house-revokes-acosta-press-pass": "reversed",
    "louisiana-enacts-police-buffer-zone-law": "enjoined",
    "federal-judge-blocks-louisiana-buffer-law": "enjoined",
    "florida-halo-law-takes-effect": "in_effect",
    "nixon-white-house-compiles-enemies-list": "historical",
    "obama-doj-charges-eight-under-espionage-act": "historical",
    "hungary-sovereignty-protection-act": "reversed",
    "india-journalist-sentenced-adani-defamation": "in_effect",
    "israel-maintains-ban-on-foreign-press-access-to-gaza": "in_effect",
    "russia-new-law-targets-exiled-journalists-assets": "in_effect",
    "el-salvador-freezes-el-faro-shareholder-assets": "in_effect",
    "hong-kong-convicts-jimmy-lai-under-national-security-law": "in_effect",
    "turkiye-crackdown-on-journalists-covering-protests": "in_effect",
}
CASE_STATUS = {
    "sherrill-v-knight-1977": "decided",
    "cnn-v-trump-2018": "dismissed",
    "ap-v-budowich-2025": "on_appeal",
    "cnn-msnow-politico-v-trump-2026": "pending",
}


class Api:
    def __init__(self, base, token):
        self.base = base.rstrip("/")
        self.token = token
        self.calls = 0

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "Authorization": "Bearer " + self.token, "Content-Type": "application/json", "User-Agent": UA,
            "Accept": "application/json",
        })
        for attempt in range(6):
            self.calls += 1
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return r.status, json.loads(r.read().decode() or "{}")
            except urllib.error.HTTPError as e:
                payload = e.read().decode()
                if e.code == 429 and attempt < 5:
                    time.sleep(20)
                    continue
                try:
                    return e.code, json.loads(payload)
                except ValueError:
                    return e.code, {"raw": payload[:500]}
            except urllib.error.URLError as e:
                if attempt < 5:
                    time.sleep(3)
                    continue
                return 0, {"error": str(e)}
        return 0, {"error": "retries exhausted"}


def jurisdiction(j, country):
    if j in JURISDICTION:
        return JURISDICTION[j]
    return country


def paragraphs(text):
    return [p.strip() for p in re.split(r"\n\s*\n", text or "") if p.strip()]


def with_refs(text, ids):
    """Append {c:ID} references to every paragraph of text."""
    if not text or not ids:
        return text
    refs = "".join("{c:%d}" % i for i in ids)
    return "\n\n".join(p + refs for p in paragraphs(text))


def case_relation(case_date, incident_date):
    """A case filed on or after the incident arises from it; an earlier one is precedent."""
    return "arising_from" if case_date and case_date >= (incident_date or "")[:10] else "precedent_cited"


def undash(text):
    """The one mechanical voice fix applied to seed prose: a pair of double
    hyphens used as dashes outside quotations becomes a pair of commas (the
    lint rules' own prescribed replacement). Everything else is left for
    the editor; a record that still fails the lint is reported, not changed."""
    if not text:
        return text
    parts = re.split(r'("[^"]*")', text)
    for i in range(0, len(parts), 2):
        parts[i] = re.sub(r" -- ([^\n]*?) -- ", r", \1, ", parts[i])
    return "".join(parts)


def first_sentence(text):
    m = re.match(r"(.+?\.)(\s|$)", text or "")
    return m.group(1) if m else text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--token-file", required=True)
    ap.add_argument("--seed", default="/home/claude/crank3/seed")
    ap.add_argument("--report", default=None)
    args = ap.parse_args()
    token = open(os.path.expanduser(args.token_file)).read().strip()
    api = Api(args.base, token)
    load = lambda n: json.load(open(os.path.join(args.seed, n + ".json")))
    sources, outlets, actors = load("sources"), load("outlets"), load("actors")
    journalists, cases, incidents, glossary = load("journalists"), load("cases"), load("incidents"), load("glossary")
    report = {"sources": {"ok": 0, "failed": []}, "outlets": {"published": [], "failed": []}, "actors": {"published": [], "failed": []},
              "journalists": {"published": [], "failed": []}, "cases": {"published": [], "draft": [], "failed": []},
              "incidents": {"published": [], "draft": [], "failed": []}, "claims": {"created": 0, "existing": 0, "superseded": 0, "skipped_no_quote": 0, "failed": []},
              "glossary": {"published": [], "failed": []}, "events": {"created": 0, "failed": []}, "slug_map": {}}

    def fail(section, key, status, body):
        report[section]["failed"].append({"slug": key, "status": status, "detail": body.get("details") or body})
        print(f"  FAIL {section} {key}: {status} {json.dumps(body.get('details') or body)[:400]}", file=sys.stderr)

    # ---- sources ----
    sid = {}
    src_by_seed = {s["id"]: s for s in sources}
    checks = []
    for s in sources:
        st, b = api.call("POST", "/admin/sources", {
            "url": s["url"], "title": s["title"], "publisher": s["publisher"],
            "source_kind": SOURCE_KIND.get(s["kind"], "reference"), "published_on": s.get("published_on"), "batch_label": BATCH,
        })
        if st == 200:
            sid[s["id"]] = b["id"]
            report["sources"]["ok"] += 1
            checks.append({"source_id": b["id"], "checked_at": f"{s.get('accessed_on', '2026-09-22')}T12:00:00Z",
                           "checker": "seed-linkcheck-2026-09-22", "http_status": s.get("http_status"),
                           "observed_state": s.get("link_state", "live"), "detail": "seed pass: curl -sIL, desktop Chrome UA"})
        else:
            report["sources"]["failed"].append({"id": s["id"], "status": st, "detail": b})
    for i in range(0, len(checks), 100):
        api.call("POST", "/admin/sources/checks", {"checks": checks[i:i + 100]})
    print(f"sources: {report['sources']['ok']} loaded", file=sys.stderr)

    def put_and_publish(section, rtype, slug, row):
        st, b = api.call("PUT", f"/admin/records/{rtype}/{slug}", {**row, "reason": REASON, "batch_label": BATCH})
        if st != 200:
            fail(section, slug, st, b)
            return False
        st, b = api.call("POST", f"/admin/records/{rtype}/{slug}/publish", {"reviewed_on": REVIEWED_ON, "next_review_on": NEXT_REVIEW, "batch_label": BATCH})
        if st != 200:
            fail(section, slug, st, b)
            return False
        report[section]["published"].append(slug)
        return True

    # ---- outlets / actors / journalists ----
    for o in outlets:
        put_and_publish("outlets", "outlet", o["slug"], {"name": o["name"], "kind": OUTLET_KIND.get(o["kind"], o["kind"]),
                                                        "country": o.get("country", "US"), "homepage_url": o.get("homepage_url")})
    actor_kind = {}
    for a in actors:
        kind, body_type = ACTOR_KIND.get(a["kind"], ("body", "other"))
        actor_kind[a["slug"]] = (a["kind"], body_type)
        put_and_publish("actors", "actor", a["slug"], {"name": a["name"], "kind": kind, "body_type": body_type,
                                                      "role": a["role_or_office"], "jurisdiction": jurisdiction(a["jurisdiction"], a.get("country", "US")),
                                                      "country": a.get("country", "US")})
    for j in journalists:
        put_and_publish("journalists", "journalist", j["slug"], {"name": j["name"], "outlet_slug": j.get("outlet"), "role": j["role"]})

    # ---- cases (draft first; incidents link to them) ----
    case_rows = {}
    case_claim_ids = {}
    for c in cases:
        court = c["court"]
        level = "appellate" if "Appeals" in court and "District" not in court else "trial"
        docket = c.get("docket")
        reporter = None
        decided = c.get("decided_on")
        if docket and re.search(r"F\.\s?\d?d|U\.S\.", docket):
            reporter, docket = docket, None
            if decided and decided.endswith("-01-01"):
                decided = None  # year-only value in the seed; the citation carries the year
        status_line = first_sentence(c.get("status", ""))
        holding = c.get("holding") or ""
        if status_line:
            holding = (holding + "\n\n" + status_line).strip()
        short = re.sub(r",? Inc\.", "", c["name"]).replace("Cable News Network", "CNN")
        row = {"caption": c["name"], "short_name": short, "court": court, "court_level": level, "docket": docket,
               "reporter_citation": reporter, "filed_on": c.get("filed_on"), "decided_on": decided,
               "status": CASE_STATUS.get(c["slug"], "pending"), "holding": holding or None}
        case_rows[c["slug"]] = row
        # Fetch existing current claims before the first PUT: once a case carries
        # current claims (e.g. from a prior run), the admin API requires every
        # holding paragraph to keep a {c:ID} reference (same rule as incidents).
        st, existing = api.call("GET", f"/admin/records/case/{c['slug']}")
        have = {(cl["field"], cl["source_id"], cl["evidence_quote"]): cl for cl in (existing.get("claims") or []) if cl["status"] == "current"}
        existing_ids = sorted({cl["id"] for cl in (existing.get("claims") or []) if cl["status"] == "current"})
        first_row = {**row, "holding": with_refs(row["holding"], existing_ids) if existing_ids and row["holding"] else row["holding"]}
        st, b = api.call("PUT", f"/admin/records/case/{c['slug']}", {**first_row, "reason": REASON, "batch_label": BATCH})
        if st != 200:
            fail("cases", c["slug"], st, b)
            case_rows[c["slug"]] = None
            continue
        docs = [{"source_id": sid[x], "role": "opinion" if src_by_seed[x]["kind"] == "court_record" else "reporting"} for x in c.get("sources", []) if x in sid]
        api.call("PUT", f"/admin/cases/{c['slug']}/links", {"sources": docs, "reason": "seed links", "batch_label": BATCH})
        # direct case claims (subject_type "case"), from court records or reporting, per spec 2.4's
        # case claim field allowlist (filed_on, docket, judge, claims_asserted, holding, decided_on, status, appeal).
        ids = []
        for cl in c.get("claims", []):
            q = (cl.get("evidence_quote") or "").strip()
            if not q:
                report["claims"]["skipped_no_quote"] += 1
                continue
            src = src_by_seed.get(cl["source_id"])
            if not src or cl["source_id"] not in sid:
                report["claims"]["failed"].append({"case": c["slug"], "field": cl["field"], "error": "unknown source"})
                continue
            key = (cl["field"], sid[cl["source_id"]], q)
            body = {
                "value": cl.get("value"), "statement": cl["statement"], "source_id": sid[cl["source_id"]], "evidence_quote": q,
                "evidence_date": src.get("published_on"), "method": CLAIM_METHOD.get(src["kind"], "outlet_report"),
                "verified_at": src.get("accessed_on", "2026-09-22"), "confidence": "medium", "batch_label": BATCH,
            }
            if key in have:
                old = have[key]
                if old["statement"] != cl["statement"] or (old.get("value") or None) != (cl.get("value") or None):
                    st, b = api.call("POST", f"/admin/claims/{old['id']}/supersede", {
                        **body, "reason": "correction", "note": "Corrected statement wording (seed repair pass)", "batch_label": BATCH,
                    })
                    if st == 200:
                        ids.append(b["id"])
                        report["claims"]["superseded"] = report["claims"].get("superseded", 0) + 1
                    else:
                        report["claims"]["failed"].append({"case": c["slug"], "field": cl["field"], "status": st, "detail": b.get("details") or b, "note": "supersede failed"})
                        ids.append(old["id"])
                else:
                    ids.append(old["id"])
                report["claims"]["existing"] += 1
                continue
            st, b = api.call("POST", "/admin/claims", {
                "subject_type": "case", "subject_slug": c["slug"], "field": cl["field"], **body,
            })
            if st == 200:
                ids.append(b["id"])
                report["claims"]["created"] += 1
            else:
                report["claims"]["failed"].append({"case": c["slug"], "field": cl["field"], "status": st, "detail": b.get("details") or b})
        case_claim_ids[c["slug"]] = ids
    case_dates = {c["slug"]: (c.get("filed_on") or c.get("decided_on") or "") for c in cases}

    # ---- incidents ----
    inc_claims = {}
    for inc in incidents:
        seed_slug = inc["slug"]
        year = inc["occurred_on"][:4]
        slug = seed_slug if re.match(r"^\d{4}-", seed_slug) else f"{year}-{seed_slug}"
        slug = slug[:80].rstrip("-")
        report["slug_map"][seed_slug] = slug
        status_text = inc.get("status") or ""
        base_row = {
            "title": inc["title"], "occurred_on": inc["occurred_on"], "occurred_on_precision": inc.get("occurred_on_precision", "day"),
            "jurisdiction": jurisdiction(inc["jurisdiction"], inc.get("country", "US")), "country": inc.get("country", "US"),
            "level": inc["level"], "type": inc["type"], "status": INCIDENT_STATUS.get(seed_slug, "in_effect"),
            "status_updated_on": STATUS_AS_OF, "unknowns": inc.get("what_we_dont_know"),
        }
        for k in ("summary", "what_happened", "stated_justification", "effect_on_reporting"):
            inc[k] = undash(inc.get(k))
        status_text = undash(status_text)
        prose = {
            "summary": inc["summary"],
            "what_happened": (inc["what_happened"] + ("\n\n" + status_text if status_text else "")).strip(),
            "stated_justification": inc.get("stated_justification"),
            "effect_on_reporting": inc.get("effect_on_reporting"),
        }
        # Fetch any existing record's current claims BEFORE the first PUT: once a
        # record carries current claims, the admin API requires every prose
        # paragraph to keep a {c:ID} reference, so a re-run's first PUT on an
        # already-published record must not strip refs down to bare prose (a
        # fresh draft has no current claims yet, so this is a no-op for it).
        st, existing = api.call("GET", f"/admin/records/incident/{slug}")
        have = {(c["field"], c["source_id"], c["evidence_quote"]): c for c in (existing.get("claims") or []) if c["status"] == "current"}
        by_field = {}
        for c in (existing.get("claims") or []):
            if c["status"] == "current":
                by_field.setdefault(c["field"], []).append(c["id"])
        existing_all_ids = sorted({i for ids in by_field.values() for i in ids})
        pick0 = lambda f: by_field.get(f) or existing_all_ids
        first_prose = {
            "summary": with_refs(prose["summary"], pick0("occurred_on")) if existing_all_ids else prose["summary"],
            "what_happened": ("\n\n".join([with_refs(inc["what_happened"], existing_all_ids)] +
                              ([with_refs(status_text, pick0("status"))] if status_text else []))
                              if existing_all_ids else prose["what_happened"]),
            "stated_justification": (with_refs(prose["stated_justification"], pick0("stated_justification"))
                                      if existing_all_ids else prose["stated_justification"]),
            "effect_on_reporting": (with_refs(prose["effect_on_reporting"], pick0("effect_on_reporting"))
                                     if existing_all_ids else prose["effect_on_reporting"]),
        }
        st, b = api.call("PUT", f"/admin/records/incident/{slug}", {**base_row, **first_prose, "reason": REASON, "batch_label": BATCH})
        if st != 200:
            fail("incidents", slug, st, b)
            continue
        # links
        actor_roles = inc.get("actor_roles", {})
        def role_for(a):
            if a in actor_roles:
                return actor_roles[a]
            bt = actor_kind.get(a, ("", ""))[1]
            return "ruled" if bt == "court" else "legislated" if bt == "legislature" else "other"
        links = {
            "actors": [{"slug": a, "role": role_for(a)} for a in inc.get("actors", []) if a in actor_kind],
            "outlets": [{"slug": o, "relation": "affected"} for o in inc.get("outlets", [])],
            "journalists": [{"slug": j, "relation": "affected"} for j in inc.get("journalists", [])],
            "cases": [{"slug": c, "relation": case_relation(case_dates.get(c, ""), inc["occurred_on"])} for c in inc.get("cases", []) if case_rows.get(c)],
            "sources": [{"source_id": sid[s], "role": "reporting", "sort": i} for i, s in enumerate(inc.get("sources", [])) if s in sid],
            "reason": "seed links", "batch_label": BATCH,
        }
        st, b = api.call("PUT", f"/admin/incidents/{slug}/links", links)
        if st != 200:
            fail("incidents", slug + " (links)", st, b)
        # claims (have/by_field pre-seeded above from the existing record, if any)
        for cl in inc.get("claims", []):
            q = (cl.get("evidence_quote") or "").strip()
            if not q:
                report["claims"]["skipped_no_quote"] += 1
                continue
            src = src_by_seed.get(cl["source_id"])
            if not src or cl["source_id"] not in sid:
                report["claims"]["failed"].append({"incident": slug, "field": cl["field"], "error": "unknown source"})
                continue
            key = (cl["field"], sid[cl["source_id"]], q)
            body = {
                "value": cl.get("value"), "statement": cl["statement"], "source_id": sid[cl["source_id"]], "evidence_quote": q,
                "evidence_date": src.get("published_on"), "method": CLAIM_METHOD.get(src["kind"], "outlet_report"),
                "verified_at": src.get("accessed_on", "2026-09-22"), "confidence": "medium", "batch_label": BATCH,
            }
            if key in have:
                old = have[key]
                if old["statement"] != cl["statement"] or (old.get("value") or None) != (cl.get("value") or None):
                    # The seed's wording changed since this claim was first created (same
                    # field/source/quote, e.g. a later voice-lint fix) -- supersede it with
                    # a corrected claim rather than leaving the stale statement live.
                    st, b = api.call("POST", f"/admin/claims/{old['id']}/supersede", {
                        **body, "reason": "correction", "note": "Corrected statement wording (seed repair pass)", "batch_label": BATCH,
                    })
                    if st == 200:
                        new_id = b["id"]
                        have[key] = {**old, "id": new_id, "statement": cl["statement"], "value": cl.get("value")}
                        bucket = by_field.setdefault(cl["field"], [])
                        if old["id"] in bucket:
                            bucket.remove(old["id"])
                        if new_id not in bucket:
                            bucket.append(new_id)
                        report["claims"]["superseded"] = report["claims"].get("superseded", 0) + 1
                    else:
                        report["claims"]["failed"].append({"incident": slug, "field": cl["field"], "status": st, "detail": b.get("details") or b, "note": "supersede failed"})
                        if old["id"] not in by_field.setdefault(cl["field"], []):
                            by_field[cl["field"]].append(old["id"])
                else:
                    if old["id"] not in by_field.setdefault(cl["field"], []):
                        by_field[cl["field"]].append(old["id"])
                report["claims"]["existing"] += 1
                continue
            st, b = api.call("POST", "/admin/claims", {
                "subject_type": "incident", "subject_slug": slug, "field": cl["field"], **body,
            })
            if st == 200:
                by_field.setdefault(cl["field"], []).append(b["id"])
                report["claims"]["created"] += 1
            else:
                report["claims"]["failed"].append({"incident": slug, "field": cl["field"], "status": st, "detail": b.get("details") or b})
        inc_claims[seed_slug] = {"slug": slug, "by_field": by_field, "sources": [sid.get(s) for s in inc.get("sources", [])]}
        all_ids = sorted({i for ids in by_field.values() for i in ids})
        if not all_ids:
            report["incidents"]["draft"].append({"slug": slug, "reason": "no seed claim carries a verbatim evidence quote"})
            continue
        pick = lambda f: by_field.get(f) or all_ids
        ref_prose = {
            "summary": with_refs(prose["summary"], pick("occurred_on")),
            "what_happened": "\n\n".join(
                [with_refs(inc["what_happened"], all_ids)] + ([with_refs(status_text, pick("status"))] if status_text else [])),
            "stated_justification": with_refs(prose["stated_justification"], pick("stated_justification")),
            "effect_on_reporting": with_refs(prose["effect_on_reporting"], pick("effect_on_reporting")),
        }
        st, b = api.call("PUT", f"/admin/records/incident/{slug}", {**base_row, **ref_prose, "reason": "Claim references added", "batch_label": BATCH})
        if st != 200:
            fail("incidents", slug, st, b)
            continue
        st, b = api.call("POST", f"/admin/records/incident/{slug}/publish", {"reviewed_on": REVIEWED_ON, "next_review_on": NEXT_REVIEW, "batch_label": BATCH})
        if st == 200:
            report["incidents"]["published"].append(slug)
        else:
            fail("incidents", slug, st, b)
            continue
        # events (spec section 2.3 `events` table; POST /admin/events per section 8).
        # Each seed event names the incident claim field it is evidenced by; the
        # claim was created above, so by_field has its id.
        #
        # NOTE: there is no admin GET/list endpoint for events and no
        # delete/retire endpoint (POST /admin/events is a blind INSERT with no
        # server-side dedup) -- see WORKLOG.md. As a best-effort guard against
        # re-running this script creating duplicate rows, we read the record's
        # own public JSON twin (which does include `events`) and skip any
        # event whose (occurred_on, kind, label) tuple is already present.
        if inc.get("events"):
            existing_events = set()
            try:
                with urllib.request.urlopen(
                    urllib.request.Request(api.base + f"/incidents/{slug}.json",
                                            headers={"User-Agent": UA, "Accept": "application/json"}),
                    timeout=30,
                ) as r:
                    for e in json.loads(r.read().decode() or "{}").get("events", []):
                        existing_events.add((e.get("date") or e.get("occurred_on"), e.get("kind"), e.get("label")))
            except Exception as e:
                print(f"  WARN could not fetch public JSON for event dedup on {slug}: {e}", file=sys.stderr)
        for ev in inc.get("events", []):
            claim_ids = by_field.get(ev.get("claim_field"))
            if not claim_ids:
                report["claims"]["failed"].append({"incident": slug, "field": "event:" + ev.get("label", "?"), "error": "no claim for event's claim_field"})
                continue
            if (ev["occurred_on"], ev["kind"], ev["label"]) in existing_events:
                continue
            st, b = api.call("POST", "/admin/events", {
                "incident_slug": slug, "occurred_on": ev["occurred_on"], "precision": ev.get("precision", "day"),
                "kind": ev["kind"], "label": ev["label"], "claim_id": claim_ids[-1], "batch_label": BATCH,
            })
            if st != 200:
                report["events"]["failed"].append({"incident": slug, "label": ev["label"], "status": st, "detail": b.get("details") or b})
                print(f"  FAIL event {slug} {ev['label']}: {st} {json.dumps(b.get('details') or b)[:300]}", file=sys.stderr)
            else:
                report["events"]["created"] += 1

    # ---- cases: links to incidents, refs, publish ----
    for c in cases:
        row = case_rows.get(c["slug"])
        if not row:
            continue
        inc_links = []
        for s in c.get("related_incidents", []):
            if s in report["slug_map"] and report["slug_map"][s] not in [f["slug"] for f in report["incidents"]["failed"]]:
                occurred = next((i["occurred_on"] for i in incidents if i["slug"] == s), "")
                rel = case_relation(case_dates.get(c["slug"], ""), occurred)
                inc_links.append({"slug": report["slug_map"][s], "relation": rel})
        docs = [{"source_id": sid[x], "role": "opinion" if src_by_seed[x]["kind"] == "court_record" else "reporting"} for x in c.get("sources", []) if x in sid]
        st, b = api.call("PUT", f"/admin/cases/{c['slug']}/links", {"sources": docs, "incidents": inc_links, "reason": "seed links", "batch_label": BATCH})
        if st != 200:
            fail("cases", c["slug"] + " (links)", st, b)
        # citable: this case's own direct claims, plus claims of linked incidents that rest
        # on one of this case's sources
        case_src = {sid.get(x) for x in c.get("sources", [])}
        refs = list(case_claim_ids.get(c["slug"], []))
        for s in c.get("related_incidents", []):
            ic = inc_claims.get(s)
            if not ic:
                continue
            st, rec = api.call("GET", f"/admin/records/incident/{ic['slug']}")
            for cl in rec.get("claims") or []:
                if cl["status"] == "current" and cl["source_id"] in case_src:
                    refs.append(cl["id"])
        if not refs:
            report["cases"]["draft"].append({"slug": c["slug"], "reason": "no current claim on the case or a linked incident rests on the case's sources"})
            continue
        st, b = api.call("PUT", f"/admin/records/case/{c['slug']}", {**row, "holding": with_refs(row["holding"], sorted(set(refs))), "reason": "Claim references added", "batch_label": BATCH})
        if st != 200:
            fail("cases", c["slug"], st, b)
            continue
        st, b = api.call("POST", f"/admin/records/case/{c['slug']}/publish", {"reviewed_on": REVIEWED_ON, "next_review_on": NEXT_REVIEW, "batch_label": BATCH})
        if st == 200:
            report["cases"]["published"].append(c["slug"])
        else:
            fail("cases", c["slug"], st, b)

    # ---- glossary ----
    for g in glossary:
        st, b = api.call("PUT", f"/admin/records/glossary_term/{g['slug']}", {"term": g["term"], "definition": g["definition"], "reason": REASON, "batch_label": BATCH})
        if st != 200:
            fail("glossary", g["slug"], st, b)
            continue
        api.call("PUT", f"/admin/records/glossary_term/{g['slug']}/sources", {"source_ids": [sid[x] for x in g.get("sources", []) if x in sid], "batch_label": BATCH})
        st, b = api.call("POST", f"/admin/records/glossary_term/{g['slug']}/publish", {"reviewed_on": REVIEWED_ON, "batch_label": BATCH})
        if st == 200:
            report["glossary"]["published"].append(g["slug"])
        else:
            fail("glossary", g["slug"], st, b)

    summary = {k: ({kk: (len(vv) if isinstance(vv, list) else vv) for kk, vv in v.items()} if isinstance(v, dict) and k != "slug_map" else None) for k, v in report.items()}
    summary.pop("slug_map", None)
    summary["api_calls"] = api.calls
    print(json.dumps(summary, indent=1))
    if args.report:
        with open(args.report, "w") as f:
            json.dump(report, f, indent=1)


if __name__ == "__main__":
    main()
