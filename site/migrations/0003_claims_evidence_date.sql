-- Crank #2 migration 0003: nullable evidence_date on claims.
-- Architect decision, 2026-09-13: ISO date of the source document, when the
-- document itself shows one (JSON-LD dateModified/datePublished, an
-- article:modified_time meta tag, a visible "Last updated" date, or the
-- creationTime field on the vendor IP-list JSON endpoints). verified_at
-- stays the date we checked; evidence_date is the date the source itself
-- carries, which is what makes a stale source honest without a hedge in
-- the prose. Rendered as "source dated YYYY-MM-DD" next to the quote.
ALTER TABLE claims ADD COLUMN evidence_date TEXT;
