-- Crank #2 (rattlesnakesbymail.com) initial schema
-- Spec: /home/claude/crank2-data-and-record-spec.md section 3
-- Applied by deploy.sh, tracked in the migrations table below.

CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT UNIQUE NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  vendor TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('crawler','fetcher','search_bot','ads_bot','engine','policy_token')),
  purpose TEXT CHECK (purpose IN ('training','search','user_fetch','ads','mixed')),
  ua_token TEXT,
  ua_pattern TEXT,
  robots_token TEXT,
  ip_list_url TEXT,
  docs_url TEXT,
  first_documented TEXT,
  first_seen_here TEXT,
  last_seen_here TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired','unverified')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_vendor ON entities(vendor);
CREATE INDEX IF NOT EXISTS idx_entities_status ON entities(status);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  slug TEXT UNIQUE,
  field TEXT NOT NULL,
  value TEXT,
  statement TEXT NOT NULL,
  evidence_url TEXT,
  evidence_quote TEXT,
  method TEXT CHECK (method IN ('vendor_doc','observed_here','third_party','test_here')),
  verified_at TEXT,
  confidence TEXT CHECK (confidence IN ('high','medium','low')),
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded','disputed')),
  supersedes_id INTEGER REFERENCES claims(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_entity ON claims(entity_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_field ON claims(field);

CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER REFERENCES claims(id),
  entity_id INTEGER REFERENCES entities(id),
  changed_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('new','updated','superseded','retired','disputed')),
  old_value TEXT,
  new_value TEXT,
  evidence_url TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_changes_entity ON changes(entity_id);
CREATE INDEX IF NOT EXISTS idx_changes_changed_at ON changes(changed_at);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  entity_id INTEGER REFERENCES entities(id),
  ua_raw TEXT,
  ip_hash TEXT,
  ip_verified INTEGER NOT NULL DEFAULT 0,
  verify_method TEXT CHECK (verify_method IN ('rdns','ip_list','cf_verified','none')),
  asn TEXT,
  country TEXT,
  path TEXT,
  format_served TEXT CHECK (format_served IN ('html','md','json','txt','xml')),
  accept_header TEXT,
  status INTEGER,
  robots_allowed INTEGER,
  referer TEXT,
  cf_bot_category TEXT
);
CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_id);
CREATE INDEX IF NOT EXISTS idx_observations_ts ON observations(ts);
CREATE INDEX IF NOT EXISTS idx_observations_path ON observations(path);

CREATE TABLE IF NOT EXISTS observation_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  requests INTEGER NOT NULL DEFAULT 0,
  paths TEXT,
  formats TEXT,
  verified_share REAL,
  UNIQUE(date, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_observation_daily_date ON observation_daily(date);
CREATE INDEX IF NOT EXISTS idx_observation_daily_entity ON observation_daily(entity_id);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_first TEXT NOT NULL,
  ts_last TEXT NOT NULL,
  text_raw TEXT NOT NULL,
  text_norm TEXT NOT NULL,
  hash TEXT UNIQUE NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  sources TEXT NOT NULL DEFAULT '[]',
  matched_claim_ids TEXT NOT NULL DEFAULT '[]',
  gap INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 0,
  answer_record_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_questions_published ON questions(published);
CREATE INDEX IF NOT EXISTS idx_questions_gap ON questions(gap);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('claim','entity','question')),
  target_id INTEGER,
  body TEXT NOT NULL,
  author_claim TEXT,
  ua_raw TEXT,
  ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  reviewer_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_target ON notes(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);

CREATE TABLE IF NOT EXISTS exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('daily','weekly','manual')),
  r2_key TEXT,
  github_commit TEXT,
  row_counts TEXT
);

CREATE TABLE IF NOT EXISTS mcp_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  tool TEXT NOT NULL,
  args_hash TEXT,
  client_name TEXT,
  client_version TEXT,
  latency_ms INTEGER,
  result_count INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_ts ON mcp_calls(ts);
