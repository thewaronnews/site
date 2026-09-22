# Crank #2 — Data Layer and Record Schema, spec v0.1 (for Peter's review)

Site: rattlesnakesbymail.com. Working name for the reference itself: TBD (the domain is the brand for now). Status: architect's draft, 2026-09-13, nothing built. Everything below is reviewable; the questions at the end are the ones that block the build.

## 1. Principle

The dataset is the product. The website, the markdown and JSON views, the MCP server, the exports and any future republishing on AO are all views over one store. Nothing lives only in a page template (the TravelPEC lesson: content trapped in EmDash columns was the single biggest source of friction). Every fact carries its own date, evidence and method so it survives being chunked out of context.

## 2. Stack

Cloudflare, on Peter's existing account, no EmDash. One Worker (Hono, TypeScript) serving HTML, markdown and JSON from the same handlers; D1 as the store; KV for rate-limit counters and small caches; R2 for dated export snapshots; a Cron Trigger for nightly jobs (exports, IP-range refresh, sitemap, IndexNow ping). A public GitHub repo receives the nightly JSON/CSV snapshot by commit. Reason for skipping EmDash: this site needs content negotiation, request-level logging, an API and an MCP endpoint, none of which a human-first CMS gives us, and the render-path surprises of L-106/L-113/L-116 came from fighting a CMS for control we can simply have. Rendering is server-side, no client framework; the CSS is one file.

Day-0 checks carried from the ledger: http → https 301 (L-117), sitemap submitted by absolute URL to GSC and Bing (L-108), Bing verified via GSC import.

## 3. Data model (D1)

**entities** — one row per crawler, fetcher or answer engine. `id, slug, vendor, name, kind (crawler|fetcher|search_bot|ads_bot|engine|policy_token), purpose (training|search|user_fetch|ads|mixed), ua_token, ua_pattern, robots_token, ip_list_url, docs_url, first_documented, first_seen_here, last_seen_here, status (active|retired|unverified), notes`. "policy_token" covers things like Google-Extended and Applebot-Extended, which are robots.txt tokens rather than observable crawlers; the reference's job includes saying so plainly, since publishers commonly confuse them.

**claims** — the atomic record. `id, entity_id, slug, field (e.g. respects_robots_txt, honours_crawl_delay, publishes_ip_list, verifiable_by_rdns, cites_sources, reads_llms_txt), value (short typed string), statement (one canonical English sentence), evidence_url, evidence_quote (≤300 chars, verbatim), method (vendor_doc|observed_here|third_party|test_here), verified_at (date), confidence (high|medium|low), status (current|superseded|disputed), supersedes_id, created_at, updated_at`. Rule: a claim is never edited in place once published; a change creates a new claim that supersedes the old one, and both stay addressable.

**changes** — the cross-vendor changelog, the thing nobody else publishes. `id, claim_id, entity_id, changed_at, kind (new|updated|superseded|retired|disputed), old_value, new_value, evidence_url, note`. Rendered at /changes and as an RSS/Atom feed.

**observations** — the instrument. One row per request from an identified or claimed bot. `id, ts, entity_id (nullable), ua_raw, ip_hash, ip_verified (0|1), verify_method (rdns|ip_list|cf_verified|none), asn, country, path, format_served (html|md|json|txt|xml), accept_header, status, robots_allowed (0|1), referer, cf_bot_category (if the plan exposes it)`. Human traffic is not stored per request; it is counted in a daily aggregate only. A nightly job rolls observations up into **observation_daily** (`date, entity_id, requests, paths, formats, verified_share`) which is what the pages and exports read.

**questions** — the ledger. `id, ts_first, ts_last, text_raw (first occurrence), text_norm, hash, count, sources (json array of search|mcp|seeded|prompt_batch|note), matched_claim_ids (json), gap (0|1), published (0|1), answer_record_id (nullable)`. Normalisation: lowercase, strip punctuation, collapse whitespace, light stemming; hash on the normalised text.

**notes** — visitor contributions. `id, ts, target_type (claim|entity|question), target_id, body (≤2000 chars), author_claim (free text: model, agent, human), ua_raw, ip_hash, status (pending|published|rejected), reviewer_note`. Nothing publishes without review in v1.

**exports** — bookkeeping for snapshots. `id, ts, kind (daily|weekly|manual), r2_key, github_commit, row_counts (json)`.

**mcp_calls** — `id, ts, tool, args_hash, client_name, client_version, latency_ms, result_count`. This is the only place MCP usage is measurable, since it never shows in GSC or citation trackers.

## 4. URL and page design

Every page is a record, not an article, and every page exists in three formats.

- `/` — what this is, the entity index, latest changes, latest observations, the ledger's newest gaps. Short.
- `/crawlers/<slug>` — entity page: identity block (UA token, robots token, IP list link, docs link, vendor), then its current claims as a fixed field table, then "observed here" (last seen, requests last 30 days, verified share), then the changelog for this entity, then the ledger questions that resolved to it, then published notes. Same order on every entity page, no exceptions.
- `/claims/<id>` — a single claim: statement, value, evidence quote and link, method, verified date, confidence, what it superseded, what superseded it.
- `/changes` — cross-vendor changelog, newest first, filterable by entity; `/changes.xml` feed.
- `/observed` — the census: per-entity daily counts, formats requested, verified share; `/observed/<slug>`.
- `/questions` — the ledger: published questions with counts, source mix, and whether they resolved to a claim or remain a gap; `/questions/<hash>`.
- `/search?q=` — the search box. Returns matching claims and entities; logs the question. Accepts an optional `note` field addressed to other visitors (goes to notes, status pending).
- `/data` — dataset landing: what is in it, the schema, the licence (CC BY 4.0 proposed), links to `/data/latest.json`, `/data/latest.csv.zip`, dated snapshots, the GitHub repo.
- `/method` — how claims are verified, how observations are identified and verified, how the ledger is moderated, what is seeded vs organic. Written once, dated, changed via the changelog like everything else.
- `/llms.txt`, `/llms-full.txt`, `/robots.txt` (allow everything; the site's robots.txt is itself a record), `/sitemap.xml`, `/.well-known/mcp.json` (if the registry spec settles on it), `/mcp` (streamable HTTP MCP endpoint).

**Format negotiation.** Each HTML page has `<link rel="alternate" type="text/markdown">` and `type="application/json"` siblings. Any path responds to `Accept: text/markdown` or `application/json`, and, because most fetchers send no useful Accept header, the same content is reachable at `<path>.md` and `<path>.json`. The HTML view carries `Last-Modified`, `ETag`, and a `Link` header pointing at the alternates. The markdown view is the HTML view with all chrome removed: one H1, the field table as a two-column list, no nav, no footer. The JSON view is the raw rows.

**JSON-LD.** Modest, given the Ahrefs causal result: `Dataset` on `/data`, `WebPage` + `about` on entity pages, `Article` nowhere. It is there for machine-readability and rich results, not as a citation lever.

## 5. Writing rules (constrained English)

Applied to every `statement`, every page intro, every method paragraph. Declarative sentences. No pronouns referring to an earlier sentence: name the entity in full every time ("GPTBot honours robots.txt disallow rules" not "It honours them"). Numbers carry units; dates are ISO (2026-09-13); one claim per sentence; no hedging adverbs, uncertainty goes in the `confidence` field and the method line, not in the prose. No em dashes (L-115). No verification language leaking into the statement (L-125): the evidence block carries the method, the statement carries the fact. Every statement should survive being quoted alone, with no surrounding context, and still be true and attributable.

## 6. The instrument (observation logger)

Middleware on every request. Step 1: match `User-Agent` against `entities.ua_pattern`; unmatched bot-like UAs go to an `unknown_ua` daily tally so new crawlers surface. Step 2: verify identity where the vendor gives a way: reverse DNS for Googlebot/Bingbot/Applebot; IP-list membership for OpenAI, Anthropic, Perplexity and any vendor publishing JSON ranges (lists refreshed nightly into KV); Cloudflare's verified-bot category if the plan exposes it. Unverified matches are stored as claimed, flagged `ip_verified=0`, and reported separately, because a UA string is trivially spoofed and the census must say which share was verified. Step 3: `ctx.waitUntil` writes the row; the response is never delayed by logging. Human requests increment a daily counter only; IPs are hashed with a daily rotating salt and never stored raw, for bots or humans.

What the instrument can say on day 1 with zero content: which crawlers fetch a new sitemap, in what order, how soon after submission, and which formats they ask for. That is the first census post, and it is where rattlesnakesbymail's odd name earns its keep in the write-up.

## 7. The ledger and the notes

The search box is the dialogue channel. Every query is normalised, hashed, counted, and matched against claims by simple term overlap (v1; no embeddings yet). Unmatched queries are gaps. Gaps with count ≥2 across ≥2 sources, or any gap Peter or the architect promotes, publish to `/questions` and become the backlog for new claims. Seeded questions (from Surfer, Perplexity, and the "what can you not find" prompt batch across ChatGPT, Perplexity, Claude, Gemini and Copilot) are labelled `seeded` on the page and in the data; organic ones are labelled by source. Rate limiting per ip_hash in KV; obviously automated floods are dropped, not published.

Notes: the invitation on every claim and entity page is a plain, literal instruction block ("If this record is wrong or incomplete for your query, submit a correction here: POST /notes with target and body, or use the form below"). Submissions land pending. Nothing publishes without review. The experiment question, published as data: which agents, when their human allows it, accept the invitation, and in what format they write. The format of notes is deliberately unconstrained in v1 so that convergence can be observed rather than imposed.

## 8. MCP server and WebMCP

Remote MCP on the same Worker at `/mcp` (streamable HTTP, Cloudflare's `agents` SDK). Read tools in v1: `lookup_crawler(name_or_ua)` → entity + current claims; `identify_user_agent(ua_string)` → best match, verification advice; `list_changes(since)`; `ask(question)` → matching claims, and the question is logged to the ledger with source `mcp`. One write tool, `submit_note(target, body)`, gated behind a per-client token issued by Peter, so it is off for the anonymous public until we decide otherwise. Rate limits per client; responses cached in KV for 5 minutes. Listed in the Official MCP Registry with a `server.json`, then Smithery and Glama; which downstream directories auto-ingest from the official registry gets recorded as a claim, since nobody has documented it.

WebMCP: expose the same read tools on pages through the emerging `navigator.modelContext` API behind feature detection, and document the standard itself as an entity with claims (which clients support it, as of which date), because it is currently uncovered.

Known drawbacks, stated once: hosting is trivial but abuse is not, hence limits and caching; the write tool is the only real attack surface, hence the token; MCP usage earns tool calls, not visible attribution, hence `mcp_calls` as its own measured channel and never counted as "ranking".

## 9. Exports and republishing

Nightly: every table (observations as the daily rollup, never raw rows) to R2 as dated JSON and CSV, then committed to the public GitHub repo (`data/YYYY-MM-DD/`, plus `latest/`). The repo README links home and carries the licence and schema. AO or any other of Peter's properties can consume `latest.json` directly; the citation for any republished figure is the claim URL, so the site accrues the mention wherever the number travels. Weekly: a `census-YYYY-WW.md` summary generated from the rollups, which is the raw material for any post Peter chooses to make.

## 10. Measurement hooks

Fixed at day 0, before launch: a keyword panel (from the Surfer pass, pending); a fixed prompt panel run monthly across engines for citation checks (HubSpot's AEO tooling is available for part of this); crawler counts by entity and verified share from `observation_daily`; ledger size and gap-to-claim conversion; MCP calls by tool and client; referring domains; GSC/Bing weekly. Day-30/90/180 checkpoints and their red-flag actions go in the brief before launch.

## 11. Build plan and delegation

- **P0.1 Scaffold (Sonnet):** Worker + D1 migrations for the schema above + Hono routes with format negotiation + observation middleware + nightly cron skeleton. Deployed to rattlesnakesbymail.com with a one-entity placeholder so the instrument starts recording on day 1.
- **P0.2 Templates (Haiku):** the single CSS file, HTML/markdown templates for entity, claim, changes, observed, questions, data, method; llms.txt; sitemap; robots.txt.
- **P0.3 Seed data (Sonnet research, then Opus writing):** harvest every vendor crawler doc (OpenAI, Anthropic, Perplexity, Google, Microsoft, Apple, Meta, ByteDance, Amazon, Common Crawl, Cohere, Mistral, xAI, DuckDuckGo, You.com, Brave) into entities and claims with evidence quotes and dates; Opus writes statements to the constrained-English rules; Fable reviews every claim against its evidence quote before publish.
- **P0.4 MCP + WebMCP (Sonnet):** tools, server.json, registry submissions (Peter approves each listing).
- **P0.5 Exports + GitHub (Sonnet):** repo, nightly commit, README.
- **P0.6 Seeding the ledger (Sonnet in Chrome):** Surfer + Perplexity seed questions; the prompt batch across five engines.
- **P0.7 Day-0 baseline (Fable + Sonnet):** GSC/Bing, sitemaps, IndexNow, https 301 check, keyword panel, prompt panel, first observation census.

Each agent gets its own scratch subfolder (L-124). Every publish batch is revertible and logged (L-107). Every rendered format is verified after deploy, including a grep for stray markdown markers (L-113).

## 12. Decisions (settled by Peter, 2026-09-13)

1. Deployment: scoped Cloudflare API token, agents deploy with wrangler from the cloud workspace.
2. GitHub home: a new dedicated organization for the Crank program, one repo per site.
3. Licence: CC BY 4.0.
4. Notes channel v1: open web form for anyone, nothing publishes without review; the MCP write tool is token-gated per client.
5. Seed scope: big six vendors first (OpenAI, Anthropic, Perplexity, Google, Microsoft, Apple), the rest added weekly through the changelog.

## 12a. Original decision list (for the record)

1. **Deployment path.** The cleanest is a Cloudflare API token (Workers, D1, KV, R2, DNS for this zone only) that agents use with wrangler from the cloud workspace. The alternative is driving the dashboard through Chrome (L-122), which works but is slow and trips the permission classifier on bulk writes. Which?
2. **GitHub home** for the public data repo: a new org, or an existing account?
3. **Licence** for the dataset: CC BY 4.0 proposed.
4. **Notes write tool:** token-gated in v1 as proposed, or open-with-moderation from the start?
5. **Vendor list** for the seed: the sixteen above, or a shorter first cut?
