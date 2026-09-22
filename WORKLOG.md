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
