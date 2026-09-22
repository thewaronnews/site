-- Full-text search (spec section 2.2). Kept separate from 0001 so a failure
-- here falls back to term-overlap search without blocking the schema.
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(record_type, record_id UNINDEXED, title, body);
