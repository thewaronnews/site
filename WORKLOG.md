# The War On News: worklog

## 2026-09-22: P1a core Worker built, deployed and seeded (lead implementer)

Done, in order, each step committed in the local git repo (/home/claude/crank3/twon):

- a) Migrations: spec 0001 schema (35 tables incl. FTS, 5 append-only triggers), 0002 bots, 0003 FTS.
  deploy.sh now splits with tools/split-sql.py (trigger-aware, strips inline comments).
- b-g) Worker rewritten for TWON: records/admin (4 scopes, spec 8 endpoints, {c:ID} enforcement, voice
  lint from editorial/lint-rules.json), all public routes with HTML/.md/.json twins, meta block, link-state
  badges, extLink with target=_blank rel="noopener noreferrer" plus archived link, timeline views, News
  Desk pages and gates, policy pages from editorial/*.md, /data with Frictionless datapackage.json, feeds
  (RSS, Atom, JSON Feed for /news and /incidents, /changes.xml), llms.txt, llms-full.txt, robots.txt,
  sitemap index with lastmod, JSON-LD per spec 4.2, /assets/site.css (1-year immutable cache, versioned
  URL), /.well-known files, IndexNow key file, MCP with the 8 spec tools. Crawler modules and strings
  removed (grep clean outside the Crank #2 reference spec in docs/).
- h) deploy.sh created twon-site, twon-db (f20bd66f-9fef-4d47-8e87-06057e00653b), twon-kv
  (82f442821f2746b399181af694a41845), twon-exports; domains, cron 17 7 * * *, zone settings. Tokens issued
  (triage, desk, publish, operator) to /home/claude/.twon and /mnt/user-data/outputs/twon-tokens.
- i) Seed loaded through the admin API with tools/load-seed.py (report: docs/seed-report-2026-09-22.json):
  99 sources (with the seed link check as source_checks), 18 outlets, 35 actors, 7 journalists,
  25 glossary terms, 7 incidents, 12 claims published. 0 cases published.
- j) Live verification: 112 requests 200 (all pages in three formats, feeds, sitemaps, discovery, css,
  datapackage), http->https 301, www->apex 301, 404s correct; mcp-smoke 9 of 10 (get_case: no published
  case). Details and resource ids in site/NOTES.md.

### TODO (not half-wired; each is a clean gap)

1. Editorial fixes needed before these seed records can publish. The voice lint rejected the prose of
   12 incidents, 1 case and 2 glossary terms (characterizing words outside quotation marks):
   - 2025-white-house-bars-ap-gulf-of-america: what_happened "retaliation"
   - 2025-pentagon-issues-new-press-credentialing-rules: what_happened "punish"
   - 2025-trump-order-ends-cpb-funding-npr-pbs: stated_justification "biased"
   - 2025-federal-judge-blocks-louisiana-buffer-law: summary "chilling"; what_happened "straightforward"
   - 1971-nixon-white-house-compiles-enemies-list: unknowns "targeted"
   - 2013-obama-doj-charges-eight-under-espionage-act: what_happened, effect_on_reporting "chilling effect"
   - 2023-hungary-sovereignty-protection-act: title "targeting"; what_happened "harass"; effect "censorship"
   - 2026-india-journalist-sentenced-adani-defamation: what_happened "regime"; effect "censorship"
   - 2026-russia-new-law-targets-exiled-journalists-assets: what_happened "targeting"
   - 2026-el-salvador-freezes-el-faro-shareholder-assets: summary, what_happened, effect "harassment"
   - 2025-hong-kong-convicts-jimmy-lai-under-national-security-law: summary "targeted"; effect "censorship"
   - 2025-turkiye-crackdown-on-journalists-covering-protests: what_happened, stated_justification "crackdown"
   - case cnn-msnow-politico-v-trump-2026: holding "retaliation", "unconstitutional" (quote the complaint)
   - glossary prior-restraint "unconstitutional"; access-journalism "critics say"
   Fix the seed text (quote or attribute), then re-run load-seed.py; it is idempotent.
2. Seed claims without evidence quotes: 32 of 44 claims on loaded incidents (64 of 92 overall) have an
   empty evidence_quote and were not created (the schema requires a quote). Four incidents have no quoted
   claim at all and stay unpublished: 2025-usagm-moves-to-shut-down-voice-of-america,
   2018-white-house-revokes-acosta-press-pass, 2024-louisiana-enacts-police-buffer-zone-law,
   2025-florida-halo-law-takes-effect. Cases sherrill-v-knight-1977, cnn-v-trump-2018, ap-v-budowich-2025
   are stored as drafts with no citable claim; /cases is empty and MCP get_case finds nothing until
   quoted case claims are added (POST /admin/claims with subject_type case).
3. Paragraph references on published incidents are record-level where the seed had no claim for that
   field (a paragraph cites the record's quoted claims). Editorial review should tighten them.
   Incident actor roles are "other" except courts and legislatures; set real roles via
   PUT /admin/incidents/<slug>/links.
4. The CNN 2026 case docket 1:26-cv-03287 and Judge Kelly remain unconfirmed against the court docket
   (seed-notes item 1).
5. GitHub export: GITHUB_TOKEN is empty; set it in secrets.env, re-run deploy.sh, POST /admin/export.
6. Mac-side tools from spec 6, 7 and 9 not built in this run: archive.py (no Wayback snapshots exist yet),
   linkcheck.py, indexnow-ping.py, publish-records.py, revert-batch.py, desk/ (News Desk agent, Jev,
   digest). The Worker endpoints they call are live.
7. Not built: policy pages versioned into `revisions` as record_type policy (served from content.js with a
   content hash as version); explainers (none in the seed, including the press pool explainer); events
   (none in the seed; timelines show incident dates only); og:image and illustrations (pending Peter);
   GA4 measurement id (none set, so no tag); MCP registry, Smithery, Glama listings; GSC and Bing setup.
8. The spec names the lint module voice.js; it ships as src/lint.js (generated from lint-rules.json).
9. One verbatim evidence quote contains an em dash (WHCA statement on the press pool incident); it is
   shown as quoted and was not altered.

## 2026-09-22: Seed repair -- quotes, cases, events, lint (all 23 incidents and 4 cases now public)

Closed out every TODO item above. Seed files edited in /home/claude/crank3/seed (incidents.json,
cases.json, sources.json, glossary.json; each has a .bak from before this pass). tools/load-seed.py
edited (this repo) to add events support, case-level claims, an idempotency fix for a
`paragraph_without_claim_ref` 422 on re-running an already-published record, an idempotency guard for
events, and a fix for stale claim statement text (see items 3 and 4 below). No other Worker code was
touched.

**Before -> after (live, verified via the public JSON twins and the admin API):**
- Incidents published: 7 / 23 -> 23 / 23
- Cases published: 0 / 4 -> 4 / 4
- Claims (current, incidents + cases): 12 created (of 92 seed claims, 64 empty) -> 105 current claims live
- Events: 0 (no seed/loader support) -> 6 distinct events on the CNN incident, but 12 rows live (see item 4)

**1. Evidence quotes.** Filled all 64 empty `evidence_quote` fields with verbatim (<=300 char) passages
fetched from the cited source (WebFetch, falling back to Wayback Machine or an alternate outlet via
WebSearch when the original URL was blocked -- NPR/CNN/CourtListener/axios/aljazeera/pbs/cnbc.com all
blocked WebFetch on at least one URL). 48 were filled with a real quote from the original or a
substitute source (14 new sources added, s100-s113). **16 were deleted** because no source reviewed
supported the claim -- all were placeholder claims whose statement read "not stated in the sources
reviewed," mostly `stated_justification` fields where the actor gave no reason on the record. Their
dependent prose was softened to say the justification was not stated, rather than inventing a quote.

**2. Cases.** All 4 cases now carry 3-4 quoted claims each (filed_on/decided_on, holding, status, and
docket where applicable): sherrill-v-knight-1977, cnn-v-trump-2018, ap-v-budowich-2025,
cnn-msnow-politico-v-trump-2026. **Docket/judge confirmation for the 2026 CNN case: CONFIRMED.**
Docket 1:26-cv-03287 is quoted verbatim from CourtListener's own docket-page title ("CABLE NEWS
NETWORK, INC. v. TRUMP, 1:26-cv-03287"; direct WebFetch to courtlistener.com was blocked by
robots.txt, so the quote is sourced from the page's own title text returned in a WebSearch result
snippet -- source s105). Judge Timothy J. Kelly's assignment is confirmed by PBS NewsHour's direct
reporting (source s013). Both are now stated as confirmed in the case's `status` field, replacing the
original "not independently re-confirmed" caveat.

**3. Voice lint.** Rewrote every flagged passage (see the TODO list above for the exact incidents/
fields/words) so quotation-only words appear only inside attributed quotes, using lint-rules.json's own
prescribed replacements where one exists (e.g. crackdown -> restrictions). The Turkiye incident was
renamed: slug turkiye-crackdown-on-journalists-covering-protests ->
2025-turkiye-detains-and-deports-journalists-covering-protests, title "Turkish authorities detain,
injure and deport journalists covering 2025 protests." `ops/seed-check.py` now reports 0 structural
errors; the only remaining `warning`-level lint hits are the pre-existing, unavoidable glossary
self-reference cases (gag-order's term "Gag order", chilling-effect's term and definition use of
"chilling") -- a term cannot be defined without naming itself, and the live admin API accepts both (they
were already published in the original pre-repair run). Spot-checked the rendered HTML (not just the
JSON twins) of three incident pages (the CNN ban, the renamed Turkiye incident, and the Pentagon badges
incident) with a quote-aware scanner against lint-rules.json: all three are clean -- every remaining
lint-listed word on those pages is inside an attributed quote or the site's own `<q class=
"claim-quote-inline">` evidence-quote rendering (verbatim per spec, correctly exempt) or, for
"crackdown," is the literal headline of a cited CPJ article reproduced in a source citation (also
correctly exempt: lint-rules.json scopes itself to "the site's own words only").

   **A real bug this surfaced and fixed in load-seed.py:** claims dedupe on (field, source_id,
   evidence_quote); several claims created in earlier partial runs (before their prose was voice-lint
   cleaned) kept that same tuple after their `statement` wording was corrected in the seed, so the
   loader's dedup logic silently left the old, uncorrected statement text live in D1 on every re-run --
   e.g. the CNN incident's `stated_justification` claim statement read "...fiction and lies..." (unquoted)
   long after the seed's own text properly quoted "FICTION and LIES." Fixed by having the incidents and
   cases claims loops compare the live claim's `statement`/`value` against the seed's, and
   `POST /admin/claims/<id>/supersede` (reason: correction) instead of silently reusing the stale claim
   when they differ. Ran load-seed.py again after the fix; it superseded the stale claims across the
   whole seed (confirmed by re-fetching the admin record for the CNN, Turkiye and Pentagon incidents and
   by a clean, zero-supersede idempotent re-run afterward). Recommend this fix be reviewed as a candidate
   for anyone else's seed tooling that has the same dedup-without-update pattern.

**4. Events -- unresolved duplication, needs a Worker fix.** Added full events support to load-seed.py
(POST /admin/events per spec 8) plus the seed's `events` array on the CNN incident (6 events: the
2026-09-18 announcement, 09-19 pass deactivation, 09-19 WHCA statement, 09-20 pool-solidarity, 09-21
lawsuit filed, 09-23 hearing scheduled). **Worker gap found:** `createEvent` (site/src/records.js) is a
blind INSERT with no dedup, and there is no GET/list endpoint and no delete/retire endpoint for events
anywhere in admin.js/records.js -- confirmed by grep across the whole admin surface. A background
`load-seed.py` run that was killed mid-flight (to apply an unrelated fix) had already posted the CNN
incident's 6 events before it was killed; the next full run had no way to know that and posted the same
6 again, so **the CNN incident currently carries 12 event rows in production, each of the 6 intended
events duplicated exactly once** (same occurred_on/kind/label/claim_id per pair). I added a best-effort
guard to load-seed.py (it now reads the incident's own public JSON twin, which does expose `events`,
and skips POSTing any event whose (occurred_on, kind, label) already appears there) -- confirmed this
stops the duplication from getting worse (`events: created 0` on two clean re-runs after the fix). It
cannot remove the 6 rows already live, because no delete/retire endpoint exists and the task's scope
excludes editing Worker code other than load-seed.py. **This needs a real fix in the Worker**: either a
delete/retire endpoint for events (mirroring `POST /admin/claims/<id>/status`'s retire semantics), or a
uniqueness constraint / upsert-by-(incident_id, occurred_on, kind, label) in `createEvent` itself. Until
then the 6 duplicate rows should be removed by whoever has direct D1 access, or a delete endpoint should
be added and used once.

**5. Actor roles.** Set a real role (announced, enforced, defended, ruled, legislated, etc., per the
enum) on every actor link where a source supports one, replacing "other," via a new per-incident
`actor_roles` field in the seed that load-seed.py's `role_for()` now reads before falling back to the
old court/legislature default.

**6. Slugs, dates, dashes.** Every incident slug now carries its 4-digit-year prefix in the seed itself
(previously only added at runtime by the loader), using the loader's own already-published slug map so
upsert continuity was preserved for the 7 originally-published incidents. 11 sources with a month- or
year-only `published_on` were nulled per the spec's fallback (the `sources` table has no
`published_on_precision` sibling column). Two incident `occurred_on` dates were corrected against
primary sources while fixing their claims (Louisiana buffer-zone law signing: 2024-05-28; Hong Kong
Lai conviction: 2025-12-15). Remaining unquoted " -- " uses outside quotations were converted to commas.

**Not independently re-confirmable / left as-is (documented in the seed):** none outstanding -- every
incident and case now publishes with at least one quoted claim, and the CNN case docket/judge are
confirmed (item 2). The events duplication (item 4) and the glossary self-reference lint warnings (item
3) are the only two open items, both requiring a Worker-side decision rather than a seed fix.

## 2026-09-22: v2 back end (lead implementer), per v2-brief-2026-09-22.md

Commits c16e847 (step 1) to the step 7 commit; details and endpoint list in site/NOTES.md "v2".

- Step 1: migration 0004_v2 applied live (tactics 13, countries 250, incident_tactics, coverage_items, incidents
  rebuilt with the v2 fields and the new level enum, era generated). **Events fixed: CNN incident 12 rows -> 6**,
  UNIQUE index on events(incident_id, occurred_on, kind, label); `POST /admin/events` idempotent;
  `GET /admin/events?incident=` and operator `DELETE /admin/events/:id` added (worklog item 4 above closed).
- Step 2: admin API for v2 fields, tactics, country RSF rank, coverage (hide/show/attach), feeds, `GET /admin/sources`,
  search rebuild, manual coverage cron. Desk scope retired; /admin/desk/* and /admin/notes/* answer 410.
- Steps 3-4: faceted /incidents and /search (12 facets, sort, view, page size capped at 100, facet counts, canonical
  URL, descriptive title, .md/.json twins, ?format=csv), /incidents.csv; /countries, /countries/<iso2>, /continents,
  /continents/<slug>, /tactics, /tactics/<slug>, /compare, /eras, /eras/<decade>, /leaders, /leaders/<slug>,
  /coverage with RSS/Atom/JSON feeds. /news removed (301 to /coverage); "News Desk" gone from routes, nav, llms.txt,
  sitemaps, feeds, MCP. Sitemaps and llms.txt list the new views.
- Step 5: hourly cron `5 * * * *` (deploy.sh); manual run through `POST /admin/cron/coverage`: 319 items fetched,
  112 fresh, 40 scored by Jev, 13 shown (in_scope >= 0.80). 109 coverage rows stored (13 shown).
- Step 6: link-state badges removed from every template (states stay in .json); dead sources read "original page no
  longer resolves; archived copy"; new footer; /terms, /privacy, /sources-and-standards (placeholder "Text pending
  editorial review."), /methodology 301; MCP: search_incidents facets, get_country, get_tactic, compare,
  recent_coverage; latest_news removed; mcp-smoke.sh 14/14 live.
- v2 classification of the 23 v1 incidents via tools/v2-backfill.py: tactics (primary plus others) for 22, leader_slug
  for 17 (actors that exist), outcomes only where the record's own claims state them (Acosta reversed 2018-11-19,
  Hungary reversed 2026-06-30, Louisiana law reversed 2025-01-31, CNN 2026, AP, VOA ongoing, Gaza sustained).
  Wording without "foreign" framing: Gaza incident prose and title, claims 12 and 104 superseded (reason update,
  new ids 112, 113), glossary espionage-act, national-security-law-hong-kong, foreign-agent-law.
- Corrections (verification/perplexity-2026-09-22.md, items 1-4) applied as superseding claims with is_correction
  revisions (tools/apply-corrections-2026-09-22.py):
  1. AP exclusion 2025-02-16 -> 2025-02-11: claim 28 -> 108, source added s114 (VOA, 2025-02-12, "on Tuesday").
  2. Pentagon rules 2025-09-21 -> 2025-09-19: claim 32 -> 109, source added s115 (NPR, 2025-09-20, "confirmed to NPR
     Friday"). Note: The Guardian (2025-09-20) says the memo was "issued Thursday" (2025-09-18); 09-19 is the date the
     rules were made public.
  3. Louisiana HB173 2024-05-28 -> 2024-05-24: claim 48 -> 110, source added s116 (Louisiana Legislature bill history,
     primary document: "05/24 H Signed by the Governor. Becomes Act No. 259."; effective 2024-08-01). The v1 date came
     from WVUE's "signed into law Tuesday (May 28)".
  4. Jimmy Lai conviction: record already 2025-12-15; claim 82 value 2025-12-14 superseded by 111 (same HRW source).
- Step 7: tools/verify-v2.sh live: 27 pages x 3 formats, 10 facet views, 6 CSV, 13 feeds/sitemaps/discovery all 200;
  6 redirects 301; removed sitemaps 404; 190 rendered pages parsed with balanced tags. Public HTML grep: "News Desk" 0,
  "Blocks automatic" 0, "Live" only in the programme name "Jimmy Kimmel Live!", em dashes only inside verbatim quotes.

### TODO (v2)

1. "foreign" still appears in public HTML in: the Gaza incident slug (URLs; a slug change needs a rename path the
   admin API lacks), verbatim quotes and source titles, statutory names in quotation marks ("collusion with foreign
   forces", "foreign agent"), the glossary term name "Foreign agent law", the publisher Foreign Policy, the
   append-only /changes ledger reasons, and site prose on four incidents that reports what governments said or
   describes correspondents (Hong Kong/Lai, Turkiye, Hungary, Russia). Editorial pass needed.
2. about.md still narrates AI agents and "US first"; the editor's About, Sources and standards, Terms of use and
   Privacy texts are pending (Terms and Privacy: "Draft for legal review", keep that label in the worklog only).
3. RSF ranks: no country has one yet (Perplexity reported US 64th in 2026; confirm against RSF and set with
   `POST /admin/countries/US/press-freedom`).
4. Leaders missing (no actor yet): India (Modi), Israel (Netanyahu), Hong Kong (John Lee), Turkiye (Erdogan),
   Louisiana (Landry). Nixon enemies list has no tactic (no clean fit; editorial call). issue_of_the_day is empty on
   every incident; most outcomes are "unknown" until sourced.
5. Coverage: Google News answers most Worker fetches with 503 (Bing News carries the search load); country guesses are
   headline heuristics; the hourly scheduled run had not fired yet at hand-off (first due 23:05 UTC); check
   /admin/health coverage_last_run. Consider rotating feeds if the plan's subrequest limit bites (20 feeds + 20 Jev).
6. Jimmy Lai sentencing date (verification item 5: 2026-02-08 vs 2026-02-09) not applied; the Pentagon
   "struck down in March 2026" item is already covered by claim 35.
7. New sources s114-s116 are cited by claims but not yet listed in incident_sources (PUT /admin/incidents/<slug>/links
   replaces the whole list; do it with the full list). No link check or Wayback snapshot yet for them.
8. ops/newsdesk.py and the desk token files are now inert (410 / 401); remove them from the Mac schedule.
9. The v1 stylesheet still carries badge and desk-note rules; it is replaced when the chosen design lands in render.js.

## 2026-09-22, v2 content load (editorial-v2 pages, 23-incident rewrite, 105-incident research merge)

Live counts after this session (GET /admin/health): incidents 128 published (129 total incl. draft), actors 211,
outlets 58, journalists 22, cases 4, sources 326, claims 484 (476 current), glossary_terms 67. Target of 128
incidents met.

- Pages: about.md, corrections.md rewritten in place; sources-and-standards.md, terms.md, privacy.md added from
  editorial-v2. Footer text confirmed already matching editorial-v2/footer.md (render.js FOOTER_LINKS/footerHtml
  needed no change). "<!-- Draft for legal review -->" comment stripped from terms.md and privacy.md source before
  publish per instruction; **flag: Terms of use and Privacy are legal-review drafts, not final-reviewed copy** (this
  label intentionally does not appear on the live pages). gen-modules.py re-run, site deployed, all five pages
  verified live in HTML and .md.
- 23 v1 incidents + 4 cases: incidents-rewrite.json and cases-rewrite.json applied as new prose revisions plus v2
  fields (continent, tactic_primary, tactics, leader_slug, outcome, outcome_on, outcome_note, issue_of_the_day,
  granularity=anchor). actors-add.json and sources-add.json (s114-s148) loaded first; s114-s116 (already live from
  the prior corrections session) were skipped as duplicates, s117-s148 added new. s114/s115/s116 attached to their
  three incidents' full source lists via PUT .../links (closes TODO item 7 above).
  - Gaza slug rename: **not applied**. No admin endpoint renames a published incident's slug (confirmed against
    admin.js's route table); left the existing slug and prose in place per TODO item 1.
  - Jimmy Lai sentencing date correction (2026-02-08 -> 2026-02-09): **not applied**. No source in
    verification/perplexity-2026-09-22.md carries this specific correction, and no compliant replacement source
    (primary document, established news org, or press-freedom org) could be found and fetched (hrw.org 404,
    cnn.com blocked by robots.txt, chinadailyhk.com did not carry the article; Wikipedia confirms the date but is
    not an accepted source type here). Left unresolved rather than inventing a citation; TODO carried forward.
  - The 72 editor_notes in incidents-rewrite.json flagging additional possible claims/quotes were treated as notes,
    not instructions to add new claims (the task's own Input description called the existing claims "unchanged");
    no new claims were fabricated from them.
- 105 new incidents (research-v2/anchors-1900-1989.json, anchors-1990-2019.json, granular-2020-2026.json) merged,
  deduped (actors/outlets by slug), and loaded via the admin API: 0 failures, all published, idempotent re-run
  guard added (skip incidents already pub_state=published, since claim creation has no dedup). seed-check.py
  extended for v2 vocabulary (tactic taxonomy, outcome/granularity enums, leader_slug resolution, seed-side source
  kinds) and brought the merged seed to 0 errors from 617 initial findings; editorial-v2/lint.py run over all new
  prose, remaining violations fixed by rewording (never by inventing text) plus 3 new lint-rules.json exempt
  entries for genuine historical proper nouns ("Office of Censorship", "Departamento de Imprensa e Propaganda",
  "unlawful use of a computer"), synced to both site/content/lint-rules.json and editorial/lint-rules.json.
  - 3 evidence_quotes over the 300-char cap were trimmed to a verbatim contiguous substring of the original quote
    (never reworded or invented).
  - Invalid country codes SU (USSR) and CS (Czechoslovakia) remapped to RU and CZ respectively (incident and any
    actors/outlets sharing them), since the live countries table holds only the 250 current ISO codes.
  - Claim field names "what_happened"/"outcome" mapped to the allowed "action"/"status"; actor_role "adjudicated"
    mapped to "ruled" (both are format-only remaps to the DB's fixed vocab, not fact changes).
  - Linda Tirado and Annika Smethurst loaded with no outlet field: Tirado's source text says "freelance" (correct
    to leave unset); Smethurst's did not state an employer in the provided research, so none was invented (seed-
    check.py's outlet requirement for journalists was relaxed to match the admin API's actual required fields
    rather than fabricate one).
  - 11 incidents in the research files named a court case inline (e.g. "trump-v-dow-jones-2025") with no caption,
    court, docket or holding supplied; these case references were dropped rather than fabricating case records, so
    seed-v2/incidents.json matches what is actually linked live.
  - Merged seed copied to seed-v2/{incidents,cases,actors,outlets,journalists,sources,glossary}.json.
  - Glossary: 40 remaining seed/glossary.json entries plus editorial-v2/glosses.json inline-gloss terms (deduped by
    glossary_slug) loaded, bringing glossary_terms to 67 live.
- Verification: tools/verify-v2.sh run live (pass); /incidents.json count, /countries, /continents, /compare,
  /eras/<decade>, /tactics/<slug>, three new incident pages, and search "Espionage Act" (1917 and 2013 entries) all
  checked directly and confirmed non-empty/correct.
- ops/linkcheck.py --all: full pass completed today (due 326) with live 236, dead 19, bot_blocked 41, error 8,
  paywalled 10, redirected 12 (a later 300s re-run confirmed the same per-source results through source 326 but
  was killed by its own timeout before writing a second summary line; no data loss, see the jsonl log).
  GET /admin/health link_integrity: 308/326 ok, 26 archived, 0 dead, 18 unchecked, share 0.945.
- ops/wayback.py --all: **degraded, as flagged in the prior session**. Two earlier runs today (20:41, 20:55 UTC,
  before this session resumed) saved 20 and 21 pages respectively. Every run since (20:59 UTC onward, including a
  fresh ~11-minute attempt this session covering source ids 3 through the low 50s, all `Connection reset by peer`
  against web.archive.org's save endpoint) saved 0 and failed 100% of attempts; this matches the proxy-level
  tunnel-timeout failure class documented in /root/.ccr/README.md (the availability-check API on a different host
  works fine; only the slow Save-Page-Now endpoint resets). Combined total for 2026-09-22: 52 saved, 122 failed.
  Stopped this session's run manually after ~11 minutes of unbroken 100% failure rather than waiting out the full
  budget for no new information; TODO carried forward to retry when the archive.org save endpoint recovers.
- ops/indexnow.py --since-hours 6: pinged 984 URLs, HTTP 200.

### TODO (added 2026-09-22, this session)

10. Retry ops/wayback.py --all once web.archive.org's save endpoint stops resetting connections; 52 saved / 122
    failed today, all failures after 20:59 UTC.
11. Gaza incident slug still not renamed (no admin rename endpoint); add one, or do a manual slug-migration path
    (new record + 301 + redirect table), if the "foreign" framing in the URL needs to go.
12. Jimmy Lai sentencing date (2026-02-08 vs 2026-02-09) still unresolved; needs a primary-document or accepted-
    outlet source before it can be corrected.
13. 72 editor_notes in editorial-v2/incidents-rewrite.json propose additional claims/quotes not added this session
    (scope was prose + v2 fields only); review and load individually with real sources if wanted.
14. 11 research-v2 incidents referenced court cases with no case record data (caption/court/docket/holding); no
    case link was attached for these. Provide full case data to link them.
15. terms.md and privacy.md are legal-review drafts (the "Draft for legal review" marker was intentionally not put
    on the live pages, only recorded here); do not treat them as final until reviewed.

## 2026-09-22, v3 ladder reframe (lead implementer), per v3-ladder-brief-2026-09-22.md

Commits 05e5f65 (step 1) to the step 6 commit; details in site/NOTES.md "v3".

- Step 1: migration 0005 live (incidents.stage, ladder_note). `POST /admin/incidents/:slug/ladder` (set or append). Stage
  backfilled on all 128 incidents by tools/stage-backfill.py (tactic rule plus 45 reviewed overrides, 21 of which differ
  from the tactic rule): restrict 20, pressure 28, punish 40, silence 31, eliminate 9. United States rows reach punish
  and silence (VOA shutdown, Near v. Minnesota, Pentagon Papers injunction, 1917 mail bans); none reach eliminate.
- Step 2: RSF 2026 ranks for 45 countries (43 from verification/rsf-2026-ranks.json; El Salvador 143 and Czechia 11 read
  from rsf.org country pages because the record holds them and the file did not). US 64th confirmed on rsf.org.
- Steps 3-4: /ladders, /ladders/<tactic>, /united-states live in HTML, .md, .json and CSV; /compare 301; every
  per-country count ranking removed; caveat on the pages the brief names; nav "United States" and "Ladders";
  /countries/us links the chapter.
- Step 5: corrections from verification/perplexity-v2-2026-09-22.md. Applied (claim plus is_correction revision, source
  added and attached): #13 Tut.by 2021-05-19 -> 05-18 (CPJ); #14 Nicaragua 2023-02-16 -> 02-15 (Al Jazeera, already
  cited: "on Wednesday"); #12 NYT suit 2025-09-16 -> 09-15 (Clearinghouse docket, already cited; nytco.com gives no filing
  date); #10 FCC complaints 2025-01-29 -> 01-22 (U.S. Press Freedom Tracker, already cited; communicationsdaily.com
  unreachable, TLS name mismatch, paywalled); #11 CPB outcome 2025-07-18 -> 07-24 (Public Law 119-28, govinfo.gov);
  #9 Portland 2020-07-16 -> 07-23, occurred_on and outcome_on (ACLU of Oregon release of 2020-07-23; claim 331 refiled
  as a status claim for the police injunction); #7 Ecuador outcome 2018-07-24 -> 2019-02-20 (ARCOTEL citing Registro
  Oficial 432); #15 Slovakia outcome 2024-07-04 -> 07-01 (European Audiovisual Observatory, IRIS 2024-8:1/24); note:
  Smethurst outcome_note now says the seized material was not ordered returned or destroyed (ABC, already cited).
  Also brought the AP, Pentagon and Louisiana lead dates in line with the earlier corrections (the editorial-v2 rewrite
  had reintroduced the old dates).
- Step 6: MCP ladder and get_united_states_chapter live (mcp-smoke 18/18); llms.txt, sitemaps (pages plus 13 ladders),
  home copy; /timeline 500 fixed (D1 100-parameter limit). verify-v3.sh live: 0 failures; verify-v2.sh live: 0 failures;
  check-no-count-ranking.py: no findings on /, /countries, /continents (7 pages), /search (3 views), /incidents, /leaders,
  /ladders, /tactics, the chapter.

### TODO (v3)

1. Corrections not applied (reasons in tools/apply-corrections-v2-2026-09-22.py SKIPPED): #1 Grenada outcome_on (two
   candidate dates, no document address), #2 Haiti 1980-11-28 (amnesty.org, no address; RSF in the record says 1981),
   #3 and #4 South Africa 1950 act dates (wikisource not accepted; sabctrc.saha.org.za page not found), #5 Politkovskaya
   (no change needed; live record already correct), #6 Hungary 2010-12-20 (europarl, loc.gov refuse fetches), #8 Serbia
   outcome 2000-10 (state.gov archive returns an error page). Zimbabwe note not loaded (not an outcome field). Each needs a
   fetchable primary or journalistic source.
2. Stage choices to review editorially: criminal speech and secrets laws counted as punish even where no one was yet
   prosecuted (Pakistan PECA, Zimbabwe Patriotic Act, Hungary 2020, Russia 2022); licence requirements and public-media
   restructuring as pressure (AIPPA, Tanzania 2018, Slovakia, Poland); Germany 1933 and Spain 1938 as silence; HHS/CDC
   2020 as restrict; DOJ 2025 rescission as pressure. Change with POST /admin/incidents/:slug/ladder or in
   stage-backfill.py REVIEWED and re-run.
3. Ladder notes exist on 2 incidents only (Politkovskaya, Reuters Myanmar). Researchers should add them where a rung needs
   context, and set `stage` on every new incident (publish now refuses an incident without one; tools/load-seed.py does
   not send stage yet).
4. Comparator research from the brief not yet in the record: Azerbaijan, Cuba, Vietnam, Eritrea, North Korea, Uganda,
   Syria, Afghanistan, Algeria, Kazakhstan, Uzbekistan, Tajikistan (and Philippines Duterte era, Israel Al Jazeera law,
   Poland 2015-2023 beyond the 2015 law). Several ladders have few rungs above the US rows; the eliminate stage holds 8
   incidents in 8 countries.
5. RSF links point at rsf.org/en/index (the verification's source) for 43 countries; per-country RSF pages would be more
   precise. Russia's and Czechia's current ranks appear beside USSR (1922) and Czechoslovakia (1968) entries.
6. Wording artifacts from the earlier lint pass ("press press controls", "press controls of the press") in 9 fields of the
   Czechoslovakia 1968, Portugal 1933, Burma 1988 and India 1975 entries; editorial fix needed.
7. The stage backfill and corrections added about 140 record_revised rows to the public /changes ledger (batch labels
   v3-stage-backfill-2026-09-22 and corrections-v2-2026-09-22).
8. New sources 327 to 334 (RSF, CPJ, govinfo, ACLU of Oregon, ARCOTEL, IRIS Merlin) have no link check or Wayback snapshot.
9. Design pass: new classes are unstyled (rsf, rsf-rank, rsf-line, focal-case, counts-caveat, ladder-note,
   stage-definition); home "Latest incidents" cards do not show RSF ranks.

## 2026-09-23: v3 ladder content load, 62 comparator incidents (lead implementer)

Loaded research-v3/ladder-1.json and ladder-2.json (62 comparator incidents across 28 countries,
for the 13 tactics, per v3-ladder-brief-2026-09-22.md) into the live site. Commit: "v3 content: 62
ladder incidents".

**Before -> after (GET /admin/health):** incidents 128 published / 129 total -> 190 published / 191
total; actors 211 -> 243; outlets 58 -> 111; journalists 22 -> 79; cases 4 -> 4 (unchanged, no new
case data in the research); sources 334 -> 403; claims 494 (485 current) -> 698 (689 current);
glossary_terms 67 -> 67 (unchanged). link_integrity after a full ops/linkcheck.py --all: 403 total,
382 ok, 27 archived, 0 dead, 21 unchecked, share 0.948.

**Stage distribution, all 190 live incidents:** restrict 20, pressure 41, punish 60, silence 47,
eliminate 22. The 62 new incidents alone: pressure 13, punish 20, silence 16, eliminate 13 (none at
restrict, by design: every new incident is a comparator rung placed above a US instance). New
countries covered: Azerbaijan, Belarus, China, Egypt, Eritrea, Ethiopia, Hong Kong, Hungary, Israel,
India, Iran, Cambodia, North Korea, Kazakhstan, Morocco, Myanmar, Malta, Mexico, Nicaragua,
Philippines, Poland, Russia, Saudi Arabia, Thailand, Turkiye, Venezuela, Vietnam, Zimbabwe (28).
Every one of the 13 tactic ladders now shows comparator rungs at pressure stage or above from a
non-US state (checked live via /ladders/<tactic>.json): access_ban 8, credential_control 7,
outlet_licensing 26, prior_restraint 18, secrets_and_espionage_laws 11, insult_and_defamation_laws
14, surveillance_and_subpoenas 10, funding_and_ownership_pressure 20, expulsion_and_visa_denial 13,
shutdowns_and_blocking 17, detention_and_violence 32, lawsuits_against_press 5,
disinformation_labeling 11.

**1. load-seed.py gaps found and fixed (site/tools/load-seed.py).** The task named one known gap
(stage/ladder_note not sent); testing surfaced four more that would have silently produced wrong or
rejected records for any v2/v3-schema incident, not just this batch:
   - `stage`/`ladder_note` now sent, but only when the seed actually carries a value (never as an
     explicit null), so a re-run over a seed file that predates these fields, or a local copy never
     synced back from a live stage-backfill or correction pass, cannot blank out a live value.
   - The full v2 classification (`tactic_primary`, `leader_slug`, `outcome`, `outcome_on`,
     `outcome_note`, `granularity`, `issue_of_the_day`, and the `tactics` array) was not sent by
     load-seed.py at all before this session; a v2/v3 incident created through it would have every one
     of those fields null. Now sent via `POST /admin/incidents/<slug>/fields` right after the base
     record exists and before publish (publish requires `stage`), same conditional-on-present rule as
     above.
   - `incidents.type` is a legacy 10-value enum (access_ban, credential_revocation, ...); the v2/v3
     seed's `type` duplicates `tactic_primary` from the 13-tactic taxonomy instead, which is a
     different vocabulary and would fail the old enum for every tactic except access_ban. `type` is now
     sent only when it is actually one of the legacy values, left null otherwise (matching how the
     already-live 105-incident v2 batch has it: `type` null, `tactic_primary` set).
   - Incident claim `field` must be one of the DB's fixed allowlist (occurred_on, announced_by,
     action, stated_justification, effect_on_reporting, status, outlet_affected, journalist_affected,
     scope_of_action, reversed_on); the new research's claims use the incident's own prose field names
     instead (what_happened, outcome_note, issue_of_the_day, what_we_dont_know), causing 114 claim
     POSTs to fail with `not_in_allowlist` on the first load attempt. Added `CLAIM_FIELD_MAP`
     (what_happened -> action, outcome_note -> status, what_we_dont_know -> status, issue_of_the_day
     -> scope_of_action; stated_justification and effect_on_reporting were already valid and pass
     through), format-only remaps, not fact changes, matching the WORKLOG's own documented precedent
     for the original what_happened/outcome remap.
   - `outlets.kind` shorthand from the new research (digital_native, news_website, media_network,
     newspaper_group, media_conglomerate, news_agency) was not in `OUTLET_KIND`'s translation dict and
     would fail the DB's 9-value enum; added mappings to digital/broadcaster/newspaper/other/
     wire_service as appropriate.
   - `incidents.status` (the enum column, not the seed's free-text `status` narrative) had no formula
     for a slug outside the original 23-incident `INCIDENT_STATUS` override table and defaulted to
     "in_effect" unconditionally, which is wrong for a decades-old, long-closed comparator incident.
     Added `default_incident_status()`: a reversed/sustained/upheld matter from before 2020 is treated
     as historical; a reversed one from 2020 on as a recent reversal; anything else (ongoing/unknown,
     or no outcome at all) as still in effect. This is a documented approximation of an editorial
     judgment call the live data otherwise makes case by case (the "historical" and "in_effect"
     ranges of occurred_on years genuinely overlap, 1971 to 2019), not a researched fact; flagged for
     review below.
   - 57 new journalist records had no `role` (required by the admin API); assigned from the incident
     text that names them (e.g. "camera operator," "founding editor," "investigative journalist";
     generic "Journalist" only where the text gives no more specific title, e.g. Diana Okremova, Omar
     Abdulaziz), never invented beyond what the record states.

**2. Why the existing 128 incidents were not reprocessed.** seed-v2/incidents.json (the merged local
seed from the prior sessions) turned out to be a stale snapshot: it had no `stage` field at all (the
live stage-backfill pass never wrote back to it), and several `occurred_on` dates still held their
pre-correction values (e.g. the AP exclusion's local copy read 2025-02-16 against the live, corrected
2025-02-11; Pentagon rules 2025-09-21 against live 2025-09-19; Louisiana HB173 2024-05-28 against live
2024-05-24). load-seed.py's incident loop re-PUTs every incident in its seed file's `incidents.json`
on every run, including `occurred_on` unconditionally; running it over the full 190-incident merged
file would have reverted those three live corrections (and blanked `stage`, before the fix above).
To avoid this, the 62 new incidents were loaded from a separate seed directory containing only the new
incidents plus the actors, outlets, journalists and sources they reference (existing ones reused by
slug, new ones added), never the existing 128. `stage`/`ladder_note` were separately backfilled
read-only from live into the canonical seed-v2/incidents.json (a local-file hygiene fix only, no live
write) so seed-check.py's new stage requirement does not flag the pre-existing 128. The `occurred_on`
staleness is a pre-existing condition of the local seed file, not touched by this session; flagged
below as a TODO, since it means load-seed.py is not actually safe to re-run over the full existing
seed until that file is refreshed from live or the loader is changed to never blindly resend
`occurred_on`-class fields for a record that already exists.

**3. Merge (seed-v2/{sources,actors,outlets,journalists,incidents}.json).** Deduped sources by URL
(69 unique of 73 raw entries: 4 were the same CPJ articles cited in both ladder-1.json and
ladder-2.json, e.g. the Poczobut sentencing and release, the Russia-Ukraine CPJ tracker, the Kabas
retrial; source ids remapped, not duplicated); checked against the live 334-source /admin/sources
list first, no collisions. Actors, outlets and journalists deduped by slug against the existing
corpus and against each other (e.g. Erdogan, Putin, Orban, Xi, Lukashenko, El-Sisi and Duterte are
already actors; Maria Ressa, Jimmy Lai, Andrzej Poczobut and others are shared between the two ladder
files or already journalists); the existing or first-seen record is kept. All 62 incident slugs are
year-prefixed and none collided with the existing 128. seed-check.py extended with the `incident.stage`
enum and a required-field check (see below); the full 190-incident merged corpus now checks at 0
errors. editorial-v2/lint.py: incidents/actors/outlets/journalists/cases/glossary all report clean
except the same 4 pre-existing, documented glossary self-reference warnings (gag-order, chilling-
effect) noted in the prior session; lint.py's own JSON_FIELDS scope does not include ladder_note or
source titles, so its sources.json run is not meaningful (source titles are the outlet's own
headlines, already excluded from linting by seed-check.py's documented policy) and its incidents.json
run initially missed the ladder_note voice-lint failures the live admin API caught on the first load
attempt (see below); this is a real gap in lint.py's field coverage, not fixed this session (it did
not block anything, since the admin API's own lint is authoritative and caught what it missed).

**4. ops/seed-check.py extended for stage.** Added `incident.stage` to SPEC_ENUMS and a
`field_missing` check (stage is required to publish, per the v3 brief), matching the treatment of
`outcome`/`granularity`. Also extended `SEED_SIDE_VOCAB["outlet.kind"]` with the six new outlet-kind
shorthand values above, so they report as translated shorthand warnings, not hard errors.

**5. "Press press controls" artifact.** Found across 7 incidents, not the 4 the prior worklog TODO
named (Czechoslovakia 1968, Portugal 1933, Burma 1988, India 1975 were listed; Spain 1938, Poland
1981 and South Korea 1980 had the same bug and were missed): 17 field instances of "press press
controls" or "press controls of the press" (a doubled word left by an earlier lint pass that replaced
"censorship" with "press controls" next to a sentence that already had "press" adjacent). Fixed by
posting corrected text through the admin API (`PUT /admin/records/incident/<slug>` with only the
changed field(s), reason and batch_label "v3-ladder-artifact-fix-2026-09-22"), letting every other
column (stage, tactic_primary, dates, {c:ID} citation markers already embedded in the live text)
fall through untouched from the existing record, confirmed live afterward. Checked all 190 live
incidents' own prose fields (title, summary, what_happened, stated_justification,
effect_on_reporting, status, what_we_dont_know, outcome_note, issue_of_the_day, ladder_note) for any
other immediately-repeated word: none found (the one apparent case, "it had had its fun" in a 2013 UK
Miranda-detention claim statement, is correct past-perfect grammar reporting the quote "You've had
your fun," not a duplication bug, and claim statements were not in scope for this check anyway).

**6. Verification.** All 13 `/ladders/<tactic>` pages checked live (counts above). Three random new
incident pages (2019-india-revokes-taseer-oci-status, 2024-kazakhstan-restrictive-media-accreditation-
rules, 2022-russia-bars-entry-foreign-journalists) confirmed live in HTML, .md and .json with correct
stage, tactic_primary and claims.

**7. ops runs.** `ops/linkcheck.py --all` needed `POST /admin/export` first (its --all mode reads the
public Frictionless export, which was still yesterday's 326-source snapshot); after refreshing the
export: 403 due, live 309, paywalled 10, bot_blocked 41, dead 21, redirected 12, error 10.
`ops/wayback.py --all --limit 150 --max-failures 10`: stopped after exactly 10 consecutive
`Connection reset by peer` failures against web.archive.org's save endpoint, 0 saved, matching the
degradation documented in the prior two sessions; archive.org's save endpoint has not recovered.
`ops/indexnow.py --since-hours 8`: pinged 1402 URLs, HTTP 200.

**What could not be loaded.** All 62 new incidents published; nothing was dropped. No new cases were
added (none of the 62 incidents named a linkable case with full case data, matching the established
policy from the prior session of not fabricating case records for a bare inline mention). No new
glossary terms (none in this research pass).

### TODO (added 2026-09-23)

16. seed-v2/incidents.json's `occurred_on` (and likely other base fields) for the original 128
    incidents are stale against three live corrections applied directly through the admin API in the
    prior v3 session (AP exclusion, Pentagon rules, Louisiana HB173 lead dates); do not re-run
    load-seed.py over the full merged seed until this file is refreshed from live, or change the
    loader to fetch and diff against the live record before resending base fields for anything that
    already exists.
17. `default_incident_status()` (load-seed.py) is a heuristic (year plus outcome), not a researched
    fact, for the 62 new incidents' `status` enum; the live "historical" vs "in_effect" split for
    existing incidents does not follow a clean formula (it depends on whether the specific measure,
    not just the era, is still in force). Spot-check the 62 new incidents' `status` values editorially.
18. lint.py's JSON_FIELDS does not include `ladder_note`, and its sources.json handling only exempts a
    file literally named "sources-add.json"; extend both if lint.py is meant to catch what the live
    admin API's own lint enforces before publish, rather than after a failed load attempt.
19. Comparator research from the v3 brief still not in the record: Cuba, Uganda, Syria, Afghanistan
    (Taliban), Algeria, Uzbekistan, Tajikistan, Israel's Al Jazeera law specifically (the 2018 Gaza
    press-ordinance incident is recorded; the 2024 Al Jazeera law is not), and Poland 2015-2023 beyond
    the already-recorded 2015 and 2021 incidents. This session added Azerbaijan, Vietnam, Eritrea,
    North Korea, Kazakhstan and the Philippines' Duterte era, which the prior session's TODO had also
    listed as missing.
20. Seven pre-existing outlets had a `kind` value in seed-v2/outlets.json ("publisher") that the live
    records do not use; fixed locally to match live (new-york-times and novaya-gazeta: newspaper;
    washington-post, wikileaks, the-guardian, cambodia-daily, harakah: other) so a future load-seed.py
    run does not fail validation on any of them.
21. New sources from this session (69 of them) have no Wayback snapshot beyond the 10-failure batch
    already attempted; retry ops/wayback.py once web.archive.org's save endpoint recovers.
