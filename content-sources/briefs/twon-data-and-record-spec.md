# The War On News: data and record specification, v1.0

Site: thewaronnews.com. Crank #3. Architect's spec, 2026-09-22. Built from the approved proposal (`sites/crank3/proposal-2026-09-22.md`), Peter's decisions (`decisions-2026-09-22.md`), the playbook brief, the Crank #2 data spec and the copied Crank #2 source. Where this spec and the proposal differ, this spec governs the build. Where it differs from Peter's decisions, the decisions govern.

## 1. Purpose and non-goals

The War On News is a dated, sourced reference to actions by officials, governments, regulators and legislatures that limit journalists' ability to gather or publish news. It is US-first, with foreign incidents as context. Subtitle on every page: "A dated record of government actions that limit reporting." The dataset is the product: pages, twins, feeds, MCP and the export are views over one D1 store.

The title carries the point of view. The record does not. Entries state who did what, when, and where to check it. Justifications are quoted, never paraphrased. Allegations are attributed ("the complaint alleges"). Motive is never characterized. Evaluative words appear only inside attributed quotations. Actors have no descriptive or evaluative field, and no party column: office and term carry that fact without turning the record into a partisan tally.

Non-goals: protest arrests and street-level assaults (the U.S. Press Freedom Tracker's territory, linked by ID in `incidents.external_ids`); commentary, advocacy or prediction; a global incident log before the US record is complete; publishing the verification method (L-125); em dashes (L-115); journalist data beyond professional facts.

## 2. Entities and D1 schema

### 2.1 Conventions

- `*_on` columns are `YYYY-MM-DD`; `*_at` are UTC `YYYY-MM-DDTHH:MM:SSZ`. Partial dates store the first day of the period plus a `*_precision` column.
- Slugs match `^[a-z0-9]+(-[a-z0-9]+)*$`, 80 characters maximum. Incidents start with the year (`2026-white-house-bars-cnn-msnow-politico`), cases use the short caption (`cnn-v-trump-2026`, `sherrill-v-knight`), notes start with the publish date (`2026-09-23-hearing-in-cnn-v-trump`).
- `jurisdiction`: `US` (federal), ISO 3166-2 (`US-LA`), state plus place slug (`US-LA:new-orleans`), or ISO 3166-1 alpha-2 (`RU`). `country` is always ISO 3166-1 alpha-2.
- Every content record carries page meta: `pub_state`, `published_at`, `reviewed_on`, `next_review_on`, `unknowns` (the "What we don't know" line), `revision`, `created_at`, `updated_at`.
- Prose columns are Markdown with claim references written `{c:123}`. The renderer turns them into numbered footnotes linked to `/claims/123`. The admin API rejects a prose paragraph with no reference to a current claim.
- Enum vocabularies are final before population (L-136). Claim `field` names are an allowlist in `records.js` (section 2.4), not a CHECK, so they can grow without a rebuild.
- `deploy.sh` must keep `CREATE TRIGGER ... BEGIN ... END;` as one statement when splitting migrations (track BEGIN/END depth; the Crank #2 splitter only respects quotes).

### 2.2 Migrations

| File | Contents |
|---|---|
| `0001_init.sql` | All tables, indexes and triggers below. No rattlesnake table is reused. |
| `0002_seed_bots.sql` | Instrument registry: the 15 Crank #2 crawler patterns and IP lists, plus Meta, Bytespider, Amazonbot, CCBot, DuckAssistBot and feed readers (Feedly, Inoreader, NewsBlur, Feedbin). |
| `0003_search_fts.sql` | `search_fts` FTS5 table (`record_type`, `record_id` UNINDEXED, `title`, `body`). Separate so a failure falls back to term-overlap search without blocking 0001. |

Content never enters by migration, only through the admin API, so validation, revisions and audit always apply.

### 2.3 `0001_init.sql`

```sql
CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT UNIQUE NOT NULL, applied_at TEXT NOT NULL);

CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE NOT NULL, final_url TEXT,
  title TEXT NOT NULL, publisher TEXT NOT NULL, outlet_id INTEGER REFERENCES outlets(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('reporting','primary_document','court_record','official_statement','dataset','reference')),
  published_on TEXT, first_seen TEXT NOT NULL, last_checked TEXT, http_status INTEGER,
  link_state TEXT NOT NULL DEFAULT 'unchecked' CHECK (link_state IN ('unchecked','live','paywalled','bot_blocked','dead','redirected')),
  link_state_since TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0,
  wayback_url TEXT, wayback_saved_at TEXT, archive_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sources_checked ON sources(last_checked);

CREATE TABLE source_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  checked_at TEXT NOT NULL, checker TEXT NOT NULL, http_status INTEGER, final_url TEXT,
  observed_state TEXT NOT NULL CHECK (observed_state IN ('live','paywalled','bot_blocked','dead','redirected','error')),
  jev_scores TEXT, detail TEXT
);
CREATE INDEX idx_source_checks ON source_checks(source_id, checked_at);

CREATE TABLE actors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person','body')),
  body_type TEXT CHECK (body_type IN ('executive_office','agency','regulator','legislature','court','law_enforcement','foreign_government','other')),
  role TEXT NOT NULL, office TEXT, jurisdiction TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'US',
  term_start TEXT, term_end TEXT, official_url TEXT, wikidata_qid TEXT, unknowns TEXT,
  pub_state TEXT NOT NULL DEFAULT 'draft' CHECK (pub_state IN ('draft','published','withdrawn')),
  published_at TEXT, reviewed_on TEXT, next_review_on TEXT, revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE outlets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('newspaper','broadcaster','cable_news','wire_service','digital','magazine','public_media','press_association','other')),
  country TEXT NOT NULL DEFAULT 'US', homepage_url TEXT, wikidata_qid TEXT, unknowns TEXT,
  pub_state TEXT NOT NULL DEFAULT 'draft' CHECK (pub_state IN ('draft','published','withdrawn')),
  published_at TEXT, reviewed_on TEXT, next_review_on TEXT, revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE journalists (  -- professional facts only
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  outlet_id INTEGER REFERENCES outlets(id), role TEXT NOT NULL, profile_url TEXT,
  pub_state TEXT NOT NULL DEFAULT 'draft' CHECK (pub_state IN ('draft','published','withdrawn')),
  published_at TEXT, reviewed_on TEXT, revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  occurred_on_precision TEXT NOT NULL DEFAULT 'day' CHECK (occurred_on_precision IN ('day','month','year','approximate')),
  ended_on TEXT, jurisdiction TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'US',
  level TEXT NOT NULL CHECK (level IN ('federal','state','local','foreign')),
  type TEXT NOT NULL CHECK (type IN ('access_ban','credential_revocation','lawsuit_against_press','regulatory_pressure','funding_cut','arrest_or_detention','subpoena_or_seizure','legislation','physical_obstruction','other')),
  summary TEXT NOT NULL, what_happened TEXT NOT NULL, stated_justification TEXT, effect_on_reporting TEXT, unknowns TEXT,
  status TEXT NOT NULL CHECK (status IN ('in_effect','in_litigation','enjoined','reversed','expired','resolved','historical')),
  status_updated_on TEXT NOT NULL,
  external_ids TEXT NOT NULL DEFAULT '{}', illustration_key TEXT,
  pub_state TEXT NOT NULL DEFAULT 'draft' CHECK (pub_state IN ('draft','published','withdrawn')),
  published_at TEXT, reviewed_on TEXT, next_review_on TEXT, revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_incidents_date ON incidents(occurred_on);

CREATE TABLE cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL,
  caption TEXT NOT NULL, short_name TEXT NOT NULL, court TEXT NOT NULL,
  court_level TEXT NOT NULL CHECK (court_level IN ('trial','appellate','supreme','agency','foreign')),
  docket TEXT, reporter_citation TEXT, filed_on TEXT, decided_on TEXT, judges TEXT, holding TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','decided','on_appeal','settled','dismissed','withdrawn')),
  courtlistener_url TEXT, unknowns TEXT,
  pub_state TEXT NOT NULL DEFAULT 'draft' CHECK (pub_state IN ('draft','published','withdrawn')),
  published_at TEXT, reviewed_on TEXT, next_review_on TEXT, revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE events (  -- timeline rows: dated developments of an incident or case
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER REFERENCES incidents(id), case_id INTEGER REFERENCES cases(id),
  occurred_on TEXT NOT NULL,
  occurred_on_precision TEXT NOT NULL DEFAULT 'day' CHECK (occurred_on_precision IN ('day','month','year','approximate')),
  kind TEXT NOT NULL CHECK (kind IN ('announcement','action','filing','hearing','ruling','appeal','reversal','statement','legislative_step','other')),
  label TEXT NOT NULL, claim_id INTEGER REFERENCES claims(id),
  pub_state TEXT NOT NULL DEFAULT 'draft' CHECK (pub_state IN ('draft','published','withdrawn')),
  created_at TEXT NOT NULL,
  CHECK (incident_id IS NOT NULL OR case_id IS NOT NULL),
  CHECK (pub_state <> 'published' OR claim_id IS NOT NULL)
);
CREATE INDEX idx_events_date ON events(occurred_on);

CREATE TABLE claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('incident','actor','outlet','journalist','case','event')),
  subject_id INTEGER NOT NULL, field TEXT NOT NULL, value TEXT, statement TEXT NOT NULL, attribution TEXT,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  evidence_quote TEXT NOT NULL, evidence_date TEXT,
  method TEXT NOT NULL CHECK (method IN ('primary_document','outlet_report','court_record','official_statement','observed_here')),
  verified_at TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded','disputed','retired')),
  supersedes_id INTEGER REFERENCES claims(id), superseded_by INTEGER REFERENCES claims(id),
  supersede_reason TEXT CHECK (supersede_reason IN ('correction','update')),
  batch_label TEXT, created_at TEXT NOT NULL,
  CHECK (length(evidence_quote) <= 300),
  CHECK (method = 'observed_here' OR length(evidence_quote) >= 1)
);
CREATE INDEX idx_claims_subject ON claims(subject_type, subject_id, status);

CREATE TRIGGER claims_no_delete BEFORE DELETE ON claims
BEGIN SELECT RAISE(ABORT, 'claims are append-only'); END;
CREATE TRIGGER claims_frozen BEFORE UPDATE ON claims
WHEN NEW.subject_type IS NOT OLD.subject_type OR NEW.subject_id IS NOT OLD.subject_id
  OR NEW.field IS NOT OLD.field OR NEW.value IS NOT OLD.value OR NEW.statement IS NOT OLD.statement
  OR NEW.attribution IS NOT OLD.attribution OR NEW.source_id IS NOT OLD.source_id
  OR NEW.evidence_quote IS NOT OLD.evidence_quote OR NEW.evidence_date IS NOT OLD.evidence_date
  OR NEW.method IS NOT OLD.method OR NEW.verified_at IS NOT OLD.verified_at
  OR NEW.confidence IS NOT OLD.confidence OR NEW.supersedes_id IS NOT OLD.supersedes_id
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS NOT OLD.superseded_by)
  OR (OLD.supersede_reason IS NOT NULL AND NEW.supersede_reason IS NOT OLD.supersede_reason)
BEGIN SELECT RAISE(ABORT, 'claims: only status, superseded_by, supersede_reason may change'); END;

CREATE TABLE revisions (  -- prose history, append-only
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL CHECK (record_type IN ('incident','actor','outlet','journalist','case','explainer','glossary_term','policy')),
  record_id INTEGER NOT NULL, revision INTEGER NOT NULL, body_json TEXT NOT NULL,
  reason TEXT NOT NULL, is_correction INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE (record_type, record_id, revision)
);
CREATE TRIGGER revisions_no_update BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER revisions_no_delete BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE news_desk_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL CHECK (length(title) <= 110),
  note TEXT NOT NULL, word_count INTEGER NOT NULL CHECK (word_count BETWEEN 60 AND 120),
  primary_source_id INTEGER NOT NULL REFERENCES sources(id),
  secondary_source_ids TEXT NOT NULL DEFAULT '[]',
  incident_id INTEGER REFERENCES incidents(id), story_date TEXT NOT NULL,
  jev_model TEXT NOT NULL, jev_scores TEXT NOT NULL, gates_passed TEXT NOT NULL, run_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('held','published','reverted')),
  published_at TEXT, reverted_at TEXT, revert_reason TEXT, created_at TEXT NOT NULL,
  CHECK (state <> 'reverted' OR (reverted_at IS NOT NULL AND revert_reason IS NOT NULL))
);
CREATE INDEX idx_notes_state ON news_desk_notes(state, published_at);

CREATE TABLE explainers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL, dek TEXT NOT NULL, body_md TEXT NOT NULL,
  target_keyword TEXT NOT NULL, surfer_score INTEGER, surfer_exception INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER, illustration_key TEXT, unknowns TEXT,
  pub_state TEXT NOT NULL DEFAULT 'draft' CHECK (pub_state IN ('draft','published','withdrawn')),
  published_at TEXT, reviewed_on TEXT, next_review_on TEXT, revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE glossary_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL,
  term TEXT NOT NULL, definition TEXT NOT NULL, body_md TEXT, see_also TEXT NOT NULL DEFAULT '[]',
  pub_state TEXT NOT NULL DEFAULT 'draft' CHECK (pub_state IN ('draft','published','withdrawn')),
  published_at TEXT, reviewed_on TEXT, revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE incident_actors (incident_id INTEGER NOT NULL REFERENCES incidents(id), actor_id INTEGER NOT NULL REFERENCES actors(id),
  role TEXT NOT NULL CHECK (role IN ('ordered','announced','implemented','enforced','defended','legislated','ruled','other')),
  role_at_time TEXT, PRIMARY KEY (incident_id, actor_id, role));
CREATE TABLE incident_outlets (incident_id INTEGER NOT NULL REFERENCES incidents(id), outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  relation TEXT NOT NULL CHECK (relation IN ('affected','plaintiff','intervenor')), PRIMARY KEY (incident_id, outlet_id, relation));
CREATE TABLE incident_journalists (incident_id INTEGER NOT NULL REFERENCES incidents(id), journalist_id INTEGER NOT NULL REFERENCES journalists(id),
  outlet_id_at_time INTEGER REFERENCES outlets(id),
  relation TEXT NOT NULL CHECK (relation IN ('affected','plaintiff')), PRIMARY KEY (incident_id, journalist_id, relation));
CREATE TABLE incident_cases (incident_id INTEGER NOT NULL REFERENCES incidents(id), case_id INTEGER NOT NULL REFERENCES cases(id),
  relation TEXT NOT NULL CHECK (relation IN ('arising_from','precedent_cited')), PRIMARY KEY (incident_id, case_id, relation));
CREATE TABLE incident_sources (incident_id INTEGER NOT NULL REFERENCES incidents(id), source_id INTEGER NOT NULL REFERENCES sources(id),
  role TEXT NOT NULL CHECK (role IN ('primary','reporting','background')), sort INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (incident_id, source_id));
CREATE TABLE incident_related (incident_id INTEGER NOT NULL REFERENCES incidents(id), related_id INTEGER NOT NULL REFERENCES incidents(id),
  relation TEXT NOT NULL CHECK (relation IN ('precedent','follow_on','parallel')), PRIMARY KEY (incident_id, related_id));
CREATE TABLE case_parties (case_id INTEGER NOT NULL REFERENCES cases(id),
  party_type TEXT NOT NULL CHECK (party_type IN ('actor','outlet','journalist')), party_id INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('plaintiff','defendant','appellant','appellee','intervenor','amicus')), PRIMARY KEY (case_id, party_type, party_id, side));
CREATE TABLE case_sources (case_id INTEGER NOT NULL REFERENCES cases(id), source_id INTEGER NOT NULL REFERENCES sources(id),
  role TEXT NOT NULL CHECK (role IN ('complaint','opinion','order','docket','brief','reporting')), PRIMARY KEY (case_id, source_id));
CREATE TABLE explainer_sources (explainer_id INTEGER NOT NULL REFERENCES explainers(id), source_id INTEGER NOT NULL REFERENCES sources(id),
  sort INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (explainer_id, source_id));
CREATE TABLE glossary_sources (term_id INTEGER NOT NULL REFERENCES glossary_terms(id), source_id INTEGER NOT NULL REFERENCES sources(id),
  PRIMARY KEY (term_id, source_id));

CREATE TABLE changes (  -- public ledger, append-only
  id INTEGER PRIMARY KEY AUTOINCREMENT, changed_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('claim_new','claim_superseded','claim_disputed','claim_retired','record_published','record_revised','record_withdrawn','note_published','note_reverted','source_offline','source_restored')),
  record_type TEXT, record_id INTEGER, claim_id INTEGER REFERENCES claims(id),
  old_value TEXT, new_value TEXT, reason TEXT, is_correction INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_changes_at ON changes(changed_at);
CREATE TRIGGER changes_no_delete BEFORE DELETE ON changes BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE submissions (  -- moderated queue: tips and corrections
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('web','mcp','email')),
  kind TEXT NOT NULL CHECK (kind IN ('correction','tip')),
  target_type TEXT CHECK (target_type IN ('incident','actor','outlet','journalist','case','claim','source','news_desk_note','explainer','glossary_term')),
  target_id INTEGER, body TEXT NOT NULL CHECK (length(body) <= 2000), source_url TEXT,
  author_claim TEXT, client_name TEXT, ua_raw TEXT, ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','hold','accepted','rejected')),
  classification TEXT CHECK (classification IN ('spam','injection','off_topic','agrees','contradicts','new_information','tip_in_scope','tip_out_of_scope')),
  jev_scores TEXT, reviewer_note TEXT, resolved_claim_id INTEGER REFERENCES claims(id), updated_at TEXT
);

-- Instrument, kept from Crank #2 and renamed (entities -> bots, observations -> requests)
CREATE TABLE bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, vendor TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('crawler','fetcher','search_bot','ads_bot','feed_reader','mcp_client','monitor')),
  ua_pattern TEXT NOT NULL, ip_list_url TEXT, created_at TEXT NOT NULL
);
CREATE TABLE requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, bot_id INTEGER REFERENCES bots(id),
  ua_raw TEXT, ip_hash TEXT, ip_verified INTEGER NOT NULL DEFAULT 0,
  verify_method TEXT CHECK (verify_method IN ('rdns','ip_list','cf_verified','none')),
  asn TEXT, country TEXT, path TEXT, format_served TEXT, accept_header TEXT, status INTEGER, referer TEXT, cf_bot_category TEXT
);
CREATE INDEX idx_requests_ts ON requests(ts);
CREATE TABLE requests_daily (
  date TEXT NOT NULL, bot_id INTEGER NOT NULL REFERENCES bots(id),
  requests INTEGER NOT NULL DEFAULT 0, verified_requests INTEGER NOT NULL DEFAULT 0,
  paths TEXT, formats TEXT, feed_subscribers INTEGER, PRIMARY KEY (date, bot_id)
);
CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts_first TEXT NOT NULL, ts_last TEXT NOT NULL,
  text_raw TEXT NOT NULL, text_norm TEXT NOT NULL, hash TEXT UNIQUE NOT NULL,
  count INTEGER NOT NULL DEFAULT 1, sources TEXT NOT NULL DEFAULT '[]', result_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE mcp_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, tool TEXT NOT NULL, args_hash TEXT,
  client_name TEXT, client_version TEXT, latency_ms INTEGER, result_count INTEGER);

CREATE TABLE exports (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('daily','manual')), r2_key TEXT, github_commit TEXT, row_counts TEXT, datapackage_version TEXT, note TEXT);
CREATE TABLE admin_writes (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, scope TEXT NOT NULL, token_label TEXT,
  method TEXT NOT NULL, path TEXT NOT NULL, record_type TEXT, record_id INTEGER, batch_label TEXT, summary TEXT);
CREATE TABLE admin_denials (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, scope TEXT NOT NULL,
  method TEXT NOT NULL, path TEXT NOT NULL, attempted TEXT, ip_hash TEXT);
```

Admin tokens stay in KV as on Crank #2: `admin-token:<sha256>` holding `{scope, issued_at, label}`, plus `admin-token-index:<scope>` for rotation. The operator token is the `ADMIN_TOKEN` secret.

### 2.4 Claim field allowlist (`records.js`)

| subject_type | fields |
|---|---|
| incident | `occurred_on`, `announced_by`, `action`, `stated_justification`, `effect_on_reporting`, `status`, `outlet_affected`, `journalist_affected`, `scope_of_action`, `reversed_on` |
| event | `occurred_on`, `action`, `filing`, `ruling`, `quote` |
| case | `filed_on`, `docket`, `judge`, `claims_asserted`, `holding`, `decided_on`, `status`, `appeal` |
| actor, outlet, journalist | `role`, `term_start`, `term_end`, `affiliation` |

## 3. URL and page design

### 3.1 Routes

| Path | Content |
|---|---|
| `/` | Subtitle, 40-word definition, latest 5 notes, latest 5 incidents, dataset and MCP line |
| `/incidents`, `/incidents/<slug>` | Index (filters: type, level, country, status) and dossier |
| `/actors`, `/actors/<slug>`; `/outlets`, `/outlets/<slug>`; `/journalists/<slug>` | Records with their incidents |
| `/cases`, `/cases/<slug>` | Index and case record |
| `/timeline`, `/timeline/<yyyy>`, `/timeline/actor/<slug>`, `/timeline/type/<type>`, `/timeline/country/<cc>` | Generated from published `events` plus each incident's `occurred_on` |
| `/news`, `/news/page/<n>`, `/news/<slug>` | News Desk, 30 per page, newest first |
| `/explainers/<slug>`, `/glossary`, `/glossary/<slug>` | Articles and terms |
| `/claims/<id>`, `/sources/<id>` | One claim with both supersession links; one source with its check history (`noindex`) |
| `/changes`, `/changes.xml`, `/corrections` | Public ledger; corrections page lists `is_correction=1` changes and reverted notes under the corrections policy |
| `/about`, `/methodology`, `/editorial-policy` | Trust pages from `site/content/*.md`, versioned in `revisions` as `policy` |
| `/data`, `/feeds`, `/mcp` | Dataset landing; feed list; MCP docs on GET, JSON-RPC on POST |
| `/search?q=`, `POST /submit` | FTS search logged to `questions`; web form into `submissions` |
| `/llms.txt`, `/llms-full.txt`, `/robots.txt`, `/<INDEXNOW_KEY>.txt`, `/.well-known/mcp/server.json`, `/.well-known/agent.json`, `/sitemap.xml` | Discovery |

Crank #2 answered GET `/mcp` with 405. Here GET returns the documentation doc in all three formats; Streamable HTTP clients POST, so nothing breaks. Reverted notes and withdrawn records return HTTP 410 with title, dates, reason and a link to `/corrections`; the withdrawn text is not shown.

### 3.2 Twins

Crank #2's `negotiate.js` is unchanged: `.md`/`.json` suffix first, then `Accept`, default HTML, `<link rel="alternate">` plus a `Link` header.

| Page | `.md` | `.json` |
|---|---|---|
| Incident | H1, subtitle, meta lines, then Summary, What happened, Stated justification, Effect on reporting, Timeline, People and bodies, Outlets and journalists, Cases, Related, Sources as numbered footnotes (URL, publisher, date, link state, archived URL); no nav | Every `incidents` column, plus `actors`, `outlets`, `journalists`, `cases`, `related`, `events`, current `claims` each with its source object, `sources`, `revisions_url`, `license`, `cite_as` |
| Actor, outlet, journalist | Identity list, incidents table | Row, incidents, current claims |
| Case | Caption, court, docket, dates, status, holding, parties, documents, incidents | Row, `parties`, `documents`, `events`, `incidents` |
| Timeline | One line per row: date, label, incident, URL | `{filter, rows:[{date, precision, kind, label, incident_slug, case_slug, claim_id}]}` |
| Note | Title, date, text, source lines | Row without `jev_scores`, `gates_passed`, `run_id` (export only), with source objects |
| Explainer, glossary, claim | Body or statement with sources | Row plus sources |

A source object is `{id, url, final_url, title, publisher, published_on, link_state, link_state_since, wayback_url, wayback_saved_at}`.

### 3.3 Page furniture

Under every title, in all formats: "Published YYYY-MM-DD. Last reviewed YYYY-MM-DD. N sources." then "What we don't know: ..." when set. Incidents add "Status: in litigation, as of YYYY-MM-DD." HTML sends `Last-Modified` from `updated_at`.

External links render only through `extLink(source)` in `util.js`:

- `live`, `bot_blocked`, `unchecked`: `<a href target="_blank" rel="noopener noreferrer">title</a>` plus a small `archived` link (same attributes) when `wayback_url` exists.
- `paywalled`: the same with "(subscription)".
- `redirected`: links `final_url`, original URL in the `title` attribute.
- `dead`: the original URL as unlinked text, then "Original link no longer resolves; archived copy" linked to the snapshot, or "no archived copy exists". Sources are never deleted.

`util.a()` also changes to `rel="noopener noreferrer"` for all external hosts.

## 4. The "For humans" and "For machines" layers

### 4.1 For humans

Each record section opens with a one-sentence lead under an H2 phrased as the reader's question ("What the White House said"), with H2 anchors, as in Crank #2's lead-in pass. The summary is the direct answer to the page's main query. Illustrations (after Peter approves the master set) are 1600x900 WebP in R2 at `/images/<key>.webp`, with a 1200x630 `og:image` crop.

### 4.2 JSON-LD (`jsonld.js`; `BreadcrumbList` on every page)

| Page | Type |
|---|---|
| Incident | `Article` whose `about` is an `Event` (`startDate` as a partial ISO date when imprecise, `endDate`, `location` AdministrativeArea, `organizer` = actors with role ordered or announced) |
| News Desk note | `NewsArticle` with `isBasedOn` the primary source, `citation` the secondaries, `about` the incident |
| Actor | `Person` (`jobTitle`) or `GovernmentOrganization`; `sameAs` Wikidata and official URL; no `description` |
| Outlet, journalist | `NewsMediaOrganization`; `Person` with `worksFor` |
| Case | `CreativeWork`, `additionalType` `http://www.wikidata.org/entity/Q2334719` (legal case), `identifier` PropertyValue docket, `dateCreated`, `sourceOrganization` the court |
| Legislation incident | adds a `Legislation` node to `about` (`legislationIdentifier`, `legislationDate`, `legislationJurisdiction`, `legislationPassedBy`, `legislationLegalForce`) |
| Explainer; glossary | `Article` with `citation`; `DefinedTerm` in a `DefinedTermSet` at `/glossary` |
| `/data`; `/` | `Dataset` (license, creator, DataDownload for CSV, JSON, datapackage.json); `WebSite` plus publisher |

Decisions: schema.org has no `LegalCase` (404, checked 2026-09-22), so cases use `CreativeWork` with the Wikidata class. Incidents are not top-level `Event`s, because Google's Event feature is for attendable events and a ban marked as one invites misclassification. Notes use `NewsArticle`: each is a dated report of a current event under a named editor, Google treats it like `Article` for rich results, and `isBasedOn` credits the original reporting. JSON-LD is for readability, not a citation lever (L-204).

### 4.3 llms.txt

```
# The War On News
> A dated record of government actions that limit reporting. US-first, with global context.
> Every page exists as HTML, .md and .json. Every fact is a claim with a verbatim quote, source URL, method and verification date. CC BY 4.0.
> Editor and publisher: Peter Benes, Prince Edward County, Ontario. AI agents research, draft and check the site under his editorial control (see /methodology).
## Record
- [Incidents](https://thewaronnews.com/incidents.md)
- [Timeline](https://thewaronnews.com/timeline.md)
- [Cases](https://thewaronnews.com/cases.md)
- [News Desk](https://thewaronnews.com/news.md)
## Data and tools
- [Dataset](https://thewaronnews.com/data.md): CSV, JSON, Frictionless datapackage.json
- [MCP server](https://thewaronnews.com/mcp.md): Streamable HTTP at /mcp
## Policies
- [Methodology](https://thewaronnews.com/methodology.md), [Editorial policy](https://thewaronnews.com/editorial-policy.md), [Corrections](https://thewaronnews.com/corrections.md)
```

One generated line per published incident and case (`- [title](url.md): date, type`) follows "Record". `/llms-full.txt` concatenates their `.md` twins.

### 4.4 Feeds, sitemaps, IndexNow

Feeds (`feeds.js`), latest 50 items: News Desk at `/news/feed.xml` (RSS 2.0), `/news/atom.xml`, `/news/feed.json` (JSON Feed 1.1), with full note text and the primary source link; Incidents (new and revised, revision reason in content) at `/incidents/feed.xml`, `/incidents/atom.xml`, `/incidents/feed.json`; `/changes.xml` (Atom). Reverted notes leave the feeds. Every HTML head links both Atom feeds.

`/sitemap.xml` is an index whose children carry the newest `lastmod` they contain: `/sitemaps/pages.xml`, `/sitemaps/incidents.xml` (incidents and cases), `/sitemaps/news.xml`, `/sitemaps/news-google.xml` (notes from the last 48 hours with `news:publication`), `/sitemaps/machine.xml` (twins and claims). `lastmod` is `updated_at`; nothing without a real date gets one.

IndexNow pings run from the Mac, never the Worker (L-139, L-142). `GET /admin/changed-urls?since=` feeds `tools/indexnow-ping.py`, which POSTs to `https://api.indexnow.org/indexnow`.

### 4.5 OKF: the open knowledge export

In this program "OKF" means the nightly public export, packaged as a Frictionless Data Package (the Open Knowledge Foundation's standard; Data Package v2 profile, tabular resources that v1 validators accept). Crank #2's shape stays (JSON and CSV per table, manifest, README, LICENSE, CITATION.cff); `datapackage.json` replaces `schema.json`.

Exported: `incidents`, `events`, `actors`, `outlets`, `journalists`, `cases`, `sources`, `claims` (all statuses), `news_desk_notes` (published and reverted; reverted rows keep `revert_reason` and null `note`), `explainers`, `glossary_terms`, all join tables, `changes`. Published rows only, plus withdrawn rows with prose nulled. Not exported: `submissions`, instrument tables, `questions`, `mcp_calls`, `admin_*`, `revisions`, so the repo reads as a dataset, not an experiment.

`datapackage.json`: `name "the-war-on-news"`, `licenses [CC-BY-4.0]`, `contributors [Peter Benes: publisher, editor]`, `version YYYY.MM.DD`, one resource per table (`path data/<table>.csv`) with a Table Schema carrying types, descriptions, `constraints.enum` from the CHECK lists, `primaryKey` and `foreignKeys`.

Repo `thewaronnews/data` after each run:

```
datapackage.json  README.md  LICENSE  CITATION.cff
data/<table>.csv        latest; the Data Package points here
json/<table>.json       latest, same rows
snapshots/YYYY-MM-DD/   Sundays and on schema change: data/, json/, datapackage.json
```

Git history is the daily archive. R2 `twon-exports` keeps every night at `data/YYYY-MM-DD/` and `latest/`, served at `/data/...`. An unchanged payload hash skips the commit, as on Crank #2. The repo's CI runs `frictionless validate datapackage.json`.

## 5. MCP server

Crank #2's plain-JS Streamable HTTP JSON-RPC server is kept whole: KV sessions (24 hours), 5-minute cache for read tools (except `search_incidents`, which logs to `questions` first), every call in `mcp_calls`, protocol versions 2025-06-18, 2025-03-26 and 2024-11-05, CORS, no SSE. Smoke UA prefix `twon-smoke/`. Limits kept: `suggest_correction` 20 per client and 60 per IP hash per day; tokens as `mcp_token:<sha256>` from `issue-mcp-token.sh`. Name `com.thewaronnews/thewaronnews`, listed on the Official MCP Registry (DNS TXT), Smithery and Glama. Read tools return `content` (the `.md` twin) and `structuredContent` (the `.json` twin), with absolute URLs.

```json
[
 {"name":"search_incidents","annotations":{"readOnlyHint":true},
  "description":"Search recorded incidents where governments or officials limited journalists' ability to report. Returns title, date, type, status, summary and URL, newest first.",
  "inputSchema":{"type":"object","properties":{"query":{"type":"string"},
   "type":{"type":"string","enum":["access_ban","credential_revocation","lawsuit_against_press","regulatory_pressure","funding_cut","arrest_or_detention","subpoena_or_seizure","legislation","physical_obstruction","other"]},
   "actor":{"type":"string","description":"Actor slug"},"from":{"type":"string","format":"date"},"to":{"type":"string","format":"date"},
   "limit":{"type":"integer","minimum":1,"maximum":50,"default":10}}}},
 {"name":"get_incident","annotations":{"readOnlyHint":true},
  "description":"One incident: what happened, quoted justification, effect on reporting, status, timeline, actors, outlets, cases, claims and archived sources.",
  "inputSchema":{"type":"object","properties":{"slug":{"type":"string"}},"required":["slug"]}},
 {"name":"get_timeline","annotations":{"readOnlyHint":true},
  "description":"Dated timeline entries, oldest first.",
  "inputSchema":{"type":"object","properties":{"from":{"type":"string","format":"date"},"to":{"type":"string","format":"date"},
   "actor":{"type":"string"},"type":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":200,"default":100}}}},
 {"name":"get_actor","annotations":{"readOnlyHint":true},
  "description":"An official or body: role, office, jurisdiction, and every incident with the actor's role.",
  "inputSchema":{"type":"object","properties":{"slug":{"type":"string"}},"required":["slug"]}},
 {"name":"get_case","annotations":{"readOnlyHint":true},
  "description":"A court case: caption, court, docket, dates, quoted holding, status, parties, documents, incidents.",
  "inputSchema":{"type":"object","properties":{"slug":{"type":"string"}},"required":["slug"]}},
 {"name":"latest_news","annotations":{"readOnlyHint":true},
  "description":"Latest News Desk notes, each linking to the original reporting.",
  "inputSchema":{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":50,"default":10}}}},
 {"name":"get_sources_for","annotations":{"readOnlyHint":true},
  "description":"Every source an incident cites, with link state and Wayback snapshot URL.",
  "inputSchema":{"type":"object","properties":{"incident_slug":{"type":"string"}},"required":["incident_slug"]}},
 {"name":"suggest_correction","annotations":{"readOnlyHint":false,"destructiveHint":false},
  "description":"Suggest a correction. Requires a client token from the publisher. Stored as pending; an editor reviews every suggestion.",
  "inputSchema":{"type":"object","properties":{
   "target_type":{"type":"string","enum":["incident","actor","outlet","journalist","case","claim","source","news_desk_note","explainer","glossary_term"]},
   "target_id":{"type":"string","description":"Slug, or numeric id for claims, sources, notes"},
   "body":{"type":"string","maxLength":2000},"source_url":{"type":"string","format":"uri"},
   "author_claim":{"type":"string","maxLength":200},"token":{"type":"string"}},
   "required":["target_type","target_id","body","token"]}}
]
```

`suggest_correction` inserts a `submissions` row (`channel mcp`, `kind correction`, `client_name` from the token) and returns `{id, status:"pending"}`.

## 6. Link integrity pipeline

The Worker never fetches third-party news URLs; news sites block datacenter egress. All fetching runs on the Mac Studio and writes back through the admin API.

**At publish** (`tools/archive.py`, called by `publish-records.py` and the News Desk): for each source without a snapshot, query `https://archive.org/wayback/available?url=<url>` and reuse a snapshot under 7 days old. Otherwise GET `https://web.archive.org/save/<url>` (UA `twon-archive/1.0`, 60-second timeout), or SPN2 when `ARCHIVE_ORG_S3_KEY` is set (POST `https://web.archive.org/save` with `Authorization: LOW key:secret`, poll `/save/status/<job_id>` every 5 seconds for up to 2 minutes). Re-query the availability API, take `archived_snapshots.closest.url`, and POST it to `/admin/sources/<id>/wayback`. One save per 15 seconds. Failures increment `archive_attempts`; the nightly job retries up to 5 attempts.

**Nightly** (`tools/linkcheck.py`, launchd 02:30 America/Toronto):

1. `GET /admin/sources/due`: sources unchecked for 20 hours or more.
2. Tier 1: `httpx` GET, current desktop Chrome UA, 20-second timeout, 5 redirects, at most 2 requests per second per host.
3. Classify. 401/402, or JSON-LD `isAccessibleForFree:false`, or a paywall marker: `paywalled`. 403/429/503 with a challenge marker (`cf-mitigated`, "Just a moment", Akamai "Access Denied", DataDome, PerimeterX): tier 2. 404/410, NXDOMAIN, refused, TLS failure: failure. 200 landing on a site root or section front, or a title sharing under 30% of tokens with `sources.title`: ambiguous, ask Jev. 200 at a different path with a matching title: `redirected`. Otherwise `live`.
4. Tier 2: Playwright Chromium, headful, 30 seconds. Article title renders: `live`. Otherwise `bot_blocked`.
5. Jev (ambiguous pages only): state = final URL, title, first 1,500 characters of text; one `choice` question `page_state` with `article`, `paywall`, `block`, `not_found`, `homepage`. At confidence 0.80 or more, map to live, paywalled, bot_blocked, failure, failure. Below 0.80, record `error` and keep the state.
6. POST batches of 200 to `/admin/sources/checks`.

The Worker applies hysteresis: `dead` only after 3 consecutive failures spanning 48 hours or more, reset by one success, so no single post can kill a source. Transitions write `source_offline` or `source_restored` changes. Dead sources without a snapshot lead the next digest.

| Endpoint | Scope | Body | Effect |
|---|---|---|---|
| `POST /admin/sources` | desk, publish | `{url, title, publisher, source_kind, published_on, outlet_slug?}` | Upsert by normalized URL (lowercase host, strip `utm_*`, `fbclid`, `gclid`, fragment); returns `{id, created}` |
| `GET /admin/sources/due?limit=` | triage+ | | Due sources |
| `POST /admin/sources/checks` | triage+ | `{checks:[{source_id, checked_at, checker, http_status, final_url, observed_state, jev_scores?, detail?}]}` | Inserts checks, applies hysteresis, updates sources, writes changes |
| `POST /admin/sources/<id>/wayback` | triage+ | `{wayback_url, wayback_saved_at}` or `{wayback_url:null}` | Sets snapshot or counts an attempt; never nulls an existing snapshot |

## 7. News Desk pipeline and gates

A scheduled Claude Sonnet agent on the Mac Studio runs at 06:30 and 16:30 America/Toronto. It is not Betty: Betty never decides what publishes. Kill switches: `~/twon/DESK_PAUSED` stops a run before any write; the KV flag `desk:paused` makes the Worker answer 423. Each run has its own folder `~/twon/desk/runs/<run_id>/` (L-124) and UA `twon-desk/1.0`.

### 7.1 Steps

0. **Commands.** Read replies from peter@benesthemenace.com in digest threads the agent sent (betty@benesthemenace.com mailbox; sender and thread id must both match). One command per line: `revert <id> <reason>`, `publish <id>`, `pause`, `resume`.
1. **Sweep** the last 36 hours. Perplexity in Chrome (`select_browser` first, never beside another browser agent, L-137) and WebSearch, each with four fixed queries: "US government action against journalists or news outlets in the last 24 hours", "White House press access news today", "FCC or regulator action against a broadcaster this week", "journalist subpoena or arrest by US authorities this week". RSS from `desk/feeds.yaml`: U.S. Press Freedom Tracker, CPJ, RCFP, Freedom of the Press Foundation, Knight First Amendment Institute, RSF, PEN America, Poynter, Nieman Lab, CJR (URLs confirmed in P1a). Advocacy feeds are leads only.
2. **Candidates.** Normalize URLs, drop any already used by a note, fetch each with the tier 1 and 2 fetcher, keep title, outlet, date and 2,000 characters of text.
3. **Jev** (7.2).
4. **Draft.** Sonnet writes a title (110 characters maximum) and a 60 to 120-word note from the fetched text only: open with the dated fact, name the outlet ("Axios reported on September 21, 2026 that..."), verbs of record, officials' reasons in direct quotation, no motive, prose dates as "September 21, 2026", link the matched incident.
5. **Gates** (7.3). Failing only G1's hold band, G9 or G10 makes a held note; any other failure drops the candidate with a logged reason.
6. **Publish** with the desk token, then `archive.py`, `indexnow-ping.py` (note, `/news`, incident), and confirm `/news/<slug>.json` returns 200.
7. **Digest** after the evening run, from betty@ to peter@benesthemenace.com, subject `TWON desk YYYY-MM-DD: N published, M held`: published notes (id, title, URL, scores, gates), held notes with the failing gate, dropped counts by reason, new dead sources, proposed new incidents, commands executed, and the footer "Reply with: revert <id> <reason> | publish <id> | pause | resume".

Limits: 6 notes per run, 8 per day; the Worker caps 12 per day.

### 7.2 Jev

`https://api.featherless.ai/v1/classifier` with `JEV_API_KEY`; the demo endpoint (2k context, 4 requests per second) is the fallback, with `state` cut to 1,800 characters and 3 requests per second. Model `featherless-ai/Qwen3.6-35B-A3B-classifier`, pinned in `desk/config.yaml`. The question set below measured 1,284 input tokens with a short state on 2026-09-22. `state` is `Headline / Outlet / Date / Text`; untrusted text never enters `instructions`.

| id | type | instructions | criteria |
|---|---|---|---|
| `in_scope` | noul | Does the text report a specific action taken or formally announced by a government official, government body, court acting on a government request, or legislature, that limits journalists' or news outlets' ability to gather or publish news? | true: concrete government action affecting access, credentials, funding, legal exposure or publication; false: opinion, rhetoric alone, private-company action, private violence, protest arrests, unrelated |
| `type` | choice | Which category best fits the government action? | the ten incident types with one-line descriptions |
| `level` | choice | Which level of government acted? | federal, state, local, foreign |
| `actor_type` | choice | Who took the action? | executive_official, agency, regulator, legislature, court, law_enforcement, foreign_government |
| `novelty` | choice | Is this story about one of these recorded incidents, or a new one? | up to 6 incident slugs (top term-overlap matches, described by title and year) plus `new` |
| `development` | choice | What kind of news is this? | new_action, court_development, response, analysis |
| `private_allegation` | noul | Does the text allege a crime or misconduct by a named journalist or private individual? | true, false |

Thresholds (recalibrated in P1a on 40 labelled headlines, 20 in and 20 out, taking the lowest `in_scope` line with zero false positives): `in_scope` 0.85 or more eligible, 0.60 to 0.85 held, under 0.60 dropped; `type` confidence under 0.60 held; `novelty` match at 0.70 or more sets `incident_id`, while `new` with `new_action` is listed as a proposed incident (the desk never creates incidents); `development=analysis` at 0.60 or more dropped; `private_allegation` 0.50 or more held.

Jev also pre-triages `submissions` (decision 8) with one `choice` over the eight classifications. Spam, injection or off_topic at 0.90 or more is rejected with the triage token; everything else goes to Betty's Crank #2 triage prompt, and disagreement means hold. Triage never accepts.

### 7.3 Gates

Each gate writes `{pass, detail}` to `gates_passed`. The Worker re-runs G4, G5, G6 and G8 on submission and answers 422 on failure.

| Gate | Rule |
|---|---|
| G1 scope | Jev thresholds |
| G2 dedupe | No note in 14 days with the same `incident_id` and `development` and title-token Jaccard 0.5 or more; no reuse of a primary source |
| G3 verbatim | Every quoted span appears in the fetched source text after whitespace and quote-mark normalization |
| G4 links | Every source is live, paywalled, redirected or tier-2-confirmed bot_blocked, or has a `wayback_url` |
| G5 length | 60 to 120 words; title 110 characters maximum |
| G6 banned words | None outside quotation marks |
| G7 quote-only evaluation | A fresh Sonnet call on the note alone returns `{"all_evaluative_language_inside_quotes": true}` |
| G8 voice lint | No em or en dashes, first person, question or exclamation marks, or process language; attribution verbs limited to said, wrote, stated, announced, told, filed, ruled, and argued or alleged for legal filings only |
| G9 source kind | Primary source is reporting, primary document, court record or official statement, not advocacy |
| G10 private allegation | `private_allegation` under 0.50 |

Banned stems (case-insensitive, allowed only inside quotation marks): attack, assault on, crackdown, war on (except the site name), authoritarian, autocrat, draconian, unprecedented, chilling, alarming, shocking, outrageous, egregious, blatant, brazen, retaliat, censor, silenc, punish, target (verb), vindictive, controversial, slammed, blasted, lashed out, defiant, embattled, disgraced, so-called, radical, extremist, far-left, far-right, regime, strongman, dangerous, troubling, concerning, dramatic, sweeping, stunning, landmark, historic, clearly, obviously, admitted, conceded, insisted, claimed. The one copy lives in `site/src/voice.js`, imported by the Worker and the desk tools.

## 8. Admin API

Crank #2's skeleton is kept: Bearer token, SHA-256 KV lookup, fixed-length compare for the operator secret, 120 requests per minute per token, JSON only, `no-store`, `X-Robots-Tag: noindex`, 403s logged to `admin_denials` (never 401s). Every successful write adds an `admin_writes` row.

| Scope | Holder | Can |
|---|---|---|
| `triage` | Betty's jobs, link checker | Read queues; submissions to rejected or hold; link checks and snapshots |
| `desk` | News Desk agent | Triage rights plus sources, create/publish/revert notes, pause (not resume) |
| `publish` | Build agents under the architect; Peter | Everything content: records, claims, events, joins, accepting submissions, resume |
| `operator` | `ADMIN_TOKEN` secret | Export, rollup, health, changed-urls; no content writes |

The `desk` scope is new: a stolen desk token can publish or revert notes and touch nothing else.

| Endpoint | Scope | Effect |
|---|---|---|
| `GET /admin/health` | any | Counts, last export, denials, link-integrity share, records past `next_review_on`, desk flag |
| `PUT /admin/records/<type>/<slug>` | publish | Body: full row, `reason`, `is_correction`, `batch_label`. Validates enums, slug, `{c:ID}` references (current, belonging to this record or a linked one), banned words outside quotes, no em dashes. Upserts, appends a revision, writes `record_revised` once published, refreshes `search_fts` |
| `POST /admin/records/<type>/<slug>/publish` | publish | `{reviewed_on, next_review_on}`; needs at least one current claim |
| `POST /admin/records/<type>/<slug>/withdraw` | publish | `{reason}`; page returns 410 |
| `PUT /admin/incidents/<slug>/links`, `PUT /admin/cases/<slug>/links` | publish | Replace join rows in one D1 batch, logged as a revision |
| `POST /admin/claims` | publish | `{subject_type, subject_slug, field, value, statement, attribution?, source_id, evidence_quote, evidence_date?, method, verified_at, confidence, batch_label}`; writes `claim_new` |
| `POST /admin/claims/<id>/supersede` | publish | New claim plus `reason` (correction or update); one batch inserts it and sets the old claim's status and `superseded_by`; `is_correction` for corrections |
| `POST /admin/claims/<id>/status` | publish | `{status: disputed or retired, reason}` |
| `POST /admin/events` | publish | `{incident_slug?, case_slug?, occurred_on, precision, kind, label, claim_id}` |
| `POST /admin/desk/notes` | desk, publish | Note fields, `source_ids`, Jev and gate JSON, `run_id`, `state`; 423 paused, 429 over cap, 422 on server gates |
| `GET /admin/desk/notes?state=held`; `POST /admin/desk/notes/<id>/publish` | desk, publish | Held queue; held to published |
| `POST /admin/desk/notes/<id>/revert` | desk, publish | `{reason}`; `note_reverted` with `is_correction=1`; leaves feeds and sitemaps; 410 |
| `POST /admin/desk/pause` | desk (true only), publish | `{paused}` |
| `GET /admin/submissions?status=`; `POST /admin/submissions/<id>` | triage (reject, hold), publish (all) | As Crank #2; `accepted` requires `resolved_claim_id` |
| Link endpoints | section 6 | |
| `GET /admin/changed-urls?since=` | operator, desk, publish | URLs for IndexNow |
| `POST /admin/export`, `POST /admin/rollup` | operator | As Crank #2 |
| `GET /admin/writes?since=&batch=` | publish | Audit, used by `revert-batch.py` |

## 9. Module-by-module plan for `site/src`

| File | Verdict and change |
|---|---|
| `index.js` | ADAPT: new route table; www to apex for thewaronnews.com; feeds, sitemaps, `/images/*` and `/data/*` from R2; GET `/mcp` docs; 410s; new OG image |
| `negotiate.js` | KEEP |
| `render.js` | ADAPT: new chrome and CSS tokens (ink #1B1B1B, paper #F3EFE6, graphite #6E6A63, wash #D8D2C4, amber #C98A1B for status markers only); meta block; `{c:ID}` footnotes; JSON-LD from `jsonld.js`; feed alternates; WebMCP script rewritten for the new read tools |
| `routes.js` | ADAPT: keeps home, search, data, submit, claims, changes, corrections; entity handlers move out |
| `db.js` | ADAPT (rewrite) for the new tables, D1 `batch()` for supersession and joins |
| `mcp.js` | ADAPT: tools, manifest, `twon-smoke/`, writes to `submissions` |
| `admin.js` | ADAPT: four scopes and section 8 endpoints, delegating to `records.js`, `newsdesk.js`, `linkstate.js` |
| `export.js` | ADAPT: new tables, `datapackage.json`, README, repo layout, no instrument tables |
| `cron.js` | ADAPT: rollup `requests` (with feed-subscriber parsing), bot IP-list refresh, export; worker IndexNow removed; cron `17 7 * * *` |
| `logger.js`, `ipmatch.js`, `github.js` | KEEP (table renames, `twon-` UAs excluded, `DATA_REPO` var) |
| `util.js` | ADAPT: `noreferrer`, `extLink()`, `INTERNAL_HOSTS` |
| `site.js` | ADAPT: all copy and constants (name, subtitle, origin, publisher Peter Benes, licence, attribution "The War On News, thewaronnews.com", repo, GA4 ID) |
| `discovery.js` | ADAPT: agent card and robots lines; sitemap code moves to `sitemaps.js` |
| `indexnow.js` | DROP (Mac pings; the key-file route stays) |
| `fields.js`, `compare.js`, `recipes.js` | DROP (crawler-specific) |
| ADD | `jsonld.js`, `feeds.js`, `sitemaps.js`, `timeline.js`, `incidents.js`, `people.js` (actors, outlets, journalists), `cases.js`, `newsdesk.js` (pages, pagination, server gates), `explainers.js` (explainers, glossary, policy pages), `linkstate.js`, `records.js` (validated upsert, revisions, field allowlist), `voice.js`, `search.js` |

`deploy.sh`: `WORKER_NAME=twon-site`, `D1_NAME=twon-db`, `KV_NAME=twon-kv`, `R2_NAME=twon-exports`, `ZONE_HOST=thewaronnews.com`, `ZONE_HOST_WWW=www.thewaronnews.com`; new module list; trigger-aware splitter; the same zone settings (always_use_https on, ssl full, browser_check, email_obfuscation, automatic_https_rewrites and server_side_exclude off). It never touches the Google MX and SPF records or verification TXT records. Secrets `SALT_SECRET`, `ADMIN_TOKEN`, `GITHUB_TOKEN`; vars `INDEXNOW_KEY`, `DATA_REPO`, `GA4_MEASUREMENT_ID`.

Tools: `verify-all.sh`, `mcp-smoke.sh`, `issue-*.sh` adapted (UA `twon-verify/1.0`, desk scope). `publish-claims.py` becomes `publish-records.py`, writing only through the admin API, never directly to D1. `revert-batch.py` supersedes or withdraws by `batch_label` from `admin_writes`. New Mac tools: `linkcheck.py`, `archive.py`, `indexnow-ping.py`, and `desk/` (`run.md` prompt, `config.yaml`, `feeds.yaml`, `jev_questions.json`, `gates.py`, `digest.py`).

## 10. Measurement hooks

### 10.1 Rank panel

Decision 14 locked the proposal's 25-keyword panel as-is (MSV and KD are in proposal section 9). It is the volume-by-opportunity selection: every in-scope head term, every term with KD under 50, and the long tails the dossiers answer, leaving out uncapturable heads (freedom of speech, censorship, Pentagon Papers) and off-scope news dossiers. Measured by GSC and Bing positions plus a manual US check; never edited.

1 press freedom; 2 white house press pool (cluster); 3 press corps white house; 4 press credentials / hard pass; 5 prior restraint; 6 first amendment text; 7 committee to protect journalists; 8 freedom of the press foundation; 9 reporters committee for freedom of the press; 10 press freedom organizations; 11 journalists in jail; 12 why is freedom of the press important; 13 freedom of press court case; 14 cnn banned from white house; 15 associated press banned from white house; 16 pentagon press corps credential revocation; 17 pbs npr funding cuts; 18 reporters without borders; 19 freedom of press index; 20 freedom house index; 21 media blackout; 22 can the president ban a news outlet; 23 is it legal to ban reporters from the white house; 24 trump press restrictions timeline; 25 war on the press.

### 10.2 Citation panel

Five engines (ChatGPT, Perplexity, Claude, Gemini, Copilot), 20 fixed prompts, each run twice in clean sessions (not the betty@ persona that contaminated Crank #2), spread over two days for quotas. A hit is any thewaronnews.com URL cited.

Current events: (1) Why were CNN, MS NOW and Politico banned from the White House? (2) What is happening in the lawsuit CNN, MS NOW and Politico filed against Trump over the White House ban? (3) What are the Pentagon's press credential rules for reporters? (4) Which news outlets lost White House press access in 2025 and 2026?
Legality: (5) Can the president ban a news outlet from the White House? (6) What did the court decide in Sherrill v. Knight? (7) What did the D.C. Circuit rule in AP v. Budowich? (8) Can the Justice Department subpoena journalists' records?
History: (9) What was Nixon's enemies list, and which journalists were on it? (10) How many Espionage Act leak cases did the Obama administration bring? (11) Why was Jim Acosta's press pass revoked in 2018, and what did the court do?
Lists and data: (12) List every news outlet barred from White House events since 2017. (13) Give me a timeline of Trump administration press restrictions. (14) Which US government actions against the press have courts blocked? (15) Is there a dataset of US government actions that restrict journalists?
Global: (16) How does press freedom in the United States compare to other democracies? (17) How do the UK and Canada decide which journalists get parliamentary press passes? (18) Where does the United States rank in the RSF World Press Freedom Index?
Definitions: (19) What is the White House press pool? (20) What is a White House hard pass?

### 10.3 Control, baseline, cadence

Control: aibubblequestion.com, untouched, snapshotted monthly (as Crank #2).

Day-0 baseline, written before the GSC sitemap submission and never revised, at `sites/crank3/baseline-2026-09.md` in Crank #2's format: sitemap URL count; GSC and Bing indexed, impressions, clicks (confirmed zero, real reading on day 1 or 2, L-108); `requests_daily` per bot with verified share and the first bot fetch; MCP calls by client (smoke clients named); feed-reader UAs; exports; the 301 check; AI Crawl Control state; the day-0 citation and rank panels; the control snapshot; known contaminations. The checkpoint clock starts at the GSC submission.

Weekly on Mondays, by a scheduled Sonnet agent in a clean browser session, to `sites/crank3/measurements/YYYY-MM-DD.md`: rank positions, indexation share, Bing AI Performance, the citation panel, crawler census, external MCP calls, feed subscribers (Feedly count plus unique feed-reader UAs), dataset downloads (`/data/*` requests plus GitHub views and clones) and stars, link-integrity share, and median desk freshness (`published_at` minus the primary source's `published_on`). Checkpoints follow the proposal's metric table.

## 11. Build order

### P1a (48 hours)

1. Infra: 301 check, Bot Fight Mode and Browser Integrity Check off, AI Crawl Control Allow, Managed robots.txt off, MX and SPF present; `deploy.sh` with `twon-*` resources, migrations 0001 to 0003, secrets, four token scopes, domains, cron.
2. Worker modules for incidents, cases, timeline, news, policies, feeds, sitemaps, MCP, admin and link integrity.
3. Content: the CNN, MS NOW and Politico incident (announced 2026-09-18, credentials deactivated 2026-09-19); `cnn-v-trump-2026` (D.D.C. 1:26-cv-03287, filed 2026-09-21, Judge Timothy J. Kelly, hearing 2026-09-23); their actors and outlets; the Sherrill v. Knight and Acosta 2018 records they cite; about, methodology (with the AI disclosure), editorial policy, corrections, data; the press pool explainer. Every source archived.
4. News Desk: Jev calibration, a held-only first run, auto-publish after Peter reads the first digest.
5. GSC and Bing (DNS TXT, absolute sitemap URLs, Bing separately); day-0 baseline.

Done means, checked with real `twon-verify/1.0` requests including content type and byte size (L-134):

- http returns 301 to https; www returns 301 to apex.
- Every P1a route answers 200 in HTML, `.md` and `.json` with the right content type, `Link` alternates and the meta block.
- Every external link has `target="_blank" rel="noopener noreferrer"`; every source has a snapshot or a logged attempt.
- On live D1, UPDATE of a claim's `statement` and DELETE on `claims` both fail; a supersession shows both claims linked.
- All six News and Incidents feeds plus `/changes.xml` validate; the sitemap index carries `lastmod`.
- `mcp-smoke.sh` passes: 8 tools listed, each read tool returns the CNN records, `suggest_correction` fails without a token.
- A triage token gets 403 on `POST /admin/desk/notes`, a desk token 403 on `POST /admin/claims`, both logged.
- One desk run completes with a digest delivered, and a `revert` reply is executed on the next run.
- Rich Results Test parses the incident, case, note and `/data` JSON-LD without errors.

### P1b (day 5)

1. The remaining ~22 incidents from the proposal seed (AP ban, injunction and partial stay; VOA; Pentagon rules and forfeiture; DOJ guidelines rescission; FCC and Kimmel; CPB funding; Louisiana buffer law; Nixon's enemies list; Obama-era Espionage Act cases; others the verification pass confirms), each through itemizer, Sonnet verification and Opus neutrality review before `publish-records.py`.
2. About 15 actors, 20 outlets and journalists, 4 cases, 15 glossary terms.
3. Explainers 2 to 5 at Surfer 75 or more (70 to 74 logged as exceptions).
4. Illustrations after Peter approves the master set.
5. GitHub org `thewaronnews`, `data` repo, first export, Frictionless CI green.
6. IndexNow for every URL from the Mac; MCP registry, Smithery and Glama on Peter's approval; Betty YAML (triage, census).

Done means:

- 20 or more published incidents, each with 3 or more current claims, every prose paragraph referencing a claim, `reviewed_on` set.
- `frictionless validate` passes and row counts match `/admin/health`.
- Two nightly link checks have run; link integrity is 97% or more; no source is `unchecked`.
- `/timeline`, `/timeline/2025`, one actor and one type timeline each show more than 5 rows in all three formats.
- The IndexNow ping returns 200 or 202 from the Mac.
- Five pages chosen by Peter pass his spot-check.
