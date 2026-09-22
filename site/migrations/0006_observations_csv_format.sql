-- Crank #2 migration 0006: observations.format_served gains 'csv', now that
-- the P0.5 export routes (/data/latest/<table>.csv, /data/<date>/<table>.csv)
-- serve CSV snapshots through the Worker and are logged by the instrument
-- like any other request. SQLite/D1 cannot alter a CHECK constraint in
-- place, so the table is recreated with the constraint list extended and
-- all existing rows are copied across unchanged.
CREATE TABLE observations_new (
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
  format_served TEXT CHECK (format_served IN ('html','md','json','txt','xml','csv')),
  accept_header TEXT,
  status INTEGER,
  robots_allowed INTEGER,
  referer TEXT,
  cf_bot_category TEXT
);
INSERT INTO observations_new SELECT * FROM observations;
DROP TABLE observations;
ALTER TABLE observations_new RENAME TO observations;
CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_id);
CREATE INDEX IF NOT EXISTS idx_observations_ts ON observations(ts);
CREATE INDEX IF NOT EXISTS idx_observations_path ON observations(path);
