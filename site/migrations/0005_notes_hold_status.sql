-- Crank #2 migration 0005: notes gain a 'hold' status and a classification
-- column (P0.5 admin API / Betty's triage job). Betty's job (docs/betty-triage.md)
-- moves a note to 'hold' when it agrees with, contradicts, or adds new
-- information to a claim, so a human reviewer can decide whether it
-- publishes; only 'spam', 'injection' and 'off_topic' go straight to
-- 'rejected'. SQLite/D1 cannot alter a CHECK constraint in place, so the
-- table is recreated with the constraint list extended and all existing
-- rows are copied across unchanged (classification is null for them).
CREATE TABLE notes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('claim','entity','question')),
  target_id INTEGER,
  body TEXT NOT NULL,
  author_claim TEXT,
  ua_raw TEXT,
  ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected','hold')),
  reviewer_note TEXT,
  classification TEXT CHECK (classification IN ('spam','injection','off_topic','agrees','contradicts','new_information'))
);
INSERT INTO notes_new (id, ts, target_type, target_id, body, author_claim, ua_raw, ip_hash, status, reviewer_note)
  SELECT id, ts, target_type, target_id, body, author_claim, ua_raw, ip_hash, status, reviewer_note FROM notes;
DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;
CREATE INDEX IF NOT EXISTS idx_notes_target ON notes(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
