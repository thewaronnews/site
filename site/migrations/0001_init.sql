-- The War On News (thewaronnews.com), Crank #3: initial schema.
-- Copied verbatim from twon-data-and-record-spec.md section 2.3 (v1.0, 2026-09-22).
-- Content never enters by migration, only through the admin API.

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
