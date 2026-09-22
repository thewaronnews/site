# Crank #2 (rattlesnakesbymail.com) — P0.1 scaffold notes

Built and deployed 2026-09-13. Everything below was verified by an actual
request against the live site or a direct Cloudflare API query, not assumed.

## Cloudflare resource ids (all prefixed rsbm-, all new, no other zone/worker
## in the account was touched)

- Worker script: `rsbm-site`
- D1 database: `rsbm-db`, uuid `92b99e81-233c-4c97-b787-d8eb71ef876d`
- KV namespace: `rsbm-kv`, id `ddd5bca91fea466db31d11aea6e781c1`
- R2 bucket: `rsbm-exports` (created, not yet used by any code path; it is
  the binding `EXPORTS` for the section-9 GitHub/R2 export phase)
- Custom domains attached to the worker: `rattlesnakesbymail.com`,
  `www.rattlesnakesbymail.com` (production environment)
- Cron: `17 3 * * *` (nightly, 03:17 UTC) confirmed via
  `GET /workers/scripts/rsbm-site/schedules`
- Secret: `SALT_SECRET`, a 32-byte random hex string generated with
  `openssl rand -hex 32` and set via
  `PUT /accounts/{account}/workers/scripts/rsbm-site/secrets`. Never printed
  or written to any file; only Cloudflare holds the value. If it needs
  rotating, delete the secret via the dashboard/API and re-run deploy.sh,
  which will detect it is missing and generate a new one.
- Zone settings changed on this zone only: `always_use_https=on`,
  `ssl=full` (confirmed via `GET /zones/{zone}/settings/...`)

## Repo layout (/home/claude/crank2-site/)

- `migrations/0001_init.sql` — full schema (spec section 3): entities,
  claims, changes, observations, observation_daily, questions, notes,
  exports, mcp_calls, plus a `migrations` bookkeeping table.
- `migrations/0002_seed_entities.sql` — 15 entity identity rows for the big
  six vendors (OpenAI x4, Anthropic x3, Perplexity x2, Google x3,
  Microsoft x1, Apple x2). No claims, no prose beyond a short factual
  `notes` field per entity, per the task's scope.
- `src/*.js` — the Worker, plain ES modules, no bundler, no dependencies.
  `index.js` is the entry point (`fetch` + `scheduled`); `routes.js` holds
  page handlers; `render.js` is the HTML/Markdown templating over a small
  generic doc model; `db.js` wraps D1; `logger.js` is the observation
  instrument; `ipmatch.js` is a hand-rolled CIDR matcher (v4 + v6);
  `negotiate.js` resolves format from path suffix or Accept header;
  `cron.js` is the nightly job; `util.js` has small shared helpers.
- `deploy.sh` — idempotent: creates the four Cloudflare resources if
  missing, applies any unapplied migration file (tracked in the
  `migrations` table, statements split respecting quoted strings so
  semicolons inside prose don't break it), uploads the worker (all `src/*.js`
  files as separate ES modules referenced from `index.js`), sets
  `SALT_SECRET` only if not already set, attaches both domains, sets the
  cron schedule, sets the two zone settings. Safe to re-run; a second run
  during verification skipped both migrations and the secret and only
  re-uploaded the script and re-applied domain/cron/zone settings (all of
  which are themselves idempotent PUT/PATCH calls).

## Seed data sources (fetched and cross-checked 2026-09-13)

- OpenAI: https://platform.openai.com/docs/bots (redirects to
  developers.openai.com/api/docs/bots). IP lists verified live:
  https://openai.com/gptbot.json, /searchbot.json, /chatgpt-user.json,
  /adsbot.json (all HTTP 200, valid JSON, `prefixes` array).
- Anthropic: https://support.claude.com/en/articles/8896518-does-anthropic-crawl-content-from-the-web-and-how-can-site-owners-block-the-crawler.
  IP list https://claude.com/crawling/bots.json verified live (200).
  ClaudeBot, Claude-SearchBot and Claude-User all share this one list.
- Perplexity: https://docs.perplexity.ai/docs/resources/perplexity-crawlers.
  IP lists https://www.perplexity.ai/perplexitybot.json and
  /perplexity-user.json verified live (200; the perplexity.com versions
  302-redirect to these).
- Google: https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
  and .../google-special-case-crawlers (both 200). Googlebot and
  GoogleOther share the common-crawlers IP list, verified live at
  https://developers.google.com/static/crawling/ipranges/common-crawlers.json
  (redirected from the older /search/apis/ipranges/googlebot.json path,
  which still 301s there). Google-Extended is documented on the same page
  as a robots.txt token with no separate user agent string and no IP list
  of its own: seeded as kind=policy_token with ua_token, ua_pattern and
  ip_list_url all NULL, per the instruction to leave undocumented fields
  NULL rather than guess.
- Microsoft: Bing's own help pages
  (bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0) render
  client-side and could not be scraped by the fetch tool, but the IP list
  URL was verified directly: https://www.bing.com/toolbox/bingbot.json
  returns 200 with a valid prefixes JSON. **Deliberate decision:** no
  Copilot-specific crawler entity was seeded. Every source found for a
  distinct "Copilot" user agent token was a third-party SEO blog, not
  Microsoft; Microsoft's own documented mechanism for opting Bing/Copilot
  content out of generative-AI training use is the `noarchive` robots
  meta tag or `X-Robots-Tag` header (announced at
  blogs.bing.com/webmaster/september-2023/Announcing-new-options...),
  not a UA token or robots.txt disallow line. Rather than seed a fabricated
  `CopilotBot` entity, this is recorded here and in the `bingbot` row's
  `notes` field instead. A later seed pass should revisit this if Microsoft
  publishes a real token.
- Apple: https://support.apple.com/en-us/119829. IP list
  https://search.developer.apple.com/applebot.json verified live (200).
  Applebot-Extended seeded as kind=policy_token, ua_token/ua_pattern/
  ip_list_url NULL, per vendor documentation stating it does not crawl.

## Verification performed (all against the live site, 2026-09-13)

- Every route (`/`, `/crawlers`, `/crawlers/<slug>` x15, `/claims/1`,
  `/changes`, `/observed`, `/observed/<slug>`, `/questions`, `/search`,
  `/data`, `/data/latest`, `/method`) returns 200 in all three of
  `<path>`, `<path>.md`, `<path>.json`, plus `Accept: text/markdown` and
  `Accept: application/json` negotiation confirmed on `/crawlers/gptbot`.
- `/claims/1` (and every claims path) correctly returns 404 in all three
  formats, since no claims exist yet: the route code path itself works,
  as required.
- `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/llms-full.txt`,
  `/changes.xml` all return 200 with correct content types
  (text/plain, application/xml, application/atom+xml).
- `/nope` (and `.md`/`.json`) return 404 cleanly in all three formats.
- POST to a GET-only route (`/crawlers`) returns 405 with an `Allow: GET`
  header, in the requested format.
- POST `/search` with `q` and `note` logs a question to the `questions`
  table and a pending row to `notes` (status=pending); confirmed by
  re-reading D1 directly.
- Every fetched `.md` page was grepped and contains no HTML tags; every
  fetched `.json` page parses with `json.load`.
- Grepped ~4000 lines across every entity page (all 15), every top-level
  page, in all three formats, plus llms.txt/llms-full.txt: zero em dashes,
  zero stray `**`.
- Spoofed `User-Agent: GPTBot/1.4` against `/crawlers/gptbot`: an
  `observations` row was written with `entity_id` for gptbot,
  `ip_verified=0`, `verify_method='none'` (this sandbox's egress IP is not
  in OpenAI's published range, so the correct, honest result). Repeated
  with a spoofed ClaudeBot UA: a second row landed the same way.
- A normal browser/curl UA request incremented the KV key
  `human_count:2026-09-13` (confirmed via direct KV read).
- An unmatched bot-like UA (`SomeRandomResearchCrawler/2.0`) landed in the
  KV `unknown_ua:2026-09-13` tally under its own UA string, not in the
  human counter.
- Cron schedule confirmed registered via
  `GET /workers/scripts/rsbm-site/schedules` → `17 3 * * *`.
- Zone settings confirmed via
  `GET /zones/{zone}/settings/always_use_https` → `on` and
  `GET /zones/{zone}/settings/ssl` → `full`.
- `https://www.rattlesnakesbymail.com/` → 301 to
  `https://rattlesnakesbymail.com/`, confirmed with curl.

## What I could NOT verify, and why

- **http:// → https:// redirect.** This sandbox's own egress policy blocks
  outbound plain HTTP (port 80) entirely — curl gets `403 Forbidden` /
  `x-deny-reason: host_not_allowed` from the local proxy before the
  request ever reaches Cloudflare (confirmed via
  `curl $HTTPS_PROXY/__agentproxy/status` and the proxy README). I could
  not curl `http://rattlesnakesbymail.com/` from here. What I *did* verify:
  the zone's `always_use_https` setting is `on` (Cloudflare's standard,
  reliable mechanism for this redirect), and the `www` → apex redirect
  (which does run over https, so it was testable) works. Peter or a later
  agent with normal HTTP egress should run
  `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://rattlesnakesbymail.com/`
  once to close this out; I expect 301 given the zone setting, but I have
  not seen it happen.

## A known Cloudflare platform quirk hit during this build

- **The Worker sets an `ETag` response header (SHA-256 of the body,
  computed per format) and implements `If-None-Match` → 304, but
  Cloudflare's edge strips the `ETag` header before it reaches the
  client**, on every route, in every format, regardless of whether it is
  set as a strong or weak (`W/"..."`) etag, and regardless of
  `Cache-Control` (tested `public, max-age=60` and `no-cache`, both
  stripped). A control header (`X-Debug-Etag`) with the identical value
  passed through untouched, isolating this to the literal header name
  `ETag`. No Page Rules exist on the zone (confirmed empty); I could not
  check zone-level Transform Rules because the API token is not scoped
  for `GET /zones/{zone}/rulesets/...` (auth error, not "not found").
  Cache level is `aggressive` (the zone default) and minify/rocket loader
  are off, neither of which explained it once tested. This is left
  unresolved: the code is correct and in place (see `respondDoc` in
  `src/index.js`), `Last-Modified` and the `Link` alternates header both
  pass through and work, but conditional GET / 304 is currently
  non-functional end to end on this domain. A later agent with broader
  token scope should check the zone's Transform Rules, or ask Peter
  whether some account-wide Cloudflare configuration manages ETag.

## Deliberately deferred (per task scope: spec sections 7, 8, 9 are later phases)

- **Notes system (section 7):** the `notes` table exists and `/search`
  writes a pending row when a `note` field is submitted, but there is no
  moderation UI, no publishing flow, and no rate limiting by ip_hash yet.
  Extension point: `db.js` `insertNote`/`listPublishedNotesForTarget`,
  and the `notes.status` column.
- **MCP server / WebMCP (section 8):** not built at all. No `/mcp` route,
  no `/.well-known/mcp.json`, no `server.json`. The `mcp_calls` table
  exists in the schema as the extension point. `ROUTES` in `src/index.js`
  has no entry for `/mcp`, so it currently 404s in all formats, which is
  correct for "not built yet" rather than a broken promise.
- **GitHub export (section 9):** `src/cron.js` has an explicit
  `exportNightly()` stub that returns `{skipped: true, reason: "..."}`
  and is not called from `runNightly()`. The nightly cron currently only
  does the observation rollup and the IP-list refresh, as instructed. The
  R2 bucket `rsbm-exports` exists and is bound as `EXPORTS` but nothing
  writes to it yet.
- **Claims and changes:** zero rows by design (P0.1 seeds entity identity
  only, per the task and per spec section 11's P0.3 being a separate,
  later phase). Every page that reads claims/changes renders correctly
  with an honest "none yet" message rather than assuming data exists.
- **Ledger publishing:** `/questions` will stay empty of published rows
  until a human or a later agent promotes a gap; this matches spec
  section 7 ("nothing publishes without being promoted").

## Known limitations worth flagging (not blockers, not silently ignored)

- KV counters (`human_count:*`, `unknown_ua:*`) use a read-then-write
  increment with no locking. Under concurrent requests this can lose
  increments (last write wins). Fine for an approximate day-1 census;
  should move to a Durable Object if exact counts start to matter.
- IP-list matching only understands the `{"prefixes":[{"ipv4Prefix"|
  "ipv6Prefix"}]}` shape all six vendors currently publish. If a vendor
  changes its JSON shape, `parseIpListJson` in `src/ipmatch.js` will
  silently return an empty list (fail closed: nothing verifies) rather
  than crash.
- The nightly rollup (`rollupObservations` in `src/cron.js`) only rolls
  up "yesterday" (UTC) each run. If the worker's `scheduled` handler is
  ever missed for more than one day, that gap is not backfilled
  automatically; the SQL is idempotent per date so a manual call to
  `rollupObservations(env, '2026-09-14')` etc. would backfill it.
