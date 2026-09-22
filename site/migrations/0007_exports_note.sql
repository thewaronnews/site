-- Crank #2 migration 0007: exports gains a free-text note column, used to
-- record why a run's github_commit is null (no change since the last
-- export, spec section 9 idempotence) or that the GitHub Git Data API
-- failed over to the Contents API for that run.
ALTER TABLE exports ADD COLUMN note TEXT;
