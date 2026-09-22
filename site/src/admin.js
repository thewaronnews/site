// Admin API (spec section 8). Bearer token; SHA-256 KV lookup for scoped
// tokens (admin-token:<sha256> -> {scope, issued_at, label}); fixed-length
// compare for the operator secret ADMIN_TOKEN; 120 requests per minute per
// token; JSON only, no-store, noindex. An authenticated caller whose scope
// does not permit a call gets 403, logged to admin_denials (401s are never
// logged). Every successful write adds an admin_writes row.
//
// Scopes: triage (queues, submissions to rejected/hold, link checks and
// snapshots), desk (triage plus sources and News Desk notes, pause only),
// publish (all content, accepting submissions, resume), operator (export,
// rollup, health, changed-urls, indexnow; no content writes).

import { sha256Hex, isoNow, isoDate } from "./util.js";
import { all, first, countsForHealth, getLastExport } from "./db.js";
import {
  normalizeType, upsertRecord, publishRecord, withdrawRecord, replaceIncidentLinks, replaceCaseLinks,
  replaceSimpleSources, createClaim, supersedeClaim, setClaimStatus, createEvent, ValidationError, TYPES,
} from "./records.js";
import { upsertSource, dueSources, recordChecks, setWayback, linkIntegrity } from "./linkstate.js";
import { createNote, listNotesByState, publishHeldNote, revertNote, setDeskPaused, deskPaused } from "./newsdesk.js";
import { runExport } from "./export.js";
import { rollupRequests } from "./cron.js";
import { pingIndexNow } from "./indexnow.js";
import { hashIp } from "./logger.js";
import { SITE_ORIGIN } from "./site.js";

const RATE_LIMIT_PER_MINUTE = 120;
const SCOPED = new Set(["triage", "desk", "publish"]);
const SUBMISSION_STATUSES = ["pending", "hold", "accepted", "rejected"];
const CLASSIFICATIONS = ["spam", "injection", "off_topic", "agrees", "contradicts", "new_information", "tip_in_scope", "tip_out_of_scope"];

const TRIAGE_UP = ["triage", "desk", "publish"];
const DESK_UP = ["desk", "publish"];
const PUBLISH = ["publish"];
const OPERATOR = ["operator"];
const ANY = ["triage", "desk", "publish", "operator"];

function adminJson(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

function timingSafeEqualHex(a, b) {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  return diff === 0;
}

async function checkAuth(request, env) {
  const m = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  const provided = m ? m[1].trim() : "";
  if (!provided) return { ok: false };
  const providedHash = await sha256Hex(provided);
  if (env.ADMIN_TOKEN) {
    const expected = await sha256Hex(env.ADMIN_TOKEN);
    if (timingSafeEqualHex(providedHash, expected)) return { ok: true, scope: "operator", label: "operator", providedHash };
  }
  if (env.KV) {
    try {
      const rec = await env.KV.get(`admin-token:${providedHash}`, "json");
      if (rec && SCOPED.has(rec.scope)) return { ok: true, scope: rec.scope, label: rec.label || rec.scope, providedHash };
    } catch {
      // KV outage: unauthorized, same as an unknown token.
    }
  }
  return { ok: false };
}

async function withinRateLimit(env, tokenHash) {
  if (!env.KV) return true;
  const key = `admin_rl:${tokenHash}:${Math.floor(Date.now() / 60000)}`;
  try {
    const n = parseInt((await env.KV.get(key)) || "0", 10) || 0;
    if (n >= RATE_LIMIT_PER_MINUTE) return false;
    await env.KV.put(key, String(n + 1), { expirationTtl: 120 });
    return true;
  } catch {
    return true;
  }
}

async function logDenial(env, request, auth, attempted) {
  try {
    const ipHash = await hashIp(env, request.headers.get("CF-Connecting-IP") || "", isoDate());
    const url = new URL(request.url);
    await env.DB.prepare("INSERT INTO admin_denials (ts, scope, method, path, attempted, ip_hash) VALUES (?,?,?,?,?,?)")
      .bind(isoNow(), auth.scope, request.method, url.pathname, attempted || null, ipHash).run();
  } catch {
    // never breaks the 403
  }
}

async function logWrite(env, auth, request, info) {
  try {
    const url = new URL(request.url);
    await env.DB.prepare("INSERT INTO admin_writes (ts, scope, token_label, method, path, record_type, record_id, batch_label, summary) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(isoNow(), auth.scope, auth.label || null, request.method, url.pathname, info.record_type || null, info.record_id || null, info.batch_label || null, info.summary ? String(info.summary).slice(0, 500) : null).run();
  } catch {
    // audit failure never undoes a write
  }
}

// ---------- read endpoints ----------

async function health(env) {
  const counts = await countsForHealth(env);
  const lastExport = await getLastExport(env);
  const denials = await all(env, "SELECT scope, COUNT(*) AS n, MAX(ts) AS last FROM admin_denials GROUP BY scope");
  const overdue = {};
  for (const t of ["incidents", "actors", "outlets", "cases", "explainers"]) {
    const r = await first(env, `SELECT COUNT(*) AS n FROM ${t} WHERE pub_state = 'published' AND next_review_on IS NOT NULL AND next_review_on < ?`, isoDate());
    overdue[t] = r ? r.n : 0;
  }
  return {
    generated_at: isoNow(), counts, last_export: lastExport, admin_denials: denials,
    link_integrity: await linkIntegrity(env), past_next_review_on: overdue,
    desk_paused: await deskPaused(env),
  };
}

async function changedUrls(env, since) {
  const cutoff = since && /^\d{4}-\d{2}-\d{2}/.test(since) ? since : isoNow(new Date(Date.now() - 24 * 3600 * 1000));
  const urls = new Set();
  const maps = [["incidents", "/incidents/"], ["actors", "/actors/"], ["outlets", "/outlets/"], ["journalists", "/journalists/"], ["cases", "/cases/"], ["explainers", "/explainers/"], ["glossary_terms", "/glossary/"]];
  for (const [table, prefix] of maps) {
    const rows = await all(env, `SELECT slug FROM ${table} WHERE pub_state = 'published' AND updated_at >= ?`, cutoff);
    for (const r of rows) {
      urls.add(`${SITE_ORIGIN}${prefix}${r.slug}`);
      urls.add(`${SITE_ORIGIN}${prefix.replace(/\/$/, "")}`);
    }
  }
  const notes = await all(env, "SELECT slug FROM news_desk_notes WHERE state = 'published' AND published_at >= ?", cutoff);
  for (const n of notes) urls.add(`${SITE_ORIGIN}/news/${n.slug}`);
  if (notes.length) urls.add(`${SITE_ORIGIN}/news`);
  const claims = await all(env, "SELECT id FROM claims WHERE created_at >= ?", cutoff);
  for (const c of claims) urls.add(`${SITE_ORIGIN}/claims/${c.id}`);
  if (urls.size) {
    urls.add(`${SITE_ORIGIN}/`);
    urls.add(`${SITE_ORIGIN}/timeline`);
    urls.add(`${SITE_ORIGIN}/changes`);
  }
  return { since: cutoff, count: urls.size, urls: [...urls] };
}

async function listSubmissions(env, status, limit) {
  const where = status ? "WHERE status = ?" : "";
  const binds = status ? [status, limit] : [limit];
  return all(env, `SELECT id, ts, channel, kind, target_type, target_id, body, source_url, author_claim, client_name, status, classification, jev_scores, reviewer_note, resolved_claim_id, updated_at FROM submissions ${where} ORDER BY id DESC LIMIT ?`, ...binds);
}

async function updateSubmission(env, id, body, scope) {
  const s = await first(env, "SELECT * FROM submissions WHERE id = ?", id);
  if (!s) throw new ValidationError({ error: "not_found" }, 404);
  if (!SUBMISSION_STATUSES.includes(body.status) || body.status === "pending") throw new ValidationError({ field: "status", error: "enum", allowed: ["hold", "accepted", "rejected"] });
  if (body.classification && !CLASSIFICATIONS.includes(body.classification)) throw new ValidationError({ field: "classification", error: "enum", allowed: CLASSIFICATIONS });
  if (!body.reviewer_note) throw new ValidationError({ field: "reviewer_note", error: "required" });
  let resolved = null;
  if (body.status === "accepted") {
    resolved = parseInt(body.resolved_claim_id, 10);
    const c = Number.isInteger(resolved) ? await first(env, "SELECT id FROM claims WHERE id = ?", resolved) : null;
    if (!c) throw new ValidationError({ field: "resolved_claim_id", error: "required_for_accepted" });
  }
  void scope;
  await env.DB.prepare("UPDATE submissions SET status = ?, classification = COALESCE(?, classification), jev_scores = COALESCE(?, jev_scores), reviewer_note = ?, resolved_claim_id = ?, updated_at = ? WHERE id = ?")
    .bind(body.status, body.classification || null, body.jev_scores ? JSON.stringify(body.jev_scores) : null, body.reviewer_note, resolved, isoNow(), id).run();
  return first(env, "SELECT id, status, classification, reviewer_note, resolved_claim_id, updated_at FROM submissions WHERE id = ?", id);
}

// ---------- dispatcher ----------

// Each route: [method, regex, scopes, handler(ctx, match) -> {result, write?}]
function routes() {
  return [
    ["GET", /^\/admin\/health$/, ANY, async ({ env }) => ({ result: await health(env) })],
    ["GET", /^\/admin\/changed-urls$/, ["operator", "desk", "publish"], async ({ env, url }) => ({ result: await changedUrls(env, url.searchParams.get("since")) })],
    ["GET", /^\/admin\/writes$/, PUBLISH, async ({ env, url }) => {
      const since = url.searchParams.get("since") || "1970-01-01";
      const batch = url.searchParams.get("batch");
      const rows = batch
        ? await all(env, "SELECT * FROM admin_writes WHERE ts >= ? AND batch_label = ? ORDER BY id", since, batch)
        : await all(env, "SELECT * FROM admin_writes WHERE ts >= ? ORDER BY id LIMIT 2000", since);
      return { result: { count: rows.length, writes: rows } };
    }],
    ["GET", /^\/admin\/records\/([a-z_]+)\/([a-z0-9-]+)$/, PUBLISH, async ({ env }, m) => {
      const type = normalizeType(m[1]);
      if (!type) throw new ValidationError({ error: "unknown_record_type" }, 404);
      const row = await first(env, `SELECT * FROM ${TYPES[type].table} WHERE slug = ?`, m[2]);
      if (!row) throw new ValidationError({ error: "not_found" }, 404);
      const claims = TYPES[type].claims ? await all(env, "SELECT * FROM claims WHERE subject_type = ? AND subject_id = ? ORDER BY id", type, row.id) : [];
      return { result: { ...row, claims } };
    }],
    ["PUT", /^\/admin\/records\/([a-z_]+)\/([a-z0-9-]+)$/, PUBLISH, async ({ env, body }, m) => {
      const type = normalizeType(m[1]);
      if (!type) throw new ValidationError({ error: "unknown_record_type" }, 404);
      const r = await upsertRecord(env, type, m[2], body);
      return { result: r, write: { record_type: type, record_id: r.id, batch_label: body.batch_label, summary: `${r.created ? "created" : "revised"} ${type} ${m[2]} r${r.revision}` } };
    }],
    ["POST", /^\/admin\/records\/([a-z_]+)\/([a-z0-9-]+)\/publish$/, PUBLISH, async ({ env, body }, m) => {
      const type = normalizeType(m[1]);
      if (!type) throw new ValidationError({ error: "unknown_record_type" }, 404);
      const r = await publishRecord(env, type, m[2], body);
      return { result: r, write: { record_type: type, record_id: r.id, batch_label: body.batch_label, summary: `published ${type} ${m[2]}` } };
    }],
    ["POST", /^\/admin\/records\/([a-z_]+)\/([a-z0-9-]+)\/withdraw$/, PUBLISH, async ({ env, body }, m) => {
      const type = normalizeType(m[1]);
      if (!type) throw new ValidationError({ error: "unknown_record_type" }, 404);
      const r = await withdrawRecord(env, type, m[2], body);
      return { result: r, write: { record_type: type, record_id: r.id, batch_label: body.batch_label, summary: `withdrew ${type} ${m[2]}` } };
    }],
    ["PUT", /^\/admin\/records\/([a-z_]+)\/([a-z0-9-]+)\/sources$/, PUBLISH, async ({ env, body }, m) => {
      const type = normalizeType(m[1]);
      const r = await replaceSimpleSources(env, type, m[2], body);
      return { result: r, write: { record_type: type, record_id: r.id, batch_label: body.batch_label, summary: `sources for ${type} ${m[2]}` } };
    }],
    ["PUT", /^\/admin\/incidents\/([a-z0-9-]+)\/links$/, PUBLISH, async ({ env, body }, m) => {
      const r = await replaceIncidentLinks(env, m[1], body);
      return { result: r, write: { record_type: "incident", record_id: r.id, batch_label: body.batch_label, summary: `links for incident ${m[1]}` } };
    }],
    ["PUT", /^\/admin\/cases\/([a-z0-9-]+)\/links$/, PUBLISH, async ({ env, body }, m) => {
      const r = await replaceCaseLinks(env, m[1], body);
      return { result: r, write: { record_type: "case", record_id: r.id, batch_label: body.batch_label, summary: `links for case ${m[1]}` } };
    }],
    ["POST", /^\/admin\/claims$/, PUBLISH, async ({ env, body }) => {
      const r = await createClaim(env, body);
      return { result: r, write: { record_type: "claim", record_id: r.id, batch_label: body.batch_label, summary: `claim ${r.id} on ${body.subject_type} ${body.subject_slug || body.subject_id}` } };
    }],
    ["POST", /^\/admin\/claims\/(\d+)\/supersede$/, PUBLISH, async ({ env, body }, m) => {
      const r = await supersedeClaim(env, parseInt(m[1], 10), body);
      return { result: r, write: { record_type: "claim", record_id: r.id, batch_label: body.batch_label, summary: `claim ${r.id} supersedes ${m[1]} (${body.reason})` } };
    }],
    ["POST", /^\/admin\/claims\/(\d+)\/status$/, PUBLISH, async ({ env, body }, m) => {
      const r = await setClaimStatus(env, parseInt(m[1], 10), body);
      return { result: r, write: { record_type: "claim", record_id: r.id, batch_label: body.batch_label, summary: `claim ${m[1]} ${body.status}` } };
    }],
    ["POST", /^\/admin\/events$/, PUBLISH, async ({ env, body }) => {
      const r = await createEvent(env, body);
      return { result: r, write: { record_type: "event", record_id: r.id, batch_label: body.batch_label, summary: `event ${r.id}` } };
    }],
    ["POST", /^\/admin\/sources$/, DESK_UP, async ({ env, body }) => {
      const r = await upsertSource(env, body);
      return { result: r, write: r.created ? { record_type: "source", record_id: r.id, batch_label: body.batch_label, summary: `source ${r.id}` } : null };
    }],
    ["GET", /^\/admin\/sources\/due$/, TRIAGE_UP, async ({ env, url }) => ({ result: { sources: await dueSources(env, parseInt(url.searchParams.get("limit") || "200", 10) || 200) } })],
    ["POST", /^\/admin\/sources\/checks$/, TRIAGE_UP, async ({ env, body }) => {
      const r = await recordChecks(env, body);
      return { result: r, write: { record_type: "source", summary: `${r.applied} link checks` } };
    }],
    ["POST", /^\/admin\/sources\/(\d+)\/wayback$/, TRIAGE_UP, async ({ env, body }, m) => {
      const r = await setWayback(env, parseInt(m[1], 10), body);
      return { result: r, write: { record_type: "source", record_id: r.id, summary: r.wayback_url ? "snapshot set" : "archive attempt counted" } };
    }],
    ["POST", /^\/admin\/desk\/notes$/, DESK_UP, async ({ env, body }) => {
      const r = await createNote(env, body);
      return { result: r, write: { record_type: "news_desk_note", record_id: r.id, batch_label: body.run_id, summary: `note ${r.slug} ${r.state}` } };
    }],
    ["GET", /^\/admin\/desk\/notes$/, DESK_UP, async ({ env, url }) => ({ result: { notes: await listNotesByState(env, url.searchParams.get("state") || "held") } })],
    ["POST", /^\/admin\/desk\/notes\/(\d+)\/publish$/, DESK_UP, async ({ env }, m) => {
      const r = await publishHeldNote(env, parseInt(m[1], 10));
      return { result: r, write: { record_type: "news_desk_note", record_id: r.id, summary: `note ${r.slug} published` } };
    }],
    ["POST", /^\/admin\/desk\/notes\/(\d+)\/revert$/, DESK_UP, async ({ env, body }, m) => {
      const r = await revertNote(env, parseInt(m[1], 10), body);
      return { result: r, write: { record_type: "news_desk_note", record_id: r.id, summary: `note ${r.slug} reverted: ${body.reason}` } };
    }],
    ["POST", /^\/admin\/desk\/pause$/, DESK_UP, async ({ env, body }) => {
      const r = await setDeskPaused(env, !!body.paused);
      return { result: r, write: { record_type: "desk", summary: `desk paused=${r.paused}` } };
    }],
    ["GET", /^\/admin\/submissions$/, TRIAGE_UP, async ({ env, url }) => {
      const status = url.searchParams.get("status");
      if (status && !SUBMISSION_STATUSES.includes(status)) throw new ValidationError({ field: "status", error: "enum", allowed: SUBMISSION_STATUSES }, 400);
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 500);
      const rows = await listSubmissions(env, status, limit);
      return { result: { status: status || "all", count: rows.length, submissions: rows } };
    }],
    ["POST", /^\/admin\/submissions\/(\d+)$/, TRIAGE_UP, async ({ env, body, auth }, m) => {
      const r = await updateSubmission(env, parseInt(m[1], 10), body, auth.scope);
      return { result: r, write: { record_type: "submission", record_id: r.id, summary: `submission ${r.id} ${r.status}` } };
    }],
    ["POST", /^\/admin\/export$/, OPERATOR, async ({ env }) => ({ result: await runExport(env, "manual") })],
    ["POST", /^\/admin\/rollup$/, OPERATOR, async ({ env, body }) => ({ result: await rollupRequests(env, body && /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : undefined) })],
    ["POST", /^\/admin\/indexnow$/, OPERATOR, async ({ env, body }) => {
      const urls = Array.isArray(body.urls) ? body.urls.filter((u) => typeof u === "string") : [];
      if (!urls.length) throw new ValidationError({ field: "urls", error: "required" }, 400);
      return { result: await pingIndexNow(env, urls) };
    }],
  ];
}

// Extra scope rules that depend on the body (checked before the handler).
function bodyScopeDenial(auth, path, body) {
  if (path === "/admin/desk/pause" && auth.scope === "desk" && !(body && body.paused === true)) return "desk scope may pause but not resume";
  if (/^\/admin\/submissions\/\d+$/.test(path) && auth.scope !== "publish" && body && body.status === "accepted") return `scope ${auth.scope} may set rejected or hold only`;
  return null;
}

export async function handleAdminRequest(request, env, ctx, url) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return adminJson({ error: "unauthorized", message: "A valid Bearer admin token is required." }, 401);
  if (!(await withinRateLimit(env, auth.providedHash))) return adminJson({ error: "rate_limited", message: `Limit is ${RATE_LIMIT_PER_MINUTE} requests per minute per token.` }, 429);

  const path = url.pathname;
  const method = request.method;
  const table = routes();
  const pathMatches = table.filter(([, re]) => re.test(path));
  if (!pathMatches.length) return adminJson({ error: "not_found", path }, 404);
  const route = pathMatches.find(([m]) => m === method);
  if (!route) return adminJson({ error: "method_not_allowed", allow: pathMatches.map(([m]) => m) }, 405);
  const [, re, scopes, handler] = route;

  let body = {};
  if (method === "POST" || method === "PUT") {
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      return adminJson({ error: "invalid_json" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return adminJson({ error: "invalid_json", message: "Body must be a JSON object." }, 400);
  }

  if (!scopes.includes(auth.scope)) {
    await logDenial(env, request, auth, body && (body.status || body.state || body.subject_type) ? String(body.status || body.state || body.subject_type) : null);
    return adminJson({ error: "forbidden", reason: `scope ${auth.scope} may not call ${method} ${path}`, allowed_scopes: scopes }, 403);
  }
  const extra = bodyScopeDenial(auth, path, body);
  if (extra) {
    await logDenial(env, request, auth, String(body.status ?? body.paused));
    return adminJson({ error: "forbidden", reason: extra }, 403);
  }

  try {
    const out = await handler({ env, ctx, url, body, auth, request }, path.match(re));
    if (out.write) await logWrite(env, auth, request, out.write);
    return adminJson(out.result, method === "GET" ? 200 : 200);
  } catch (err) {
    if (err instanceof ValidationError) return adminJson({ error: "validation_failed", details: err.errors }, err.status);
    const msg = String((err && err.message) || err);
    if (/UNIQUE constraint/i.test(msg)) return adminJson({ error: "conflict", message: msg }, 409);
    if (/CHECK constraint|append-only|only status/i.test(msg)) return adminJson({ error: "constraint", message: msg }, 422);
    return adminJson({ error: "internal_error", message: msg }, 500);
  }
}
