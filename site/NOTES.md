# The War On News (thewaronnews.com), Crank #3: Worker notes

## v2 (2026-09-22, brief v2-brief-2026-09-22.md)

- Migration `0004_v2.sql`: `tactics` (13, seeded), `countries` (250: ISO 3166-1 plus XK, continent slug, UN M49
  sub-region, RSF rank columns; list in `tools/data/countries.txt`), `incident_tactics`, `coverage_items`;
  `incidents` rebuilt (level = national | state_or_province | municipal | supranational; `type` optional; new
  continent, tactic_primary, leader_slug, issue_of_the_day, outcome/outcome_on/outcome_note, granularity; `era` is a
  VIRTUAL generated column). The rebuild keeps every statement FK-consistent on its own (children copied aside,
  emptied, parent rebuilt, children restored) because deploy.sh sends one statement per D1 call and deferred FKs do
  not survive a parent DROP. Events de-duplicated in the same pass (12 -> 6 CNN rows) and
  `UNIQUE (incident_id, occurred_on, kind, label)`; `POST /admin/events` is now idempotent on that key.
- Pre-migration backup of every table: `dump.py` in the session scratchpad produced `prod-pre-v2.sqlite` (D1's export
  API refuses databases with FTS5 tables). Time-travel bookmark before 0004:
  `00000009-00000000-000050ee-6cfe64e7e68e04e2ca55111eac6da066`.
- Scopes: triage, publish, operator. Desk tokens are no longer accepted; `/admin/desk/*` and `/admin/notes/*` answer
  410; `newsdesk.js` removed (the `news_desk_notes` table is kept).
- New admin endpoints: `GET /admin/sources` (limit/offset/link_state), `GET /admin/events?incident=|case=`,
  `DELETE /admin/events/:id` (operator), `POST /admin/incidents/:slug/fields` (v2 fields, revision appended),
  `PUT /admin/incidents/:slug/tactics` {primary, tactics[], reason}, `GET /admin/tactics`, `PUT /admin/tactics/:slug`,
  `GET /admin/countries`, `POST /admin/countries/:iso2/press-freedom` {rank, year, source_url, source_id?},
  `GET /admin/coverage?state=`, `POST /admin/coverage/:id` {state, reason | incident_slug (publish) | tactic_guess |
  country_guess}, `GET|PUT /admin/coverage/feeds` (KV `coverage:feeds`), `POST /admin/cron/coverage` {max_new,
  dry_run} (operator; runs the hourly job now), `POST /admin/search/rebuild` (operator).
- Modules: `search.js` (facet parsing, canonical query, one incident query for every list view, CSV, FTS over incident,
  actor, outlet, journalist, case, glossary_term, tactic, country, coverage_item), `v2routes.js` (faceted /incidents
  and /search, /countries, /countries/<iso2>, /continents, /continents/<slug>, /tactics, /tactics/<slug>, /compare,
  /eras, /eras/<decade>s, /leaders, /leaders/<slug>, /coverage), `coverage.js` (hourly job).
- Facets on /incidents, /search and search_incidents: country (comma list), continent, tactic, from, to (year or
  date), level, actor, leader, outlet, outcome, source_kind, has_case; plus q, sort (date, date_asc, country, tactic,
  relevance), per_page (max 100), page, view (table | cards). Canonical query order is fixed; the canonical link and
  the .md/.json alternates carry it. `?format=csv` on every list view; `/incidents.csv` for the full set.
- Redirects (301): /methodology -> /sources-and-standards; /news, /news/page/N -> /coverage; /news/{feed.xml,atom.xml,
  feed.json} -> /coverage/...; /countries/US -> /countries/us; /tactics/access-ban -> /tactics/access_ban;
  /eras/1970 -> /eras/1970s. /sitemaps/news.xml and news-google.xml are gone (404).
- Policy pages come from `content/<slug>.md` through `tools/gen-modules.py`; a slug without a file (terms, privacy,
  sources-and-standards today) is served as its title plus "Text pending editorial review." Drop the editor's file in
  `content/` and re-run deploy.sh to swap it in.
- Crons: `17 7 * * *` nightly (unchanged) and `5 * * * *` recent coverage; `scheduled()` dispatches on event.cron.
  Coverage: 20 feeds from KV (10 organisations from ops/desk/feeds.yaml, 5 Google News searches, 5 Bing News
  searches; Google News answers most Worker fetches with 503, Bing works), items older than 14 days skipped, canonical
  URL (tracking parameters, fragment) plus title-similarity (Jaccard >= 0.8) dedupe, keyword screen, Jev demo
  (`simple-jev-demo-api.featherless.ai`, browser User-Agent, 1,800-character state; paid endpoint when the Worker
  secret JEV_API_KEY exists) for in_scope and tactic, 4 calls in parallel, at most 20 per hourly run; shown when
  in_scope >= 0.80; country guessed from the earliest country name in the headline; unattached items pruned after 60
  days. Em dashes in feed headlines and summaries are replaced (": " and ", ").
- Tools: `tools/verify-v2.sh` (all v2 routes in three formats, facets, CSV, feeds, redirects), `tools/mcp-smoke.sh`
  (11 tools), `tools/v2-backfill.py` (tactics, leaders, outcomes for the 23 v1 incidents, wording),
  `tools/apply-corrections-2026-09-22.py`, `tools/local-harness.mjs` (now `DB_FILE=` runs on a copy of real data).

Built and deployed 2026-09-22 from `twon-data-and-record-spec.md` v1.0 on top of
a copy of Crank #2's Worker. Everything below was checked against the live site
or the Cloudflare API on 2026-09-22.

## Cloudflare resources (all twon-*; no rsbm-* resource or other zone touched)

- Account `d5e354491bbe47fa55bc0e5806d877e8`, zone `6aaa2d7d209d3e933784618e63a847a2` (thewaronnews.com)
- Worker script: `twon-site` (26 ES modules, compatibility date 2026-09-01)
- D1: `twon-db`, uuid `f20bd66f-9fef-4d47-8e87-06057e00653b` (migrations 0001, 0002, 0003 applied)
- KV: `twon-kv`, id `82f442821f2746b399181af694a41845`
- R2: `twon-exports` (binding `EXPORTS`; `latest/` and `data/YYYY-MM-DD/` written by the export)
- Custom domains: `thewaronnews.com`, `www.thewaronnews.com` (www answers 301 to apex in the Worker)
- Cron: `17 7 * * *` UTC (rollup of `requests`, bot IP-list refresh, export)
- Secrets: `SALT_SECRET` (generated by deploy.sh, never printed), `ADMIN_TOKEN` (operator scope, set by
  tools/issue-scoped-admin-tokens.sh). `GITHUB_TOKEN` not set (empty in secrets.env): the export writes R2 and
  records "GitHub skipped" in `exports.note`. Set it, re-run deploy.sh, then POST /admin/export.
- Vars: `SITE_ORIGIN`, `GITHUB_ORG`, `GITHUB_REPO`, `DATA_REPO`, `INDEXNOW_KEY`, `GA4_MEASUREMENT_ID` (empty: no analytics tag)
- Zone settings: always_use_https on, ssl full, browser_check off, email_obfuscation off,
  automatic_https_rewrites off, server_side_exclude off. MX/SPF/TXT records untouched.

## Admin tokens (values never printed)

`/home/claude/.twon/admin-token-{triage,desk,publish,operator}.txt` (mode 600) and the same four files in
`/mnt/user-data/outputs/twon-tokens/` (that mount reports mode 644 regardless of chmod). Scoped tokens are
stored in KV only as `admin-token:<sha256>`; rotate one with `tools/issue-scoped-admin-tokens.sh <scope>`.

## Layout

- `migrations/0001_init.sql` spec 2.3 verbatim (35 tables with FTS, 5 append-only triggers);
  `0002_seed_bots.sql` (13 Crank #2 crawler patterns plus Meta x3, Bytespider, Amazonbot, CCBot,
  DuckAssistBot, Feedly, Inoreader, NewsBlur, Feedbin); `0003_search_fts.sql`.
- `tools/split-sql.py`: statement splitter used by deploy.sh; keeps `CREATE TRIGGER ... END;` whole, strips
  `--` and `/* */` comments (the Crank #2 splitter would have broken on the inline `--` in 0001).
- `content/`: about, methodology, corrections, editorial-policy (from editorial/), lint-rules.json,
  site.css plus site-extra.css (link-state badges the base sheet lacks, meta block, footer, forms).
  `tools/gen-modules.py` turns them into `src/content.js`, `src/lint.js`, `src/css.js` (run by deploy.sh).
- `src/`: index (router, twins, R2 files, redirects), negotiate (kept), render (chrome, meta block,
  `{c:ID}` footnotes, WebMCP read tools), routes (all public pages), records (validated upsert, revisions,
  publish, withdraw, joins, claims, supersession, events), admin (4 scopes, spec 8 endpoints), linkstate
  (sources, checks with 3-failures-over-48-hours hysteresis, Wayback), newsdesk (notes, server gates G4 G5
  G6 G8, 12/day cap, pause), timeline, feeds (RSS, Atom, JSON Feed, changes.xml), sitemaps (index plus 5
  children with lastmod), jsonld, mcp (8 tools), export (Frictionless Data Package), cron, discovery
  (robots, llms.txt, llms-full.txt, agent card), logger/ipmatch (instrument, twon-* UAs skipped),
  github (skips cleanly when unset), indexnow (operator-only manual ping; routine pings run from the Mac).
- Dropped: compare.js, fields.js, recipes.js, the Crank #2 og image, every crawler-specific tool.
- `tools/`: deploy helpers above, `load-seed.py`, `issue-scoped-admin-tokens.sh`, `issue-mcp-token.sh`,
  `mcp-smoke.sh`, `verify-all.sh`, `local-harness.mjs` (runs the Worker under Node 22 with node:sqlite, KV
  and R2 shims for testing before a deploy; local tokens `local-publish` etc.).

## Interpretations where the spec was silent or the seed did not fit

- `{c:ID}` rule: PUT validates every reference (current, on this record or a linked one) and, once a record
  is published, requires a reference in every prose paragraph. Publish enforces both, plus at least one
  current claim (incident: its own; case: its own or a linked incident's). Drafts may be stored without
  references, since claims need the record to exist first.
- Voice lint (lint-rules.json) runs on records' prose, titles and unknowns, on event labels and on News
  Desk notes (G6, G8). Text inside double quotes and blockquotes is exempt; a glossary term may use its
  own name. Claim statements get only the em dash check (they are not linted by the spec).
- Incident slugs are prefixed with the year (spec 2.1): `2026-white-house-bans-cnn-msnow-politico`.
- Seed mappings: incident and case status enums were set per seed status line (table in load-seed.py);
  the free-text status line is kept as the last paragraph of `what_happened` (cases: first sentence of the
  status line, appended to `holding`). Seed jurisdiction text mapped to US, US-LA, US-FL or the country
  code. Actor roles per incident are not in the seed: courts `ruled`, legislatures `legislated`, all others
  `other`. Claims: method from the source kind, `verified_at` = the seed's accessed_on, confidence medium.
  The one mechanical text change: a pair of ` -- ` dashes outside quotations became a pair of commas.
- Sherrill v. Knight: the seed's `decided_on` 1977-01-01 is a year-only value; stored as null with
  `reporter_citation` 569 F.2d 124 (D.C. Cir. 1977).
- Home alternates are `/index.md` and `/index.json`. Twins of withdrawn records and reverted notes answer
  410 with title, dates, reason and a link to /corrections. `/incidents/<slug>/revisions` and
  `/cases/<slug>/revisions` list revision numbers, dates and reasons.
- The one em dash on public pages is inside a verbatim evidence quote (claim on
  2025-whca-loses-control-of-press-pool, from the WHCA statement); quotes are never altered.

## Verification (live, 2026-09-22, UA twon-verify/1.0, tools/verify-all.sh; INDEXNOW key redacted)

```
== pages in three formats ==
200  /                                                text/html; charset=utf-8                     9897
200  /index.md                                        text/markdown; charset=utf-8                 3519
200  /index.json                                      application/json; charset=utf-8              2480
200  /incidents                                       text/html; charset=utf-8                     7702
200  /incidents.md                                    text/markdown; charset=utf-8                 2201
200  /incidents.json                                  application/json; charset=utf-8              6979
200  /incidents/2026-white-house-bans-cnn-msnow-politico text/html; charset=utf-8                    19527
200  /incidents/2026-white-house-bans-cnn-msnow-politico.md text/markdown; charset=utf-8                 7324
200  /incidents/2026-white-house-bans-cnn-msnow-politico.json application/json; charset=utf-8             14597
200  /actors                                          text/html; charset=utf-8                    10605
200  /actors.md                                       text/markdown; charset=utf-8                 5503
200  /actors.json                                     application/json; charset=utf-8             14843
200  /actors/donald-trump                             text/html; charset=utf-8                     6071
200  /actors/donald-trump.md                          text/markdown; charset=utf-8                  959
200  /actors/donald-trump.json                        application/json; charset=utf-8              2317
200  /outlets                                         text/html; charset=utf-8                     6718
200  /outlets.md                                      text/markdown; charset=utf-8                 1990
200  /outlets.json                                    application/json; charset=utf-8              5865
200  /outlets/cnn                                     text/html; charset=utf-8                     5702
200  /outlets/cnn.md                                  text/markdown; charset=utf-8                  715
200  /outlets/cnn.json                                application/json; charset=utf-8              1423
200  /journalists                                     text/html; charset=utf-8                     5492
200  /journalists.md                                  text/markdown; charset=utf-8                 1055
200  /journalists.json                                application/json; charset=utf-8              2290
200  /cases                                           text/html; charset=utf-8                     4805
200  /cases.md                                        text/markdown; charset=utf-8                  372
200  /cases.json                                      application/json; charset=utf-8               134
200  /timeline                                        text/html; charset=utf-8                     6948
200  /timeline.md                                     text/markdown; charset=utf-8                 1652
200  /timeline.json                                   application/json; charset=utf-8              2192
200  /timeline/2025                                   text/html; charset=utf-8                     6575
200  /timeline/2025.md                                text/markdown; charset=utf-8                 1211
200  /timeline/2025.json                              application/json; charset=utf-8              1590
200  /timeline/actor/donald-trump                     text/html; charset=utf-8                     6214
200  /timeline/actor/donald-trump.md                  text/markdown; charset=utf-8                  804
200  /timeline/actor/donald-trump.json                application/json; charset=utf-8              1006
200  /timeline/type/access_ban                        text/html; charset=utf-8                     6171
200  /timeline/type/access_ban.md                     text/markdown; charset=utf-8                  820
200  /timeline/type/access_ban.json                   application/json; charset=utf-8              1021
200  /timeline/country/us                             text/html; charset=utf-8                     6939
200  /timeline/country/us.md                          text/markdown; charset=utf-8                 1427
200  /timeline/country/us.json                        application/json; charset=utf-8              1884
200  /news                                            text/html; charset=utf-8                     4891
200  /news.md                                         text/markdown; charset=utf-8                  507
200  /news.json                                       application/json; charset=utf-8                58
200  /glossary                                        text/html; charset=utf-8                    17324
200  /glossary.md                                     text/markdown; charset=utf-8                 9414
200  /glossary.json                                   application/json; charset=utf-8             13184
200  /glossary/hard-pass                              text/html; charset=utf-8                     7137
200  /glossary/hard-pass.md                           text/markdown; charset=utf-8                 1053
200  /glossary/hard-pass.json                         application/json; charset=utf-8              2219
200  /claims/1                                        text/html; charset=utf-8                     6237
200  /claims/1.md                                     text/markdown; charset=utf-8                 1022
200  /claims/1.json                                   application/json; charset=utf-8              1364
200  /sources/1                                       text/html; charset=utf-8                     5848
200  /sources/1.md                                    text/markdown; charset=utf-8                 1046
200  /sources/1.json                                  application/json; charset=utf-8              1319
200  /changes                                         text/html; charset=utf-8                    20296
200  /changes.md                                      text/markdown; charset=utf-8                13935
200  /changes.json                                    application/json; charset=utf-8             42485
200  /corrections                                     text/html; charset=utf-8                     7686
200  /corrections.md                                  text/markdown; charset=utf-8                 2560
200  /corrections.json                                application/json; charset=utf-8              2460
200  /corrections/log                                 text/html; charset=utf-8                     4706
200  /corrections/log.md                              text/markdown; charset=utf-8                  249
200  /corrections/log.json                            application/json; charset=utf-8                39
200  /about                                           text/html; charset=utf-8                     8062
200  /about.md                                        text/markdown; charset=utf-8                 3039
200  /about.json                                      application/json; charset=utf-8              3176
200  /methodology                                     text/html; charset=utf-8                     9620
200  /methodology.md                                  text/markdown; charset=utf-8                 4817
200  /methodology.json                                application/json; charset=utf-8              5012
200  /editorial-policy                                text/html; charset=utf-8                     8799
200  /editorial-policy.md                             text/markdown; charset=utf-8                 3908
200  /editorial-policy.json                           application/json; charset=utf-8              4137
200  /data                                            text/html; charset=utf-8                    10957
200  /data.md                                         text/markdown; charset=utf-8                 4903
200  /data.json                                       application/json; charset=utf-8              1135
200  /feeds                                           text/html; charset=utf-8                     5384
200  /feeds.md                                        text/markdown; charset=utf-8                  987
200  /feeds.json                                      application/json; charset=utf-8               993
200  /mcp                                             text/html; charset=utf-8                     6908
200  /mcp.md                                          text/markdown; charset=utf-8                 2144
200  /mcp.json                                        application/json; charset=utf-8              6398
200  /search                                          text/html; charset=utf-8                     4455
200  /search.md                                       text/markdown; charset=utf-8                  135
200  /search.json                                     application/json; charset=utf-8                44
== discovery, feeds, sitemaps, assets ==
200  /robots.txt                                      text/plain; charset=utf-8                     651
200  /llms.txt                                        text/plain; charset=utf-8                    2270
200  /llms-full.txt                                   text/plain; charset=utf-8                   31472
200  /sitemap.xml                                     application/xml; charset=utf-8                620
200  /sitemaps/pages.xml                              application/xml; charset=utf-8               1314
200  /sitemaps/incidents.xml                          application/xml; charset=utf-8              10627
200  /sitemaps/news.xml                               application/xml; charset=utf-8                111
200  /sitemaps/news-google.xml                        application/xml; charset=utf-8                171
200  /sitemaps/machine.xml                            application/xml; charset=utf-8              25795
200  /assets/site.css                                 text/css; charset=utf-8                     22623
200  /changes.xml                                     application/atom+xml; charset=utf-8         40241
200  /news/feed.xml                                   application/rss+xml; charset=utf-8            631
200  /news/atom.xml                                   application/atom+xml; charset=utf-8           682
200  /news/feed.json                                  application/feed+json; charset=utf-8          521
200  /incidents/feed.xml                              application/rss+xml; charset=utf-8           4995
200  /incidents/atom.xml                              application/atom+xml; charset=utf-8          5683
200  /incidents/feed.json                             application/feed+json; charset=utf-8         5070
200  /data/datapackage.json                           application/json; charset=utf-8             58582
200  /data/data/incidents.csv                         text/csv; charset=utf-8                     14224
200  /data/json/incidents.json                        application/json; charset=utf-8             17852
200  /.well-known/mcp/server.json                     application/json; charset=utf-8               445
200  /.well-known/agent.json                          application/json; charset=utf-8              3212
200  /<INDEXNOW_KEY>.txt            text/plain; charset=utf-8                      32
== negotiation ==
200  Accept: text/markdown                            text/markdown; charset=utf-8                     
200  Accept: application/json                         application/json; charset=utf-8                  
== Link header on incident page ==
link: <https://thewaronnews.com/incidents/2026-white-house-bans-cnn-msnow-politico.md>; rel="alternate"; type="text/markdown", <https://thewaronnews.com/incidents/2026-white-house-bans-cnn-msnow-politico.json>; rel="alternate"; type="application/json", <https://thewaronnews.com/incidents/2026-white-house-bans-cnn-msnow-politico>; rel="canonical"; type="text/html", </mcp>; rel="service", </.well-known/agent.json>; rel="service-desc", </sitemaps/machine.xml>; rel="sitemap"
== redirects ==
301  https://www -> https://thewaronnews.com/about                                                     
301  http:// -> https://thewaronnews.com/                                                              
== 404 and 405 ==
404  /nope                                            text/html; charset=utf-8                     4477
404  /nope.json                                       application/json; charset=utf-8                45
failures: 0
```

MCP (tools/mcp-smoke.sh against https://thewaronnews.com/mcp):

```
PASS initialize
PASS tools/list has 8 tools
PASS search_incidents
PASS get_incident
PASS get_timeline
PASS get_actor
FAIL get_case (published case): {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"No published case has the slug \"cnn-msnow-politico-v-trump-2026\"."}],"structuredContent":{"found":false},"isError":false}}
PASS latest_news
PASS get_sources_for
PASS suggest_correction without token fails
passed=9 failed=1
```

get_case fails only because no case is published yet (see WORKLOG TODO).

Other live checks: `UPDATE claims SET statement` and `DELETE FROM claims` on live D1 both fail with the
trigger messages; a triage token got 403 on POST /admin/desk/notes and a desk token 403 on POST
/admin/claims, both logged in admin_denials; /admin/health link integrity 99/99 (seed link check posted as
source_checks; no Wayback snapshots yet). Export 1: datapackage 2026.09.22, 22 resources, GitHub skipped.
