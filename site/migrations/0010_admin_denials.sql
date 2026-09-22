-- Crank #2 migration 0010: admin_denials logs every 403 the admin API
-- returns to an authenticated caller whose scope does not permit the call
-- (scope=triage attempting status=published; scope=legacy attempting any
-- note status change at all; any scope other than legacy attempting
-- export/rollup/indexnow). A 401 (unknown or absent token) is never
-- written here, so an attacker cannot fill this table just by guessing
-- tokens. No part of any token is ever stored, only the caller's scope
-- name. Internal table: never in export.js's COLUMN_DESCRIPTIONS, never
-- reachable by any public route; GET /admin/health surfaces only a count
-- and the latest row's ts/scope/attempted_status.
CREATE TABLE IF NOT EXISTS admin_denials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  scope TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  attempted_status TEXT,
  note_id INTEGER,
  ip_hash TEXT
);
