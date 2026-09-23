// Remote MCP server (spec section 5), kept whole from Crank #2: plain-JS
// Streamable HTTP, JSON-RPC 2.0 over POST, KV sessions (24 hours), 5-minute
// KV cache for read tools (search_incidents logs to questions first and is
// not cached), every call in mcp_calls, protocol versions 2025-06-18,
// 2025-03-26 and 2024-11-05, CORS, no SSE. GET /mcp is answered by the
// documentation page in index.js, not here. Smoke UA prefix: twon-smoke/.

import { MCP_SERVER_NAME, MCP_SERVER_TITLE, SITE_ORIGIN } from "./site.js";
import { first, all, upsertQuestion, timelineRows, sourceObject } from "./db.js";
import { incidentHandler, actorHandler, caseHandler } from "./routes.js";
import { countryHandler, tacticHandler } from "./v2routes.js";
import { ladderHandler, unitedStatesHandler } from "./ladders.js";
import { refData, readFilters, queryIncidents } from "./search.js";
import { listCoverage } from "./coverage.js";
import { renderMarkdown } from "./render.js";
import { sha256Hex, isoNow, isoDate, normalizeQuestion, mdToPlain, linkStateLabel, extLinkMd } from "./util.js";
import { hashIp } from "./logger.js";
import { ENUMS } from "./records.js";

const SERVER_VERSION = "1.0.0";
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const SESSION_TTL_SECONDS = 24 * 3600;
const CACHE_TTL_SECONDS = 5 * 60;
const SUGGEST_CLIENT_DAILY_LIMIT = 20;
const SUGGEST_IP_DAILY_LIMIT = 60;
const CACHEABLE_TOOLS = new Set(["get_incident", "get_timeline", "get_actor", "get_case", "get_sources_for", "get_tactic", "get_country", "ladder", "get_united_states_chapter", "recent_coverage"]);
const STAGE_SLUGS = ["restrict", "pressure", "punish", "silence", "eliminate"];
const TACTIC_SLUGS = ["access_ban", "credential_control", "outlet_licensing", "prior_restraint", "secrets_and_espionage_laws", "insult_and_defamation_laws", "surveillance_and_subpoenas", "funding_and_ownership_pressure", "expulsion_and_visa_denial", "shutdowns_and_blocking", "detention_and_violence", "lawsuits_against_press", "disinformation_labeling"];
const CONTINENT_SLUGS = ["africa", "antarctica", "asia", "europe", "north-america", "oceania", "south-america"];
const TARGET_TYPES = ["incident", "actor", "outlet", "journalist", "case", "claim", "source", "explainer", "glossary_term"];

const SERVER_INSTRUCTIONS = "The War On News is a dated, sourced record of how governments have limited journalists, 1900 to today, by country, tactic and era. Use search_incidents (with country, continent, tactic, leader, outcome, from and to facets) to find incidents, get_incident for one incident with its claims and archived sources, get_country and get_tactic for a country's or a tactic's record (every country carries its RSF World Press Freedom Index rank), ladder for one tactic's incidents by escalation stage (restrict, pressure, punish, silence, eliminate) with the United States as the focal case, get_united_states_chapter for the United States chapter (2025 to 2026, the record since 1917, and where each tactic in use now has led elsewhere), get_timeline for dated entries, get_actor and get_case for people, bodies and court cases, recent_coverage for links to recent reporting, and get_sources_for for an incident's sources with link state. Cite pages by their URL. suggest_correction needs a client token from the publisher.";

export const MCP_SERVER_MANIFEST = {
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json",
  name: MCP_SERVER_NAME,
  title: MCP_SERVER_TITLE,
  description: "How governments have limited journalists, 1900 to today: a dated, sourced record by country, tactic and era, as MCP tools.",
  version: SERVER_VERSION,
  websiteUrl: SITE_ORIGIN,
  remotes: [{ type: "streamable-http", url: `${SITE_ORIGIN}/mcp` }],
};

const RO = { readOnlyHint: true, openWorldHint: false };

export const TOOLS = [
  {
    name: "search_incidents", title: "Search incidents", annotations: RO,
    description: "Search recorded incidents where governments or officials limited journalists' ability to report, with the same facets as /incidents. Returns date, country, tactic, head of government, outcome, summary and URL, newest first (best match first with a query).",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "Free-text terms (full-text search over titles and text)." },
      country: { type: "string", description: "ISO 3166-1 alpha-2 code, or several separated by commas (e.g. US or US,HU)." },
      continent: { type: "string", enum: CONTINENT_SLUGS },
      tactic: { type: "string", enum: TACTIC_SLUGS },
      leader: { type: "string", description: "Actor slug of the head of government at the time (e.g. donald-trump)." },
      actor: { type: "string", description: "Actor slug of any official or body named in the incident." },
      outcome: { type: "string", enum: ENUMS.outcome },
      level: { type: "string", enum: ENUMS.level },
      from: { type: "string", description: "Year or date (YYYY, YYYY-MM or YYYY-MM-DD)." },
      to: { type: "string", description: "Year or date (YYYY, YYYY-MM or YYYY-MM-DD)." },
      has_case: { type: "boolean" },
      sort: { type: "string", enum: ["date", "date_asc", "country", "tactic", "relevance"] },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
    } },
  },
  {
    name: "get_incident", title: "Get an incident", annotations: RO,
    description: "One incident: what happened, quoted justification, effect on reporting, status, timeline, actors, outlets, cases, claims and archived sources.",
    inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
  },
  {
    name: "get_timeline", title: "Get the timeline", annotations: RO,
    description: "Dated timeline entries, oldest first.",
    inputSchema: { type: "object", properties: {
      from: { type: "string", format: "date" }, to: { type: "string", format: "date" },
      actor: { type: "string" }, type: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
    } },
  },
  {
    name: "get_actor", title: "Get an actor", annotations: RO,
    description: "An official or body: role, office, jurisdiction, and every incident with the actor's role.",
    inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
  },
  {
    name: "get_case", title: "Get a court case", annotations: RO,
    description: "A court case: caption, court, docket, dates, quoted holding, status, parties, documents, incidents.",
    inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
  },
  {
    name: "get_country", title: "Get a country", annotations: RO,
    description: "One country's record: incidents by year, tactics used, heads of government at the time, and the latest RSF World Press Freedom Index rank where recorded.",
    inputSchema: { type: "object", properties: { iso2: { type: "string", description: "ISO 3166-1 alpha-2 code, e.g. US, HU, IN." } }, required: ["iso2"] },
  },
  {
    name: "get_tactic", title: "Get a tactic", annotations: RO,
    description: "One tactic: plain definition and every recorded incident using it, by country and year.",
    inputSchema: { type: "object", properties: { slug: { type: "string", enum: TACTIC_SLUGS } }, required: ["slug"] },
  },
  {
    name: "ladder", title: "A tactic's ladder", annotations: RO,
    description: "Where one tactic has led: its recorded incidents grouped by escalation stage (restrict, pressure, punish, silence, eliminate), then by date, with country and RSF 2026 rank, head of government, what was done, outcome, ladder note and number of sources. United States rows are marked as the focal case and come first within their stage. Entry counts reflect the depth of the record, not the severity of a country's conduct.",
    inputSchema: { type: "object", properties: {
      tactic: { type: "string", enum: TACTIC_SLUGS }, stage: { type: "string", enum: STAGE_SLUGS }, continent: { type: "string", enum: CONTINENT_SLUGS },
      from: { type: "string", description: "Year or date (YYYY, YYYY-MM or YYYY-MM-DD)" }, to: { type: "string", description: "Year or date (YYYY, YYYY-MM or YYYY-MM-DD)" },
    }, required: ["tactic"] },
  },
  {
    name: "get_united_states_chapter", title: "The United States chapter", annotations: RO,
    description: "The focal chapter as JSON: the United States' RSF 2026 rank; incidents dated 2025 and 2026 in date order with events; the earlier record from 1917 by decade; for each tactic in use now, the United States rows, the furthest stage the tactic has reached elsewhere and its ladder; United States court cases; sources.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "recent_coverage", title: "Recent coverage", annotations: RO,
    description: "Links to recent reporting (last 60 days) on government actions against journalists worldwide, newest first, with publisher and date. Headlines belong to their publishers.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } } },
  },
  {
    name: "get_sources_for", title: "Get sources for an incident", annotations: RO,
    description: "Every source an incident cites, with link state and Wayback snapshot URL.",
    inputSchema: { type: "object", properties: { incident_slug: { type: "string" } }, required: ["incident_slug"] },
  },
  {
    name: "suggest_correction", title: "Suggest a correction",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Suggest a correction. Requires a client token from the publisher. Stored as pending; an editor reviews every suggestion.",
    inputSchema: { type: "object", properties: {
      target_type: { type: "string", enum: TARGET_TYPES },
      target_id: { type: "string", description: "Slug, or numeric id for claims, sources, notes" },
      body: { type: "string", maxLength: 2000 },
      source_url: { type: "string", format: "uri" },
      author_claim: { type: "string", maxLength: 200 },
      token: { type: "string" },
    }, required: ["target_type", "target_id", "body", "token"] },
  },
];

// ---------- helpers ----------

function randomHex(nBytes) {
  const arr = new Uint8Array(nBytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj === undefined ? null : obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

function isSmokeTestUa(request) {
  const ua = (request && request.headers && request.headers.get("User-Agent")) || "";
  return ua.startsWith("twon-smoke/");
}

export function corsHeaders(extra) {
  return Object.assign({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  }, extra || {});
}

function jsonRaw(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, headers || {}) });
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
}

async function kvGetCount(env, key) {
  if (!env.KV) return 0;
  try { return parseInt((await env.KV.get(key)) || "0", 10) || 0; } catch { return 0; }
}

async function kvIncrCount(env, key, ttl) {
  if (!env.KV) return;
  try { await env.KV.put(key, String((await kvGetCount(env, key)) + 1), { expirationTtl: ttl }); } catch { /* best effort */ }
}

async function logMcpCall(env, { tool, argsHash, clientName, clientVersion, latencyMs, resultCount }) {
  if (!env.DB) return;
  try {
    await env.DB.prepare("INSERT INTO mcp_calls (ts, tool, args_hash, client_name, client_version, latency_ms, result_count) VALUES (?,?,?,?,?,?,?)")
      .bind(isoNow(), tool, argsHash || null, clientName || null, clientVersion || null, latencyMs ?? null, resultCount ?? 0).run();
  } catch {
    // logging never breaks the response
  }
}

function errResult(text) {
  return { content: [{ type: "text", text }], isError: true, resultCount: 0 };
}

async function docResult(doc, notFoundText) {
  if (!doc || doc.status === 404) return { content: [{ type: "text", text: notFoundText }], structuredContent: { found: false }, isError: false, resultCount: 0 };
  return { content: [{ type: "text", text: renderMarkdown(doc) }], structuredContent: doc.data, isError: false, resultCount: 1 };
}

function slugArg(args, key) {
  const v = String((args && args[key]) || "").trim().toLowerCase().replace(/^https?:\/\/[^/]+\/[a-z]+\//, "").replace(/\.(md|json)$/, "");
  return /^[a-z0-9-]{1,80}$/.test(v) ? v : null;
}

function syntheticCtx(env, path) {
  return { env, url: new URL(`${SITE_ORIGIN}${path}`), request: new Request(`${SITE_ORIGIN}${path}`) };
}

// ---------- tools ----------

async function toolSearchIncidents(args, { env, request }) {
  const ref = await refData(env);
  const limit = Math.min(Math.max(parseInt(args.limit, 10) || 10, 1), 100);
  const q = String(args.query || "").trim().slice(0, 200);
  const raw = { ...args, q, per_page: String(limit) };
  if (typeof args.has_case === "boolean") raw.has_case = args.has_case ? "1" : "0";
  for (const k of ["country", "continent", "tactic", "leader", "actor", "outcome", "level"]) {
    if (args[k] && !readFilters({ [k]: args[k] }, ref)[k]) return errResult(`Unknown ${k}: "${args[k]}".`);
  }
  const f = readFilters(raw, ref);
  f.per_page = String(limit);
  const res = await queryIncidents(env, f);
  if (q && !isSmokeTestUa(request)) {
    const norm = normalizeQuestion(q);
    try { await upsertQuestion(env, { textRaw: q, textNorm: norm, hash: await sha256Hex(norm), source: "mcp", ts: isoNow(), resultCount: res.total }); } catch { /* never breaks the tool */ }
  }
  const incidents = res.rows.map((r) => ({ slug: r.slug, title: r.title, occurred_on: r.occurred_on, occurred_on_precision: r.occurred_on_precision, country: r.country, country_name: r.country_name, continent: r.continent, level: r.level, tactic_primary: r.tactic_primary, tactics: r.tactics, leader_slug: r.leader_slug, leader_name: r.leader_name, outcome: r.outcome, status: r.status, summary: mdToPlain(r.summary), url: r.url }));
  const text = incidents.length
    ? incidents.map((i) => `- ${i.occurred_on} ${i.title} (${i.country_name}${i.tactic_primary ? `, ${i.tactic_primary}` : ""}${i.leader_name ? `, head of government ${i.leader_name}` : ""}, outcome ${i.outcome}). ${i.summary} ${i.url}`).join("\n")
    : "No recorded incident matches this search.";
  const { per_page: _p, ...filters } = f;
  return { content: [{ type: "text", text: `${res.total} matching; showing ${incidents.length}.\n${text}` }], structuredContent: { query: q, filters, count: res.total, returned: incidents.length, incidents }, isError: false, resultCount: incidents.length };
}

async function toolGetIncident(args, { env }) {
  const slug = slugArg(args, "slug");
  if (!slug) return errResult("get_incident requires a slug.");
  const doc = await incidentHandler(syntheticCtx(env, `/incidents/${slug}`), slug);
  return docResult(doc, `No published incident has the slug "${slug}".`);
}

async function toolGetTimeline(args, { env }) {
  const limit = Math.min(Math.max(parseInt(args.limit, 10) || 100, 1), 200);
  const rows = (await timelineRows(env, { actorSlug: args.actor || null, type: args.type || null, from: args.from || null, to: args.to || null })).slice(0, limit);
  const out = rows.map((r) => ({ ...r, url: r.incident_slug ? `${SITE_ORIGIN}/incidents/${r.incident_slug}` : r.case_slug ? `${SITE_ORIGIN}/cases/${r.case_slug}` : null }));
  const text = out.length ? out.map((r) => `${r.date} ${r.label}${r.url ? ` ${r.url}` : ""}`).join("\n") : "No timeline entries match.";
  return { content: [{ type: "text", text }], structuredContent: { filter: { from: args.from || null, to: args.to || null, actor: args.actor || null, type: args.type || null }, rows: out }, isError: false, resultCount: out.length };
}

async function toolGetActor(args, { env }) {
  const slug = slugArg(args, "slug");
  if (!slug) return errResult("get_actor requires a slug.");
  return docResult(await actorHandler(syntheticCtx(env, `/actors/${slug}`), slug), `No published actor has the slug "${slug}".`);
}

async function toolGetCase(args, { env }) {
  const slug = slugArg(args, "slug");
  if (!slug) return errResult("get_case requires a slug.");
  return docResult(await caseHandler(syntheticCtx(env, `/cases/${slug}`), slug), `No published case has the slug "${slug}".`);
}

async function toolGetCountry(args, { env }) {
  const iso = String(args.iso2 || args.country || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) return errResult("get_country requires an ISO 3166-1 alpha-2 code (iso2).");
  return docResult(await countryHandler(syntheticCtx(env, `/countries/${iso.toLowerCase()}`), iso), `No country has the code "${iso}".`);
}

async function toolGetTactic(args, { env }) {
  const slug = String(args.slug || "").trim().toLowerCase().replace(/-/g, "_");
  if (!TACTIC_SLUGS.includes(slug)) return errResult(`slug must be one of: ${TACTIC_SLUGS.join(", ")}`);
  return docResult(await tacticHandler(syntheticCtx(env, `/tactics/${slug}`), slug), `No tactic has the slug "${slug}".`);
}

async function toolLadder(args, { env }) {
  const tactic = String(args.tactic || "").trim().toLowerCase().replace(/-/g, "_");
  if (!TACTIC_SLUGS.includes(tactic)) return errResult(`tactic must be one of: ${TACTIC_SLUGS.join(", ")}`);
  if (args.stage && !STAGE_SLUGS.includes(String(args.stage).toLowerCase())) return errResult(`stage must be one of: ${STAGE_SLUGS.join(", ")}`);
  if (args.continent && !CONTINENT_SLUGS.includes(String(args.continent).toLowerCase())) return errResult(`continent must be one of: ${CONTINENT_SLUGS.join(", ")}`);
  const params = new URLSearchParams();
  for (const k of ["stage", "continent", "from", "to"]) if (args[k]) params.set(k, String(args[k]));
  const ctx = syntheticCtx(env, `/ladders/${tactic}${params.toString() ? `?${params}` : ""}`);
  const doc = await ladderHandler(ctx, tactic);
  const d = doc.data;
  const lines = [];
  for (const st of d.stages) {
    lines.push(`## ${st.name}${st.definition ? `: ${st.definition}` : ""}`);
    for (const r of st.rungs) lines.push(`- ${r.occurred_on} ${r.focal_case ? "[focal case] " : ""}${r.country_name} (${r.rsf ? r.rsf.label : "RSF rank: not recorded"})${r.leader_name ? `; head of government ${r.leader_name}` : ""}: ${r.what_was_done} Outcome: ${r.outcome}.${r.ladder_note ? ` Note: ${r.ladder_note}` : ""} Sources: ${r.sources_count}. ${r.url}`);
  }
  return { content: [{ type: "text", text: `# ${doc.title}\n\n${d.counts_caveat}\n\n${lines.length ? lines.join("\n") : "No incident matches."}\n\n${d.canonical_url}` }], structuredContent: d, isError: false, resultCount: d.count };
}

async function toolGetUnitedStatesChapter(args, { env }) {
  const doc = await unitedStatesHandler(syntheticCtx(env, "/united-states"));
  return { content: [{ type: "text", text: renderMarkdown(doc) }], structuredContent: doc.data, isError: false, resultCount: doc.data.now.incidents.length };
}

async function toolRecentCoverage(args, { env }) {
  const limit = Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), 100);
  const items = await listCoverage(env, { state: "shown", limit });
  const out = items.map((i) => ({ title: i.title, url: i.url, publisher: i.publisher, published_at: i.published_at, summary: i.summary, country_guess: i.country_guess, tactic_guess: i.tactic_guess }));
  const text = out.length ? out.map((i) => `- ${String(i.published_at || "").slice(0, 10)} ${i.title} (${i.publisher || ""}) ${i.url}`).join("\n") : "No recent coverage is listed yet.";
  return { content: [{ type: "text", text }], structuredContent: { count: out.length, items: out, page: `${SITE_ORIGIN}/coverage` }, isError: false, resultCount: out.length };
}

async function toolGetSourcesFor(args, { env }) {
  const slug = slugArg(args, "incident_slug");
  if (!slug) return errResult("get_sources_for requires an incident_slug.");
  const inc = await first(env, "SELECT id, title, pub_state FROM incidents WHERE slug = ?", slug);
  if (!inc || inc.pub_state !== "published") return { content: [{ type: "text", text: `No published incident has the slug "${slug}".` }], structuredContent: { found: false, sources: [] }, isError: false, resultCount: 0 };
  const rows = await all(env, "SELECT s.*, ins.role AS cite_role FROM incident_sources ins JOIN sources s ON s.id = ins.source_id WHERE ins.incident_id = ? ORDER BY ins.sort, s.id", inc.id);
  const sources = rows.map((s) => ({ ...sourceObject(s), role: s.cite_role }));
  const text = sources.length ? sources.map((s, i) => `${i + 1}. ${extLinkMd(s)} (${s.publisher}${s.published_on ? `, ${s.published_on}` : ""}). Link state: ${linkStateLabel(s.link_state)}.`).join("\n") : "No sources are linked yet.";
  return { content: [{ type: "text", text: `# Sources for ${inc.title}\n\n${text}\n\n${SITE_ORIGIN}/incidents/${slug}` }], structuredContent: { incident_slug: slug, url: `${SITE_ORIGIN}/incidents/${slug}`, sources }, isError: false, resultCount: sources.length };
}

async function resolveTarget(env, type, raw) {
  const map = { incident: "incidents", actor: "actors", outlet: "outlets", journalist: "journalists", case: "cases", explainer: "explainers", glossary_term: "glossary_terms" };
  const s = String(raw || "").trim();
  if (map[type]) {
    const r = /^\d+$/.test(s) ? await first(env, `SELECT id FROM ${map[type]} WHERE id = ?`, parseInt(s, 10)) : await first(env, `SELECT id FROM ${map[type]} WHERE slug = ?`, s);
    return r ? r.id : null;
  }
  const table = { claim: "claims", source: "sources", news_desk_note: "news_desk_notes" }[type];
  if (!table) return null;
  if (type === "news_desk_note" && !/^\d+$/.test(s)) {
    const r = await first(env, "SELECT id FROM news_desk_notes WHERE slug = ?", s);
    return r ? r.id : null;
  }
  const r = await first(env, `SELECT id FROM ${table} WHERE id = ?`, parseInt(s, 10));
  return r ? r.id : null;
}

async function toolSuggestCorrection(args, { env, request, ipHeader }) {
  const token = args && args.token;
  const noToken = "suggest_correction requires a client token issued by the publisher of The War On News.";
  if (!token || typeof token !== "string") return errResult(noToken);
  let clientName = null;
  try { clientName = env.KV ? await env.KV.get(`mcp_token:${await sha256Hex(token)}`) : null; } catch { clientName = null; }
  if (!clientName) return errResult(noToken);
  if (!TARGET_TYPES.includes(args.target_type)) return errResult(`target_type must be one of: ${TARGET_TYPES.join(", ")}`);
  const body = typeof args.body === "string" ? args.body.trim() : "";
  if (!body) return errResult("suggest_correction requires a non-empty body.");
  if (body.length > 2000) return errResult("body must be 2000 characters or fewer.");
  const targetId = await resolveTarget(env, args.target_type, args.target_id);
  if (targetId === null) return errResult(`No ${args.target_type} matches "${args.target_id}".`);
  const dateStr = isoDate();
  const ipHash = await hashIp(env, ipHeader || "", dateStr);
  const clientKey = `mcp_rl:client:${clientName}:${dateStr}`;
  const ipKey = `mcp_rl:ip:${ipHash}:${dateStr}`;
  if ((await kvGetCount(env, clientKey)) >= SUGGEST_CLIENT_DAILY_LIMIT || (await kvGetCount(env, ipKey)) >= SUGGEST_IP_DAILY_LIMIT) return errResult("Rate limit reached for suggest_correction.");
  if (isSmokeTestUa(request)) {
    return { content: [{ type: "text", text: "Not recorded: this request identified itself as test traffic (User-Agent twon-smoke/*)." }], structuredContent: { id: null, status: "skipped_test_traffic" }, isError: false, resultCount: 0 };
  }
  const res = await env.DB.prepare("INSERT INTO submissions (ts, channel, kind, target_type, target_id, body, source_url, author_claim, client_name, ua_raw, ip_hash, status) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending')")
    .bind(isoNow(), "mcp", "correction", args.target_type, targetId, body, args.source_url ? String(args.source_url).slice(0, 500) : null,
      args.author_claim ? String(args.author_claim).slice(0, 200) : null, clientName, (request.headers.get("User-Agent") || "").slice(0, 500), ipHash).run();
  await kvIncrCount(env, clientKey, 24 * 3600);
  await kvIncrCount(env, ipKey, 24 * 3600);
  const id = res.meta.last_row_id;
  return { content: [{ type: "text", text: `Suggestion ${id} stored as pending; an editor reviews every suggestion.` }], structuredContent: { id, status: "pending" }, isError: false, resultCount: 1 };
}

async function callTool(name, args, argsHash, deps) {
  const { env, ctx } = deps;
  const cacheable = CACHEABLE_TOOLS.has(name);
  if (cacheable && env.KV) {
    try {
      const cached = await env.KV.get(`mcp_cache:${name}:${argsHash}`, "json");
      if (cached) return cached;
    } catch {
      // fresh call
    }
  }
  const fns = {
    search_incidents: toolSearchIncidents, get_incident: toolGetIncident, get_timeline: toolGetTimeline, get_actor: toolGetActor,
    get_case: toolGetCase, get_sources_for: toolGetSourcesFor, suggest_correction: toolSuggestCorrection,
    get_country: toolGetCountry, get_tactic: toolGetTactic, ladder: toolLadder, get_united_states_chapter: toolGetUnitedStatesChapter, recent_coverage: toolRecentCoverage,
  };
  if (!fns[name]) return { notFoundTool: true, resultCount: 0 };
  const result = await fns[name](args || {}, deps);
  if (cacheable && env.KV && !result.isError) {
    ctx.waitUntil(env.KV.put(`mcp_cache:${name}:${argsHash}`, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS }).catch(() => {}));
  }
  return result;
}

// ---------- JSON-RPC dispatch ----------

async function handleSingle(msg, deps) {
  const { env, ctx, sessionId } = deps;
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return { response: rpcError(null, -32600, "Invalid Request") };
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  const id = hasId ? msg.id : undefined;
  const isNotification = !hasId;

  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return { response: isNotification ? undefined : rpcError(id, -32600, "Invalid Request") };
  }

  const method = msg.method;
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};

  try {
    if (method === "initialize") {
      const newSessionId = randomHex(16);
      const clientInfo = params.clientInfo && typeof params.clientInfo === "object" ? params.clientInfo : {};
      const requestedVersion = params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion) ? requestedVersion : DEFAULT_PROTOCOL_VERSION;
      const sessionRecord = {
        clientName: isSmokeTestUa(deps.request) ? "smoke-test" : (clientInfo.name || "unknown"),
        clientVersion: clientInfo.version || "",
        protocolVersion,
        ts: isoNow(),
      };
      if (env.KV) {
        ctx.waitUntil(
          env.KV.put(`mcp_session:${newSessionId}`, JSON.stringify(sessionRecord), { expirationTtl: SESSION_TTL_SECONDS }).catch(() => {})
        );
      }
      const result = {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: MCP_SERVER_NAME, title: MCP_SERVER_TITLE, version: SERVER_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      };
      const argsHash = await sha256Hex(canonicalJson(params));
      ctx.waitUntil(
        logMcpCall(env, {
          tool: "initialize",
          argsHash,
          clientName: sessionRecord.clientName,
          clientVersion: sessionRecord.clientVersion,
          latencyMs: 0,
          resultCount: 0,
        })
      );
      return { response: isNotification ? undefined : rpcResult(id, result), sessionHeader: newSessionId };
    }

    if (method === "ping") {
      return { response: isNotification ? undefined : rpcResult(id, {}) };
    }

    let session = null;
    if (sessionId && env.KV) {
      try {
        session = await env.KV.get(`mcp_session:${sessionId}`, "json");
      } catch {
        session = null;
      }
    }
    const clientName = isSmokeTestUa(deps.request) ? "smoke-test" : (session ? session.clientName : "unknown");
    const clientVersion = session ? session.clientVersion : "";

    if (method === "tools/list") {
      return { response: isNotification ? undefined : rpcResult(id, { tools: TOOLS }) };
    }

    if (method === "tools/call") {
      const toolName = params.name;
      if (!toolName || typeof toolName !== "string") {
        return { response: isNotification ? undefined : rpcError(id, -32602, "Invalid params: tools/call requires a string name") };
      }
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
      const argsHash = await sha256Hex(canonicalJson(args));
      const startedAt = Date.now();
      const outcome = await callTool(toolName, args, argsHash, { env, ctx, request: deps.request, ipHeader: deps.ipHeader });
      const latencyMs = Date.now() - startedAt;
      if (outcome.notFoundTool) {
        ctx.waitUntil(logMcpCall(env, { tool: toolName, argsHash, clientName, clientVersion, latencyMs, resultCount: 0 }));
        return { response: isNotification ? undefined : rpcError(id, -32602, `Unknown tool: ${toolName}`) };
      }
      ctx.waitUntil(
        logMcpCall(env, { tool: toolName, argsHash, clientName, clientVersion, latencyMs, resultCount: outcome.resultCount })
      );
      return {
        response: isNotification
          ? undefined
          : rpcResult(id, { content: outcome.content, structuredContent: outcome.structuredContent, isError: !!outcome.isError }),
      };
    }

    return { response: isNotification ? undefined : rpcError(id, -32601, `Method not found: ${method}`) };
  } catch (err) {
    return { response: isNotification ? undefined : rpcError(id, -32603, "Internal error: " + (err && err.message ? err.message : String(err))) };
  }
}

export async function handleMcpRequest(request, env, ctx) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers: corsHeaders({ "Content-Type": "application/json" }) });
  }
  if (request.method !== "POST") {
    return jsonRaw({ error: "method_not_allowed", message: "Only POST is served at /mcp." }, 405, corsHeaders({ Allow: "POST" }));
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    rawBody = "";
  }

  let parsed;
  try {
    parsed = rawBody.trim() === "" ? null : JSON.parse(rawBody);
  } catch {
    return jsonRaw(rpcError(null, -32700, "Parse error"), 400, corsHeaders());
  }
  if (parsed === null) {
    return jsonRaw(rpcError(null, -32700, "Parse error: empty body"), 400, corsHeaders());
  }

  const sessionId = request.headers.get("Mcp-Session-Id") || null;
  const ipHeader = request.headers.get("CF-Connecting-IP") || "";
  const deps = { env, ctx, request, sessionId, ipHeader };

  if (Array.isArray(parsed)) {
    const outs = [];
    let sessionHeader = null;
    for (const msg of parsed) {
      if (msg && msg.method === "notifications/initialized") continue;
      const { response: r, sessionHeader: sh } = await handleSingle(msg, deps);
      if (sh) sessionHeader = sh;
      if (r !== undefined) outs.push(r);
    }
    const headers = corsHeaders({ "Content-Type": "application/json" });
    if (sessionHeader) headers["Mcp-Session-Id"] = sessionHeader;
    if (outs.length === 0) return new Response(null, { status: 202, headers: corsHeaders() });
    return new Response(JSON.stringify(outs), { status: 200, headers });
  }

  if (parsed.method === "notifications/initialized") {
    return new Response(null, { status: 202, headers: corsHeaders() });
  }

  const { response: r, sessionHeader } = await handleSingle(parsed, deps);
  const headers = corsHeaders({ "Content-Type": "application/json" });
  if (sessionHeader) headers["Mcp-Session-Id"] = sessionHeader;
  if (r === undefined) {
    return new Response(null, { status: 202, headers });
  }
  return new Response(JSON.stringify(r), { status: 200, headers });
}
