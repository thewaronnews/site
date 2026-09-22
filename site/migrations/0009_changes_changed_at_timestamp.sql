-- Crank #2 migration 0009: changes.changed_at gains a time-of-day
-- component. Every row written before this migration is a bare date
-- string (YYYY-MM-DD, 10 characters); every writer from this point on
-- (db.js insertChange, site/tools/publish-claims.py) records a full UTC
-- timestamp (YYYY-MM-DDTHH:MM:SSZ) instead. This backfills every existing
-- date-only value to midnight UTC on the same date, so every row in the
-- column has the same shape going forward. Idempotent: the WHERE clause
-- only matches a value exactly 10 characters long with '-' in the date
-- positions, so a row already carrying a full timestamp (or already
-- migrated) never matches again.
UPDATE changes
SET changed_at = changed_at || 'T00:00:00Z'
WHERE length(changed_at) = 10
  AND substr(changed_at, 5, 1) = '-'
  AND substr(changed_at, 8, 1) = '-';
