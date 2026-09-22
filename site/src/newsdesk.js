// News Desk (spec section 7): note writes from the desk agent, the server
// re-run of gates G4, G5, G6 and G8, publish / revert / pause.

import { isoNow, isoDate, wordCount, slugOk, safeJsonParse } from "./util.js";
import { all, first, getSourcesByIds } from "./db.js";
import { ValidationError, writeChange } from "./records.js";
import { lintText, stripVerbatim } from "./lint.js";

export const DAILY_CAP = 12;
const OK_LINK_STATES = new Set(["live", "paywalled", "redirected", "bot_blocked"]);
const PROCESS_WORDS = ["this session", "we checked", "we verified", "our check", "verification pass", "jev", "classifier", "agent", "gate", "sweep"];

export async function deskPaused(env) {
  if (!env.KV) return false;
  try {
    return (await env.KV.get("desk:paused")) === "true";
  } catch {
    return false;
  }
}

export async function setDeskPaused(env, paused) {
  await env.KV.put("desk:paused", paused ? "true" : "false");
  return { paused: !!paused };
}

function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function noteSlug(dateStr, title) {
  let s = `${dateStr}-${slugify(title)}`;
  if (s.length > 80) s = s.slice(0, 80).replace(/-[^-]*$/, "");
  return s.replace(/-+$/, "");
}

// Server gates. Returns {G4, G5, G6, G8} each {pass, detail}.
export async function serverGates(env, note) {
  const gates = {};
  const ids = [note.primary_source_id, ...(note.secondary_source_ids || [])];
  const sources = await getSourcesByIds(env, ids);
  const missing = ids.filter((id) => !sources.find((s) => s.id === parseInt(id, 10)));
  const bad = sources.filter((s) => !OK_LINK_STATES.has(s.link_state) && !s.wayback_url);
  gates.G4 = { pass: !missing.length && !bad.length, detail: missing.length ? `unknown sources ${missing.join(",")}` : bad.length ? `sources without a live link or snapshot: ${bad.map((s) => s.id).join(",")}` : "ok" };
  const wc = wordCount(note.note);
  gates.G5 = { pass: wc >= 60 && wc <= 120 && String(note.title || "").length <= 110, detail: `${wc} words, title ${String(note.title || "").length} characters` };
  const hits = [...lintText(note.title), ...lintText(note.note)].filter((h) => h.kind === "banned" || h.kind === "quotation_only");
  gates.G6 = { pass: !hits.length, detail: hits.length ? `outside quotes: ${[...new Set(hits.map((h) => h.phrase))].join(", ")}` : "ok" };
  const own = stripVerbatim(`${note.title}\n${note.note}`);
  const g8 = [];
  if (/[—–―]/.test(own) || /\S -{1,2} \S/.test(own)) g8.push("dash");
  if (/(^|[^\p{L}])(I|we|our|us|me|my)(?=$|[^\p{L}])/u.test(own.replace(/\bUS\b|\bU\.S\./g, ""))) g8.push("first person");
  if (/[?!]/.test(own)) g8.push("question or exclamation mark");
  const pw = PROCESS_WORDS.filter((w) => new RegExp(`(^|[^\\p{L}])${w}(?=$|[^\\p{L}])`, "iu").test(own));
  if (pw.length) g8.push(`process language: ${pw.join(", ")}`);
  gates.G8 = { pass: !g8.length, detail: g8.length ? g8.join("; ") : "ok" };
  return gates;
}

async function publishedToday(env) {
  const r = await first(env, "SELECT COUNT(*) AS n FROM news_desk_notes WHERE state = 'published' AND published_at >= ?", `${isoDate()}T00:00:00Z`);
  return r ? r.n : 0;
}

// POST /admin/desk/notes
export async function createNote(env, body) {
  if (await deskPaused(env)) throw new ValidationError({ error: "desk_paused" }, 423);
  const state = body.state || "held";
  if (state !== "held" && state !== "published") throw new ValidationError({ field: "state", error: "enum", allowed: ["held", "published"] });
  if (state === "published" && (await publishedToday(env)) >= DAILY_CAP) throw new ValidationError({ error: "daily_cap", cap: DAILY_CAP }, 429);
  const sourceIds = (body.source_ids || []).map((x) => parseInt(x, 10)).filter(Number.isInteger);
  const primary = parseInt(body.primary_source_id ?? sourceIds[0], 10);
  const secondary = (body.secondary_source_ids || sourceIds.slice(1)).map((x) => parseInt(x, 10)).filter((x) => Number.isInteger(x) && x !== primary);
  const errors = [];
  if (!body.title) errors.push({ field: "title", error: "required" });
  if (!body.note) errors.push({ field: "note", error: "required" });
  if (!Number.isInteger(primary)) errors.push({ field: "primary_source_id", error: "required" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.story_date || "")) errors.push({ field: "story_date", error: "date_format" });
  for (const f of ["jev_model", "run_id"]) if (!body[f]) errors.push({ field: f, error: "required" });
  if (errors.length) throw new ValidationError(errors);
  const note = { title: body.title, note: body.note, primary_source_id: primary, secondary_source_ids: secondary };
  const gates = await serverGates(env, note);
  const failed = Object.entries(gates).filter(([, g]) => !g.pass);
  if (failed.length) throw new ValidationError({ error: "server_gates_failed", gates }, 422);
  let incidentId = null;
  if (body.incident_slug) {
    const i = await first(env, "SELECT id FROM incidents WHERE slug = ?", body.incident_slug);
    if (!i) throw new ValidationError({ field: "incident_slug", error: "unknown_slug" });
    incidentId = i.id;
  }
  const dup = await first(env, "SELECT id FROM news_desk_notes WHERE primary_source_id = ? AND state <> 'reverted'", primary);
  if (dup) throw new ValidationError({ error: "primary_source_already_used", note_id: dup.id }, 409);
  const now = isoNow();
  const slug = body.slug && slugOk(body.slug) ? body.slug : noteSlug(isoDate(), body.title);
  const gatesPassed = { ...(safeJsonParse(typeof body.gates_passed === "string" ? body.gates_passed : JSON.stringify(body.gates_passed || {}), {}) || {}), server: gates };
  const res = await env.DB.prepare(
    `INSERT INTO news_desk_notes (slug, title, note, word_count, primary_source_id, secondary_source_ids, incident_id, story_date, jev_model, jev_scores, gates_passed, run_id, state, published_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(slug, body.title, body.note, wordCount(body.note), primary, JSON.stringify(secondary), incidentId, body.story_date, body.jev_model,
    typeof body.jev_scores === "string" ? body.jev_scores : JSON.stringify(body.jev_scores || {}), JSON.stringify(gatesPassed), body.run_id, state,
    state === "published" ? now : null, now).run();
  const id = res.meta.last_row_id;
  if (state === "published") await writeChange(env, { kind: "note_published", record_type: "news_desk_note", record_id: id });
  return { id, slug, state, gates };
}

export async function listNotesByState(env, state = "held", limit = 100) {
  return all(env, "SELECT id, slug, title, note, word_count, primary_source_id, secondary_source_ids, incident_id, story_date, state, gates_passed, run_id, created_at, published_at FROM news_desk_notes WHERE state = ? ORDER BY id DESC LIMIT ?", state, limit);
}

// POST /admin/desk/notes/<id>/publish (held -> published)
export async function publishHeldNote(env, id) {
  const n = await first(env, "SELECT * FROM news_desk_notes WHERE id = ?", id);
  if (!n) throw new ValidationError({ error: "not_found" }, 404);
  if (n.state !== "held") throw new ValidationError({ error: "not_held", state: n.state }, 409);
  if (await deskPaused(env)) throw new ValidationError({ error: "desk_paused" }, 423);
  if ((await publishedToday(env)) >= DAILY_CAP) throw new ValidationError({ error: "daily_cap", cap: DAILY_CAP }, 429);
  const gates = await serverGates(env, { title: n.title, note: n.note, primary_source_id: n.primary_source_id, secondary_source_ids: safeJsonParse(n.secondary_source_ids, []) });
  if (Object.values(gates).some((g) => !g.pass)) throw new ValidationError({ error: "server_gates_failed", gates }, 422);
  await env.DB.prepare("UPDATE news_desk_notes SET state = 'published', published_at = ? WHERE id = ?").bind(isoNow(), id).run();
  await writeChange(env, { kind: "note_published", record_type: "news_desk_note", record_id: id });
  return { id, slug: n.slug, state: "published" };
}

// POST /admin/desk/notes/<id>/revert
export async function revertNote(env, id, body) {
  const n = await first(env, "SELECT * FROM news_desk_notes WHERE id = ?", id);
  if (!n) throw new ValidationError({ error: "not_found" }, 404);
  if (!body.reason) throw new ValidationError({ field: "reason", error: "required" });
  if (n.state === "reverted") return { id, slug: n.slug, state: "reverted", already: true };
  await env.DB.prepare("UPDATE news_desk_notes SET state = 'reverted', reverted_at = ?, revert_reason = ? WHERE id = ?").bind(isoNow(), body.reason, id).run();
  await writeChange(env, { kind: "note_reverted", record_type: "news_desk_note", record_id: id, reason: body.reason, is_correction: 1 });
  return { id, slug: n.slug, state: "reverted" };
}
