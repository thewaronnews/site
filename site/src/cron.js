// Nightly scheduled job. Rolls raw observations up into observation_daily,
// refreshes vendor IP range lists into KV, then exports the public tables
// (spec section 9, P0.5) to R2 and the public GitHub repository. Order
// matters: the export must run after the rollup so the day's own
// observation_daily rows are included in what ships that night.

import { refreshIpList } from "./logger.js";
import { runExport } from "./export.js";
import { pingIndexNow } from "./indexnow.js";
import { SITE_ORIGIN } from "./site.js";
import { isoDate } from "./util.js";

function yesterdayUtc() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function rollupObservations(env, dateStr = yesterdayUtc()) {
  const { results } = await env.DB.prepare(
    `SELECT entity_id,
            COUNT(*) AS requests,
            SUM(ip_verified) AS verified,
            GROUP_CONCAT(DISTINCT path) AS paths,
            GROUP_CONCAT(DISTINCT format_served) AS formats
     FROM observations
     WHERE ts LIKE ? AND entity_id IS NOT NULL
     GROUP BY entity_id`
  ).bind(`${dateStr}%`).all();

  for (const row of results || []) {
    const requests = row.requests || 0;
    const verified = row.verified || 0;
    const share = requests ? verified / requests : 0;
    const paths = (row.paths || "").split(",").filter(Boolean).slice(0, 100);
    const formats = (row.formats || "").split(",").filter(Boolean);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO observation_daily (date, entity_id, requests, paths, formats, verified_share, verified_requests)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(dateStr, row.entity_id, requests, JSON.stringify(paths), JSON.stringify(formats), share, verified).run();
  }
  return { date: dateStr, entities_rolled_up: (results || []).length };
}

export async function refreshAllIpLists(env) {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT ip_list_url FROM entities WHERE ip_list_url IS NOT NULL`
  ).all();
  const urls = (results || []).map((r) => r.ip_list_url);
  const out = [];
  for (const url of urls) {
    const cidrs = await refreshIpList(env, url);
    out.push({ url, cidr_count: cidrs.length });
  }
  return out;
}

// Spec section 9: every public table to R2 as dated JSON and CSV, then
// committed to the public GitHub repository under data/YYYY-MM-DD/ and
// latest/. The nightly run exports "today" (UTC, the date at the moment
// the cron fires, shortly after 03:17 UTC) after rollupObservations() above
// has just rolled up "yesterday" into observation_daily, so the export
// below picks up that new rollup row along with everything already current.
// Every URL whose lastmod is today (P0.7 IndexNow): claims created today,
// entity pages with a change today, plus / and /changes when either of
// those happened, since both pages' own lastmod tracks the latest change.
async function todaysChangedUrls(env, dateStr = isoDate()) {
  const { results: claimRows } = await env.DB.prepare(
    `SELECT id FROM claims WHERE created_at LIKE ?`
  ).bind(`${dateStr}%`).all();
  const { results: entityRows } = await env.DB.prepare(
    `SELECT DISTINCT e.slug FROM changes c JOIN entities e ON e.id = c.entity_id WHERE c.changed_at LIKE ?`
  ).bind(`${dateStr}%`).all();

  const urls = [];
  if ((claimRows || []).length || (entityRows || []).length) {
    urls.push(`${SITE_ORIGIN}/`);
    urls.push(`${SITE_ORIGIN}/changes`);
  }
  for (const r of claimRows || []) urls.push(`${SITE_ORIGIN}/claims/${r.id}`);
  for (const r of entityRows || []) urls.push(`${SITE_ORIGIN}/crawlers/${r.slug}`);
  return urls;
}

// The Worker's own nightly IndexNow ping is off by default
// (env.INDEXNOW_WORKER_PING must be the literal string "on" to enable it).
// Cloudflare Workers egress got 429 from IndexNow (2026-09-17); a scheduled
// job on Peter Benes's own machine pings IndexNow now, via the same
// /admin/indexnow endpoint. indexnow.js, the key file route at
// /<INDEXNOW_KEY>.txt, and the manual /admin/indexnow endpoint are
// unaffected by this switch; only this automatic nightly call is gated.
export async function exportNightly(env, ctx) {
  const result = await runExport(env, "daily");
  if (env.INDEXNOW_WORKER_PING === "on") {
    const urls = await todaysChangedUrls(env);
    if (urls.length) {
      const ping = pingIndexNow(env, urls);
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(ping);
      } else {
        await ping;
      }
    }
  }
  return result;
}

export async function runNightly(env, ctx) {
  const rollup = await rollupObservations(env);
  const ipLists = await refreshAllIpLists(env);
  const exportResult = await exportNightly(env, ctx);
  return { rollup, ipLists, exportResult };
}
