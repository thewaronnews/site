// Validated content writes (spec sections 2 and 8): record upsert with
// revisions, publish, withdraw, join replacement, claims (create,
// supersede, status), events. Every write the admin API makes to a content
// table goes through here, so validation, revisions, the public change
// ledger and the search index always apply.

import { isoNow, isoDate, slugOk, splitParagraphs, mdToPlain } from "./util.js";
import { lintText } from "./lint.js";
import { all, first } from "./db.js";

// ---------- vocabularies ----------

export const ENUMS = {
  actor_kind: ["person", "body"],
  body_type: ["executive_office", "agency", "regulator", "legislature", "court", "law_enforcement", "foreign_government", "other"],
  outlet_kind: ["newspaper", "broadcaster", "cable_news", "wire_service", "digital", "magazine", "public_media", "press_association", "other"],
  precision: ["day", "month", "year", "approximate"],
  // v2: the tier of government that acted (brief 2026-09-22).
  level: ["national", "state_or_province", "municipal", "supranational"],
  outcome: ["reversed", "upheld", "sustained", "ongoing", "unknown"],
  granularity: ["anchor", "granular"],
  incident_type: ["access_ban", "credential_revocation", "lawsuit_against_press", "regulatory_pressure", "funding_cut", "arrest_or_detention", "subpoena_or_seizure", "legislation", "physical_obstruction", "other"],
  incident_status: ["in_effect", "in_litigation", "enjoined", "reversed", "expired", "resolved", "historical"],
  court_level: ["trial", "appellate", "supreme", "agency", "foreign"],
  case_status: ["pending", "decided", "on_appeal", "settled", "dismissed", "withdrawn"],
  event_kind: ["announcement", "action", "filing", "hearing", "ruling", "appeal", "reversal", "statement", "legislative_step", "other"],
  method: ["primary_document", "outlet_report", "court_record", "official_statement", "observed_here"],
  confidence: ["high", "medium", "low"],
  source_kind: ["reporting", "primary_document", "court_record", "official_statement", "dataset", "reference"],
  actor_role: ["ordered", "announced", "implemented", "enforced", "defended", "legislated", "ruled", "other"],
  outlet_relation: ["affected", "plaintiff", "intervenor"],
  journalist_relation: ["affected", "plaintiff"],
  case_relation: ["arising_from", "precedent_cited"],
  source_role: ["primary", "reporting", "background"],
  related_relation: ["precedent", "follow_on", "parallel"],
  party_type: ["actor", "outlet", "journalist"],
  side: ["plaintiff", "defendant", "appellant", "appellee", "intervenor", "amicus"],
  case_source_role: ["complaint", "opinion", "order", "docket", "brief", "reporting"],
};

// Claim field allowlist (spec 2.4).
export const CLAIM_FIELDS = {
  incident: ["occurred_on", "announced_by", "action", "stated_justification", "effect_on_reporting", "status", "outlet_affected", "journalist_affected", "scope_of_action", "reversed_on"],
  event: ["occurred_on", "action", "filing", "ruling", "quote"],
  case: ["filed_on", "docket", "judge", "claims_asserted", "holding", "decided_on", "status", "appeal"],
  actor: ["role", "term_start", "term_end", "affiliation"],
  outlet: ["role", "term_start", "term_end", "affiliation"],
  journalist: ["role", "term_start", "term_end", "affiliation"],
};

// Record type definitions. `cols` are the writable columns; `prose` are
// Markdown columns that may carry {c:ID}; `own` are short strings in the
// site's own voice that are also linted.
export const TYPES = {
  incident: {
    table: "incidents", path: "/incidents/", claims: true,
    cols: ["title", "occurred_on", "occurred_on_precision", "ended_on", "jurisdiction", "country", "level", "type", "tactic_primary", "leader_slug", "issue_of_the_day", "outcome", "outcome_on", "outcome_note", "granularity", "summary", "what_happened", "stated_justification", "effect_on_reporting", "unknowns", "status", "status_updated_on", "external_ids", "illustration_key", "next_review_on"],
    required: ["title", "occurred_on", "jurisdiction", "level", "summary", "what_happened", "status", "status_updated_on"],
    enums: { occurred_on_precision: "precision", level: "level", type: "incident_type", status: "incident_status", outcome: "outcome", granularity: "granularity" },
    dates: ["occurred_on", "ended_on", "status_updated_on", "next_review_on", "outcome_on"],
    prose: ["summary", "what_happened", "stated_justification", "effect_on_reporting"],
    own: ["title", "unknowns", "issue_of_the_day", "outcome_note"],
    titleCol: "title",
  },
  actor: {
    table: "actors", path: "/actors/", claims: true,
    cols: ["name", "kind", "body_type", "role", "office", "jurisdiction", "country", "term_start", "term_end", "official_url", "wikidata_qid", "unknowns", "next_review_on"],
    required: ["name", "kind", "role", "jurisdiction"],
    enums: { kind: "actor_kind", body_type: "body_type" },
    dates: ["term_start", "term_end", "next_review_on"],
    prose: [], own: ["role", "office", "unknowns"], titleCol: "name",
  },
  outlet: {
    table: "outlets", path: "/outlets/", claims: true,
    cols: ["name", "kind", "country", "homepage_url", "wikidata_qid", "unknowns", "next_review_on"],
    required: ["name", "kind"],
    enums: { kind: "outlet_kind" },
    dates: ["next_review_on"],
    prose: [], own: ["unknowns"], titleCol: "name",
  },
  journalist: {
    table: "journalists", path: "/journalists/", claims: true,
    cols: ["name", "outlet_id", "role", "profile_url"],
    required: ["name", "role"],
    enums: {}, dates: [], prose: [], own: ["role"], titleCol: "name",
  },
  case: {
    table: "cases", path: "/cases/", claims: true,
    cols: ["caption", "short_name", "court", "court_level", "docket", "reporter_citation", "filed_on", "decided_on", "judges", "holding", "status", "courtlistener_url", "unknowns", "next_review_on"],
    required: ["caption", "short_name", "court", "court_level", "status"],
    enums: { court_level: "court_level", status: "case_status" },
    dates: ["filed_on", "decided_on", "next_review_on"],
    prose: ["holding"], own: ["unknowns"], titleCol: "caption",
  },
  explainer: {
    table: "explainers", path: "/explainers/", claims: false,
    cols: ["title", "dek", "body_md", "target_keyword", "surfer_score", "surfer_exception", "word_count", "illustration_key", "unknowns", "next_review_on"],
    required: ["title", "dek", "body_md", "target_keyword"],
    enums: {}, dates: ["next_review_on"], prose: ["body_md"], own: ["title", "dek", "unknowns"], titleCol: "title",
  },
  glossary_term: {
    table: "glossary_terms", path: "/glossary/", claims: false,
    cols: ["term", "definition", "body_md", "see_also"],
    required: ["term", "definition"],
    enums: {}, dates: [], prose: ["definition", "body_md"], own: [], titleCol: "term",
  },
};

export function normalizeType(t) {
  const m = { incidents: "incident", actors: "actor", outlets: "outlet", journalists: "journalist", cases: "case", explainers: "explainer", glossary: "glossary_term", glossary_terms: "glossary_term", glossary_term: "glossary_term" };
  return TYPES[t] ? t : m[t] || null;
}

export class ValidationError extends Error {
  constructor(errors, status = 422) {
    super("validation failed");
    this.errors = Array.isArray(errors) ? errors : [errors];
    this.status = status;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function refsIn(text) {
  return [...String(text || "").matchAll(/\{c:(\d+)\}/g)].map((m) => parseInt(m[1], 10));
}

// Lint a record's own-voice fields; glossary terms may use their own term.
function lintRecord(type, row) {
  const def = TYPES[type];
  const errors = [];
  const exemptTerms = type === "glossary_term" && row.term ? [row.term] : [];
  for (const col of [...def.prose, ...def.own, def.titleCol]) {
    const v = row[col];
    if (typeof v !== "string" || !v) continue;
    const hits = lintText(v, { exemptTerms });
    if (hits.length) errors.push({ field: col, error: "voice_lint", hits: hits.map((h) => h.phrase) });
  }
  return errors;
}

function validateShape(type, row) {
  const def = TYPES[type];
  const errors = [];
  for (const c of def.required) {
    if (row[c] === undefined || row[c] === null || row[c] === "") errors.push({ field: c, error: "required" });
  }
  for (const [col, enumName] of Object.entries(def.enums)) {
    const v = row[col];
    if (v !== undefined && v !== null && !ENUMS[enumName].includes(v)) errors.push({ field: col, error: "enum", allowed: ENUMS[enumName] });
  }
  for (const col of def.dates) {
    const v = row[col];
    if (v !== undefined && v !== null && v !== "" && !DATE_RE.test(v)) errors.push({ field: col, error: "date_format", expected: "YYYY-MM-DD" });
  }
  if (row.country !== undefined && row.country !== null && !/^[A-Z]{2}$/.test(row.country)) errors.push({ field: "country", error: "iso_3166_1_alpha2" });
  if (row.jurisdiction !== undefined && row.jurisdiction !== null && !/^([A-Z]{2}(-[A-Z0-9]{1,3})?)(:[a-z0-9-]+)?$/.test(row.jurisdiction)) {
    errors.push({ field: "jurisdiction", error: "format", expected: "US, US-LA, US-LA:new-orleans or an ISO 3166-1 alpha-2 code" });
  }
  if (type === "actor" && row.kind === "body" && !row.body_type) errors.push({ field: "body_type", error: "required_for_body" });
  return errors;
}

// Claim ids a record may cite: its own current claims plus those of linked
// records (incident: its events, actors, outlets, journalists, cases;
// case: its incidents and events).
export async function citableClaimIds(env, type, id) {
  if (!id) return new Set();
  let rows = [];
  if (type === "incident") {
    rows = await all(env, `SELECT id FROM claims WHERE status = 'current' AND (
      (subject_type = 'incident' AND subject_id = ?1)
      OR (subject_type = 'event' AND subject_id IN (SELECT id FROM events WHERE incident_id = ?1))
      OR (subject_type = 'actor' AND subject_id IN (SELECT actor_id FROM incident_actors WHERE incident_id = ?1))
      OR (subject_type = 'outlet' AND subject_id IN (SELECT outlet_id FROM incident_outlets WHERE incident_id = ?1))
      OR (subject_type = 'journalist' AND subject_id IN (SELECT journalist_id FROM incident_journalists WHERE incident_id = ?1))
      OR (subject_type = 'case' AND subject_id IN (SELECT case_id FROM incident_cases WHERE incident_id = ?1)))`, id);
  } else if (type === "case") {
    rows = await all(env, `SELECT id FROM claims WHERE status = 'current' AND (
      (subject_type = 'case' AND subject_id = ?1)
      OR (subject_type = 'event' AND subject_id IN (SELECT id FROM events WHERE case_id = ?1))
      OR (subject_type = 'incident' AND subject_id IN (SELECT incident_id FROM incident_cases WHERE case_id = ?1)))`, id);
  } else if (TYPES[type] && TYPES[type].claims) {
    rows = await all(env, "SELECT id FROM claims WHERE status = 'current' AND subject_type = ? AND subject_id = ?", type, id);
  }
  return new Set(rows.map((r) => r.id));
}

// Every {c:ID} must be current and citable; when `requireRefs`, every
// non-empty prose paragraph must carry at least one reference.
async function validateRefs(env, type, id, row, requireRefs) {
  const def = TYPES[type];
  if (!def.claims) return [];
  const errors = [];
  const citable = await citableClaimIds(env, type, id);
  for (const col of def.prose) {
    const text = row[col];
    if (!text) continue;
    for (const ref of refsIn(text)) {
      if (!citable.has(ref)) errors.push({ field: col, error: "claim_ref_not_citable", claim_id: ref, rule: "must be a current claim on this record or a linked record" });
    }
    if (requireRefs) {
      splitParagraphs(text).forEach((p, i) => {
        if (/^#{1,4}\s/.test(p)) return;
        if (!refsIn(p).length) errors.push({ field: col, error: "paragraph_without_claim_ref", paragraph: i + 1, text: p.slice(0, 80) });
      });
    }
  }
  return errors;
}

// v2 incident fields (brief 2026-09-22): tactic, leader, issue of the day,
// outcome. The tactic must exist; the leader must be an actor; the issue of
// the day is at most 60 words.
async function validateIncidentV2(env, row) {
  const errors = [];
  if (row.tactic_primary) {
    const t = await first(env, "SELECT slug FROM tactics WHERE slug = ?", row.tactic_primary);
    if (!t) errors.push({ field: "tactic_primary", error: "unknown_tactic", value: row.tactic_primary });
  }
  if (row.leader_slug) {
    const a = await first(env, "SELECT id FROM actors WHERE slug = ?", row.leader_slug);
    if (!a) errors.push({ field: "leader_slug", error: "unknown_actor", value: row.leader_slug });
  }
  if (row.issue_of_the_day && String(row.issue_of_the_day).trim().split(/\s+/).length > 60) errors.push({ field: "issue_of_the_day", error: "max_60_words" });
  if (row.country) {
    const c = await first(env, "SELECT iso2 FROM countries WHERE iso2 = ?", row.country);
    if (!c) errors.push({ field: "country", error: "unknown_country", value: row.country });
  }
  return errors;
}

async function refreshSearch(env, type, id, row) {
  const def = TYPES[type];
  if (!def) return;
  try {
    await env.DB.prepare("DELETE FROM search_fts WHERE record_type = ? AND record_id = ?").bind(type, id).run();
    if (row.pub_state !== "published") return;
    const body = [...def.prose, ...def.own, "role", "office", "court", "docket"].map((c) => mdToPlain(row[c] || "")).filter(Boolean).join("\n");
    await env.DB.prepare("INSERT INTO search_fts (record_type, record_id, title, body) VALUES (?,?,?,?)").bind(type, id, row[def.titleCol] || "", body).run();
  } catch {
    // search_fts (migration 0003) is optional; search falls back to LIKE.
  }
}

export async function writeChange(env, c) {
  await env.DB.prepare(
    `INSERT INTO changes (changed_at, kind, record_type, record_id, claim_id, old_value, new_value, reason, is_correction) VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(c.changed_at || isoNow(), c.kind, c.record_type || null, c.record_id || null, c.claim_id || null, c.old_value ?? null, c.new_value ?? null, c.reason || null, c.is_correction ? 1 : 0).run();
}

async function appendRevision(env, type, id, revision, row, reason, isCorrection) {
  const rt = type === "glossary_term" ? "glossary_term" : type;
  await env.DB.prepare("INSERT INTO revisions (record_type, record_id, revision, body_json, reason, is_correction, created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(rt, id, revision, JSON.stringify(row), reason || "update", isCorrection ? 1 : 0, isoNow()).run();
}

export async function getRecord(env, type, slug) {
  const def = TYPES[type];
  return first(env, `SELECT * FROM ${def.table} WHERE slug = ?`, slug);
}

async function resolveOutletId(env, body) {
  if (body.outlet_slug) {
    const o = await first(env, "SELECT id FROM outlets WHERE slug = ?", body.outlet_slug);
    if (!o) throw new ValidationError({ field: "outlet_slug", error: "unknown_outlet", value: body.outlet_slug });
    return o.id;
  }
  return body.outlet_id ?? null;
}

// PUT /admin/records/<type>/<slug>
export async function upsertRecord(env, type, slug, body) {
  const def = TYPES[type];
  if (!def) throw new ValidationError({ error: "unknown_record_type", type }, 404);
  if (!slugOk(slug)) throw new ValidationError({ field: "slug", error: "slug_format", rule: "^[a-z0-9]+(-[a-z0-9]+)*$, 80 characters maximum" });
  const reason = body.reason;
  if (!reason || typeof reason !== "string") throw new ValidationError({ field: "reason", error: "required" });
  const isCorrection = body.is_correction ? 1 : 0;

  const existing = await getRecord(env, type, slug);
  const row = {};
  for (const c of def.cols) {
    if (Object.prototype.hasOwnProperty.call(body, c)) row[c] = body[c] === "" ? null : body[c];
    else if (existing) row[c] = existing[c];
  }
  if (type === "journalist") row.outlet_id = await resolveOutletId(env, body) ?? (existing ? existing.outlet_id : null);
  if (type === "incident") {
    if (row.external_ids && typeof row.external_ids === "object") row.external_ids = JSON.stringify(row.external_ids);
    if (!row.external_ids) row.external_ids = "{}";
    if (!row.occurred_on_precision) row.occurred_on_precision = "day";
    if (!row.country) row.country = "US";
    if (!row.outcome) row.outcome = "unknown";
    if (!row.granularity) row.granularity = row.occurred_on && row.occurred_on < "2020" ? "anchor" : "granular";
  }
  if (type === "actor" && !row.country) row.country = "US";
  if (type === "outlet" && !row.country) row.country = "US";
  if (type === "glossary_term") {
    if (Array.isArray(row.see_also)) row.see_also = JSON.stringify(row.see_also);
    if (!row.see_also) row.see_also = "[]";
  }
  if (type === "explainer" && row.body_md) row.word_count = String(row.body_md).trim().split(/\s+/).length;

  const pubState = existing ? existing.pub_state : "draft";
  const errors = [...validateShape(type, row), ...lintRecord(type, row), ...(await validateRefs(env, type, existing ? existing.id : null, row, pubState === "published"))];
  if (type === "incident") errors.push(...(await validateIncidentV2(env, row)));
  if (errors.length) throw new ValidationError(errors);
  if (type === "incident") {
    const c = row.country ? await first(env, "SELECT continent FROM countries WHERE iso2 = ?", row.country) : null;
    row.continent = c ? c.continent : null;
  }

  const now = isoNow();
  let id;
  let revision;
  if (existing) {
    revision = (existing.revision || 1) + 1;
    const sets = Object.keys(row).map((c) => `${c} = ?`);
    await env.DB.prepare(`UPDATE ${def.table} SET ${sets.join(", ")}, revision = ?, updated_at = ? WHERE id = ?`)
      .bind(...Object.values(row), revision, now, existing.id).run();
    id = existing.id;
  } else {
    revision = 1;
    const cols = Object.keys(row);
    const res = await env.DB.prepare(`INSERT INTO ${def.table} (slug, ${cols.join(", ")}, pub_state, revision, created_at, updated_at) VALUES (?, ${cols.map(() => "?").join(", ")}, 'draft', 1, ?, ?)`)
      .bind(slug, ...Object.values(row), now, now).run();
    id = res.meta.last_row_id;
  }
  const saved = await first(env, `SELECT * FROM ${def.table} WHERE id = ?`, id);
  if (type === "incident" && saved.tactic_primary) {
    await env.DB.batch([
      env.DB.prepare("UPDATE incident_tactics SET is_primary = 0 WHERE incident_id = ?").bind(id),
      env.DB.prepare("INSERT INTO incident_tactics (incident_id, tactic_slug, is_primary) VALUES (?,?,1) ON CONFLICT(incident_id, tactic_slug) DO UPDATE SET is_primary = 1").bind(id, saved.tactic_primary),
    ]);
  }
  await appendRevision(env, type, id, revision, saved, reason, isCorrection);
  if (existing && existing.pub_state === "published") {
    await writeChange(env, { kind: "record_revised", record_type: type, record_id: id, reason, is_correction: isCorrection });
  }
  await refreshSearch(env, type, id, saved);
  return { id, slug, type, created: !existing, revision, pub_state: saved.pub_state };
}

// POST /admin/records/<type>/<slug>/publish
export async function publishRecord(env, type, slug, body) {
  const def = TYPES[type];
  const rec = await getRecord(env, type, slug);
  if (!rec) throw new ValidationError({ error: "not_found", type, slug }, 404);
  const reviewedOn = body.reviewed_on || isoDate();
  const nextReview = body.next_review_on || null;
  if (!DATE_RE.test(reviewedOn) || (nextReview && !DATE_RE.test(nextReview))) throw new ValidationError({ error: "date_format" });
  const errors = [...lintRecord(type, rec), ...(await validateRefs(env, type, rec.id, rec, true))];
  if (type === "incident" || type === "case") {
    const citable = await citableClaimIds(env, type, rec.id);
    const own = await first(env, "SELECT COUNT(*) AS n FROM claims WHERE status = 'current' AND subject_type = ? AND subject_id = ?", type, rec.id);
    if (type === "incident" && (!own || own.n < 1)) errors.push({ error: "needs_current_claim", rule: "an incident needs at least one current claim" });
    if (type === "case" && citable.size < 1) errors.push({ error: "needs_current_claim", rule: "a case needs a current claim on the case or a linked incident" });
  }
  if (errors.length) throw new ValidationError(errors);
  const now = isoNow();
  const nextCol = ["incident", "actor", "outlet", "case", "explainer"].includes(type);
  await env.DB.prepare(`UPDATE ${def.table} SET pub_state = 'published', published_at = COALESCE(published_at, ?), reviewed_on = ?${nextCol ? ", next_review_on = COALESCE(?, next_review_on)" : ""}, updated_at = ? WHERE id = ?`)
    .bind(...(nextCol ? [now, reviewedOn, nextReview, now, rec.id] : [now, reviewedOn, now, rec.id])).run();
  if (rec.pub_state !== "published") {
    await writeChange(env, { kind: "record_published", record_type: type, record_id: rec.id, reason: body.reason || "first publication" });
  }
  const saved = await first(env, `SELECT * FROM ${def.table} WHERE id = ?`, rec.id);
  await refreshSearch(env, type, rec.id, saved);
  return { id: rec.id, slug, type, pub_state: "published", published_at: saved.published_at, reviewed_on: saved.reviewed_on };
}

// POST /admin/records/<type>/<slug>/withdraw
export async function withdrawRecord(env, type, slug, body) {
  const def = TYPES[type];
  const rec = await getRecord(env, type, slug);
  if (!rec) throw new ValidationError({ error: "not_found" }, 404);
  if (!body.reason) throw new ValidationError({ field: "reason", error: "required" });
  const now = isoNow();
  await env.DB.prepare(`UPDATE ${def.table} SET pub_state = 'withdrawn', updated_at = ? WHERE id = ?`).bind(now, rec.id).run();
  await writeChange(env, { kind: "record_withdrawn", record_type: type, record_id: rec.id, reason: body.reason, is_correction: body.is_correction ? 1 : 0 });
  await refreshSearch(env, type, rec.id, { pub_state: "withdrawn" });
  return { id: rec.id, slug, type, pub_state: "withdrawn" };
}

async function idBySlug(env, table, slug, field) {
  const r = await first(env, `SELECT id FROM ${table} WHERE slug = ?`, slug);
  if (!r) throw new ValidationError({ field, error: "unknown_slug", value: slug });
  return r.id;
}

function checkEnum(v, name, field) {
  if (!ENUMS[name].includes(v)) throw new ValidationError({ field, error: "enum", value: v, allowed: ENUMS[name] });
}

// PUT /admin/incidents/<slug>/links
export async function replaceIncidentLinks(env, slug, body) {
  const inc = await getRecord(env, "incident", slug);
  if (!inc) throw new ValidationError({ error: "not_found" }, 404);
  const stmts = [];
  const add = (sql, ...b) => stmts.push(env.DB.prepare(sql).bind(...b));
  if (Array.isArray(body.actors)) {
    add("DELETE FROM incident_actors WHERE incident_id = ?", inc.id);
    for (const x of body.actors) {
      checkEnum(x.role || "other", "actor_role", "actors.role");
      add("INSERT OR IGNORE INTO incident_actors (incident_id, actor_id, role, role_at_time) VALUES (?,?,?,?)", inc.id, await idBySlug(env, "actors", x.slug, "actors.slug"), x.role || "other", x.role_at_time || null);
    }
  }
  if (Array.isArray(body.outlets)) {
    add("DELETE FROM incident_outlets WHERE incident_id = ?", inc.id);
    for (const x of body.outlets) {
      checkEnum(x.relation || "affected", "outlet_relation", "outlets.relation");
      add("INSERT OR IGNORE INTO incident_outlets (incident_id, outlet_id, relation) VALUES (?,?,?)", inc.id, await idBySlug(env, "outlets", x.slug, "outlets.slug"), x.relation || "affected");
    }
  }
  if (Array.isArray(body.journalists)) {
    add("DELETE FROM incident_journalists WHERE incident_id = ?", inc.id);
    for (const x of body.journalists) {
      checkEnum(x.relation || "affected", "journalist_relation", "journalists.relation");
      const outletId = x.outlet_slug ? await idBySlug(env, "outlets", x.outlet_slug, "journalists.outlet_slug") : null;
      add("INSERT OR IGNORE INTO incident_journalists (incident_id, journalist_id, outlet_id_at_time, relation) VALUES (?,?,?,?)", inc.id, await idBySlug(env, "journalists", x.slug, "journalists.slug"), outletId, x.relation || "affected");
    }
  }
  if (Array.isArray(body.cases)) {
    add("DELETE FROM incident_cases WHERE incident_id = ?", inc.id);
    for (const x of body.cases) {
      checkEnum(x.relation || "arising_from", "case_relation", "cases.relation");
      add("INSERT OR IGNORE INTO incident_cases (incident_id, case_id, relation) VALUES (?,?,?)", inc.id, await idBySlug(env, "cases", x.slug, "cases.slug"), x.relation || "arising_from");
    }
  }
  if (Array.isArray(body.sources)) {
    add("DELETE FROM incident_sources WHERE incident_id = ?", inc.id);
    let i = 0;
    for (const x of body.sources) {
      checkEnum(x.role || "reporting", "source_role", "sources.role");
      const s = await first(env, "SELECT id FROM sources WHERE id = ?", x.source_id);
      if (!s) throw new ValidationError({ field: "sources.source_id", error: "unknown_source", value: x.source_id });
      add("INSERT OR IGNORE INTO incident_sources (incident_id, source_id, role, sort) VALUES (?,?,?,?)", inc.id, s.id, x.role || "reporting", x.sort ?? i++);
    }
  }
  if (Array.isArray(body.related)) {
    add("DELETE FROM incident_related WHERE incident_id = ?", inc.id);
    for (const x of body.related) {
      checkEnum(x.relation || "parallel", "related_relation", "related.relation");
      add("INSERT OR IGNORE INTO incident_related (incident_id, related_id, relation) VALUES (?,?,?)", inc.id, await idBySlug(env, "incidents", x.slug, "related.slug"), x.relation || "parallel");
    }
  }
  const revision = (inc.revision || 1) + 1;
  add("UPDATE incidents SET revision = ?, updated_at = ? WHERE id = ?", revision, isoNow(), inc.id);
  add("INSERT INTO revisions (record_type, record_id, revision, body_json, reason, is_correction, created_at) VALUES ('incident', ?, ?, ?, ?, 0, ?)",
    inc.id, revision, JSON.stringify({ links: body }), body.reason || "links replaced", isoNow());
  await env.DB.batch(stmts);
  return { id: inc.id, slug, revision, statements: stmts.length };
}

// PUT /admin/cases/<slug>/links
export async function replaceCaseLinks(env, slug, body) {
  const cs = await getRecord(env, "case", slug);
  if (!cs) throw new ValidationError({ error: "not_found" }, 404);
  const stmts = [];
  const add = (sql, ...b) => stmts.push(env.DB.prepare(sql).bind(...b));
  if (Array.isArray(body.parties)) {
    add("DELETE FROM case_parties WHERE case_id = ?", cs.id);
    for (const p of body.parties) {
      checkEnum(p.party_type, "party_type", "parties.party_type");
      checkEnum(p.side, "side", "parties.side");
      const table = p.party_type === "actor" ? "actors" : p.party_type === "outlet" ? "outlets" : "journalists";
      add("INSERT OR IGNORE INTO case_parties (case_id, party_type, party_id, side) VALUES (?,?,?,?)", cs.id, p.party_type, await idBySlug(env, table, p.slug, "parties.slug"), p.side);
    }
  }
  if (Array.isArray(body.sources)) {
    add("DELETE FROM case_sources WHERE case_id = ?", cs.id);
    for (const x of body.sources) {
      checkEnum(x.role || "reporting", "case_source_role", "sources.role");
      const s = await first(env, "SELECT id FROM sources WHERE id = ?", x.source_id);
      if (!s) throw new ValidationError({ field: "sources.source_id", error: "unknown_source", value: x.source_id });
      add("INSERT OR IGNORE INTO case_sources (case_id, source_id, role) VALUES (?,?,?)", cs.id, s.id, x.role || "reporting");
    }
  }
  if (Array.isArray(body.incidents)) {
    add("DELETE FROM incident_cases WHERE case_id = ?", cs.id);
    for (const x of body.incidents) {
      checkEnum(x.relation || "arising_from", "case_relation", "incidents.relation");
      add("INSERT OR IGNORE INTO incident_cases (incident_id, case_id, relation) VALUES (?,?,?)", await idBySlug(env, "incidents", x.slug, "incidents.slug"), cs.id, x.relation || "arising_from");
    }
  }
  const revision = (cs.revision || 1) + 1;
  add("UPDATE cases SET revision = ?, updated_at = ? WHERE id = ?", revision, isoNow(), cs.id);
  add("INSERT INTO revisions (record_type, record_id, revision, body_json, reason, is_correction, created_at) VALUES ('case', ?, ?, ?, ?, 0, ?)",
    cs.id, revision, JSON.stringify({ links: body }), body.reason || "links replaced", isoNow());
  await env.DB.batch(stmts);
  return { id: cs.id, slug, revision, statements: stmts.length };
}

// Glossary and explainer source lists (not in spec 8's table; same shape).
export async function replaceSimpleSources(env, type, slug, body) {
  const rec = await getRecord(env, type, slug);
  if (!rec) throw new ValidationError({ error: "not_found" }, 404);
  const ids = (body.source_ids || []).map((x) => parseInt(x, 10)).filter(Number.isInteger);
  const stmts = [];
  if (type === "glossary_term") {
    stmts.push(env.DB.prepare("DELETE FROM glossary_sources WHERE term_id = ?").bind(rec.id));
    for (const sid of ids) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO glossary_sources (term_id, source_id) VALUES (?,?)").bind(rec.id, sid));
  } else if (type === "explainer") {
    stmts.push(env.DB.prepare("DELETE FROM explainer_sources WHERE explainer_id = ?").bind(rec.id));
    ids.forEach((sid, i) => stmts.push(env.DB.prepare("INSERT OR IGNORE INTO explainer_sources (explainer_id, source_id, sort) VALUES (?,?,?)").bind(rec.id, sid, i)));
  } else {
    throw new ValidationError({ error: "unsupported_type" });
  }
  await env.DB.batch(stmts);
  return { id: rec.id, slug, sources: ids.length };
}

// ---------- claims ----------

async function resolveSubject(env, subjectType, body) {
  if (subjectType === "event") {
    const id = parseInt(body.subject_id, 10);
    const r = await first(env, "SELECT id FROM events WHERE id = ?", id);
    if (!r) throw new ValidationError({ field: "subject_id", error: "unknown_event" });
    return r.id;
  }
  const def = TYPES[subjectType];
  if (!def || !def.claims) throw new ValidationError({ field: "subject_type", error: "enum", allowed: Object.keys(CLAIM_FIELDS) });
  if (body.subject_slug) return idBySlug(env, def.table, body.subject_slug, "subject_slug");
  const id = parseInt(body.subject_id, 10);
  const r = await first(env, `SELECT id FROM ${def.table} WHERE id = ?`, id);
  if (!r) throw new ValidationError({ field: "subject_slug", error: "required" });
  return r.id;
}

async function validateClaimBody(env, body) {
  const errors = [];
  const st = body.subject_type;
  if (!CLAIM_FIELDS[st]) errors.push({ field: "subject_type", error: "enum", allowed: Object.keys(CLAIM_FIELDS) });
  else if (!CLAIM_FIELDS[st].includes(body.field)) errors.push({ field: "field", error: "not_in_allowlist", allowed: CLAIM_FIELDS[st] });
  if (!body.statement || typeof body.statement !== "string") errors.push({ field: "statement", error: "required" });
  if (body.statement && /—/.test(body.statement.replace(/"[^"]*"|“[^”]*”/g, ""))) errors.push({ field: "statement", error: "em_dash" });
  if (!ENUMS.method.includes(body.method)) errors.push({ field: "method", error: "enum", allowed: ENUMS.method });
  if (!ENUMS.confidence.includes(body.confidence)) errors.push({ field: "confidence", error: "enum", allowed: ENUMS.confidence });
  const q = body.evidence_quote == null ? "" : String(body.evidence_quote);
  if (q.length > 300) errors.push({ field: "evidence_quote", error: "max_300_chars" });
  if (body.method !== "observed_here" && q.length < 1) errors.push({ field: "evidence_quote", error: "required" });
  if (!body.verified_at || !/^\d{4}-\d{2}-\d{2}/.test(body.verified_at)) errors.push({ field: "verified_at", error: "date_format" });
  if (body.evidence_date && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(body.evidence_date)) errors.push({ field: "evidence_date", error: "date_format" });
  const src = await first(env, "SELECT id FROM sources WHERE id = ?", parseInt(body.source_id, 10));
  if (!src) errors.push({ field: "source_id", error: "unknown_source" });
  if (errors.length) throw new ValidationError(errors);
}

function claimInsert(env, subjectId, body, extra = {}) {
  return env.DB.prepare(
    `INSERT INTO claims (subject_type, subject_id, field, value, statement, attribution, source_id, evidence_quote, evidence_date, method, verified_at, confidence, status, supersedes_id, batch_label, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'current',?,?,?)`
  ).bind(body.subject_type, subjectId, body.field, body.value ?? null, body.statement, body.attribution || null, parseInt(body.source_id, 10),
    body.evidence_quote ?? "", body.evidence_date || null, body.method, body.verified_at, body.confidence, extra.supersedes_id || null, body.batch_label || null, isoNow());
}

// POST /admin/claims
export async function createClaim(env, body) {
  await validateClaimBody(env, body);
  const subjectId = await resolveSubject(env, body.subject_type, body);
  const res = await claimInsert(env, subjectId, body).run();
  const id = res.meta.last_row_id;
  await writeChange(env, { kind: "claim_new", record_type: body.subject_type, record_id: subjectId, claim_id: id, new_value: body.value ?? null });
  return { id, subject_type: body.subject_type, subject_id: subjectId, status: "current" };
}

// POST /admin/claims/<id>/supersede
export async function supersedeClaim(env, oldId, body) {
  const old = await first(env, "SELECT * FROM claims WHERE id = ?", oldId);
  if (!old) throw new ValidationError({ error: "not_found" }, 404);
  if (old.status !== "current" && old.status !== "disputed") throw new ValidationError({ error: "not_current", status: old.status }, 409);
  if (body.reason !== "correction" && body.reason !== "update") throw new ValidationError({ field: "reason", error: "enum", allowed: ["correction", "update"] });
  const merged = { subject_type: old.subject_type, field: old.field, ...body };
  merged.subject_type = old.subject_type;
  await validateClaimBody(env, merged);
  const isCorrection = body.reason === "correction" ? 1 : 0;
  const results = await env.DB.batch([
    claimInsert(env, old.subject_id, merged, { supersedes_id: old.id }),
    env.DB.prepare("UPDATE claims SET status = 'superseded', superseded_by = (SELECT MAX(id) FROM claims WHERE supersedes_id = ?1), supersede_reason = ?2 WHERE id = ?1").bind(old.id, body.reason),
    env.DB.prepare(`INSERT INTO changes (changed_at, kind, record_type, record_id, claim_id, old_value, new_value, reason, is_correction)
      VALUES (?, 'claim_superseded', ?, ?, (SELECT MAX(id) FROM claims WHERE supersedes_id = ?), ?, ?, ?, ?)`)
      .bind(isoNow(), old.subject_type, old.subject_id, old.id, old.value, merged.value ?? null, body.note || body.reason, isCorrection),
  ]);
  const newId = results[0].meta.last_row_id;
  return { id: newId, supersedes_id: old.id, reason: body.reason, is_correction: isCorrection };
}

// POST /admin/claims/<id>/status
export async function setClaimStatus(env, id, body) {
  const c = await first(env, "SELECT * FROM claims WHERE id = ?", id);
  if (!c) throw new ValidationError({ error: "not_found" }, 404);
  if (body.status !== "disputed" && body.status !== "retired") throw new ValidationError({ field: "status", error: "enum", allowed: ["disputed", "retired"] });
  if (!body.reason) throw new ValidationError({ field: "reason", error: "required" });
  await env.DB.prepare("UPDATE claims SET status = ? WHERE id = ?").bind(body.status, id).run();
  await writeChange(env, { kind: body.status === "disputed" ? "claim_disputed" : "claim_retired", record_type: c.subject_type, record_id: c.subject_id, claim_id: id, reason: body.reason, is_correction: body.is_correction ? 1 : 0 });
  return { id, status: body.status };
}

// POST /admin/events
export async function createEvent(env, body) {
  const errors = [];
  if (!DATE_RE.test(body.occurred_on || "")) errors.push({ field: "occurred_on", error: "date_format" });
  const precision = body.precision || body.occurred_on_precision || "day";
  if (!ENUMS.precision.includes(precision)) errors.push({ field: "precision", error: "enum" });
  if (!ENUMS.event_kind.includes(body.kind)) errors.push({ field: "kind", error: "enum", allowed: ENUMS.event_kind });
  if (!body.label) errors.push({ field: "label", error: "required" });
  const hits = lintText(body.label || "");
  if (hits.length) errors.push({ field: "label", error: "voice_lint", hits: hits.map((h) => h.phrase) });
  if (!body.incident_slug && !body.case_slug) errors.push({ error: "incident_slug_or_case_slug_required" });
  if (errors.length) throw new ValidationError(errors);
  const incidentId = body.incident_slug ? await idBySlug(env, "incidents", body.incident_slug, "incident_slug") : null;
  const caseId = body.case_slug ? await idBySlug(env, "cases", body.case_slug, "case_slug") : null;
  let claimId = body.claim_id ? parseInt(body.claim_id, 10) : null;
  if (claimId) {
    const c = await first(env, "SELECT id, status FROM claims WHERE id = ?", claimId);
    if (!c || c.status !== "current") throw new ValidationError({ field: "claim_id", error: "must_be_current_claim" });
  }
  const pubState = body.pub_state || (claimId ? "published" : "draft");
  if (pubState === "published" && !claimId) throw new ValidationError({ field: "claim_id", error: "required_to_publish" });
  // Idempotent on (incident_id, occurred_on, kind, label): the UNIQUE index
  // from migration 0004 backs this; a repeat POST returns the existing row.
  if (incidentId) {
    const dup = await first(env, "SELECT id, pub_state FROM events WHERE incident_id = ? AND occurred_on = ? AND kind = ? AND label = ?", incidentId, body.occurred_on, body.kind, body.label);
    if (dup) return { id: dup.id, pub_state: dup.pub_state, existing: true };
  }
  const res = await env.DB.prepare("INSERT INTO events (incident_id, case_id, occurred_on, occurred_on_precision, kind, label, claim_id, pub_state, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(incidentId, caseId, body.occurred_on, precision, body.kind, body.label, claimId, pubState, isoNow()).run();
  return { id: res.meta.last_row_id, pub_state: pubState };
}

// GET /admin/events?incident=<slug> (or ?case=<slug>)
export async function listEvents(env, { incidentSlug, caseSlug } = {}) {
  if (incidentSlug) {
    const id = await idBySlug(env, "incidents", incidentSlug, "incident");
    return all(env, "SELECT * FROM events WHERE incident_id = ? ORDER BY occurred_on, id", id);
  }
  if (caseSlug) {
    const id = await idBySlug(env, "cases", caseSlug, "case");
    return all(env, "SELECT * FROM events WHERE case_id = ? ORDER BY occurred_on, id", id);
  }
  return all(env, "SELECT * FROM events ORDER BY id DESC LIMIT 500");
}

// DELETE /admin/events/<id> (operator). Events are timeline rows, not
// claims; a claim about an event keeps its own history. Refuses when a
// current claim has the event as its subject.
export async function deleteEvent(env, id) {
  const e = await first(env, "SELECT * FROM events WHERE id = ?", id);
  if (!e) throw new ValidationError({ error: "not_found" }, 404);
  const c = await first(env, "SELECT COUNT(*) AS n FROM claims WHERE subject_type = 'event' AND subject_id = ? AND status = 'current'", id);
  if (c && c.n) throw new ValidationError({ error: "event_has_current_claims", claims: c.n }, 409);
  await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
  return { id, deleted: true, event: e };
}

// ---------- v2: incident classification, tactics, countries ----------

export const INCIDENT_V2_FIELDS = ["level", "tactic_primary", "leader_slug", "issue_of_the_day", "outcome", "outcome_on", "outcome_note", "granularity", "country", "jurisdiction"];

// POST /admin/incidents/<slug>/fields: only the v2 classification fields,
// through upsertRecord so a revision and (when published) a ledger entry
// are appended like every other record write.
export async function setIncidentFields(env, slug, body) {
  const inc = await getRecord(env, "incident", slug);
  if (!inc) throw new ValidationError({ error: "not_found" }, 404);
  const patch = { reason: body.reason, is_correction: body.is_correction };
  let n = 0;
  for (const k of INCIDENT_V2_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, k)) { patch[k] = body[k]; n++; }
  }
  if (!n) throw new ValidationError({ error: "nothing_to_update", fields: INCIDENT_V2_FIELDS });
  const r = await upsertRecord(env, "incident", slug, patch);
  if (Array.isArray(body.tactics)) await setIncidentTactics(env, slug, { tactics: body.tactics, primary: body.tactic_primary, reason: body.reason, _skipRevision: true });
  return r;
}

// PUT /admin/incidents/<slug>/tactics {primary, tactics:[slug...], reason}
export async function setIncidentTactics(env, slug, body) {
  const inc = await getRecord(env, "incident", slug);
  if (!inc) throw new ValidationError({ error: "not_found" }, 404);
  const primary = body.primary || inc.tactic_primary;
  const list = [...new Set([...(Array.isArray(body.tactics) ? body.tactics : []), ...(primary ? [primary] : [])])];
  if (!list.length) throw new ValidationError({ field: "tactics", error: "required" });
  if (!body.reason && !body._skipRevision) throw new ValidationError({ field: "reason", error: "required" });
  const known = new Set((await all(env, "SELECT slug FROM tactics")).map((t) => t.slug));
  const bad = list.filter((t) => !known.has(t));
  if (bad.length) throw new ValidationError({ field: "tactics", error: "unknown_tactic", values: bad, allowed: [...known] });
  const stmts = [env.DB.prepare("DELETE FROM incident_tactics WHERE incident_id = ?").bind(inc.id)];
  for (const t of list) stmts.push(env.DB.prepare("INSERT INTO incident_tactics (incident_id, tactic_slug, is_primary) VALUES (?,?,?)").bind(inc.id, t, t === primary ? 1 : 0));
  if (!body._skipRevision) {
    const revision = (inc.revision || 1) + 1;
    const now = isoNow();
    stmts.push(env.DB.prepare("UPDATE incidents SET tactic_primary = ?, revision = ?, updated_at = ? WHERE id = ?").bind(primary || null, revision, now, inc.id));
    stmts.push(env.DB.prepare("INSERT INTO revisions (record_type, record_id, revision, body_json, reason, is_correction, created_at) VALUES ('incident', ?, ?, ?, ?, 0, ?)")
      .bind(inc.id, revision, JSON.stringify({ tactics: list, tactic_primary: primary }), body.reason, now));
    if (inc.pub_state === "published") {
      stmts.push(env.DB.prepare("INSERT INTO changes (changed_at, kind, record_type, record_id, reason, is_correction) VALUES (?, 'record_revised', 'incident', ?, ?, 0)").bind(now, inc.id, body.reason));
    }
  }
  await env.DB.batch(stmts);
  return { id: inc.id, slug, tactic_primary: primary || null, tactics: list };
}

// POST /admin/countries/<iso2>/press-freedom {rank, year, source_url, source_id?, note?}
export async function setCountryPressFreedom(env, iso2, body) {
  const cc = String(iso2 || "").toUpperCase();
  const c = await first(env, "SELECT iso2 FROM countries WHERE iso2 = ?", cc);
  if (!c) throw new ValidationError({ error: "unknown_country", iso2: cc }, 404);
  const rank = parseInt(body.rank, 10);
  const year = parseInt(body.year, 10);
  const errors = [];
  if (!(rank >= 1 && rank <= 250)) errors.push({ field: "rank", error: "integer_1_to_250" });
  if (!(year >= 2002 && year <= 2100)) errors.push({ field: "year", error: "year" });
  if (!body.source_url || !/^https:\/\//.test(body.source_url)) errors.push({ field: "source_url", error: "https_url_required" });
  let sourceId = body.source_id ? parseInt(body.source_id, 10) : null;
  if (sourceId && !(await first(env, "SELECT id FROM sources WHERE id = ?", sourceId))) errors.push({ field: "source_id", error: "unknown_source" });
  if (errors.length) throw new ValidationError(errors);
  if (!sourceId) {
    const s = await first(env, "SELECT id FROM sources WHERE url = ?", body.source_url);
    sourceId = s ? s.id : null;
  }
  await env.DB.prepare("UPDATE countries SET press_freedom_rank_latest = ?, press_freedom_rank_year = ?, press_freedom_source_url = ?, press_freedom_source_id = ?, notes = COALESCE(?, notes), updated_at = ? WHERE iso2 = ?")
    .bind(rank, year, body.source_url, sourceId, body.note || null, isoNow(), cc).run();
  return first(env, "SELECT * FROM countries WHERE iso2 = ?", cc);
}

// PUT /admin/tactics/<slug> {name?, definition?, notes?, first_recorded_on?, reason}
export async function updateTactic(env, slug, body) {
  const t = await first(env, "SELECT * FROM tactics WHERE slug = ?", slug);
  if (!t) throw new ValidationError({ error: "not_found" }, 404);
  const next = { name: body.name ?? t.name, definition: body.definition ?? t.definition, notes: body.notes ?? t.notes, first_recorded_on: body.first_recorded_on ?? t.first_recorded_on };
  const errors = [];
  if (String(next.definition).trim().split(/\s+/).length > 80) errors.push({ field: "definition", error: "max_80_words" });
  for (const k of ["name", "definition", "notes"]) {
    const hits = lintText(next[k] || "");
    if (hits.length) errors.push({ field: k, error: "voice_lint", hits: hits.map((h) => h.phrase) });
  }
  if (next.first_recorded_on && !DATE_RE.test(next.first_recorded_on)) errors.push({ field: "first_recorded_on", error: "date_format" });
  if (errors.length) throw new ValidationError(errors);
  await env.DB.prepare("UPDATE tactics SET name = ?, definition = ?, notes = ?, first_recorded_on = ?, updated_at = ? WHERE slug = ?")
    .bind(next.name, next.definition, next.notes || null, next.first_recorded_on || null, isoNow(), slug).run();
  return first(env, "SELECT * FROM tactics WHERE slug = ?", slug);
}
