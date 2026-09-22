-- Crank #2 migration 0008: observation_daily gains verified_requests, an
-- integer count of verified requests for the day, alongside the existing
-- verified_share ratio. A content audit (2026-09-15) found /observed and
-- /crawlers/<slug> averaging verified_share across days, which is a mean of
-- daily shares rather than sum(verified requests)/sum(requests): a day with
-- few requests and a high share pulls the multi-day figure up (or down)
-- exactly as much as a day with thousands of requests. verified_requests
-- lets every consumer sum a true numerator and a true denominator instead.
-- Backfilled for existing rows as round(verified_share * requests); the
-- nightly rollup (cron.js) writes it directly from its own exact verified
-- count from this point forward. No row is deleted or altered otherwise:
-- the disclosed spoofed-UA test rows from 2026-09-13 and 2026-09-14 stay
-- exactly as recorded.
ALTER TABLE observation_daily ADD COLUMN verified_requests INTEGER;
UPDATE observation_daily
SET verified_requests = CAST(ROUND(COALESCE(verified_share, 0) * requests) AS INTEGER)
WHERE verified_requests IS NULL;
