// Recent coverage (v2 brief 2026-09-22): links to recent reporting on
// government actions against journalists, collected hourly by the Worker's
// cron from a curated feed list plus Google News RSS queries (list kept in
// KV under coverage:feeds), scored by Jev (in_scope, tactic), shown when the
// in_scope score is at least SHOW_THRESHOLD. No editorial text: each item is
// the publisher's own headline, date and feed summary, linked out.

import { all, first } from "./db.js";
import { isoNow, normalizeUrl } from "./util.js";
import { ValidationError } from "./records.js";

export const SHOW_THRESHOLD = 0.8;
export const RETENTION_DAYS = 60;
const FEEDS_KV_KEY = "coverage:feeds";
const LAST_RUN_KV_KEY = "coverage:last_run";
const JEV_MODEL = "featherless-ai/Qwen3.6-35B-A3B-classifier";
const JEV_DEMO = "https://simple-jev-demo-api.featherless.ai/v1/classifier";
const JEV_PAID = "https://api.featherless.ai/v1/classifier";
const JEV_STATE_LIMIT = 1800;
// Cloudflare in front of the Jev demo answers 403 (error 1010) to
// non-browser User-Agents (ops/logs/first-run-2026-09-22.md).
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const FETCH_UA = "Mozilla/5.0 (compatible; twon-coverage/1.0; +https://thewaronnews.com/coverage)";
// Subrequest budget: about 26 feed fetches plus at most 20 Jev calls keeps
// a run under the 50-subrequest limit of the smallest Workers plan.
const MAX_NEW_PER_RUN = 20;
const MAX_ITEM_AGE_DAYS = 14;

const GN = (q, hl = "en-US", gl = "US", ceid = "US:en") => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
const GN_QUERIES = [
  '"press freedom" OR "journalists banned" OR "reporters barred"',
  '"journalist arrested" OR "journalist detained" OR "reporter jailed"',
  '"press pass" revoked OR "press credentials" revoked OR "accreditation revoked" journalist',
];
// Bing News RSS answers Workers more reliably than Google News, which
// often returns 503 to Cloudflare egress (first run, 2026-09-22).
const BING = (q, cc = "us") => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=en&cc=${cc}`;
const BING_QUERIES = [
  ["press freedom journalists government", "us"],
  ["journalist arrested OR detained OR jailed", "us"],
  ["reporters barred OR banned OR expelled government", "us"],
  ["news outlet licence revoked OR shut down government", "gb"],
  ["journalist arrested press freedom", "in"],
];

// Seed list: ops/desk/feeds.yaml (press-freedom organisations and media
// trade press) plus Google News RSS searches in several editions.
export const DEFAULT_FEEDS = [
  { org: "U.S. Press Freedom Tracker", url: "https://pressfreedomtracker.us/blog/feed/" },
  { org: "Committee to Protect Journalists", url: "https://cpj.org/feed/" },
  { org: "Reporters Without Borders", url: "https://rsf.org/en/rss/am%C3%A9riques/united-states/feed.xml" },
  { org: "Freedom of the Press Foundation", url: "https://freedom.press/rss.xml" },
  { org: "Reporters Committee for Freedom of the Press", url: "https://www.rcfp.org/feed/" },
  { org: "Knight First Amendment Institute", url: "https://knightcolumbia.org/rss/feed.xml" },
  { org: "Nieman Lab", url: "https://www.niemanlab.org/feed/" },
  { org: "Poynter", url: "https://www.poynter.org/feed/" },
  { org: "Columbia Journalism Review", url: "https://www.cjr.org/feed" },
  { org: "PEN America", url: "https://pen.org/feed/" },
  ...GN_QUERIES.map((q) => ({ org: "Google News", url: GN(q), google: true })),
  { org: "Google News (United Kingdom)", url: GN('"press freedom" OR "journalist arrested" OR "reporters barred"', "en-GB", "GB", "GB:en"), google: true },
  { org: "Google News (India)", url: GN('"press freedom" OR "journalist arrested" OR "journalist booked"', "en-IN", "IN", "IN:en"), google: true },
  ...BING_QUERIES.map(([q, cc]) => ({ org: "Bing News", url: BING(q, cc), bing: true })),
];

export async function getFeeds(env) {
  try {
    const v = env.KV ? await env.KV.get(FEEDS_KV_KEY, "json") : null;
    if (Array.isArray(v) && v.length) return v;
  } catch { /* fall through */ }
  return DEFAULT_FEEDS;
}

export async function setFeeds(env, feeds) {
  if (!Array.isArray(feeds) || !feeds.length) throw new ValidationError({ field: "feeds", error: "required", expected: "[{org, url}]" });
  const clean = [];
  for (const f of feeds) {
    const u = normalizeUrl(f && f.url);
    if (!u || !/^https:\/\//.test(u)) throw new ValidationError({ field: "feeds.url", error: "https_url_required", value: f && f.url });
    clean.push({ org: String(f.org || new URL(u).hostname).slice(0, 120), url: f.url, ...(f.google || /news\.google\.com/.test(u) ? { google: true } : {}), ...(f.bing || /bing\.com\/news/.test(u) ? { bing: true } : {}) });
  }
  await env.KV.put(FEEDS_KV_KEY, JSON.stringify(clean));
  return { count: clean.length, feeds: clean };
}

// ---------- canonical URLs and titles ----------

const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ocid$|oc$|cmpid$|smid$|taid$|ref$|ref_src$|src$|at_medium$|at_campaign$|guccounter$|rss$|feed$|output$)/i;

export function canonicalUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase();
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    let s = u.toString();
    s = s.replace(/\/amp\/?$/, "/").replace(/\?$/, "");
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

export function titleKey(title) {
  return String(title || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).sort().join(" ").slice(0, 300);
}
const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "are", "was", "has", "have", "its", "into", "over", "after", "amid", "says", "said", "new", "news"]);

function jaccard(a, b) {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}

// ---------- RSS / Atom parsing (regex based; feeds are small) ----------

function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : null;
}

function attr(block, name, attrName, where = null) {
  const re = new RegExp(`<${name}\\b([^>]*)/?>`, "gi");
  let m;
  while ((m = re.exec(block))) {
    const attrs = m[1];
    if (where && !where.test(attrs)) continue;
    const a = attrs.match(new RegExp(`${attrName}\\s*=\\s*"([^"]*)"`, "i")) || attrs.match(new RegExp(`${attrName}\\s*=\\s*'([^']*)'`, "i"));
    if (a) return decodeEntities(a[1]);
  }
  return null;
}

// The site prints no em dashes; feed headlines and summaries are otherwise
// shown as the publisher wrote them.
function undash(s, joiner) {
  return String(s || "").replace(/\s*[\u2014\u2015]\s*/g, joiner).replace(/\s+\u2013\s+/g, joiner);
}

function words(s, n) {
  const w = String(s || "").split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(" ") : `${w.slice(0, n).join(" ")}...`;
}

export function parseFeed(xml, feed) {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    let title = stripTags(tag(b, "title"));
    let link = isAtom ? (attr(b, "link", "href", /rel\s*=\s*["']alternate["']/i) || attr(b, "link", "href")) : stripTags(tag(b, "link")) || stripTags(tag(b, "guid"));
    const date = stripTags(tag(b, isAtom ? "published" : "pubDate") || tag(b, "updated") || tag(b, "dc:date") || "");
    let publisher = stripTags(tag(b, "source")) || stripTags(tag(b, "News:Source")) || feed.org;
    if (/bing\.com\/news\/apiclick/i.test(link || "")) {
      // Bing wraps the article address in an apiclick redirect (url=...).
      try { const real = new URL(decodeEntities(link.trim())).searchParams.get("url"); if (real) link = real; } catch { /* keep */ }
      publisher = publisher.replace(/\s+on MSN$/, "");
    }
    let summary = stripTags(tag(b, isAtom ? "summary" : "description") || tag(b, "content") || "");
    if (feed.google || /news\.google\.com/.test(feed.url)) {
      // Google News titles end " - Publisher"; the description repeats the
      // headline and publisher, so it is not used as a summary.
      const src = stripTags(tag(b, "source"));
      if (src) {
        publisher = src;
        const suffix = ` - ${src}`;
        if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);
      }
      summary = "";
    }
    if (summary && titleKey(summary).startsWith(titleKey(title))) summary = "";
    const d = new Date(date);
    if (!title || !link) continue;
    if (/ - BingNews$/.test(title)) continue;
    title = undash(title, ": ");
    summary = undash(summary, ", ");
    items.push({
      title: title.slice(0, 300),
      link: link.trim(),
      publisher: publisher.slice(0, 120),
      published_at: Number.isNaN(d.getTime()) ? null : isoNow(d),
      summary: words(summary, 40),
      feed_url: feed.url,
      google: !!(feed.google || /news\.google\.com/.test(feed.url)),
    });
  }
  return items;
}

// ---------- country guess (names in the headline and summary) ----------

let countryCache = null;
const DEMONYMS = {
  US: ["american", "u.s.", "white house", "pentagon", "washington"], GB: ["british", "u.k.", "britain", "england", "scotland"], RU: ["russian", "kremlin"],
  CN: ["chinese", "beijing"], IN: ["indian"], TR: ["turkish", "turkey", "turkiye"], IL: ["israeli"], PS: ["palestinian", "gaza", "west bank"],
  IR: ["iranian", "tehran"], HU: ["hungarian", "budapest"], HK: ["hong kong"], SV: ["salvadoran", "salvadorean"], MX: ["mexican"], BR: ["brazilian"],
  PK: ["pakistani"], BD: ["bangladeshi"], PH: ["filipino", "philippine"], NG: ["nigerian"], EG: ["egyptian"], SA: ["saudi"], UA: ["ukrainian", "kyiv"],
  BY: ["belarusian", "belarus"], AF: ["afghan", "taliban"], VE: ["venezuelan"], NI: ["nicaraguan"], GE: ["georgian", "tbilisi"], AZ: ["azerbaijani", "azerbaijan"],
  CA: ["canadian", "ottawa"], AU: ["australian"], FR: ["french"], DE: ["german"], IT: ["italian"], ES: ["spanish"], SY: ["syrian"], KE: ["kenyan"], ET: ["ethiopian"],
  SD: ["sudanese"], MM: ["myanmar", "burmese"], VN: ["vietnamese"], KR: ["south korean"], KP: ["north korean"], SG: ["singaporean"], SE: ["swedish"], SK: ["slovak"],
  RS: ["serbian"], GR: ["greek"], PL: ["polish"], ZW: ["zimbabwean"], UG: ["ugandan"], TZ: ["tanzanian"], CU: ["cuban"], GT: ["guatemalan"], PE: ["peruvian"],
};

async function countryMatchers(env) {
  if (countryCache) return countryCache;
  const rows = await all(env, "SELECT iso2, name FROM countries");
  const list = [];
  for (const r of rows) {
    if (r.name.length > 3) list.push([r.iso2, r.name.toLowerCase()]);
    for (const d of DEMONYMS[r.iso2] || []) list.push([r.iso2, d]);
  }
  list.push(["US", "united states"], ["GB", "united kingdom"], ["CD", "congo"], ["CZ", "czech"], ["KR", "korea"], ["GB", "bbc"], ["SO", "somaliland"]);
  list.sort((a, b) => b[1].length - a[1].length);
  countryCache = list.map(([iso2, name]) => [iso2, new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`, "i")]);
  return countryCache;
}

// The earliest country named in the headline wins (headlines usually lead
// with the country that acted: "Egypt: Sudanese journalist arrested"), then
// the summary; a longer name beats a shorter one at the same place.
export async function guessCountry(env, title, summary = "") {
  const matchers = await countryMatchers(env);
  for (const t of [String(title || ""), String(summary || "")]) {
    let best = null;
    for (const [iso2, re] of matchers) {
      const m = re.exec(t);
      if (m && (!best || m.index < best.index)) best = { iso2, index: m.index };
    }
    if (best) return best.iso2;
  }
  return null;
}

// ---------- Jev ----------

async function jevQuestions(env) {
  const tactics = await all(env, "SELECT slug, name, definition FROM tactics ORDER BY sort");
  const criteria = {};
  for (const t of tactics) criteria[t.slug] = `${t.name}: ${t.definition.split(". ")[0]}`.slice(0, 200);
  return {
    in_scope: {
      type: "noul",
      instructions: "Does the text report a specific action taken or formally announced by a government, a government official or agency, a court acting on a government request, or a legislature, that limits journalists' or news outlets' ability to gather or publish news, in any country?",
      criteria: {
        true: "a concrete government action against reporters or outlets: access, credentials, licences, prosecution, arrest, surveillance, funding, expulsion, blocking or official labels",
        false: "opinion, rhetoric alone, a private company's action, crime by private people with no government role, entertainment, sport or unrelated news",
      },
    },
    tactic: { type: "choice", instructions: "Which tactic best describes the government action?", criteria },
  };
}

export async function jevClassify(env, state) {
  const paid = !!env.JEV_API_KEY;
  const headers = { "Content-Type": "application/json", "User-Agent": BROWSER_UA, Accept: "application/json" };
  if (paid) headers.Authorization = `Bearer ${env.JEV_API_KEY}`;
  const body = { model: JEV_MODEL, state: String(state).slice(0, JEV_STATE_LIMIT), questions: await jevQuestions(env) };
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(paid ? JEV_PAID : JEV_DEMO, { method: "POST", headers, body: JSON.stringify(body) });
    if (r.ok) {
      const j = await r.json();
      return { answers: j.answers || {}, model: j.model || JEV_MODEL };
    }
    lastErr = `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`;
    if (r.status !== 429 && r.status < 500) break;
    await new Promise((res) => setTimeout(res, 800 * attempt));
  }
  throw new Error(`jev ${lastErr}`);
}

// ---------- the hourly job ----------

const PRESS_RE = /\b(journalists?|reporters?|press|media|newspapers?|broadcasters?|outlets?|correspondents?|editors?|news agency|photojournalists?|bloggers?|publishers?|newsrooms?|radio|television|tv)\b/gi;
const STATE_RE = /\b(government|authorities|police|court|judge|ministry|minister|law|bill|arrest(ed|s)?|detain(ed|s)?|jail(ed)?|prison|sentenced|charged|ban(s|ned)?|barred|revok(e|ed|es)|expel(led|s)?|deport(ed)?|licen[cs]e|regulator|president|prime minister|parliament|congress|sued|lawsuit|subpoena|raid(ed)?|seiz(e|ed)|block(ed|s)?|shut(down| down)|visa|accreditation|credentials?|pentagon|white house|kremlin|junta|military|security forces|spyware|surveillance|agent)\b/gi;

function prefilterScore(text) {
  const t = String(text || "");
  const p = (t.match(PRESS_RE) || []).length;
  const g = (t.match(STATE_RE) || []).length;
  if (!p || !g) return Math.min(p, 1);
  return 1 + Math.min(p, 3) + Math.min(g, 3);
}

async function fetchFeed(feed) {
  const r = await fetch(feed.url, { headers: { "User-Agent": feed.google ? BROWSER_UA : FETCH_UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" }, redirect: "follow", cf: { cacheTtl: 300 } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  return parseFeed(text.slice(0, 2_000_000), feed);
}

// Google News item links (news.google.com/rss/articles/...) are kept as
// given: they open the publisher's page in a browser, and resolving them
// would cost a subrequest each. Title similarity catches the same story
// arriving from Google News and from the publisher's own feed.

export async function runCoverage(env, { maxNew = MAX_NEW_PER_RUN, dryRun = false } = {}) {
  const started = Date.now();
  const feeds = await getFeeds(env);
  const out = { started_at: isoNow(), feeds: feeds.length, feed_errors: [], fetched: 0, fresh: 0, duplicates: 0, scored: 0, shown: 0, hidden: 0, jev_errors: 0, pruned: 0, new_items: [] };
  const fetched = await Promise.allSettled(feeds.map((f) => fetchFeed(f)));
  let candidates = [];
  fetched.forEach((r, i) => {
    if (r.status === "fulfilled") candidates.push(...r.value);
    else out.feed_errors.push({ url: feeds[i].url, error: String(r.reason && r.reason.message || r.reason).slice(0, 120) });
  });
  out.fetched = candidates.length;
  const cutoff = isoNow(new Date(Date.now() - MAX_ITEM_AGE_DAYS * 86400000));
  candidates = candidates.filter((c) => !c.published_at || c.published_at >= cutoff);
  candidates.sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
  out.fresh = candidates.length;

  const recent = await all(env, "SELECT url, title_key FROM coverage_items WHERE fetched_at >= ?", isoNow(new Date(Date.now() - RETENTION_DAYS * 86400000)));
  const seenUrls = new Set(recent.map((r) => r.url));
  const seenKeys = recent.map((r) => r.title_key);
  const batchKeys = [];
  const fresh = [];
  for (const c of candidates) {
    const key = titleKey(c.title);
    const url = canonicalUrl(c.link);
    if (!key || !url) continue;
    const dupByTitle = (k) => k === key || jaccard(k, key) >= 0.8;
    if (seenUrls.has(url) || seenKeys.some(dupByTitle) || batchKeys.some(dupByTitle)) { out.duplicates++; continue; }
    seenUrls.add(url);
    batchKeys.push(key);
    fresh.push({ ...c, url, key, pre: prefilterScore(`${c.title} ${c.summary}`) });
  }
  // Cheap keyword screen first: Jev scores only items that mention both
  // the press and a state actor or action, best matches and newest first.
  fresh.sort((x, y) => y.pre - x.pre || String(y.published_at || "").localeCompare(String(x.published_at || "")));
  const toScore = fresh.filter((c) => c.pre >= 2).slice(0, maxNew);
  const scoreSet = new Set(toScore);
  const results = new Map();
  for (let k = 0; k < toScore.length; k += 4) {
    if (Date.now() - started > 90000) break;
    const group = toScore.slice(k, k + 4);
    const settled = await Promise.allSettled(group.map((c) => jevClassify(env, `Headline: ${c.title}\nOutlet: ${c.publisher}\nDate: ${c.published_at || "unknown"}\nText: ${c.summary || c.title}`)));
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") { results.set(group[i], r.value); out.scored++; }
      else { out.jev_errors++; if (out.jev_errors <= 3) out.feed_errors.push({ url: "jev", error: String(r.reason && r.reason.message || r.reason).slice(0, 160) }); }
    });
  }
  const now = isoNow();
  const stmts = [];
  for (const c of fresh) {
    const j = results.get(c);
    // Items not screened in, or not reached this run, are stored only when
    // they failed the keyword screen (so they are not re-read every hour);
    // screened items that were not scored wait for the next run.
    if (!j && scoreSet.has(c)) continue;
    const score = j && j.answers.in_scope && typeof j.answers.in_scope.noul === "number" ? j.answers.in_scope.noul : null;
    const tactic = j && j.answers.tactic ? j.answers.tactic.choice || null : null;
    const tacticConf = j && j.answers.tactic ? j.answers.tactic.confidence ?? null : null;
    const country = await guessCountry(env, c.title, c.summary);
    const state = score !== null && score >= SHOW_THRESHOLD ? "shown" : "hidden";
    const reason = !j ? "keyword screen" : score === null ? "not scored" : state === "shown" ? `in_scope ${score.toFixed(2)}` : `in_scope ${score.toFixed(2)} below ${SHOW_THRESHOLD}`;
    if (state === "shown") out.shown++; else out.hidden++;
    if (j) out.new_items.push({ title: c.title, publisher: c.publisher, url: c.url, score, tactic, country, state });
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO coverage_items (url, title, title_key, publisher, published_at, summary, feed_url, jev_in_scope, jev_model, tactic_guess, tactic_confidence, country_guess, state, state_reason, fetched_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(c.url, c.title, c.key, c.publisher, c.published_at, c.summary || null, c.feed_url, score, j ? j.model : null, tactic, tacticConf, country, state, reason, now, now));
  }
  out.screened_out = fresh.filter((c) => c.pre < 2).length;
  out.new_items.sort((x, y) => (y.score || 0) - (x.score || 0));
  if (!dryRun) for (let k = 0; k < stmts.length; k += 50) await env.DB.batch(stmts.slice(k, k + 50));
  if (!dryRun) {
    const pr = await env.DB.prepare("DELETE FROM coverage_items WHERE incident_id IS NULL AND COALESCE(published_at, fetched_at) < ?").bind(isoNow(new Date(Date.now() - RETENTION_DAYS * 86400000))).run();
    out.pruned = (pr.meta && pr.meta.changes) || 0;
    await refreshCoverageSearch(env);
  }
  out.duration_ms = Date.now() - started;
  if (env.KV && !dryRun) {
    try { await env.KV.put(LAST_RUN_KV_KEY, JSON.stringify({ ...out, new_items: out.new_items.slice(0, 20) })); } catch { /* best effort */ }
  }
  return out;
}

// Shown items go into the site search index (record_type coverage_item).
export async function refreshCoverageSearch(env) {
  try {
    await env.DB.prepare("DELETE FROM search_fts WHERE record_type = 'coverage_item'").run();
    await env.DB.prepare("INSERT INTO search_fts (record_type, record_id, title, body) SELECT 'coverage_item', id, title, COALESCE(publisher, '') || ' ' || COALESCE(summary, '') FROM coverage_items WHERE state = 'shown'").run();
  } catch { /* search is optional */ }
}

export async function lastCoverageRun(env) {
  try { return env.KV ? await env.KV.get(LAST_RUN_KV_KEY, "json") : null; } catch { return null; }
}

// ---------- reads ----------

export async function listCoverage(env, { state = "shown", limit = 200, offset = 0, country = null, tactic = null, from = null, to = null } = {}) {
  const where = [];
  const binds = [];
  if (state && state !== "all") { where.push("state = ?"); binds.push(state); }
  if (country) { where.push("country_guess = ?"); binds.push(String(country).toUpperCase()); }
  if (tactic) { where.push("tactic_guess = ?"); binds.push(tactic); }
  if (from) { where.push("COALESCE(published_at, fetched_at) >= ?"); binds.push(from); }
  if (to) { where.push("substr(COALESCE(published_at, fetched_at), 1, 10) <= ?"); binds.push(to); }
  binds.push(limit, offset);
  return all(env, `SELECT c.*, i.slug AS incident_slug, i.title AS incident_title FROM coverage_items c LEFT JOIN incidents i ON i.id = c.incident_id
    ${where.length ? `WHERE ${where.map((w) => `c.${w}`).join(" AND ")}` : ""} ORDER BY COALESCE(c.published_at, c.fetched_at) DESC, c.id DESC LIMIT ? OFFSET ?`, ...binds);
}

export async function updateCoverageItem(env, id, body, scope) {
  const item = await first(env, "SELECT * FROM coverage_items WHERE id = ?", id);
  if (!item) throw new ValidationError({ error: "not_found" }, 404);
  const sets = [];
  const binds = [];
  if (body.state !== undefined) {
    if (!["shown", "hidden"].includes(body.state)) throw new ValidationError({ field: "state", error: "enum", allowed: ["shown", "hidden"] });
    if (!body.reason) throw new ValidationError({ field: "reason", error: "required" });
    sets.push("state = ?", "state_reason = ?");
    binds.push(body.state, String(body.reason).slice(0, 300));
  }
  if (body.incident_slug !== undefined) {
    if (scope !== "publish") throw new ValidationError({ error: "forbidden", reason: "attaching coverage to an incident needs the publish scope" }, 403);
    let incId = null;
    if (body.incident_slug) {
      const inc = await first(env, "SELECT id FROM incidents WHERE slug = ?", body.incident_slug);
      if (!inc) throw new ValidationError({ field: "incident_slug", error: "unknown_slug" });
      incId = inc.id;
    }
    sets.push("incident_id = ?");
    binds.push(incId);
  }
  for (const k of ["tactic_guess", "country_guess"]) {
    if (body[k] !== undefined) { sets.push(`${k} = ?`); binds.push(body[k] || null); }
  }
  if (!sets.length) throw new ValidationError({ error: "nothing_to_update", fields: ["state", "reason", "incident_slug", "tactic_guess", "country_guess"] });
  sets.push("updated_at = ?");
  binds.push(isoNow(), id);
  await env.DB.prepare(`UPDATE coverage_items SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  await refreshCoverageSearch(env);
  return first(env, "SELECT * FROM coverage_items WHERE id = ?", id);
}
