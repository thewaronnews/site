// Link integrity (spec section 6). The Worker never fetches third-party
// news URLs; the Mac-side checker posts results here. Hysteresis: a source
// becomes dead only after 3 consecutive failures spanning 48 hours or
// more, and one success resets it.

import { isoNow, normalizeUrl } from "./util.js";
import { all, first } from "./db.js";
import { ENUMS, ValidationError, writeChange } from "./records.js";

const OBSERVED = ["live", "paywalled", "bot_blocked", "dead", "redirected", "error"];
const FAILURE_WINDOW_MS = 48 * 3600 * 1000;

// POST /admin/sources: upsert by normalized URL.
export async function upsertSource(env, body) {
  const url = normalizeUrl(body.url);
  const errors = [];
  if (!url) errors.push({ field: "url", error: "invalid_url" });
  if (!body.title) errors.push({ field: "title", error: "required" });
  if (!body.publisher) errors.push({ field: "publisher", error: "required" });
  if (!ENUMS.source_kind.includes(body.source_kind)) errors.push({ field: "source_kind", error: "enum", allowed: ENUMS.source_kind });
  if (body.published_on && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(body.published_on)) errors.push({ field: "published_on", error: "date_format" });
  if (errors.length) throw new ValidationError(errors);
  const existing = await first(env, "SELECT id FROM sources WHERE url = ?", url);
  if (existing) return { id: existing.id, created: false, url };
  let outletId = null;
  if (body.outlet_slug) {
    const o = await first(env, "SELECT id FROM outlets WHERE slug = ?", body.outlet_slug);
    outletId = o ? o.id : null;
  }
  const now = isoNow();
  const res = await env.DB.prepare(
    `INSERT INTO sources (url, title, publisher, outlet_id, source_kind, published_on, first_seen, link_state, created_at) VALUES (?,?,?,?,?,?,?, 'unchecked', ?)`
  ).bind(url, body.title, body.publisher, outletId, body.source_kind, body.published_on || null, now, now).run();
  return { id: res.meta.last_row_id, created: true, url };
}

// GET /admin/sources/due: unchecked for 20 hours or more.
export async function dueSources(env, limit = 200) {
  const cutoff = isoNow(new Date(Date.now() - 20 * 3600 * 1000));
  return all(env, `SELECT id, url, final_url, title, publisher, link_state, last_checked, consecutive_failures, wayback_url, archive_attempts
    FROM sources WHERE last_checked IS NULL OR last_checked <= ? ORDER BY last_checked IS NOT NULL, last_checked LIMIT ?`, cutoff, Math.min(limit, 1000));
}

async function applyOneCheck(env, c) {
  const s = await first(env, "SELECT * FROM sources WHERE id = ?", c.source_id);
  if (!s) return { source_id: c.source_id, error: "unknown_source" };
  if (!OBSERVED.includes(c.observed_state)) return { source_id: c.source_id, error: "invalid_observed_state" };
  const checkedAt = c.checked_at || isoNow();
  await env.DB.prepare(
    "INSERT INTO source_checks (source_id, checked_at, checker, http_status, final_url, observed_state, jev_scores, detail) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(s.id, checkedAt, c.checker || "unknown", c.http_status ?? null, c.final_url || null, c.observed_state,
    c.jev_scores ? JSON.stringify(c.jev_scores) : null, c.detail || null).run();

  let state = s.link_state;
  let failures = s.consecutive_failures || 0;
  const obs = c.observed_state;
  if (obs === "error") {
    // Recorded, state kept (spec 6 step 5).
  } else if (obs === "dead") {
    failures += 1;
    if (failures >= 3) {
      const firstFail = await first(env, `SELECT checked_at FROM source_checks WHERE source_id = ? AND observed_state = 'dead' ORDER BY checked_at DESC LIMIT 1 OFFSET ?`, s.id, failures - 1);
      if (firstFail && Date.parse(checkedAt) - Date.parse(firstFail.checked_at) >= FAILURE_WINDOW_MS) state = "dead";
    }
  } else {
    failures = 0;
    state = obs;
  }
  const since = state !== s.link_state ? checkedAt : s.link_state_since;
  await env.DB.prepare(`UPDATE sources SET last_checked = ?, http_status = ?, final_url = COALESCE(?, final_url), link_state = ?, link_state_since = ?, consecutive_failures = ? WHERE id = ?`)
    .bind(checkedAt, c.http_status ?? s.http_status, c.final_url || null, state, since, failures, s.id).run();
  if (state !== s.link_state) {
    if (state === "dead") await writeChange(env, { kind: "source_offline", record_type: null, record_id: null, old_value: s.link_state, new_value: "dead", reason: `source ${s.id}` });
    else if (s.link_state === "dead") await writeChange(env, { kind: "source_restored", old_value: "dead", new_value: state, reason: `source ${s.id}` });
  }
  return { source_id: s.id, link_state: state, consecutive_failures: failures };
}

// POST /admin/sources/checks
export async function recordChecks(env, body) {
  const checks = Array.isArray(body.checks) ? body.checks.slice(0, 200) : null;
  if (!checks) throw new ValidationError({ field: "checks", error: "required_array" });
  const out = [];
  for (const c of checks) out.push(await applyOneCheck(env, c));
  return { applied: out.filter((r) => !r.error).length, results: out };
}

// POST /admin/sources/<id>/wayback: sets a snapshot, or counts a failed
// attempt; never nulls an existing snapshot.
export async function setWayback(env, id, body) {
  const s = await first(env, "SELECT id, wayback_url FROM sources WHERE id = ?", id);
  if (!s) throw new ValidationError({ error: "not_found" }, 404);
  if (body.wayback_url) {
    if (!/^https:\/\/web\.archive\.org\//.test(body.wayback_url)) throw new ValidationError({ field: "wayback_url", error: "must_be_web_archive_org" });
    await env.DB.prepare("UPDATE sources SET wayback_url = ?, wayback_saved_at = ?, archive_attempts = archive_attempts + 1 WHERE id = ?")
      .bind(body.wayback_url, body.wayback_saved_at || isoNow(), id).run();
    return { id, wayback_url: body.wayback_url };
  }
  await env.DB.prepare("UPDATE sources SET archive_attempts = archive_attempts + 1 WHERE id = ?").bind(id).run();
  return { id, wayback_url: s.wayback_url || null, attempt_counted: true };
}

// Link-integrity share for /admin/health: live, paywalled, redirected or
// tier-2 bot_blocked, or any source with a snapshot.
export async function linkIntegrity(env) {
  const r = await first(env, `SELECT COUNT(*) AS total,
    SUM(CASE WHEN link_state IN ('live','paywalled','redirected','bot_blocked') OR wayback_url IS NOT NULL THEN 1 ELSE 0 END) AS ok,
    SUM(CASE WHEN link_state = 'unchecked' THEN 1 ELSE 0 END) AS unchecked,
    SUM(CASE WHEN link_state = 'dead' THEN 1 ELSE 0 END) AS dead,
    SUM(CASE WHEN wayback_url IS NOT NULL THEN 1 ELSE 0 END) AS archived
    FROM sources`);
  const total = (r && r.total) || 0;
  return { total, ok: r ? r.ok || 0 : 0, unchecked: r ? r.unchecked || 0 : 0, dead: r ? r.dead || 0 : 0, archived: r ? r.archived || 0 : 0, share: total ? Math.round(((r.ok || 0) / total) * 1000) / 1000 : null };
}

