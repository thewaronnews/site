// Nightly scheduled job (cron 17 7 * * * UTC, spec section 9): roll raw
// requests up into requests_daily (with feed-reader subscriber counts),
// refresh the bots' published IP lists into KV, then run the export.
// IndexNow pings run from the Mac, never from here (L-139, L-142).

import { refreshIpList } from "./logger.js";
import { runExport } from "./export.js";

function yesterdayUtc() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Feed readers report subscribers in the UA, e.g. "Feedly/1.0 (+http://
// www.feedly.com/fetcher.html; 42 subscribers)". Take the maximum per bot
// per day across feeds (summing would double count one reader's feeds).
function subscribersFromUa(ua) {
  const m = String(ua || "").match(/(\d+)\s+(subscribers|readers)/i);
  return m ? parseInt(m[1], 10) : null;
}

export async function rollupRequests(env, dateStr = yesterdayUtc()) {
  const { results } = await env.DB.prepare(
    `SELECT bot_id, COUNT(*) AS requests, SUM(ip_verified) AS verified,
            GROUP_CONCAT(DISTINCT path) AS paths, GROUP_CONCAT(DISTINCT format_served) AS formats
     FROM requests WHERE ts LIKE ? AND bot_id IS NOT NULL GROUP BY bot_id`
  ).bind(`${dateStr}%`).all();
  for (const row of results || []) {
    const uas = await env.DB.prepare("SELECT DISTINCT ua_raw FROM requests WHERE ts LIKE ? AND bot_id = ?").bind(`${dateStr}%`, row.bot_id).all();
    let subs = null;
    for (const u of uas.results || []) {
      const n = subscribersFromUa(u.ua_raw);
      if (n !== null) subs = Math.max(subs || 0, n);
    }
    const paths = (row.paths || "").split(",").filter(Boolean).slice(0, 100);
    const formats = (row.formats || "").split(",").filter(Boolean);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO requests_daily (date, bot_id, requests, verified_requests, paths, formats, feed_subscribers) VALUES (?,?,?,?,?,?,?)`
    ).bind(dateStr, row.bot_id, row.requests || 0, row.verified || 0, JSON.stringify(paths), JSON.stringify(formats), subs).run();
  }
  return { date: dateStr, bots_rolled_up: (results || []).length };
}

export async function refreshAllIpLists(env) {
  const { results } = await env.DB.prepare("SELECT DISTINCT ip_list_url FROM bots WHERE ip_list_url IS NOT NULL").all();
  const out = [];
  for (const r of results || []) {
    const cidrs = await refreshIpList(env, r.ip_list_url);
    out.push({ url: r.ip_list_url, cidr_count: cidrs.length });
  }
  return out;
}

export async function runNightly(env) {
  const out = {};
  try { out.rollup = await rollupRequests(env); } catch (e) { out.rollup = { error: String(e && e.message || e) }; }
  try { out.ipLists = await refreshAllIpLists(env); } catch (e) { out.ipLists = { error: String(e && e.message || e) }; }
  try { out.export = await runExport(env, "daily"); } catch (e) { out.export = { error: String(e && e.message || e) }; }
  if (env.KV) {
    try { await env.KV.put("cron:last", JSON.stringify({ at: new Date().toISOString(), out })); } catch { /* best effort */ }
  }
  return out;
}
