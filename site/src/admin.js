// Admin API (spec section 7 / handoff-build-P0.2-P0.7.md "Notes moderation",
// P0.5). Every route here is under /admin, gated by a Bearer ADMIN_TOKEN
// Worker secret, JSON only, never cached, excluded from the sitemap and
// llms.txt (they only ever list the static and entity paths), and rate
// limited per token via KV. Nothing here carries the GA4 tag or the WebMCP
// script; index.js never calls renderHtml/renderMarkdown for this path.

import { sha256Hex, isoNow, isoDate } from "./util.js";
import {
  listNotesByStatus, getNoteById, updateNote, insertChange, updateClaimStatus,
  getClaim, getEntityById, countsForHealth, getLastExport, getQuestionById,
  insertAdminDenial, getAdminDenialsSummary,
} from "./db.js";
import { runExport } from "./export.js";
import { rollupObservations } from "./cron.js";
import { pingIndexNow } from "./indexnow.js";
import { hashIp } from "./logger.js";

const RATE_LIMIT_PER_MINUTE = 120;
const VALID_NOTE_STATUSES_QUERY = ["pending", "hold", "published", "rejected"];
const VALID_NOTE_STATUSES_UPDATE = ["published", "rejected", "hold"];
const VALID_CLASSIFICATIONS = ["spam", "injection", "off_topic", "agrees", "contradicts", "new_information"];

function adminHeaders(extra) {
  return Object.assign(
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
    extra || {}
  );
}

function adminJson(obj, status = 200, extra) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: adminHeaders(extra) });
}

// Fixed-length comparison over two hex digests (both SHA-256, always 64
// hex characters), so a mismatched provided token never returns faster or
// slower depending on where it first differs from the real one.
function timingSafeEqualHex(a, b) {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

// Scoped admin tokens (P1.1, architect-decisions-2026-09-17 section 1,
// ruling 1). The legacy ADMIN_TOKEN Worker secret is still compared with
// the fixed-length hex compare above. A triage or publish token is looked
// up by the SHA-256 hash of what was presented, as admin-token:<hash> in
// KV (JSON: {scope, issued_at, label}), so KV never holds anything that
// could reconstruct the token and there is no string comparison of a
// scoped secret at all. Scope permissions are enforced by the route
// dispatcher below; this function only identifies the caller.
async function checkAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  const provided = m ? m[1].trim() : "";
  if (!provided) return { ok: false, scope: null, providedHash: "" };
  const providedHash = await sha256Hex(provided);

  if (env.ADMIN_TOKEN) {
    const expectedHash = await sha256Hex(env.ADMIN_TOKEN);
    if (timingSafeEqualHex(providedHash, expectedHash)) {
      return { ok: true, scope: "legacy", providedHash };
    }
  }

  if (env.KV) {
    try {
      const record = await env.KV.get(`admin-token:${providedHash}`, "json");
      if (record && (record.scope === "triage" || record.scope === "publish")) {
        return { ok: true, scope: record.scope, providedHash };
      }
    } catch {
      // KV outage: falls through to unauthorized, same as a genuinely
      // unknown token; the legacy token never depends on KV so it is
      // unaffected by an outage here.
    }
  }

  return { ok: false, scope: null, providedHash };
}

async function withinRateLimit(env, tokenHash) {
  if (!env.KV) return true;
  const minuteBucket = Math.floor(Date.now() / 60000);
  const key = `admin_rl:${tokenHash}:${minuteBucket}`;
  try {
    const current = await env.KV.get(key);
    const n = current ? parseInt(current, 10) || 0 : 0;
    if (n >= RATE_LIMIT_PER_MINUTE) return false;
    await env.KV.put(key, String(n + 1), { expirationTtl: 120 });
    return true;
  } catch {
    return true; // KV outage never blocks admin access; only the counter is lost
  }
}

async function shapeNoteTarget(env, note) {
  if (note.target_type === "claim" && note.target_id) {
    const claim = await getClaim(env, note.target_id);
    if (!claim) return null;
    const entity = await getEntityById(env, claim.entity_id);
    return { id: claim.id, slug: claim.slug, statement: claim.statement, entity: entity ? { slug: entity.slug, name: entity.name } : null };
  }
  if (note.target_type === "entity" && note.target_id) {
    const entity = await getEntityById(env, note.target_id);
    if (!entity) return null;
    return { slug: entity.slug, name: entity.name };
  }
  if (note.target_type === "question" && note.target_id) {
    const question = await getQuestionById(env, note.target_id);
    if (!question) return null;
    return { id: question.id, hash: question.hash, text: question.text_raw };
  }
  return null;
}

async function handleGetNotes(env, url) {
  const status = url.searchParams.get("status");
  if (!status || !VALID_NOTE_STATUSES_QUERY.includes(status)) {
    return adminJson({ error: "invalid_status", message: `status must be one of: ${VALID_NOTE_STATUSES_QUERY.join(", ")}` }, 400);
  }
  let limit = parseInt(url.searchParams.get("limit") || "50", 10);
  if (!Number.isInteger(limit) || limit <= 0) limit = 50;
  limit = Math.min(limit, 500);

  const notes = await listNotesByStatus(env, status, limit);
  const shaped = [];
  for (const n of notes) {
    shaped.push({
      id: n.id,
      ts: n.ts,
      target_type: n.target_type,
      target_id: n.target_id,
      body: n.body,
      author_claim: n.author_claim,
      status: n.status,
      reviewer_note: n.reviewer_note,
      classification: n.classification,
      target: await shapeNoteTarget(env, n),
    });
  }
  return adminJson({ status, count: shaped.length, notes: shaped });
}

// Scope permission (published vs. rejected/hold) and status-value parsing
// happen earlier, in the dispatcher, since the dispatcher needs the parsed
// body to log a denial before ever reaching this function. `parseOk` is
// false only when the request body was not valid JSON.
async function handlePostNote(env, id, parsedBody, parseOk) {
  const note = await getNoteById(env, id);
  if (!note) return adminJson({ error: "not_found", message: `No note with id ${id}.` }, 404);
  if (!parseOk) return adminJson({ error: "invalid_json" }, 400);
  const { status, reviewer_note: reviewerNote, classification } = parsedBody || {};
  if (!status || !VALID_NOTE_STATUSES_UPDATE.includes(status)) {
    return adminJson({ error: "invalid_status", message: `status must be one of: ${VALID_NOTE_STATUSES_UPDATE.join(", ")}` }, 400);
  }
  if (classification !== undefined && classification !== null && !VALID_CLASSIFICATIONS.includes(classification)) {
    return adminJson({ error: "invalid_classification", message: `classification must be one of: ${VALID_CLASSIFICATIONS.join(", ")}` }, 400);
  }
  if (typeof reviewerNote !== "string" || !reviewerNote.trim()) {
    return adminJson({ error: "reviewer_note_required", message: "reviewer_note is required and must be a non-empty string." }, 400);
  }

  const updated = await updateNote(env, id, { status, reviewerNote, classification: classification || null });

  let changeId = null;
  if (classification === "contradicts" && note.target_type === "claim" && note.target_id) {
    const claim = await getClaim(env, note.target_id);
    if (claim) {
      changeId = await insertChange(env, {
        claimId: claim.id,
        entityId: claim.entity_id,
        changedAt: isoDate(),
        kind: "disputed",
        oldValue: null,
        newValue: null,
        evidenceUrl: null,
        note: reviewerNote,
      });
      // A reviewer's explicit escalation only: classification=contradicts
      // alone (and a plain 'hold') never moves the claim itself.
      if (reviewerNote.trim().startsWith("DISPUTE:")) {
        await updateClaimStatus(env, claim.id, "disputed");
      }
    }
  }

  return adminJson({ note: updated, change_id: changeId });
}

async function handlePostExport(env, ctx) {
  const row = await runExport(env, "manual");
  return adminJson(row);
}

// Manual backfill for the nightly rollup (cron.js rollupObservations),
// for when a scheduled 03:17 UTC run needs to be reproduced or a date was
// missed. Body: {"date":"YYYY-MM-DD"}, defaults to UTC yesterday like the
// cron itself.
async function handlePostRollup(env, request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const date = body && typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : undefined;
  const result = date ? await rollupObservations(env, date) : await rollupObservations(env);
  return adminJson(result);
}

// IndexNow (P0.7): lets a device-side script (publish-claims.py --indexnow)
// ping IndexNow for a batch of URLs right after it publishes claims,
// instead of waiting for the nightly export's own pass. Body: {"urls":[...]}.
async function handlePostIndexNow(env, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return adminJson({ error: "invalid_json" }, 400);
  }
  const urls = body && Array.isArray(body.urls) ? body.urls.filter((u) => typeof u === "string" && u) : null;
  if (!urls || !urls.length) {
    return adminJson({ error: "urls_required", message: "Body must be {\"urls\": [\"https://...\", ...]}." }, 400);
  }
  const result = await pingIndexNow(env, urls);
  return adminJson(result);
}

async function handleHealth(env) {
  const counts = await countsForHealth(env);
  const lastExport = await getLastExport(env);
  const adminDenials = await getAdminDenialsSummary(env);
  return adminJson({ generated_at: isoNow(), counts, last_export: lastExport, admin_denials: adminDenials });
}

// Denial log (P1.1, migration 0010): a 403 returned to an authenticated
// caller whose scope does not permit the call is written here. A 401
// (unknown or absent token) is never written, so an attacker cannot fill
// this table just by guessing tokens. No part of any token is ever
// stored, only the caller's scope name (never "unauthenticated").
async function logDenial(env, request, { scope, method, path, attemptedStatus, noteId }) {
  let ipHash = null;
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "";
    ipHash = await hashIp(env, ip, isoDate());
  } catch {
    ipHash = null;
  }
  try {
    await insertAdminDenial(env, {
      ts: isoNow(), scope, method, path,
      attemptedStatus: attemptedStatus || null,
      noteId: noteId ?? null,
      ipHash,
    });
  } catch {
    // the log must never break the 403 response it is logging
  }
}

export async function handleAdminRequest(request, env, ctx, url) {
  const { ok: authOk, scope, providedHash } = await checkAuth(request, env);
  if (!authOk) {
    return adminJson({ error: "unauthorized", message: "A valid Bearer admin token is required." }, 401);
  }
  const allowed = await withinRateLimit(env, providedHash);
  if (!allowed) {
    return adminJson({ error: "rate_limited", message: `Limit is ${RATE_LIMIT_PER_MINUTE} requests per minute per token.` }, 429);
  }

  const path = url.pathname;
  const method = request.method;

  if (path === "/admin/notes" && method === "GET") {
    return handleGetNotes(env, url);
  }
  if (path === "/admin/health" && method === "GET") {
    return handleHealth(env);
  }

  const noteMatch = path.match(/^\/admin\/notes\/(\d+)$/);
  if (noteMatch && method === "POST") {
    const noteId = parseInt(noteMatch[1], 10);
    let parsedBody = null;
    let parseOk = true;
    try {
      parsedBody = await request.json();
    } catch {
      parsedBody = null;
      parseOk = false;
    }
    const attemptedStatus = parsedBody && typeof parsedBody.status === "string" ? parsedBody.status : null;

    // Scoped admin tokens (architect-decisions-2026-09-17 section 1, ruling
    // 1): the legacy operator token can no longer change a note's status at
    // all -- that is the gap this closes, since Betty's triage jobs already
    // hold a copy of it. A triage token may set rejected/hold but never
    // published; a publish token may set any of the three (the human
    // review queue must be able to decline as well as publish). Scope is
    // checked before the note is even looked up, so an unauthorized scope
    // never learns whether a given note id exists.
    if (scope === "legacy") {
      await logDenial(env, request, { scope, method, path, attemptedStatus, noteId });
      return adminJson({ error: "forbidden", reason: "note status changes require a scoped token (triage or publish)" }, 403);
    }
    if (scope === "triage" && attemptedStatus === "published") {
      await logDenial(env, request, { scope, method, path, attemptedStatus, noteId });
      return adminJson({ error: "forbidden", reason: "scope triage may not set published" }, 403);
    }
    return handlePostNote(env, noteId, parsedBody, parseOk);
  }

  // Export, rollup and indexnow stay operator-only (the legacy token):
  // none of them is part of the human publish decision the triage/publish
  // split is about, and a stolen triage or publish token gains nothing
  // from them.
  if (path === "/admin/export" && method === "POST") {
    if (scope !== "legacy") {
      await logDenial(env, request, { scope, method, path, attemptedStatus: null, noteId: null });
      return adminJson({ error: "forbidden", reason: "export requires the legacy operator token" }, 403);
    }
    return handlePostExport(env, ctx);
  }
  if (path === "/admin/rollup" && method === "POST") {
    if (scope !== "legacy") {
      await logDenial(env, request, { scope, method, path, attemptedStatus: null, noteId: null });
      return adminJson({ error: "forbidden", reason: "rollup requires the legacy operator token" }, 403);
    }
    return handlePostRollup(env, request);
  }
  if (path === "/admin/indexnow" && method === "POST") {
    if (scope !== "legacy") {
      await logDenial(env, request, { scope, method, path, attemptedStatus: null, noteId: null });
      return adminJson({ error: "forbidden", reason: "indexnow requires the legacy operator token" }, 403);
    }
    return handlePostIndexNow(env, request);
  }

  return adminJson({ error: "not_found", path }, 404);
}
