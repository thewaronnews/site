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
