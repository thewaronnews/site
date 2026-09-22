-- Crank #2 migration 0004: strip the "respects robots.txt" policy assertion
-- out of entities.notes, keeping notes to entity identity only.
-- This fact now belongs to the claims table (respects_robots_txt field),
-- published in the P0.3 batch, and should not also live duplicated inside
-- entities.notes prose. site/migrations/0002_seed_entities.sql seeded this
-- sentence in three forms: the plain form on eight rows, a shorter form on
-- bingbot, and a combined form on applebot bundling a second, unrelated
-- fact (crawl-rate behaviour) into the same sentence. Each REPLACE removes
-- the leading space along with the sentence so no double space or dangling
-- separator is left behind. WHERE clauses use short LIKE substrings
-- (D1/SQLite rejects long LIKE patterns as "too complex"); the REPLACE
-- argument itself still matches the full exact sentence.
-- Order matters: the combined applebot sentence is handled first so the
-- shorter patterns below cannot partially match it first.

UPDATE entities
SET notes = REPLACE(notes, ' Respects robots.txt and adjusts crawl rate automatically per vendor documentation.', '')
WHERE notes LIKE '%adjusts crawl rate automatically%';

UPDATE entities
SET notes = REPLACE(notes, ' Respects robots.txt per vendor documentation.', '')
WHERE notes LIKE '%robots.txt per vendor documentation%';

UPDATE entities
SET notes = REPLACE(notes, ' Respects robots.txt.', '')
WHERE notes LIKE '%Respects robots.txt.%';

UPDATE entities
SET notes = TRIM(notes)
WHERE notes IS NOT NULL;
