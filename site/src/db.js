// D1 read layer for the public pages, feeds, MCP and export. Uses the
// native D1 binding (env.DB). Writes live in records.js, newsdesk.js and
// linkstate.js so every content write goes through validation.

import { safeJsonParse } from "./util.js";

const SOURCE_COLS = "id, url, final_url, title, publisher, outlet_id, source_kind, published_on, first_seen, last_checked, http_status, link_state, link_state_since, consecutive_failures, wayback_url, wayback_saved_at, archive_attempts";

export async function all(env, sql, ...binds) {
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results || [];
}

export async function first(env, sql, ...binds) {
  return (await env.DB.prepare(sql).bind(...binds).first()) || null;
}

// Public source object (spec 3.2).
export function sourceObject(s) {
  if (!s) return null;
  return {
    id: s.id,
    url: s.url,
    final_url: s.final_url || null,
    title: s.title,
    publisher: s.publisher,
    published_on: s.published_on || null,
    link_state: s.link_state,
    link_state_since: s.link_state_since || null,
    wayback_url: s.wayback_url || null,
    wayback_saved_at: s.wayback_saved_at || null,
  };
}

// ---------- bots (instrument) ----------

const PATTERNS_KV_KEY = "cache:bot_patterns_v1";
const PATTERNS_TTL_MS = 10 * 60 * 1000;
let memPatterns = null;

export async function getBotPatterns(env) {
  const now = Date.now();
  if (memPatterns && now - memPatterns.at < PATTERNS_TTL_MS) return memPatterns.list;
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
  const rows = await all(env, "SELECT id, slug, name, vendor, kind, ua_pattern, ip_list_url FROM bots");
  const list = rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, vendor: r.vendor, kind: r.kind, pattern: r.ua_pattern, ip_list_url: r.ip_list_url }));
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

export async function insertRequestRow(env, r) {
  await env.DB.prepare(
    `INSERT INTO requests (ts, bot_id, ua_raw, ip_hash, ip_verified, verify_method, asn, country, path, format_served, accept_header, status, referer, cf_bot_category)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(r.ts, r.bot_id, r.ua_raw, r.ip_hash, r.ip_verified, r.verify_method, r.asn, r.country, r.path, r.format_served, r.accept_header, r.status, r.referer, r.cf_bot_category).run();
}

// ---------- sources and claims ----------

export async function getSource(env, id) {
  return first(env, `SELECT ${SOURCE_COLS}, created_at FROM sources WHERE id = ?`, id);
}

export async function getSourcesByIds(env, ids) {
  const clean = [...new Set((ids || []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
  if (!clean.length) return [];
  return all(env, `SELECT ${SOURCE_COLS} FROM sources WHERE id IN (${clean.map(() => "?").join(",")})`, ...clean);
}

export async function listSourceChecks(env, sourceId, limit = 50) {
  return all(env, "SELECT checked_at, checker, http_status, final_url, observed_state, detail FROM source_checks WHERE source_id = ? ORDER BY checked_at DESC LIMIT ?", sourceId, limit);
}

export async function getClaim(env, id) {
  return first(env, "SELECT * FROM claims WHERE id = ?", id);
}

export async function listClaimsFor(env, subjectType, subjectId, { currentOnly = true } = {}) {
  const rows = await all(
    env,
    `SELECT * FROM claims WHERE subject_type = ? AND subject_id = ? ${currentOnly ? "AND status = 'current'" : ""} ORDER BY id`,
    subjectType, subjectId
  );
  return attachSources(env, rows);
}

export async function attachSources(env, claims) {
  const sources = await getSourcesByIds(env, claims.map((c) => c.source_id));
  const byId = new Map(sources.map((s) => [s.id, s]));
  return claims.map((c) => ({ ...c, source: sourceObject(byId.get(c.source_id)) }));
}

export async function getClaimsByIds(env, ids) {
  const clean = [...new Set(ids.filter(Number.isInteger))];
  if (!clean.length) return [];
  const rows = await all(env, `SELECT * FROM claims WHERE id IN (${clean.map(() => "?").join(",")})`, ...clean);
  return attachSources(env, rows);
}

export async function listAllCurrentClaims(env, limit = 10000) {
  return all(env, "SELECT id, subject_type, subject_id, created_at FROM claims WHERE status = 'current' ORDER BY id LIMIT ?", limit);
}

// ---------- incidents ----------

const INCIDENT_LIST_COLS = "id, slug, title, occurred_on, occurred_on_precision, ended_on, jurisdiction, country, level, type, summary, status, status_updated_on, pub_state, published_at, reviewed_on, updated_at";

export async function listIncidents(env, { type, level, country, status, actorId, limit = 500 } = {}) {
  const where = ["i.pub_state = 'published'"];
  const binds = [];
  if (type) { where.push("i.type = ?"); binds.push(type); }
  if (level) { where.push("i.level = ?"); binds.push(level); }
  if (country) { where.push("i.country = ?"); binds.push(country.toUpperCase()); }
  if (status) { where.push("i.status = ?"); binds.push(status); }
  if (actorId) { where.push("i.id IN (SELECT incident_id FROM incident_actors WHERE actor_id = ?)"); binds.push(actorId); }
  binds.push(limit);
  return all(env, `SELECT ${INCIDENT_LIST_COLS.split(", ").map((c) => "i." + c).join(", ")} FROM incidents i WHERE ${where.join(" AND ")} ORDER BY i.occurred_on DESC, i.id DESC LIMIT ?`, ...binds);
}

export async function getIncidentRow(env, slug) {
  return first(env, "SELECT * FROM incidents WHERE slug = ?", slug);
}

export async function getIncidentFull(env, slug) {
  const inc = await getIncidentRow(env, slug);
  if (!inc) return null;
  if (inc.pub_state !== "published") return { row: inc };
  const [actors, outlets, journalists, cases, related, events, claims, srcRows] = await Promise.all([
    all(env, `SELECT a.id, a.slug, a.name, a.kind, a.body_type, a.role AS actor_role, a.office, a.jurisdiction, a.wikidata_qid, a.official_url, ia.role, ia.role_at_time
              FROM incident_actors ia JOIN actors a ON a.id = ia.actor_id WHERE ia.incident_id = ? AND a.pub_state = 'published' ORDER BY a.name`, inc.id),
    all(env, `SELECT o.id, o.slug, o.name, o.kind, o.homepage_url, io.relation FROM incident_outlets io JOIN outlets o ON o.id = io.outlet_id
              WHERE io.incident_id = ? AND o.pub_state = 'published' ORDER BY o.name`, inc.id),
    all(env, `SELECT j.id, j.slug, j.name, j.role, ij.relation, o.slug AS outlet_slug, o.name AS outlet_name FROM incident_journalists ij
              JOIN journalists j ON j.id = ij.journalist_id LEFT JOIN outlets o ON o.id = COALESCE(ij.outlet_id_at_time, j.outlet_id)
              WHERE ij.incident_id = ? AND j.pub_state = 'published' ORDER BY j.name`, inc.id),
    all(env, `SELECT c.id, c.slug, c.caption, c.short_name, c.court, c.docket, c.status, c.filed_on, c.decided_on, ic.relation FROM incident_cases ic
              JOIN cases c ON c.id = ic.case_id WHERE ic.incident_id = ? AND c.pub_state = 'published' ORDER BY c.filed_on`, inc.id),
    all(env, `SELECT i.slug, i.title, i.occurred_on, i.occurred_on_precision, ir.relation FROM incident_related ir JOIN incidents i ON i.id = ir.related_id
              WHERE ir.incident_id = ? AND i.pub_state = 'published' ORDER BY i.occurred_on`, inc.id),
    all(env, `SELECT e.id, e.occurred_on, e.occurred_on_precision, e.kind, e.label, e.claim_id, c.slug AS case_slug FROM events e LEFT JOIN cases c ON c.id = e.case_id
              WHERE e.incident_id = ? AND e.pub_state = 'published' ORDER BY e.occurred_on, e.id`, inc.id),
    listClaimsFor(env, "incident", inc.id),
    all(env, `SELECT s.*, ins.role AS cite_role, ins.sort FROM incident_sources ins JOIN sources s ON s.id = ins.source_id WHERE ins.incident_id = ? ORDER BY ins.sort, s.id`, inc.id),
  ]);
  return { row: inc, actors, outlets, journalists, cases, related, events, claims, sources: srcRows };
}

// ---------- actors / outlets / journalists ----------

export async function listActors(env) {
  return all(env, `SELECT a.id, a.slug, a.name, a.kind, a.body_type, a.role, a.office, a.jurisdiction, a.country, a.updated_at,
    (SELECT COUNT(DISTINCT ia.incident_id) FROM incident_actors ia JOIN incidents i ON i.id = ia.incident_id WHERE ia.actor_id = a.id AND i.pub_state = 'published') AS incident_count
    FROM actors a WHERE a.pub_state = 'published' ORDER BY a.name`);
}

export async function getActorFull(env, slug) {
  const row = await first(env, "SELECT * FROM actors WHERE slug = ?", slug);
  if (!row || row.pub_state !== "published") return row ? { row } : null;
  const incidents = await all(env, `SELECT i.slug, i.title, i.occurred_on, i.occurred_on_precision, i.type, i.status, ia.role, ia.role_at_time
    FROM incident_actors ia JOIN incidents i ON i.id = ia.incident_id WHERE ia.actor_id = ? AND i.pub_state = 'published' ORDER BY i.occurred_on DESC`, row.id);
  const cases = await all(env, `SELECT c.slug, c.caption, c.court, c.status, cp.side FROM case_parties cp JOIN cases c ON c.id = cp.case_id
    WHERE cp.party_type = 'actor' AND cp.party_id = ? AND c.pub_state = 'published'`, row.id);
  const claims = await listClaimsFor(env, "actor", row.id);
  return { row, incidents, cases, claims };
}

export async function listOutlets(env) {
  return all(env, `SELECT o.id, o.slug, o.name, o.kind, o.country, o.homepage_url, o.updated_at,
    (SELECT COUNT(DISTINCT io.incident_id) FROM incident_outlets io JOIN incidents i ON i.id = io.incident_id WHERE io.outlet_id = o.id AND i.pub_state = 'published') AS incident_count
    FROM outlets o WHERE o.pub_state = 'published' ORDER BY o.name`);
}

export async function getOutletFull(env, slug) {
  const row = await first(env, "SELECT * FROM outlets WHERE slug = ?", slug);
  if (!row || row.pub_state !== "published") return row ? { row } : null;
  const incidents = await all(env, `SELECT i.slug, i.title, i.occurred_on, i.occurred_on_precision, i.type, i.status, io.relation
    FROM incident_outlets io JOIN incidents i ON i.id = io.incident_id WHERE io.outlet_id = ? AND i.pub_state = 'published' ORDER BY i.occurred_on DESC`, row.id);
  const journalists = await all(env, "SELECT slug, name, role FROM journalists WHERE outlet_id = ? AND pub_state = 'published' ORDER BY name", row.id);
  const claims = await listClaimsFor(env, "outlet", row.id);
  return { row, incidents, journalists, claims };
}

export async function listJournalists(env) {
  return all(env, `SELECT j.id, j.slug, j.name, j.role, j.updated_at, o.slug AS outlet_slug, o.name AS outlet_name FROM journalists j
    LEFT JOIN outlets o ON o.id = j.outlet_id WHERE j.pub_state = 'published' ORDER BY j.name`);
}

export async function getJournalistFull(env, slug) {
  const row = await first(env, `SELECT j.*, o.slug AS outlet_slug, o.name AS outlet_name FROM journalists j LEFT JOIN outlets o ON o.id = j.outlet_id WHERE j.slug = ?`, slug);
  if (!row || row.pub_state !== "published") return row ? { row } : null;
  const incidents = await all(env, `SELECT i.slug, i.title, i.occurred_on, i.occurred_on_precision, i.type, i.status, ij.relation
    FROM incident_journalists ij JOIN incidents i ON i.id = ij.incident_id WHERE ij.journalist_id = ? AND i.pub_state = 'published' ORDER BY i.occurred_on DESC`, row.id);
  const claims = await listClaimsFor(env, "journalist", row.id);
  return { row, incidents, claims };
}

// ---------- cases ----------

export async function listCases(env) {
  return all(env, "SELECT id, slug, caption, short_name, court, court_level, docket, filed_on, decided_on, status, updated_at FROM cases WHERE pub_state = 'published' ORDER BY COALESCE(filed_on, decided_on) DESC");
}

export async function getCaseFull(env, slug) {
  const row = await first(env, "SELECT * FROM cases WHERE slug = ?", slug);
  if (!row || row.pub_state !== "published") return row ? { row } : null;
  const [partyRows, documents, events, incidents, claims] = await Promise.all([
    all(env, "SELECT party_type, party_id, side FROM case_parties WHERE case_id = ?", row.id),
    all(env, "SELECT s.*, cs.role AS doc_role FROM case_sources cs JOIN sources s ON s.id = cs.source_id WHERE cs.case_id = ? ORDER BY s.published_on, s.id", row.id),
    all(env, "SELECT id, occurred_on, occurred_on_precision, kind, label, claim_id FROM events WHERE case_id = ? AND pub_state = 'published' ORDER BY occurred_on, id", row.id),
    all(env, `SELECT i.id, i.slug, i.title, i.occurred_on, i.occurred_on_precision, ic.relation FROM incident_cases ic JOIN incidents i ON i.id = ic.incident_id
      WHERE ic.case_id = ? AND i.pub_state = 'published' ORDER BY i.occurred_on`, row.id),
    listClaimsFor(env, "case", row.id),
  ]);
  const parties = [];
  for (const p of partyRows) {
    const table = p.party_type === "actor" ? "actors" : p.party_type === "outlet" ? "outlets" : "journalists";
    const r = await first(env, `SELECT slug, name, pub_state FROM ${table} WHERE id = ?`, p.party_id);
    if (r) parties.push({ party_type: p.party_type, side: p.side, slug: r.pub_state === "published" ? r.slug : null, name: r.name });
  }
  return { row, parties, documents, events, incidents, claims };
}

// ---------- timeline ----------

export async function timelineRows(env, { year, actorSlug, type, country, from, to } = {}) {
  const where = ["i.pub_state = 'published'"];
  const binds = [];
  if (type) { where.push("i.type = ?"); binds.push(type); }
  if (country) { where.push("i.country = ?"); binds.push(country.toUpperCase()); }
  if (actorSlug) { where.push("i.id IN (SELECT ia.incident_id FROM incident_actors ia JOIN actors a ON a.id = ia.actor_id WHERE a.slug = ?)"); binds.push(actorSlug); }
  const incRows = await all(env, `SELECT i.id, i.slug, i.title, i.occurred_on, i.occurred_on_precision, i.type, i.country FROM incidents i WHERE ${where.join(" AND ")}`, ...binds);
  const incIds = incRows.map((r) => r.id);
  const bySlug = new Map(incRows.map((r) => [r.id, r]));
  let evRows = [];
  if (incIds.length) {
    evRows = await all(env, `SELECT e.id, e.incident_id, e.case_id, e.occurred_on, e.occurred_on_precision, e.kind, e.label, e.claim_id, c.slug AS case_slug
      FROM events e LEFT JOIN cases c ON c.id = e.case_id WHERE e.pub_state = 'published' AND e.incident_id IN (${incIds.map(() => "?").join(",")})`, ...incIds);
  }
  const rows = incRows.map((i) => ({
    date: i.occurred_on, precision: i.occurred_on_precision, kind: "incident", label: i.title,
    incident_slug: i.slug, case_slug: null, claim_id: null,
  }));
  for (const e of evRows) {
    const inc = bySlug.get(e.incident_id);
    rows.push({ date: e.occurred_on, precision: e.occurred_on_precision, kind: e.kind, label: e.label, incident_slug: inc ? inc.slug : null, case_slug: e.case_slug || null, claim_id: e.claim_id });
  }
  let out = rows;
  if (year) out = out.filter((r) => r.date.startsWith(String(year)));
  if (from) out = out.filter((r) => r.date >= from);
  if (to) out = out.filter((r) => r.date <= to);
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.kind === "incident" ? -1 : 1)));
  return out;
}

// ---------- news desk ----------

export async function listNotes(env, { limit = 30, offset = 0 } = {}) {
  return all(env, `SELECT id, slug, title, note, word_count, primary_source_id, secondary_source_ids, incident_id, story_date, state, published_at, created_at
    FROM news_desk_notes WHERE state = 'published' ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?`, limit, offset);
}

export async function countPublishedNotes(env) {
  const r = await first(env, "SELECT COUNT(*) AS n FROM news_desk_notes WHERE state = 'published'");
  return r ? r.n : 0;
}

export async function getNoteBySlug(env, slug) {
  return first(env, "SELECT * FROM news_desk_notes WHERE slug = ?", slug);
}

export async function noteWithSources(env, n) {
  const secondary = safeJsonParse(n.secondary_source_ids, []) || [];
  const sources = await getSourcesByIds(env, [n.primary_source_id, ...secondary]);
  const byId = new Map(sources.map((s) => [s.id, s]));
  let incident = null;
  if (n.incident_id) incident = await first(env, "SELECT slug, title, pub_state FROM incidents WHERE id = ?", n.incident_id);
  return {
    primary: byId.get(n.primary_source_id) || null,
    secondary: secondary.map((id) => byId.get(parseInt(id, 10))).filter(Boolean),
    incident: incident && incident.pub_state === "published" ? incident : null,
  };
}

// ---------- glossary / explainers ----------

export async function listGlossary(env) {
  return all(env, "SELECT id, slug, term, definition, updated_at FROM glossary_terms WHERE pub_state = 'published' ORDER BY term COLLATE NOCASE");
}

export async function getGlossaryTerm(env, slug) {
  const row = await first(env, "SELECT * FROM glossary_terms WHERE slug = ?", slug);
  if (!row || row.pub_state !== "published") return row ? { row } : null;
  const sources = await all(env, "SELECT s.* FROM glossary_sources gs JOIN sources s ON s.id = gs.source_id WHERE gs.term_id = ? ORDER BY s.id", row.id);
  return { row, sources };
}

export async function listExplainers(env) {
  return all(env, "SELECT id, slug, title, dek, published_at, updated_at FROM explainers WHERE pub_state = 'published' ORDER BY published_at DESC");
}

export async function getExplainer(env, slug) {
  const row = await first(env, "SELECT * FROM explainers WHERE slug = ?", slug);
  if (!row || row.pub_state !== "published") return row ? { row } : null;
  const sources = await all(env, "SELECT s.* FROM explainer_sources es JOIN sources s ON s.id = es.source_id WHERE es.explainer_id = ? ORDER BY es.sort, s.id", row.id);
  return { row, sources };
}

// ---------- changes ----------

export async function listChanges(env, { limit = 200, correctionsOnly = false } = {}) {
  return all(env, `SELECT * FROM changes ${correctionsOnly ? "WHERE is_correction = 1" : ""} ORDER BY changed_at DESC, id DESC LIMIT ?`, limit);
}

export async function listRevertedNotes(env) {
  return all(env, "SELECT slug, title, story_date, published_at, reverted_at, revert_reason FROM news_desk_notes WHERE state = 'reverted' ORDER BY reverted_at DESC");
}

// Record path for a change row (public ledger links).
export async function recordPathFor(env, recordType, recordId) {
  const map = { incident: ["incidents", "/incidents/"], actor: ["actors", "/actors/"], outlet: ["outlets", "/outlets/"], journalist: ["journalists", "/journalists/"], case: ["cases", "/cases/"], explainer: ["explainers", "/explainers/"], glossary_term: ["glossary_terms", "/glossary/"], news_desk_note: ["news_desk_notes", "/news/"] };
  const m = map[recordType];
  if (!m || !recordId) return null;
  const r = await first(env, `SELECT slug FROM ${m[0]} WHERE id = ?`, recordId);
  return r ? `${m[1]}${r.slug}` : null;
}

// ---------- search ----------

export async function upsertQuestion(env, { textRaw, textNorm, hash, source, ts, resultCount }) {
  const existing = await first(env, "SELECT id, sources FROM questions WHERE hash = ?", hash);
  if (existing) {
    const sources = new Set(safeJsonParse(existing.sources, []) || []);
    sources.add(source);
    await env.DB.prepare("UPDATE questions SET ts_last = ?, count = count + 1, sources = ?, result_count = ? WHERE id = ?")
      .bind(ts, JSON.stringify([...sources]), resultCount || 0, existing.id).run();
    return existing.id;
  }
  const res = await env.DB.prepare("INSERT INTO questions (ts_first, ts_last, text_raw, text_norm, hash, count, sources, result_count) VALUES (?,?,?,?,?,1,?,?)")
    .bind(ts, ts, textRaw, textNorm, hash, JSON.stringify([source]), resultCount || 0).run();
  return res.meta && res.meta.last_row_id;
}

// FTS5 first (search_fts), falling back to LIKE term overlap when the FTS
// table is missing or the query does not parse.
export async function searchRecords(env, q, limit = 30) {
  const terms = String(q || "").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((t) => t.length > 1).slice(0, 8);
  if (!terms.length) return [];
  try {
    const ftsQuery = terms.map((t) => `"${t.replace(/"/g, "")}"*`).join(" OR ");
    const rows = await all(env, "SELECT record_type, record_id, title, snippet(search_fts, 3, '', '', '...', 20) AS snippet, bm25(search_fts) AS score FROM search_fts WHERE search_fts MATCH ? ORDER BY score LIMIT ?", ftsQuery, limit);
    if (rows.length) return resolveSearchRows(env, rows);
  } catch {
    // fall through to LIKE
  }
  const like = `%${terms[0]}%`;
  const rows = await all(env, `SELECT 'incident' AS record_type, id AS record_id, title, summary AS snippet FROM incidents WHERE pub_state = 'published' AND (title LIKE ? OR summary LIKE ? OR what_happened LIKE ?)
    UNION ALL SELECT 'case', id, caption, holding FROM cases WHERE pub_state = 'published' AND (caption LIKE ? OR holding LIKE ?)
    UNION ALL SELECT 'actor', id, name, role FROM actors WHERE pub_state = 'published' AND (name LIKE ? OR role LIKE ?)
    UNION ALL SELECT 'glossary_term', id, term, definition FROM glossary_terms WHERE pub_state = 'published' AND (term LIKE ? OR definition LIKE ?) LIMIT ?`,
  like, like, like, like, like, like, like, like, like, limit);
  return resolveSearchRows(env, rows);
}

async function resolveSearchRows(env, rows) {
  const out = [];
  for (const r of rows) {
    const path = await recordPathFor(env, r.record_type, r.record_id);
    if (!path) continue;
    const table = { incident: "incidents", case: "cases", actor: "actors", outlet: "outlets", journalist: "journalists", glossary_term: "glossary_terms", explainer: "explainers" }[r.record_type];
    if (table) {
      const pub = await first(env, `SELECT pub_state FROM ${table} WHERE id = ?`, r.record_id);
      if (!pub || pub.pub_state !== "published") continue;
    }
    out.push({ record_type: r.record_type, title: r.title, path, snippet: String(r.snippet || "").replace(/\{c:\d+\}/g, "").slice(0, 300) });
  }
  return out;
}

// ---------- health / export bookkeeping ----------

export async function countsForHealth(env) {
  const tables = ["incidents", "actors", "outlets", "journalists", "cases", "events", "claims", "sources", "news_desk_notes", "explainers", "glossary_terms", "changes", "submissions", "requests", "questions", "mcp_calls", "admin_writes", "admin_denials"];
  const out = {};
  for (const t of tables) {
    try {
      const r = await first(env, `SELECT COUNT(*) AS n FROM ${t}`);
      out[t] = r ? r.n : 0;
    } catch {
      out[t] = null;
    }
  }
  for (const t of ["incidents", "actors", "outlets", "journalists", "cases", "explainers", "glossary_terms"]) {
    const r = await first(env, `SELECT COUNT(*) AS n FROM ${t} WHERE pub_state = 'published'`);
    out[`${t}_published`] = r ? r.n : 0;
  }
  const cur = await first(env, "SELECT COUNT(*) AS n FROM claims WHERE status = 'current'");
  out.claims_current = cur ? cur.n : 0;
  return out;
}

export async function getLastExport(env) {
  return first(env, "SELECT * FROM exports ORDER BY id DESC LIMIT 1");
}

export async function insertExportRow(env, { ts, kind, r2Key, githubCommit, rowCounts, version, note }) {
  const res = await env.DB.prepare("INSERT INTO exports (ts, kind, r2_key, github_commit, row_counts, datapackage_version, note) VALUES (?,?,?,?,?,?,?)")
    .bind(ts, kind, r2Key, githubCommit, JSON.stringify(rowCounts), version || null, note || null).run();
  return { id: res.meta && res.meta.last_row_id, ts, kind, r2_key: r2Key, github_commit: githubCommit, row_counts: rowCounts, datapackage_version: version, note };
}
