-- The War On News v3 (brief v3-ladder-brief-2026-09-22): the ladder reframe.
--
-- incidents.stage: one escalation stage per incident (restrict, pressure,
-- punish, silence, eliminate). Nullable in the schema so the column can be
-- added in place; the admin API validates the value and requires a stage
-- before an incident is published. The 128 incidents live at migration
-- time are backfilled through the admin API by tools/stage-backfill.py
-- (rule from the tactic plus a reviewed override list), so each change is
-- an ordinary revision.
-- incidents.ladder_note: optional short note shown on the incident's rung
-- of a ladder (/ladders/<tactic>), in the site's own voice (linted).
--
-- RSF ranks: the countries table already carries press_freedom_rank_latest,
-- press_freedom_rank_year and press_freedom_source_url (migration 0004), so
-- no rsf_rank_2026 column is added; the 2026 ranks are loaded into those
-- columns with year 2026 through POST /admin/countries/<iso2>/press-freedom.
-- The counts caveat lives in content/page-notes.json (src/content.js).

ALTER TABLE incidents ADD COLUMN stage TEXT CHECK (stage IS NULL OR stage IN ('restrict','pressure','punish','silence','eliminate'));
ALTER TABLE incidents ADD COLUMN ladder_note TEXT;
CREATE INDEX IF NOT EXISTS idx_incidents_stage ON incidents(stage);
