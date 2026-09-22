// v2 search and filter (brief 2026-09-22): one faceted incident query used
// by /incidents, /search, /compare, the country, continent, tactic, era and
// leader pages, the CSV downloads and the MCP tools; full-text search over
// incidents, actors, outlets, cases, tactics, glossary, countries and
// recent coverage (search_fts from migration 0003, rebuilt here).

import { all, first } from "./db.js";
import { mdToPlain, isoNow } from "./util.js";
import { SITE_ORIGIN, CONTINENTS, LEVEL_LABELS, OUTCOME_LABELS } from "./site.js";

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;
export const FACET_KEYS = ["country", "continent", "tactic", "from", "to", "level", "actor", "leader", "outlet", "outcome", "source_kind", "has_case"];
const SORTS = ["date", "date_asc", "country", "tactic", "relevance"];
const SOURCE_KINDS = ["reporting", "primary_document", "court_record", "official_statement", "dataset", "reference"];

// ---------- reference maps (cached per isolate for a minute) ----------

let refCache = null;
export async function refData(env) {
  if (refCache && Date.now() - refCache.at < 60000) return refCache;
  const [countries, tactics, actors, outlets] = await Promise.all([
    all(env, "SELECT iso2, name, continent, region, press_freedom_rank_latest, press_freedom_rank_year, press_freedom_source_url FROM countries"),
    all(env, "SELECT slug, name, definition, first_recorded_on, notes, sort FROM tactics ORDER BY sort"),
    all(env, "SELECT slug, name, office, role, pub_state FROM actors"),
    all(env, "SELECT slug, name, pub_state FROM outlets"),
  ]);
  refCache = {
    at: Date.now(),
    countries: new Map(countries.map((c) => [c.iso2, c])),
    countryList: countries,
    tactics: new Map(tactics.map((t) => [t.slug, t])),
    tacticList: tactics,
    actors: new Map(actors.map((a) => [a.slug, a])),
    outlets: new Map(outlets.map((o) => [o.slug, o])),
  };
  return refCache;
}

export function countryName(ref, iso2) {
  const c = ref.countries.get(String(iso2 || "").toUpperCase());
  return c ? c.name : iso2 || "";
}

// ---------- parameters ----------

const DATE_ARG = /^\d{4}(-\d{2}(-\d{2})?)?$/;

// Reads and validates the facet parameters from a URLSearchParams or a
// plain object (MCP). Unknown values are dropped, never passed to SQL.
export function readFilters(src, ref) {
  const get = (k) => {
    const v = src instanceof URLSearchParams ? src.get(k) : src[k];
    return v === undefined || v === null ? "" : String(v).trim();
  };
  const f = {};
  const q = get("q") || get("query");
  if (q) f.q = q.slice(0, 200);
  const countries = get("country").toUpperCase().split(",").map((s) => s.trim()).filter((c) => ref.countries.has(c));
  if (countries.length) f.country = [...new Set(countries)].sort().join(",");
  const cont = get("continent").toLowerCase();
  if (CONTINENTS[cont]) f.continent = cont;
  const tactic = get("tactic").toLowerCase();
  if (ref.tactics.has(tactic)) f.tactic = tactic;
  const from = get("from");
  if (DATE_ARG.test(from)) f.from = from;
  const to = get("to");
  if (DATE_ARG.test(to)) f.to = to;
  const level = get("level");
  if (LEVEL_LABELS[level]) f.level = level;
  const actor = get("actor").toLowerCase();
  if (/^[a-z0-9-]{1,80}$/.test(actor)) f.actor = actor;
  const leader = get("leader").toLowerCase();
  if (/^[a-z0-9-]{1,80}$/.test(leader)) f.leader = leader;
  const outlet = get("outlet").toLowerCase();
  if (/^[a-z0-9-]{1,80}$/.test(outlet)) f.outlet = outlet;
  const outcome = get("outcome");
  if (OUTCOME_LABELS[outcome]) f.outcome = outcome;
  const sk = get("source_kind");
  if (SOURCE_KINDS.includes(sk)) f.source_kind = sk;
  const hc = get("has_case").toLowerCase();
  if (["1", "true", "yes"].includes(hc)) f.has_case = "1";
  else if (["0", "false", "no"].includes(hc)) f.has_case = "0";
  const sort = get("sort");
  if (SORTS.includes(sort) && sort !== "date") f.sort = sort;
  const page = parseInt(get("page"), 10);
  if (page > 1) f.page = String(Math.min(page, 10000));
  const per = parseInt(get("per_page") || get("limit"), 10);
  if (per > 0 && per !== DEFAULT_PAGE_SIZE) f.per_page = String(Math.min(per, MAX_PAGE_SIZE));
  const view = get("view");
  if (view === "cards") f.view = "cards";
  return f;
}

const PARAM_ORDER = ["q", ...FACET_KEYS, "sort", "per_page", "page", "view"];

// Canonical query string: fixed parameter order, defaults left out.
export function canonicalQuery(f, omit = []) {
  const parts = [];
  for (const k of PARAM_ORDER) {
    if (omit.includes(k)) continue;
    if (f[k] !== undefined && f[k] !== null && f[k] !== "") parts.push(`${k}=${encodeURIComponent(f[k]).replace(/%2C/g, ",")}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function hasFacets(f) {
  return FACET_KEYS.some((k) => f[k]);
}

function toBound(to) {
  if (/^\d{4}$/.test(to)) return `${to}-12-31`;
  if (/^\d{4}-\d{2}$/.test(to)) return `${to}-31`;
  return to;
}

// ---------- the incident query ----------

const COLS = "i.id, i.slug, i.title, i.occurred_on, i.occurred_on_precision, i.ended_on, i.jurisdiction, i.country, i.continent, i.level, i.type, i.tactic_primary, i.leader_slug, i.issue_of_the_day, i.outcome, i.outcome_on, i.outcome_note, i.granularity, i.era, i.summary, i.status, i.status_updated_on, i.published_at, i.reviewed_on, i.updated_at";

async function ftsIncidentIds(env, q) {
  const terms = String(q || "").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((t) => t.length > 1).slice(0, 8);
  if (!terms.length) return null;
  try {
    const rows = await all(env, "SELECT record_id, bm25(search_fts) AS score FROM search_fts WHERE search_fts MATCH ? AND record_type = 'incident' ORDER BY score LIMIT 1000", terms.map((t) => `"${t.replace(/"/g, "")}"*`).join(" AND "));
    const rows2 = rows.length ? rows : await all(env, "SELECT record_id, bm25(search_fts) AS score FROM search_fts WHERE search_fts MATCH ? AND record_type = 'incident' ORDER BY score LIMIT 1000", terms.map((t) => `"${t.replace(/"/g, "")}"*`).join(" OR "));
    return new Map(rows2.map((r, i) => [parseInt(r.record_id, 10), i]));
  } catch {
    const like = `%${terms[0]}%`;
    const rows = await all(env, "SELECT id FROM incidents WHERE pub_state = 'published' AND (title LIKE ? OR summary LIKE ? OR what_happened LIKE ?)", like, like, like);
    return new Map(rows.map((r, i) => [r.id, i]));
  }
}

// Returns {rows (this page), total, page, pages, perPage, facets, filters}.
export async function queryIncidents(env, f, { paginate = true } = {}) {
  const ref = await refData(env);
  const where = ["i.pub_state = 'published'"];
  const binds = [];
  if (f.country) { const cs = f.country.split(","); where.push(`i.country IN (${cs.map(() => "?").join(",")})`); binds.push(...cs); }
  if (f.continent) { where.push("i.continent = ?"); binds.push(f.continent); }
  if (f.tactic) { where.push("i.id IN (SELECT incident_id FROM incident_tactics WHERE tactic_slug = ?)"); binds.push(f.tactic); }
  if (f.from) { where.push("i.occurred_on >= ?"); binds.push(f.from); }
  if (f.to) { where.push("substr(i.occurred_on, 1, 10) <= ?"); binds.push(toBound(f.to)); }
  if (f.level) { where.push("i.level = ?"); binds.push(f.level); }
  if (f.actor) { where.push("i.id IN (SELECT ia.incident_id FROM incident_actors ia JOIN actors a ON a.id = ia.actor_id WHERE a.slug = ?)"); binds.push(f.actor); }
  if (f.leader) { where.push("i.leader_slug = ?"); binds.push(f.leader); }
  if (f.outlet) { where.push("i.id IN (SELECT io.incident_id FROM incident_outlets io JOIN outlets o ON o.id = io.outlet_id WHERE o.slug = ?)"); binds.push(f.outlet); }
  if (f.outcome) { where.push("i.outcome = ?"); binds.push(f.outcome); }
  if (f.source_kind) { where.push("i.id IN (SELECT ins.incident_id FROM incident_sources ins JOIN sources s ON s.id = ins.source_id WHERE s.source_kind = ?)"); binds.push(f.source_kind); }
  if (f.has_case === "1") where.push("EXISTS (SELECT 1 FROM incident_cases ic WHERE ic.incident_id = i.id)");
  if (f.has_case === "0") where.push("NOT EXISTS (SELECT 1 FROM incident_cases ic WHERE ic.incident_id = i.id)");
  let rows = await all(env, `SELECT ${COLS}, (SELECT COUNT(*) FROM incident_cases ic WHERE ic.incident_id = i.id) AS case_count FROM incidents i WHERE ${where.join(" AND ")} ORDER BY i.occurred_on DESC, i.id DESC`, ...binds);
  let rank = null;
  if (f.q) {
    rank = await ftsIncidentIds(env, f.q);
    if (rank) rows = rows.filter((r) => rank.has(r.id));
  }
  const tacticRows = rows.length ? await all(env, "SELECT it.incident_id, it.tactic_slug, it.is_primary FROM incident_tactics it JOIN incidents i ON i.id = it.incident_id WHERE i.pub_state = 'published'") : [];
  const tacticsBy = new Map();
  for (const t of tacticRows) {
    if (!tacticsBy.has(t.incident_id)) tacticsBy.set(t.incident_id, []);
    tacticsBy.get(t.incident_id).push(t.tactic_slug);
  }
  rows = rows.map((r) => enrich(r, ref, tacticsBy.get(r.id) || (r.tactic_primary ? [r.tactic_primary] : [])));
  const sort = f.sort || (f.q ? "relevance" : "date");
  if (sort === "date_asc") rows.sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.id - b.id);
  else if (sort === "country") rows.sort((a, b) => a.country_name.localeCompare(b.country_name) || b.occurred_on.localeCompare(a.occurred_on));
  else if (sort === "tactic") rows.sort((a, b) => (a.tactic_name || "~").localeCompare(b.tactic_name || "~") || b.occurred_on.localeCompare(a.occurred_on));
  else if (sort === "relevance" && rank) rows.sort((a, b) => rank.get(a.id) - rank.get(b.id));
  const facets = facetCounts(rows, ref);
  const total = rows.length;
  const perPage = Math.min(parseInt(f.per_page || DEFAULT_PAGE_SIZE, 10) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(parseInt(f.page || "1", 10) || 1, pages);
  const pageRows = paginate ? rows.slice((page - 1) * perPage, page * perPage) : rows;
  return { rows: pageRows, all: rows, total, page, pages, perPage, facets, filters: f, sort };
}

export function enrich(r, ref, tactics) {
  const leader = r.leader_slug ? ref.actors.get(r.leader_slug) : null;
  const t = r.tactic_primary ? ref.tactics.get(r.tactic_primary) : null;
  const c = ref.countries.get(r.country);
  return {
    ...r,
    country_name: c ? c.name : r.country,
    continent: r.continent || (c ? c.continent : null),
    continent_name: CONTINENTS[r.continent || (c && c.continent)] || null,
    tactic_name: t ? t.name : null,
    tactics: tactics || [],
    leader_name: leader ? leader.name : null,
    era: r.era || `${String(r.occurred_on).slice(0, 3)}0s`,
    url: `${SITE_ORIGIN}/incidents/${r.slug}`,
  };
}

function bump(m, k) {
  if (k === null || k === undefined || k === "") return;
  m[k] = (m[k] || 0) + 1;
}

export function facetCounts(rows) {
  const out = { country: {}, continent: {}, tactic: {}, level: {}, outcome: {}, era: {}, year: {}, leader: {}, has_case: {} };
  for (const r of rows) {
    bump(out.country, r.country);
    bump(out.continent, r.continent);
    for (const t of r.tactics) bump(out.tactic, t);
    bump(out.level, r.level);
    bump(out.outcome, r.outcome);
    bump(out.era, r.era);
    bump(out.year, String(r.occurred_on).slice(0, 4));
    bump(out.leader, r.leader_slug);
    bump(out.has_case, r.case_count > 0 ? "1" : "0");
  }
  return out;
}

// ---------- descriptive titles ----------

export function describeFilters(f, ref, { lead = "Incidents" } = {}) {
  const bits = [];
  let head = lead;
  if (f.tactic) head = `${lead}: ${ref.tactics.get(f.tactic).name.toLowerCase()}`;
  if (f.country) bits.push(`in ${f.country.split(",").map((c) => countryName(ref, c)).join(", ")}`);
  else if (f.continent) bits.push(`in ${CONTINENTS[f.continent]}`);
  if (f.from && f.to) bits.push(`${f.from} to ${f.to}`);
  else if (f.from) bits.push(`from ${f.from}`);
  else if (f.to) bits.push(`to ${f.to}`);
  if (f.level) bits.push(`${LEVEL_LABELS[f.level].toLowerCase()} level`);
  if (f.leader) { const a = ref.actors.get(f.leader); bits.push(`head of government ${a ? a.name : f.leader}`); }
  if (f.actor) { const a = ref.actors.get(f.actor); bits.push(`naming ${a ? a.name : f.actor}`); }
  if (f.outlet) { const o = ref.outlets.get(f.outlet); bits.push(`affecting ${o ? o.name : f.outlet}`); }
  if (f.outcome) bits.push(`outcome ${OUTCOME_LABELS[f.outcome].toLowerCase()}`);
  if (f.source_kind) bits.push(`with ${f.source_kind.replace(/_/g, " ")} sources`);
  if (f.has_case === "1") bits.push("with a court case");
  if (f.has_case === "0") bits.push("without a court case");
  return bits.length ? `${head}, ${bits.join(", ")}` : head;
}

// ---------- CSV ----------

const CSV_COLS = ["slug", "title", "occurred_on", "occurred_on_precision", "country", "country_name", "continent", "jurisdiction", "level", "tactic_primary", "tactics", "leader_slug", "leader_name", "issue_of_the_day", "outcome", "outcome_on", "outcome_note", "era", "granularity", "status", "status_updated_on", "case_count", "summary", "url"];

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join(";") : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function incidentsCsv(rows) {
  const lines = [CSV_COLS.join(",")];
  for (const r of rows) lines.push(CSV_COLS.map((c) => csvCell(c === "summary" ? mdToPlain(r.summary) : r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function csvResponse(body, filename) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ---------- full-text search across record types ----------

const RECORD_PATHS = {
  incident: (r) => `/incidents/${r}`, actor: (r) => `/actors/${r}`, outlet: (r) => `/outlets/${r}`, case: (r) => `/cases/${r}`,
  glossary_term: (r) => `/glossary/${r}`, tactic: (r) => `/tactics/${r}`, country: (r) => `/countries/${String(r).toLowerCase()}`, journalist: (r) => `/journalists/${r}`,
};

export async function searchAll(env, q, { limit = 40, types = null } = {}) {
  const terms = String(q || "").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((t) => t.length > 1).slice(0, 8);
  if (!terms.length) return [];
  let rows = [];
  try {
    const run = (op) => all(env, "SELECT record_type, record_id, title, snippet(search_fts, 3, '', '', '...', 24) AS snippet, bm25(search_fts) AS score FROM search_fts WHERE search_fts MATCH ? ORDER BY score LIMIT ?", terms.map((t) => `"${t.replace(/"/g, "")}"*`).join(op), limit * 2);
    rows = await run(" AND ");
    if (!rows.length) rows = await run(" OR ");
  } catch {
    rows = [];
  }
  const out = [];
  for (const r of rows) {
    if (types && !types.includes(r.record_type)) continue;
    const item = await resolveHit(env, r);
    if (item) out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

async function resolveHit(env, r) {
  const snippet = String(r.snippet || "").replace(/\{c:\d+\}/g, "").slice(0, 300);
  if (r.record_type === "coverage_item") {
    const c = await first(env, "SELECT id, url, title, publisher, published_at FROM coverage_items WHERE id = ? AND state = 'shown'", parseInt(r.record_id, 10));
    return c ? { record_type: "coverage_item", title: c.title, path: null, url: c.url, publisher: c.publisher, published_at: c.published_at, snippet } : null;
  }
  if (r.record_type === "tactic" || r.record_type === "country") {
    return { record_type: r.record_type, title: r.title, path: RECORD_PATHS[r.record_type](r.record_id), snippet };
  }
  const table = { incident: "incidents", case: "cases", actor: "actors", outlet: "outlets", journalist: "journalists", glossary_term: "glossary_terms" }[r.record_type];
  if (!table) return null;
  const rec = await first(env, `SELECT slug, pub_state FROM ${table} WHERE id = ?`, parseInt(r.record_id, 10));
  if (!rec || rec.pub_state !== "published") return null;
  return { record_type: r.record_type, title: r.title, path: RECORD_PATHS[r.record_type](rec.slug), snippet };
}

// Rebuilds search_fts from the published records (operator endpoint and
// after migrations). Record-level refreshes still happen on every write.
export async function rebuildSearchIndex(env) {
  const ref = await refData(env);
  const docs = [];
  const incidents = await all(env, "SELECT id, title, summary, what_happened, stated_justification, effect_on_reporting, issue_of_the_day, outcome_note, country, jurisdiction, tactic_primary, leader_slug FROM incidents WHERE pub_state = 'published'");
  const itac = await all(env, "SELECT incident_id, tactic_slug FROM incident_tactics");
  for (const i of incidents) {
    const tnames = itac.filter((t) => t.incident_id === i.id).map((t) => (ref.tactics.get(t.tactic_slug) || {}).name).filter(Boolean);
    const leader = i.leader_slug ? (ref.actors.get(i.leader_slug) || {}).name : "";
    docs.push(["incident", i.id, i.title, [i.summary, i.what_happened, i.stated_justification, i.effect_on_reporting, i.issue_of_the_day, i.outcome_note, countryName(ref, i.country), i.jurisdiction, tnames.join(" "), leader].map((x) => mdToPlain(x || "")).filter(Boolean).join("\n")]);
  }
  for (const a of await all(env, "SELECT id, name, role, office, jurisdiction, country FROM actors WHERE pub_state = 'published'")) docs.push(["actor", a.id, a.name, [a.role, a.office, countryName(ref, a.country)].filter(Boolean).join("\n")]);
  for (const o of await all(env, "SELECT id, name, kind, country FROM outlets WHERE pub_state = 'published'")) docs.push(["outlet", o.id, o.name, [o.kind.replace(/_/g, " "), countryName(ref, o.country)].join("\n")]);
  for (const j of await all(env, "SELECT id, name, role FROM journalists WHERE pub_state = 'published'")) docs.push(["journalist", j.id, j.name, j.role]);
  for (const c of await all(env, "SELECT id, caption, short_name, court, docket, holding FROM cases WHERE pub_state = 'published'")) docs.push(["case", c.id, c.caption, [c.short_name, c.court, c.docket, mdToPlain(c.holding || "")].filter(Boolean).join("\n")]);
  for (const g of await all(env, "SELECT id, term, definition, body_md FROM glossary_terms WHERE pub_state = 'published'")) docs.push(["glossary_term", g.id, g.term, [mdToPlain(g.definition), mdToPlain(g.body_md || "")].filter(Boolean).join("\n")]);
  for (const t of ref.tacticList) docs.push(["tactic", t.slug, t.name, [t.definition, t.slug.replace(/_/g, " ")].join("\n")]);
  const used = await all(env, "SELECT DISTINCT country FROM incidents WHERE pub_state = 'published'");
  for (const u of used) { const c = ref.countries.get(u.country); if (c) docs.push(["country", c.iso2, c.name, `${c.region}\n${c.iso2}`]); }
  for (const cv of await all(env, "SELECT id, title, publisher, summary FROM coverage_items WHERE state = 'shown'")) docs.push(["coverage_item", cv.id, cv.title, [cv.publisher, cv.summary].filter(Boolean).join("\n")]);
  await env.DB.prepare("DELETE FROM search_fts").run();
  for (let k = 0; k < docs.length; k += 50) {
    await env.DB.batch(docs.slice(k, k + 50).map((d) => env.DB.prepare("INSERT INTO search_fts (record_type, record_id, title, body) VALUES (?,?,?,?)").bind(...d)));
  }
  const counts = {};
  for (const d of docs) counts[d[0]] = (counts[d[0]] || 0) + 1;
  return { rebuilt_at: isoNow(), documents: docs.length, by_type: counts };
}
