#!/usr/bin/env python3
"""
seed-check.py -- validate /home/claude/crank3/seed/*.json against
twon-data-and-record-spec.md's field rules.

Read-only: this never modifies the seed. It prints a report (counts per
file, then every violation found) and exits 1 if any violation was found,
0 otherwise, so it can be used as a pre-import gate later without changing
its job today, which is only to report.

Checked, per spec section 2 and the editorial lint rules:
  - required fields present, with the right JSON type
  - enum fields against the D1 CHECK lists in section 2.3 (note: the seed
    predates the admin API's field names/enums in places -- see "Seed vs
    spec shape" below -- mismatches are reported, not silently accepted)
  - slugs match ^[a-z0-9]+(-[a-z0-9]+)*$, <=80 chars, and incidents start
    with a 4-digit year per section 2.1's naming convention
  - dates match YYYY-MM-DD (or are null where the field allows it)
  - claims.evidence_quote <=300 characters (the claims table's CHECK)
  - cross-references resolve: incidents.actors/outlets/journalists/cases/
    sources, journalists.outlet, cases.related_incidents, and every
    `sources` list against sources.json's ids
  - no em/en dash (or dash substitute) in the site's own prose fields,
    outside evidence_quote (which is a verbatim quotation and exempt, same
    as lint-rules.json's rule for quoted text)

Seed vs spec shape: the seed files are pre-admin-API research output, not
D1 rows, so some fields use different names/vocabularies than the section
2.3 schema (e.g. actors.kind here is a flat descriptive kind, not the
schema's `kind` in {person,body} + `body_type`; jurisdiction is free text,
not the `US` / `US-LA` convention; source.kind uses outlet_report/org_report
rather than the schema's source_kind enum). Each such mismatch is reported
as a `enum_shape_mismatch` finding rather than papered over, since the
admin API will reject these values as posted and the build plan (section 11)
has itemizer/verification passes ahead of `publish-records.py` to resolve
them -- this script's job is to surface that work, not to guess a fix.

Usage: python3 seed-check.py [--seed-dir PATH] [--json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

DEFAULT_SEED_DIR = Path("/home/claude/crank3/seed")

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
YEAR_PREFIX_RE = re.compile(r"^(19|20)\d{2}-")
ISO2_RE = re.compile(r"^[A-Z]{2}$")

# Spec section 2.3 CHECK lists (the D1 schema's own enums)
SPEC_ENUMS = {
    "incident.type": {
        "access_ban", "credential_revocation", "lawsuit_against_press", "regulatory_pressure",
        "funding_cut", "arrest_or_detention", "subpoena_or_seizure", "legislation",
        "physical_obstruction", "other",
    },
    # v2 (brief 2026-09-22): level is the tier of government that acted, not a
    # domestic/foreign distinction. Both the legacy v1 values and the live v2
    # values are accepted here so the checker still validates pre-v2 seed
    # rows; the admin API itself only accepts the v2 set.
    "incident.level": {
        "federal", "state", "local", "foreign",
        "national", "state_or_province", "municipal", "supranational",
    },
    "incident.occurred_on_precision": {"day", "month", "year", "approximate"},
    "source.source_kind": {
        "reporting", "primary_document", "court_record", "official_statement", "dataset", "reference",
    },
    "source.link_state": {"unchecked", "live", "paywalled", "bot_blocked", "dead", "redirected"},
    "outlet.kind": {
        "newspaper", "broadcaster", "cable_news", "wire_service", "digital", "magazine",
        "public_media", "press_association", "other",
    },
    "actor.kind": {"person", "body"},
    # v2 fields (brief 2026-09-22).
    "incident.outcome": {"reversed", "upheld", "sustained", "ongoing", "unknown"},
    "incident.granularity": {"anchor", "granular"},
    "tactic.slug": {
        "access_ban", "credential_control", "outlet_licensing", "prior_restraint",
        "secrets_and_espionage_laws", "insult_and_defamation_laws", "surveillance_and_subpoenas",
        "funding_and_ownership_pressure", "expulsion_and_visa_denial", "shutdowns_and_blocking",
        "detention_and_violence", "lawsuits_against_press", "disinformation_labeling",
    },
    # v3 (brief v3-ladder-brief-2026-09-22): escalation stage. The admin API
    # now refuses to publish an incident with no stage set.
    "incident.stage": {"restrict", "pressure", "punish", "silence", "eliminate"},
}

# Pre-DB-mapping seed vocabularies that the load tools (load-seed.py,
# tools/v2-backfill.py's siblings, the v2 research loader) translate into the
# SPEC_ENUMS values above before posting to the admin API (e.g. sources.kind
# "outlet_report"/"org_report"/"official_document"/... -> source_kind
# "reporting"/"reference"/"primary_document"; actors.kind "office"/"other"
# -> DB kind "body"). A value in one of these sets is reported at
# "warning", not "error": it is seed-side shorthand with an established,
# tested translation, not a value the admin API would actually reject as
# posted.
SEED_SIDE_VOCAB = {
    "source.source_kind": {
        "outlet_report", "org_report", "official_statement", "court_record", "primary_document",
        "official_document", "press_freedom_report", "advocacy_report", "press_freedom_org",
        "advocacy_legal", "legal_analysis", "other", "dataset", "reference", "reporting",
    },
    "actor.kind": {"person", "body", "office", "other"},
    "source.link_state": {"blocks_automated_checks"},
    "outlet.kind": {
        "wire", "publisher", "news_agency", "digital_native", "news_website",
        "media_network", "newspaper_group", "media_conglomerate",
    },
}

# Prose fields checked for em/en dashes and lint per record type. This is
# the site's OWN composed prose only, per lint-rules.json's own scope
# ("applies_to": "the site's own words only"). sources.title/publisher are
# deliberately excluded: they are the external outlet's own headline and
# name, reproduced as bibliographic data (the same treatment evidence_quote
# gets), not text the site wrote -- linting them would flag, say, a
# newspaper's own "Trump Targets Press Funding" headline as if the site had
# written it.
PROSE_FIELDS = {
    "incidents": ["title", "summary", "what_happened", "stated_justification", "effect_on_reporting", "status", "what_we_dont_know"],
    "actors": ["name", "role_or_office"],
    "outlets": ["name"],
    "journalists": ["name", "role"],
    "cases": ["name", "holding", "status"],
    "glossary": ["term", "definition"],
}


class Report:
    def __init__(self) -> None:
        self.counts: Dict[str, int] = {}
        self.violations: List[Dict[str, Any]] = []

    def add(self, file: str, record: str, rule: str, detail: str, severity: str = "error") -> None:
        self.violations.append({"file": file, "record": record, "rule": rule, "detail": detail, "severity": severity})

    def by_rule(self) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for v in self.violations:
            out[v["rule"]] = out.get(v["rule"], 0) + 1
        return out


def load(seed_dir: Path, name: str) -> List[dict]:
    path = seed_dir / f"{name}.json"
    if not path.exists():
        return []
    return common.load_json(path)


def check_slug(report: Report, file: str, record: str, slug: Any, require_year: bool = False) -> None:
    if not isinstance(slug, str) or not slug:
        report.add(file, record, "slug_type", f"slug is {slug!r}, expected a non-empty string")
        return
    if len(slug) > 80:
        report.add(file, record, "slug_length", f"slug is {len(slug)} chars (max 80)")
    if not SLUG_RE.match(slug):
        report.add(file, record, "slug_format", f"'{slug}' does not match ^[a-z0-9]+(-[a-z0-9]+)*$")
    if require_year and not YEAR_PREFIX_RE.match(slug):
        report.add(
            file, record, "slug_convention",
            f"'{slug}' does not start with a 4-digit year, per section 2.1 (\"Incidents start with the year\")",
            severity="warning",
        )


def check_date(report: Report, file: str, record: str, field: str, value: Any, required: bool = True) -> None:
    if value is None:
        if required:
            report.add(file, record, "date_missing", f"{field} is null but is required")
        return
    if not isinstance(value, str) or not DATE_RE.match(value):
        report.add(file, record, "date_format", f"{field}='{value}' is not YYYY-MM-DD")
        return
    try:
        y, m, d = (int(x) for x in value.split("-"))
        if not (1 <= m <= 12 and 1 <= d <= 31):
            raise ValueError
    except ValueError:
        report.add(file, record, "date_format", f"{field}='{value}' is not a real calendar date")


def check_enum(report: Report, file: str, record: str, field: str, value: Any, enum_key: str, severity: str = "error") -> None:
    allowed = SPEC_ENUMS[enum_key]
    if value in allowed:
        return
    seed_vocab = SEED_SIDE_VOCAB.get(enum_key)
    if seed_vocab and value in seed_vocab:
        report.add(
            file, record, "enum_shape_mismatch",
            f"{field}='{value}' is seed-side shorthand for spec enum {enum_key}, translated by the load tools",
            severity="warning",
        )
        return
    report.add(
        file, record, "enum_shape_mismatch",
        f"{field}='{value}' not in spec enum {enum_key}={sorted(allowed)}",
        severity=severity,
    )


def check_country(report: Report, file: str, record: str, value: Any) -> None:
    if value is None:
        return
    if not isinstance(value, str) or not ISO2_RE.match(value):
        report.add(file, record, "country_format", f"country='{value}' is not an ISO 3166-1 alpha-2 code")


def check_prose_dashes(report: Report, file: str, record: str, field: str, text: Any, lint: common.Lint) -> None:
    if not isinstance(text, str) or not text:
        return
    for v in lint.check(text):
        if v["kind"] == "dash":
            report.add(file, record, "em_dash_in_prose", f"{field}: '{v['text']}' ({v['replacement']}) at offset {v['offset']}")


def check_lint(report: Report, file: str, record: str, field: str, text: Any, lint: common.Lint) -> None:
    if not isinstance(text, str) or not text:
        return
    for v in lint.check(text):
        if v["kind"] in ("banned_phrase", "quotation_only"):
            report.add(
                file, record, f"lint_{v['kind']}",
                f"{field}: '{v['text']}'" + (f" -> {v['replacement']}" if v.get("replacement") else ""),
                severity="warning",
            )


def run(seed_dir: Path) -> Report:
    report = Report()
    lint = common.Lint()

    incidents = load(seed_dir, "incidents")
    actors = load(seed_dir, "actors")
    outlets = load(seed_dir, "outlets")
    journalists = load(seed_dir, "journalists")
    cases = load(seed_dir, "cases")
    sources = load(seed_dir, "sources")
    glossary = load(seed_dir, "glossary")

    report.counts = {
        "incidents": len(incidents), "actors": len(actors), "outlets": len(outlets),
        "journalists": len(journalists), "cases": len(cases), "sources": len(sources),
        "glossary": len(glossary),
    }

    source_ids = {s.get("id") for s in sources}
    actor_slugs = {a.get("slug") for a in actors}
    outlet_slugs = {o.get("slug") for o in outlets}
    journalist_slugs = {j.get("slug") for j in journalists}
    case_slugs = {c.get("slug") for c in cases}
    incident_slugs = {i.get("slug") for i in incidents}

    # -- sources.json --------------------------------------------------
    seen_source_ids: set = set()
    for s in sources:
        rid = s.get("id", "?")
        if rid in seen_source_ids:
            report.add("sources", rid, "duplicate_id", f"id '{rid}' repeats")
        seen_source_ids.add(rid)
        for field in ("url", "title", "publisher"):
            if not s.get(field):
                report.add("sources", rid, "field_missing", f"{field} is missing or empty")
        url = s.get("url", "")
        if url and not re.match(r"^https?://", url):
            report.add("sources", rid, "url_format", f"url '{url}' is not http(s)")
        check_date(report, "sources", rid, "published_on", s.get("published_on"), required=False)
        check_date(report, "sources", rid, "accessed_on", s.get("accessed_on"), required=False)
        if "kind" in s:
            check_enum(report, "sources", rid, "kind", s["kind"], "source.source_kind")
        if "link_state" in s:
            check_enum(report, "sources", rid, "link_state", s["link_state"], "source.link_state")
        if not isinstance(s.get("http_status"), int):
            report.add("sources", rid, "field_type", f"http_status is {s.get('http_status')!r}, expected int")
        # sources.title/publisher are not linted -- see PROSE_FIELDS comment.

    # -- actors.json ------------------------------------------------
    for a in actors:
        slug = a.get("slug", "?")
        check_slug(report, "actors", slug, slug)
        for field in ("name", "role_or_office", "jurisdiction", "country"):
            if not a.get(field):
                report.add("actors", slug, "field_missing", f"{field} is missing or empty")
        if "kind" in a:
            check_enum(report, "actors", slug, "kind", a["kind"], "actor.kind", severity="warning")
        check_country(report, "actors", slug, a.get("country"))
        for sid in a.get("sources", []):
            if sid not in source_ids:
                report.add("actors", slug, "broken_reference", f"sources: '{sid}' not found in sources.json")
        for field in PROSE_FIELDS["actors"]:
            check_prose_dashes(report, "actors", slug, field, a.get(field), lint)
            check_lint(report, "actors", slug, field, a.get(field), lint)

    # -- outlets.json -----------------------------------------------
    for o in outlets:
        slug = o.get("slug", "?")
        check_slug(report, "outlets", slug, slug)
        for field in ("name", "country"):
            if not o.get(field):
                report.add("outlets", slug, "field_missing", f"{field} is missing or empty")
        if "kind" in o:
            check_enum(report, "outlets", slug, "kind", o["kind"], "outlet.kind")
        check_country(report, "outlets", slug, o.get("country"))
        url = o.get("homepage_url", "")
        if url and not re.match(r"^https?://", url):
            report.add("outlets", slug, "url_format", f"homepage_url '{url}' is not http(s)")
        for field in PROSE_FIELDS["outlets"]:
            check_prose_dashes(report, "outlets", slug, field, o.get(field), lint)
            check_lint(report, "outlets", slug, field, o.get(field), lint)

    # -- journalists.json ---------------------------------------------
    for j in journalists:
        slug = j.get("slug", "?")
        check_slug(report, "journalists", slug, slug)
        # `outlet` is not required: the admin API's own PUT
        # /admin/records/journalist/<slug> only requires name and role
        # (outlet_slug is optional, e.g. a freelance journalist or one whose
        # employer is not stated in the sources reviewed).
        for field in ("name", "role"):
            if not j.get(field):
                report.add("journalists", slug, "field_missing", f"{field} is missing or empty")
        outlet = j.get("outlet")
        if outlet and outlet not in outlet_slugs:
            report.add("journalists", slug, "broken_reference", f"outlet '{outlet}' not found in outlets.json")
        for sid in j.get("sources", []):
            if sid not in source_ids:
                report.add("journalists", slug, "broken_reference", f"sources: '{sid}' not found in sources.json")
        for field in PROSE_FIELDS["journalists"]:
            check_prose_dashes(report, "journalists", slug, field, j.get(field), lint)
            check_lint(report, "journalists", slug, field, j.get(field), lint)

    # -- cases.json -----------------------------------------------------
    for c in cases:
        slug = c.get("slug", "?")
        check_slug(report, "cases", slug, slug)
        for field in ("name", "court", "holding", "status"):
            if not c.get(field):
                report.add("cases", slug, "field_missing", f"{field} is missing or empty")
        check_date(report, "cases", slug, "filed_on", c.get("filed_on"), required=False)
        check_date(report, "cases", slug, "decided_on", c.get("decided_on"), required=False)
        for sid in c.get("sources", []):
            if sid not in source_ids:
                report.add("cases", slug, "broken_reference", f"sources: '{sid}' not found in sources.json")
        for ri in c.get("related_incidents", []):
            if ri not in incident_slugs:
                report.add("cases", slug, "broken_reference", f"related_incidents: '{ri}' not found in incidents.json")
        for field in PROSE_FIELDS["cases"]:
            check_prose_dashes(report, "cases", slug, field, c.get(field), lint)
            check_lint(report, "cases", slug, field, c.get(field), lint)

    # -- glossary.json ----------------------------------------------
    for g in glossary:
        slug = g.get("slug", "?")
        check_slug(report, "glossary", slug, slug)
        for field in ("term", "definition"):
            if not g.get(field):
                report.add("glossary", slug, "field_missing", f"{field} is missing or empty")
        for sid in g.get("sources", []):
            if sid not in source_ids:
                report.add("glossary", slug, "broken_reference", f"sources: '{sid}' not found in sources.json")
        for field in PROSE_FIELDS["glossary"]:
            check_prose_dashes(report, "glossary", slug, field, g.get(field), lint)
            check_lint(report, "glossary", slug, field, g.get(field), lint)

    # -- incidents.json -----------------------------------------------
    for i in incidents:
        slug = i.get("slug", "?")
        check_slug(report, "incidents", slug, slug, require_year=True)
        for field in ("title", "occurred_on", "level", "type", "summary", "what_happened"):
            if not i.get(field):
                report.add("incidents", slug, "field_missing", f"{field} is missing or empty")
        check_date(report, "incidents", slug, "occurred_on", i.get("occurred_on"))
        if "occurred_on_precision" in i:
            check_enum(report, "incidents", slug, "occurred_on_precision", i["occurred_on_precision"], "incident.occurred_on_precision")
        if "level" in i:
            check_enum(report, "incidents", slug, "level", i["level"], "incident.level")
        if "type" in i and not i.get("tactic_primary"):
            # v2 incidents carry `type` as a duplicate of tactic_primary (a
            # 13-tactic-taxonomy slug, checked below) rather than the legacy
            # v1 incident.type enum, and the admin API is never sent `type`
            # for a v2 load, so it is not re-checked against the old enum
            # here.
            check_enum(report, "incidents", slug, "type", i["type"], "incident.type")
        check_country(report, "incidents", slug, i.get("country"))

        # -- v2 fields (brief 2026-09-22) --
        if i.get("tactic_primary"):
            check_enum(report, "incidents", slug, "tactic_primary", i["tactic_primary"], "tactic.slug")
        for t in i.get("tactics") or []:
            check_enum(report, "incidents", slug, "tactics[]", t, "tactic.slug")
        if "outcome" in i and i["outcome"] is not None:
            check_enum(report, "incidents", slug, "outcome", i["outcome"], "incident.outcome")
        if "granularity" in i and i["granularity"] is not None:
            check_enum(report, "incidents", slug, "granularity", i["granularity"], "incident.granularity")
        # v3: stage is required on every incident (the admin API refuses to
        # publish an incident with no stage set).
        if not i.get("stage"):
            report.add("incidents", slug, "field_missing", "stage is missing or empty (required to publish, brief v3-ladder-brief-2026-09-22)")
        else:
            check_enum(report, "incidents", slug, "stage", i["stage"], "incident.stage")
        leader = i.get("leader_slug")
        if leader and leader not in actor_slugs:
            report.add("incidents", slug, "broken_reference", f"leader_slug: '{leader}' not found in actors.json")
        if i.get("issue_of_the_day") and len(str(i["issue_of_the_day"]).split()) > 60:
            report.add("incidents", slug, "issue_of_the_day_length", "issue_of_the_day exceeds 60 words")

        for a in i.get("actors", []):
            if a not in actor_slugs:
                report.add("incidents", slug, "broken_reference", f"actors: '{a}' not found in actors.json")
        for o in i.get("outlets", []):
            if o not in outlet_slugs:
                report.add("incidents", slug, "broken_reference", f"outlets: '{o}' not found in outlets.json")
        for j in i.get("journalists", []):
            if j not in journalist_slugs:
                report.add("incidents", slug, "broken_reference", f"journalists: '{j}' not found in journalists.json")
        for cs in i.get("cases", []):
            if cs not in case_slugs:
                report.add("incidents", slug, "broken_reference", f"cases: '{cs}' not found in cases.json")
        for sid in i.get("sources", []):
            if sid not in source_ids:
                report.add("incidents", slug, "broken_reference", f"sources: '{sid}' not found in sources.json")

        for field in PROSE_FIELDS["incidents"]:
            check_prose_dashes(report, "incidents", slug, field, i.get(field), lint)
            check_lint(report, "incidents", slug, field, i.get(field), lint)

        for idx, claim in enumerate(i.get("claims", [])):
            cref = f"{slug}#claims[{idx}]"
            quote = claim.get("evidence_quote", "")
            if quote and len(quote) > 300:
                report.add("incidents", cref, "claim_quote_length", f"evidence_quote is {len(quote)} chars (max 300)")
            if not claim.get("source_id"):
                report.add("incidents", cref, "field_missing", "claim has no source_id")
            elif claim["source_id"] not in source_ids:
                report.add("incidents", cref, "broken_reference", f"source_id '{claim['source_id']}' not found in sources.json")
            if not claim.get("statement"):
                report.add("incidents", cref, "field_missing", "claim has no statement")
            check_prose_dashes(report, "incidents", cref, "statement", claim.get("statement"), lint)
            check_lint(report, "incidents", cref, "statement", claim.get("statement"), lint)
            # evidence_quote is verbatim (exempt from the dash/lint check,
            # same treatment lint-rules.json gives quoted text generally)

    return report


def print_report(report: Report, as_json: bool) -> None:
    if as_json:
        print(json.dumps({"counts": report.counts, "violations": report.violations}, indent=2))
        return

    print("Seed check -- /home/claude/crank3/seed/*.json")
    print()
    print("Counts:")
    for name, count in report.counts.items():
        print(f"  {name}.json: {count}")
    print()

    errors = [v for v in report.violations if v["severity"] == "error"]
    warnings = [v for v in report.violations if v["severity"] == "warning"]
    print(f"Violations: {len(errors)} error(s), {len(warnings)} warning(s)")
    by_rule = report.by_rule()
    for rule, count in sorted(by_rule.items(), key=lambda kv: -kv[1]):
        print(f"  {rule}: {count}")
    print()

    if report.violations:
        print("Detail:")
        for v in report.violations:
            print(f"  [{v['severity']}] {v['file']}:{v['record']} {v['rule']} -- {v['detail']}")
    else:
        print("No violations found.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed-dir", default=str(DEFAULT_SEED_DIR))
    ap.add_argument("--json", action="store_true", help="print machine-readable JSON instead of text")
    args = ap.parse_args()

    report = run(Path(args.seed_dir))
    print_report(report, args.json)
    return 0  # report-only, per the task: fix nothing, just report


if __name__ == "__main__":
    sys.exit(main())
