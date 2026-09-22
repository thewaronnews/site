// D1 access helpers. Uses the native D1 binding (env.DB), not the REST API,
// since this code runs inside the Worker itself.

import { safeJsonParse, termOverlapScore } from "./util.js";

const PATTERNS_KV_KEY = "cache:entity_patterns_v1";
const PATTERNS_TTL_MS = 10 * 60 * 1000; // 10 minutes, per spec section 6

let memPatterns = null; // { at: number, list: [...] }

export async function getEntityPatterns(env) {
  const now = Date.now();
  if (memPatterns && now - memPatterns.at < PATTERNS_TTL_MS) {
    return memPatterns.list;
  }
  if (env.KV) {
    try {
      const cached = await env.KV.get(PATTERNS_KV_KEY, "json");
      if (cached && now - cached.at < PATTERNS_TTL_MS) {
        memPatterns = { at: cached.at, list: cached.list };
        return cached.list;
      }
    } catch {
      // fall through to D1
    }
  }
  const { results } = await env.DB.prepare(
    `SELECT id, slug, name, vendor, kind, ua_pattern, ip_list_url FROM entities WHERE status = 'active' AND ua_pattern IS NOT NULL`
  ).all();
  const list = (results || []).map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    vendor: r.vendor,
    kind: r.kind,
    pattern: r.ua_pattern,
    ip_list_url: r.ip_list_url,
  }));
  memPatterns = { at: now, list };
  if (env.KV) {
    try {
      await env.KV.put(PATTERNS_KV_KEY, JSON.stringify({ at: now, list }), { expirationTtl: 3600 });
    } catch {
      // best effort
    }
  }
  return list;
}

export async function listEntities(env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM entities ORDER BY vendor, name`
  ).all();
  return results || [];
}

export async function getEntityBySlug(env, slug) {
  return await env.DB.prepare(`SELECT * FROM entities WHERE slug = ?`).bind(slug).first();
}

export async function getEntityById(env, id) {
  return await env.DB.prepare(`SELECT * FROM entities WHERE id = ?`).bind(id).first();
}

export async function listClaimsForEntity(env, entityId, { onlyCurrent = true } = {}) {
  const sql = onlyCurrent
    ? `SELECT * FROM claims WHERE entity_id = ? AND status = 'current' ORDER BY field`
    : `SELECT * FROM claims WHERE entity_id = ? ORDER BY field`;
  const { results } = await env.DB.prepare(sql).bind(entityId).all();
  return results || [];
}

export async function getClaim(env, id) {
  return await env.DB.prepare(`SELECT * FROM claims WHERE id = ?`).bind(id).first();
}

export async function listAllCurrentClaims(env, limit = 5000) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM claims WHERE status = 'current' ORDER BY id LIMIT ?`
  ).bind(limit).all();
  return results || [];
}

// Joins each change row to the claim it is about, so callers can show the
// claim's field (what changed) and link to the claim, without a second
// round trip per row. claim_field/claim_value/claim_statement are null when
// a change has no claim_id (there are none of those today, but the schema
// allows it).
export async function listChanges(env, { entitySlug = null, limit = 200 } = {}) {
  if (entitySlug) {
    const { results } = await env.DB.prepare(
      `SELECT changes.*, entities.slug AS entity_slug, entities.name AS entity_name,
              claims.field AS claim_field, claims.value AS claim_value, claims.statement AS claim_statement
       FROM changes
       JOIN entities ON entities.id = changes.entity_id
       LEFT JOIN claims ON claims.id = changes.claim_id
       WHERE entities.slug = ? ORDER BY changed_at DESC LIMIT ?`
    ).bind(entitySlug, limit).all();
    return results || [];
  }
  const { results } = await env.DB.prepare(
    `SELECT changes.*, entities.slug AS entity_slug, entities.name AS entity_name,
            claims.field AS claim_field, claims.value AS claim_value, claims.statement AS claim_statement
     FROM changes
     LEFT JOIN entities ON entities.id = changes.entity_id
     LEFT JOIN claims ON claims.id = changes.claim_id
     ORDER BY changed_at DESC LIMIT ?`
  ).bind(limit).all();
  return results || [];
}

export async function listObservationDailyForEntity(env, entityId, days = 30) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM observation_daily WHERE entity_id = ? ORDER BY date DESC LIMIT ?`
  ).bind(entityId, days).all();
  return results || [];
}

export async function listObservationDaily(env, days = 30) {
  const { results } = await env.DB.prepare(
    `SELECT observation_daily.*, entities.slug AS entity_slug, entities.name AS entity_name
     FROM observation_daily JOIN entities ON entities.id = observation_daily.entity_id
     ORDER BY date DESC LIMIT ?`
  ).bind(days * 20).all();
  return results || [];
}

// Request-weighted per-entity summary: requests and verified_requests are
// summed over the window (date >= cutoffDate), so the verified share is
// sum(verified_requests)/sum(requests), not a mean of daily shares. first_seen
// and last_seen are unbounded (over every observation_daily row ever rolled
// up for the entity), since "when have we ever seen this crawler" is a
// different question from "how much traffic in the last 30 days". An entity
// with rows only outside the window still appears, with requests = 0.
export async function observationWindowSummary(env, cutoffDate) {
  const { results } = await env.DB.prepare(
    `SELECT observation_daily.entity_id,
            entities.slug AS entity_slug, entities.name AS entity_name,
            SUM(CASE WHEN observation_daily.date >= ? THEN observation_daily.requests ELSE 0 END) AS requests,
            SUM(CASE WHEN observation_daily.date >= ? THEN COALESCE(observation_daily.verified_requests, 0) ELSE 0 END) AS verified_requests,
            MIN(observation_daily.date) AS first_seen,
            MAX(observation_daily.date) AS last_seen
     FROM observation_daily
     JOIN entities ON entities.id = observation_daily.entity_id
     GROUP BY observation_daily.entity_id
     ORDER BY requests DESC, entities.name ASC`
  ).bind(cutoffDate, cutoffDate).all();
  return results || [];
}

// The distinct response formats requested within the window, per entity.
// Kept as a separate query because observation_daily.formats is a per-day
// JSON array and merging those sets is easiest done in JS, not SQL.
export async function observationWindowFormats(env, cutoffDate) {
  const { results } = await env.DB.prepare(
    `SELECT entity_id, formats FROM observation_daily WHERE date >= ?`
  ).bind(cutoffDate).all();
  const byEntity = {};
  for (const r of results || []) {
    const arr = safeJsonParse(r.formats, []);
    if (!Array.isArray(arr)) continue;
    if (!byEntity[r.entity_id]) byEntity[r.entity_id] = new Set();
    for (const f of arr) byEntity[r.entity_id].add(f);
  }
  return byEntity;
}

export async function recentObservations(env, limit = 20) {
  const { results } = await env.DB.prepare(
    `SELECT observations.ts, observations.path, observations.format_served, observations.ip_verified,
            observations.verify_method, entities.slug AS entity_slug, entities.name AS entity_name
     FROM observations LEFT JOIN entities ON entities.id = observations.entity_id
     WHERE observations.entity_id IS NOT NULL
     ORDER BY observations.ts DESC LIMIT ?`
  ).bind(limit).all();
  return results || [];
}

export async function insertObservation(env, row) {
  await env.DB.prepare(
    `INSERT INTO observations
      (ts, entity_id, ua_raw, ip_hash, ip_verified, verify_method, asn, country, path, format_served, accept_header, status, robots_allowed, referer, cf_bot_category)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.ts, row.entity_id ?? null, row.ua_raw ?? null, row.ip_hash ?? null,
    row.ip_verified ? 1 : 0, row.verify_method ?? null, row.asn ?? null, row.country ?? null,
    row.path ?? null, row.format_served ?? null, row.accept_header ?? null, row.status ?? null,
    row.robots_allowed === null || row.robots_allowed === undefined ? null : (row.robots_allowed ? 1 : 0),
    row.referer ?? null, row.cf_bot_category ?? null
  ).run();
}

export async function upsertQuestion(env, { textRaw, textNorm, hash, source, ts }) {
  const existing = await env.DB.prepare(`SELECT * FROM questions WHERE hash = ?`).bind(hash).first();
  if (existing) {
    const sources = safeJsonParse(existing.sources, []);
    if (!sources.includes(source)) sources.push(source);
    await env.DB.prepare(
      `UPDATE questions SET ts_last = ?, count = count + 1, sources = ? WHERE id = ?`
    ).bind(ts, JSON.stringify(sources), existing.id).run();
    return existing.id;
  }
  const res = await env.DB.prepare(
    `INSERT INTO questions (ts_first, ts_last, text_raw, text_norm, hash, count, sources, matched_claim_ids, gap, published)
     VALUES (?,?,?,?,?,1,?,?,?,0)`
  ).bind(ts, ts, textRaw, textNorm, hash, JSON.stringify([source]), JSON.stringify([]), 1).run();
  return res.meta && res.meta.last_row_id;
}

export async function insertNote(env, { ts, targetType, targetId, body, authorClaim, uaRaw, ipHash }) {
  const res = await env.DB.prepare(
    `INSERT INTO notes (ts, target_type, target_id, body, author_claim, ua_raw, ip_hash, status)
     VALUES (?,?,?,?,?,?,?,'pending')`
  ).bind(ts, targetType, targetId ?? null, body, authorClaim ?? null, uaRaw ?? null, ipHash ?? null).run();
  return res.meta && res.meta.last_row_id;
}

export async function listPublishedQuestions(env, limit = 200) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM questions WHERE published = 1 ORDER BY ts_last DESC LIMIT ?`
  ).bind(limit).all();
  return results || [];
}

export async function listGapQuestions(env, limit = 50) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM questions WHERE gap = 1 ORDER BY count DESC, ts_last DESC LIMIT ?`
  ).bind(limit).all();
  return results || [];
}

export async function getQuestionById(env, id) {
  return await env.DB.prepare(`SELECT * FROM questions WHERE id = ?`).bind(id).first();
}

export async function getQuestionByHash(env, hash) {
  return await env.DB.prepare(`SELECT * FROM questions WHERE hash = ?`).bind(hash).first();
}

// Public note shape: exactly these seven columns, in this order, and
// nothing else. This is the one place every public code path (entity,
// claim and question pages, and the export) reads published notes from,
// so ua_raw, ip_hash, reviewer_note and classification can never leak
// through a public JSON, HTML or Markdown view, an export, or a future
// call site that forgets to shape the row itself. The admin API reads
// notes through its own queries below (listNotesByStatus, getNoteById),
// which keep the full row on purpose.
const PUBLIC_NOTE_COLUMNS = "id, target_type, target_id, body, author_claim, ts, status";

export async function listPublishedNotesForTarget(env, targetType, targetId) {
  const { results } = await env.DB.prepare(
    `SELECT ${PUBLIC_NOTE_COLUMNS} FROM notes WHERE target_type = ? AND target_id = ? AND status = 'published' ORDER BY ts DESC`
  ).bind(targetType, targetId).all();
  return results || [];
}

// v1 search: simple term overlap, no embeddings (spec section 7). The
// dataset is small (entities: a few dozen; claims: a few hundred at most
// in this phase) so ranking in JS after a full-table fetch is adequate.
export async function searchEntitiesAndClaims(env, normalizedQuery) {
  const words = normalizedQuery.split(" ").filter(Boolean);
  if (words.length === 0) return { entities: [], claims: [] };

  const { results: allEntities } = await env.DB.prepare(`SELECT * FROM entities`).all();
  const entityScored = (allEntities || [])
    .map((e) => ({
      e,
      score: termOverlapScore(normalizedQuery, `${e.slug} ${e.vendor} ${e.name} ${e.kind} ${e.purpose || ""}`.toLowerCase()),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((x) => x.e);

  const { results: allClaims } = await env.DB.prepare(`SELECT * FROM claims WHERE status = 'current'`).all();
  const claimScored = (allClaims || [])
    .map((c) => ({
      c,
      score: termOverlapScore(normalizedQuery, `${c.field} ${c.statement}`.toLowerCase()),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((x) => x.c);

  return { entities: entityScored, claims: claimScored };
}

export async function migrationApplied(env, filename) {
  const row = await env.DB.prepare(`SELECT filename FROM migrations WHERE filename = ?`).bind(filename).first();
  return !!row;
}

// ---------- P0.5: exports (spec section 9) ----------
// Claims are exported in full (every status), because a superseded or
// disputed claim stays addressable and belongs in the public record just
// as much as a current one. observations is never exported, only its
// observation_daily rollup; questions and notes are filtered to published
// content only, at the call sites below.

export async function listAllClaimsForExport(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM claims ORDER BY id`).all();
  return results || [];
}

export async function listAllChangesForExport(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM changes ORDER BY id`).all();
  return results || [];
}

export async function listAllObservationDailyForExport(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM observation_daily ORDER BY date, entity_id`).all();
  return results || [];
}

export async function listPublishedQuestionsForExport(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, ts_first, ts_last, text_norm, count, sources, matched_claim_ids, gap
     FROM questions WHERE published = 1 ORDER BY id`
  ).all();
  return results || [];
}

export async function listPublishedNotesForExport(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${PUBLIC_NOTE_COLUMNS} FROM notes WHERE status = 'published' ORDER BY id`
  ).all();
  return results || [];
}

export async function listMcpCallsDailyForExport(env) {
  const { results } = await env.DB.prepare(
    `SELECT substr(ts, 1, 10) AS date, tool, COALESCE(client_name, 'unknown') AS client_name,
            COUNT(*) AS calls, ROUND(AVG(latency_ms)) AS avg_latency_ms
     FROM mcp_calls
     WHERE tool != 'initialize'
     GROUP BY date, tool, client_name
     ORDER BY date, tool, client_name`
  ).all();
  return results || [];
}

export async function insertExportRow(env, { ts, kind, r2Key, githubCommit, rowCounts, note }) {
  const res = await env.DB.prepare(
    `INSERT INTO exports (ts, kind, r2_key, github_commit, row_counts, note) VALUES (?,?,?,?,?,?)`
  ).bind(ts, kind, r2Key, githubCommit ?? null, JSON.stringify(rowCounts || {}), note ?? null).run();
  const id = res.meta && res.meta.last_row_id;
  return {
    id,
    ts,
    kind,
    r2_key: r2Key,
    github_commit: githubCommit ?? null,
    row_counts: rowCounts || {},
    note: note ?? null,
  };
}

export async function getLastExport(env) {
  const row = await env.DB.prepare(`SELECT * FROM exports ORDER BY id DESC LIMIT 1`).first();
  if (!row) return null;
  return { ...row, row_counts: safeJsonParse(row.row_counts, {}) };
}

// ---------- P0.5: admin API (spec section 7 / handoff "Notes moderation") ----------

const TABLES_FOR_HEALTH = [
  "entities", "claims", "changes", "observations", "observation_daily",
  "questions", "notes", "exports", "mcp_calls",
];

export async function countsForHealth(env) {
  const out = {};
  for (const t of TABLES_FOR_HEALTH) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${t}`).first();
    out[t] = (row && row.c) || 0;
  }
  return out;
}

// ---------- P1.1: scoped admin tokens / admin_denials (migration 0010) ----------
// Deliberately not in TABLES_FOR_HEALTH or export.js's COLUMN_DESCRIPTIONS:
// admin_denials is an internal security log, never exported, never
// reachable by any public route. GET /admin/health surfaces only a count
// and the latest row's ts/scope/attempted_status, via this function.

export async function insertAdminDenial(env, { ts, scope, method, path, attemptedStatus, noteId, ipHash }) {
  const res = await env.DB.prepare(
    `INSERT INTO admin_denials (ts, scope, method, path, attempted_status, note_id, ip_hash) VALUES (?,?,?,?,?,?,?)`
  ).bind(ts, scope, method, path, attemptedStatus ?? null, noteId ?? null, ipHash ?? null).run();
  return res.meta && res.meta.last_row_id;
}

export async function getAdminDenialsSummary(env) {
  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM admin_denials`).first();
  const latest = await env.DB.prepare(
    `SELECT ts, scope, attempted_status FROM admin_denials ORDER BY id DESC LIMIT 1`
  ).first();
  return { count: (countRow && countRow.c) || 0, latest: latest || null };
}

export async function listNotesByStatus(env, status, limit = 50) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM notes WHERE status = ? ORDER BY ts DESC LIMIT ?`
  ).bind(status, limit).all();
  return results || [];
}

export async function getNoteById(env, id) {
  return await env.DB.prepare(`SELECT * FROM notes WHERE id = ?`).bind(id).first();
}

export async function updateNote(env, id, { status, reviewerNote, classification }) {
  await env.DB.prepare(
    `UPDATE notes SET status = ?, reviewer_note = ?, classification = ? WHERE id = ?`
  ).bind(status, reviewerNote ?? null, classification ?? null, id).run();
  return await getNoteById(env, id);
}

// changed_at is always stored as a full UTC timestamp from this point on
// (migration 0009 backfilled the earlier date-only rows). A caller that
// still passes a bare date (10 chars, YYYY-MM-DD) gets it normalised to
// midnight UTC here, so every writer converges on one shape without every
// call site having to know about it; a caller that passes nothing gets
// the current instant.
function normalizeChangedAt(changedAt) {
  if (!changedAt) return new Date().toISOString();
  if (typeof changedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(changedAt)) {
    return `${changedAt}T00:00:00Z`;
  }
  return changedAt;
}

export async function insertChange(env, { claimId, entityId, changedAt, kind, oldValue, newValue, evidenceUrl, note }) {
  const res = await env.DB.prepare(
    `INSERT INTO changes (claim_id, entity_id, changed_at, kind, old_value, new_value, evidence_url, note)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(claimId ?? null, entityId ?? null, normalizeChangedAt(changedAt), kind, oldValue ?? null, newValue ?? null, evidenceUrl ?? null, note ?? null).run();
  return res.meta && res.meta.last_row_id;
}

export async function updateClaimStatus(env, claimId, status) {
  await env.DB.prepare(`UPDATE claims SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(status, isoNowSafe(), claimId).run();
}

function isoNowSafe() {
  return new Date().toISOString();
}

export async function deleteChangeById(env, id) {
  await env.DB.prepare(`DELETE FROM changes WHERE id = ?`).bind(id).run();
}

export async function getChangeById(env, id) {
  return await env.DB.prepare(`SELECT * FROM changes WHERE id = ?`).bind(id).first();
}
