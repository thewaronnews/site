// The instrument (spec section 6). Runs after the response is built, inside
// ctx.waitUntil, so logging never delays a reply. Matches User-Agent against
// entities.ua_pattern (cached), verifies identity by IP-list membership or
// Cloudflare's verified-bot signal where available, hashes the IP with a
// daily rotating salt, and tallies unmatched bot-like and human traffic in KV.

import { getEntityPatterns, insertObservation } from "./db.js";
import { ipInAnyCidr, parseIpListJson } from "./ipmatch.js";
import { isoDate, isoNow, sha256Hex } from "./util.js";

const BOT_LIKE = /bot|crawler|spider|fetch|agent|http/i;
const UNKNOWN_UA_CAP = 500;
const IP_LIST_TTL_MS = 26 * 60 * 60 * 1000; // slightly over a day; cron refreshes nightly anyway

async function dailySalt(env, dateStr) {
  return sha256Hex(`${dateStr}:${env.SALT_SECRET || "unsalted"}`);
}

export async function hashIp(env, ip, dateStr) {
  const salt = await dailySalt(env, dateStr);
  return sha256Hex(`${ip || "unknown"}:${salt}`);
}

async function getIpListCidrsCached(env, url) {
  if (!url) return [];
  const key = `iplist:${url}`;
  try {
    const cached = await env.KV.get(key, "json");
    if (cached && Date.now() - cached.at < IP_LIST_TTL_MS && Array.isArray(cached.cidrs)) {
      return cached.cidrs;
    }
  } catch {
    // ignore, fall through to fetch
  }
  return refreshIpList(env, url);
}

export async function refreshIpList(env, url) {
  const key = `iplist:${url}`;
  try {
    const res = await fetch(url, { cf: { cacheTtl: 0 } });
    if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
    const json = await res.json();
    const cidrs = parseIpListJson(json);
    await env.KV.put(key, JSON.stringify({ at: Date.now(), cidrs }), { expirationTtl: 3 * 24 * 3600 });
    return cidrs;
  } catch (err) {
    // Fail closed: no cidrs means nothing verifies against this list until
    // the next successful refresh. Leave any previously cached value alone.
    return [];
  }
}

async function incrKvCounter(env, key, ttlSeconds) {
  try {
    const current = await env.KV.get(key);
    const n = current ? parseInt(current, 10) || 0 : 0;
    await env.KV.put(key, String(n + 1), { expirationTtl: ttlSeconds });
  } catch {
    // best effort; a lost increment under concurrent writes is an accepted
    // approximation for v1 (see NOTES.md)
  }
}

async function tallyUnknownUa(env, dateStr, ua) {
  const key = `unknown_ua:${dateStr}`;
  try {
    const map = (await env.KV.get(key, "json")) || {};
    if (Object.prototype.hasOwnProperty.call(map, ua)) {
      map[ua] += 1;
    } else if (Object.keys(map).length < UNKNOWN_UA_CAP) {
      map[ua] = 1;
    } else {
      return; // cap reached, drop new distinct UAs for the rest of the day
    }
    await env.KV.put(key, JSON.stringify(map), { expirationTtl: 3 * 24 * 3600 });
  } catch {
    // best effort
  }
}

// Pure classification: entity match, bot-like, our own smoke test, empty
// UA, or human. Exposed so the render path can decide, before the response
// is built, whether this request qualifies for the analytics tag (P0.7).
// Does not change anything the instrument stores below.
export function classifyUa(ua, patterns) {
  if (!ua) return "empty";
  if (ua.startsWith("rsbm-smoke/")) return "smoke";
  const match = patterns.find((p) => {
    try {
      return new RegExp(p.pattern).test(ua);
    } catch {
      return false;
    }
  });
  if (match) return "entity";
  if (BOT_LIKE.test(ua)) return "bot-like";
  return "human";
}

// True only when the request classifies as human. Fails closed (false) on
// any error, e.g. a missing DB binding, so a broken lookup never grants the
// tag; it can only ever suppress it.
export async function isAnalyticsEligible(env, ua) {
  try {
    if (!ua) return false;
    if (!env.DB) return false;
    const patterns = await getEntityPatterns(env);
    return classifyUa(ua, patterns) === "human";
  } catch {
    return false;
  }
}

// Called as ctx.waitUntil(observe(...)). Never throws into the caller.
export async function observe(request, response, env, formatServed) {
  try {
    const ua = request.headers.get("User-Agent") || "";
    if (ua.startsWith("rsbm-smoke/")) return; // our own smoke-test traffic, not counted

    const url = new URL(request.url);
    const dateStr = isoDate();

    if (!env.DB || !env.KV) return; // bindings missing, nothing to log against

    const patterns = await getEntityPatterns(env);
    const match = patterns.find((p) => {
      try {
        return new RegExp(p.pattern).test(ua);
      } catch {
        return false;
      }
    });

    const cf = request.cf || {};
    const ip = request.headers.get("CF-Connecting-IP") || "";

    if (!match) {
      if (BOT_LIKE.test(ua)) {
        await tallyUnknownUa(env, dateStr, ua);
      } else {
        await incrKvCounter(env, `human_count:${dateStr}`, 3 * 24 * 3600);
      }
      return;
    }

    let ipVerified = 0;
    let verifyMethod = "none";
    if (match.ip_list_url) {
      const cidrs = await getIpListCidrsCached(env, match.ip_list_url);
      if (cidrs.length && ipInAnyCidr(ip, cidrs)) {
        ipVerified = 1;
        verifyMethod = "ip_list";
      }
    }
    if (!ipVerified && cf.verifiedBotCategory) {
      ipVerified = 1;
      verifyMethod = "cf_verified";
    }

    const ipHash = await hashIp(env, ip, dateStr);

    await insertObservation(env, {
      ts: isoNow(),
      entity_id: match.id,
      ua_raw: ua,
      ip_hash: ipHash,
      ip_verified: ipVerified,
      verify_method: verifyMethod,
      asn: cf.asn ? String(cf.asn) : null,
      country: cf.country || null,
      path: url.pathname,
      format_served: formatServed,
      accept_header: request.headers.get("Accept") || null,
      status: response.status,
      robots_allowed: 1,
      referer: request.headers.get("Referer") || null,
      cf_bot_category: cf.verifiedBotCategory || null,
    });
  } catch {
    // The instrument must never break the response path.
  }
}
