// Remote MCP server (spec section 8), Streamable HTTP, JSON-RPC 2.0 over a
// single POST endpoint. Plain JS, no SDK. Dispatched directly from fetch()
// in index.js before the format-negotiation dispatcher: this endpoint only
// ever speaks JSON-RPC, never HTML/Markdown/JSON-doc negotiation.

import { MCP_SERVER_NAME, SITE_ORIGIN } from "./site.js";
import {
  listEntities, getEntityBySlug, getEntityById, listClaimsForEntity, getClaim,
  listChanges, upsertQuestion, insertNote, searchEntitiesAndClaims, getEntityPatterns,
  getQuestionById, getQuestionByHash,
} from "./db.js";
import { crawlerDetailHandler } from "./routes.js";
import { renderMarkdown } from "./render.js";
import { sha256Hex, isoNow, isoDate, normalizeQuestion } from "./util.js";
import { hashIp } from "./logger.js";

const SERVER_VERSION = "0.1.0";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const SESSION_TTL_SECONDS = 24 * 3600;
const CACHE_TTL_SECONDS = 5 * 60;
const SUBMIT_NOTE_CLIENT_DAILY_LIMIT = 20;
const SUBMIT_NOTE_IP_DAILY_LIMIT = 60;
const CACHEABLE_TOOLS = new Set(["lookup_crawler", "identify_user_agent", "list_changes"]);

const SERVER_INSTRUCTIONS = "These tools look up a documented crawler or agent by name or user-agent string and match a free-text question against the claims published on Rattlesnakes By Mail. Submitting a note requires a client token issued by Rattlesnakes By Mail.";

// This manifest is also written by hand to site/server.json for the
// Official MCP Registry (see docs/build-notes-P0.4.md); the two are kept in
// sync manually since there is no build step to generate one from the other.
export const MCP_SERVER_MANIFEST = {
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json",
  name: "com.rattlesnakesbymail/rattlesnakesbymail",
  description: "Dated, sourced claims about AI crawlers and agents, offered as MCP tools.",
  version: SERVER_VERSION,
  websiteUrl: SITE_ORIGIN,
  remotes: [
    { type: "streamable-http", url: `${SITE_ORIGIN}/mcp` },
  ],
};

export const TOOLS = [
  {
    name: "lookup_crawler",
    title: "Look Up A Crawler",
    description: "Look up a documented crawler on Rattlesnakes By Mail by name, slug, or user-agent string, and return identity fields, current claims, publication dates, and evidence URLs. Use lookup_crawler when the crawler is already named, or when the user agent is already known to belong to a documented crawler.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        name_or_ua: { type: "string", description: "A crawler name, slug, or full user-agent string." },
      },
      required: ["name_or_ua"],
    },
  },
  {
    name: "identify_user_agent",
    title: "Identify A User Agent",
    description: "Match an unrecognized raw User-Agent header against the crawlers documented on Rattlesnakes By Mail, and return the matched crawler plus instructions for verifying the request. Use identify_user_agent when the crawler behind the User-Agent header is not yet known.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        user_agent: { type: "string", description: "A raw User-Agent header string." },
      },
      required: ["user_agent"],
    },
  },
  {
    name: "list_changes",
    title: "List Changes",
    description: "List recorded changes to claims on Rattlesnakes By Mail, newest first, with the change date and the affected crawler. Filter by date with since, by crawler with entity, or by both. Use list_changes to detect crawler policy updates published after a given date.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "An ISO date; only changes on or after this date are returned." },
        entity: { type: "string", description: "An entity slug to filter changes to one crawler." },
        limit: { type: "integer", description: "Maximum rows to return, up to 200.", maximum: 200 },
      },
    },
  },
  {
    name: "ask",
    title: "Ask A Question",
    description: "Match a free-text question against the claims published on Rattlesnakes By Mail, and return the matching claims, or no match when no published claim covers the question. Every question sent to ask is recorded, and a recorded question may be published on the public questions page at Rattlesnakes By Mail. Do not send private or identifying text to ask.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "A free-text question about crawlers, agents, or claims." },
      },
      required: ["question"],
    },
  },
  {
    name: "submit_note",
    title: "Submit A Note",
    description: "Submit a correction or note about a claim, an entity, or a question on Rattlesnakes By Mail. Requires a client token issued out of band by the publisher. Every note is stored as pending, and an editor reviews every pending note before publication.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        target_type: { type: "string", enum: ["claim", "entity", "question"], description: "The kind of record the note is about." },
        target_id: { type: "string", description: "The id or slug of the claim or entity, or the id or hash of the question, the note is about." },
        body: { type: "string", description: "The note text, up to 2000 characters.", maxLength: 2000 },
        token: { type: "string", description: "A client token issued by Rattlesnakes By Mail." },
      },
      required: ["target_type", "target_id", "body", "token"],
    },
  },
];

// ---------- small helpers ----------

function randomHex(nBytes) {
  const arr = new Uint8Array(nBytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj === undefined ? null : obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

function safeRegexTest(pattern, str) {
  try {
    return new RegExp(pattern).test(str);
  } catch {
    return false;
  }
}

// P0.4 follow-up: our own verification scripts identify themselves with
// this User-Agent so their calls never pollute the questions/notes ledger.
function isSmokeTestUa(request) {
  const ua = (request && request.headers && request.headers.get("User-Agent")) || "";
  return ua.startsWith("rsbm-smoke/");
}

function corsHeaders(extra) {
  return Object.assign(
    {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS, HEAD",
      "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
      "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
    },
    extra || {}
  );
}

function jsonRaw(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, headers || {}),
  });
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
}

async function kvGetCount(env, key) {
  if (!env.KV) return 0;
  try {
    const v = await env.KV.get(key);
    return v ? parseInt(v, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

async function kvIncrCount(env, key, ttlSeconds) {
  if (!env.KV) return;
  try {
    const cur = await kvGetCount(env, key);
    await env.KV.put(key, String(cur + 1), { expirationTtl: ttlSeconds });
  } catch {
    // best effort, same accepted race as logger.js counters
  }
}

async function logMcpCall(env, { tool, argsHash, clientName, clientVersion, latencyMs, resultCount }) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO mcp_calls (ts, tool, args_hash, client_name, client_version, latency_ms, result_count) VALUES (?,?,?,?,?,?,?)`
    )
      .bind(isoNow(), tool, argsHash || null, clientName || null, clientVersion || null, latencyMs ?? null, resultCount ?? 0)
      .run();
  } catch {
    // logging must never break the response path
  }
}

async function findEntityByNameOrUa(env, q) {
  const entities = await listEntities(env);
  const qLower = q.toLowerCase();
  const qSlug = qLower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let found = entities.find((e) => e.slug === qSlug);
  if (found) return found;
  found = entities.find((e) => e.name && e.name.toLowerCase() === qLower);
  if (found) return found;
  found = entities.find((e) => e.ua_token && e.ua_token.toLowerCase() === qLower);
  if (found) return found;
  found = entities.find((e) => e.robots_token && e.robots_token.toLowerCase() === qLower);
  if (found) return found;
  found = entities.find((e) => e.ua_pattern && safeRegexTest(e.ua_pattern, q));
  if (found) return found;
  found = entities.find((e) => qLower.includes(e.slug) || (e.name && qLower.includes(e.name.toLowerCase())));
  return found || null;
}

async function resolveNoteTarget(env, targetType, targetIdRaw) {
  if (targetType === "claim") {
    const id = typeof targetIdRaw === "string" ? parseInt(targetIdRaw, 10) : targetIdRaw;
    if (!Number.isInteger(id)) return null;
    const claim = await getClaim(env, id);
    return claim ? claim.id : null;
  }
  if (targetType === "entity") {
    if (typeof targetIdRaw === "string" && !/^\d+$/.test(targetIdRaw)) {
      const bySlug = await getEntityBySlug(env, targetIdRaw);
      return bySlug ? bySlug.id : null;
    }
    const id = typeof targetIdRaw === "string" ? parseInt(targetIdRaw, 10) : targetIdRaw;
    if (!Number.isInteger(id)) return null;
    const entity = await getEntityById(env, id);
    return entity ? entity.id : null;
  }
  if (targetType === "question") {
    // A question's public address is its hash (/questions/<hash>), so a
    // non-numeric target_id is looked up by hash; a numeric target_id is
    // looked up by the questions.id primary key, the same fallback the
    // public /notes form uses.
    if (typeof targetIdRaw === "string" && !/^\d+$/.test(targetIdRaw)) {
      const byHash = await getQuestionByHash(env, targetIdRaw);
      return byHash ? byHash.id : null;
    }
    const id = typeof targetIdRaw === "string" ? parseInt(targetIdRaw, 10) : targetIdRaw;
    if (!Number.isInteger(id)) return null;
    const question = await getQuestionById(env, id);
    return question ? question.id : null;
  }
  return null;
}

// ---------- tool implementations ----------
// Each returns { content, structuredContent, isError, resultCount }.

async function toolLookupCrawler(args, { env }) {
  const q = String((args && args.name_or_ua) || "").trim();
  if (!q) {
    return {
      content: [{ type: "text", text: "lookup_crawler requires a non-empty name_or_ua." }],
      structuredContent: { matched: false, entity: null, claims: [] },
      isError: true,
      resultCount: 0,
    };
  }
  const entity = await findEntityByNameOrUa(env, q);
  if (!entity) {
    return {
      content: [{ type: "text", text: `No crawler on Rattlesnakes By Mail matches "${q}".` }],
      structuredContent: { matched: false, entity: null, claims: [] },
      isError: false,
      resultCount: 0,
    };
  }
  // crawlerDetailHandler reads url.searchParams (for the "?submitted=1"
  // confirmation banner, HTML-only concern); lookup_crawler has no real
  // request URL, so a synthetic one is passed here rather than touching
  // crawlerDetailHandler itself, which the HTML route also calls unchanged.
  const doc = await crawlerDetailHandler({ env, url: new URL(`${SITE_ORIGIN}/crawlers/${entity.slug}`) }, entity.slug);
  const text = renderMarkdown(doc);
  const claims = doc.data.claims;
  return {
    content: [{ type: "text", text }],
    structuredContent: { matched: true, entity: doc.data.entity, claims },
    isError: false,
    resultCount: claims.length,
  };
}

async function toolIdentifyUserAgent(args, { env }) {
  const ua = String((args && args.user_agent) || "").trim();
  if (!ua) {
    return {
      content: [{ type: "text", text: "identify_user_agent requires a non-empty user_agent." }],
      structuredContent: { matched: false },
      isError: true,
      resultCount: 0,
    };
  }
  const patterns = await getEntityPatterns(env);
  const match = patterns.find((p) => safeRegexTest(p.pattern, ua));
  if (!match) {
    return {
      content: [{ type: "text", text: `The string "${ua}" matches no documented crawler on Rattlesnakes By Mail.` }],
      structuredContent: { matched: false },
      isError: false,
      resultCount: 0,
    };
  }
  const entity = await getEntityById(env, match.id);
  const claims = await listClaimsForEntity(env, entity.id);
  const rdnsClaim = claims.find((c) => c.field === "verifiable_by_rdns");
  const verifiableByRdns = rdnsClaim ? rdnsClaim.value : null;
  const ipListUrl = entity.ip_list_url || null;
  let instruction;
  if (ipListUrl && verifiableByRdns === "yes") {
    instruction = `Verify a ${entity.name} request by checking the source IP against ${ipListUrl}, or by reverse DNS lookup.`;
  } else if (ipListUrl) {
    instruction = `Verify a ${entity.name} request by checking the source IP against ${ipListUrl}.`;
  } else if (verifiableByRdns === "yes") {
    instruction = `Verify a ${entity.name} request by reverse DNS lookup on the source IP.`;
  } else {
    instruction = `Rattlesnakes By Mail has no documented IP list or reverse-DNS method for ${entity.name}.`;
  }
  return {
    content: [{ type: "text", text: instruction }],
    structuredContent: {
      matched: true,
      slug: entity.slug,
      name: entity.name,
      vendor: entity.vendor,
      kind: entity.kind,
      purpose: entity.purpose,
      ip_list_url: ipListUrl,
      verifiable_by_rdns: verifiableByRdns,
      verification: instruction,
    },
    isError: false,
    resultCount: 1,
  };
}

async function toolListChanges(args, { env }) {
  const since = args && args.since ? String(args.since) : null;
  const entitySlug = args && args.entity ? String(args.entity) : null;
  let limit = args && args.limit;
  limit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 200;
  const fetchLimit = since ? 2000 : limit;
  let rows = await listChanges(env, { entitySlug, limit: fetchLimit });
  if (since) rows = rows.filter((r) => r.changed_at >= since);
  rows = rows.slice(0, limit);
  const shaped = rows.map((r) => ({
    changed_at: r.changed_at,
    kind: r.kind,
    entity: r.entity_slug || null,
    old_value: r.old_value,
    new_value: r.new_value,
    evidence_url: r.evidence_url,
    claim_url: r.claim_id ? `${SITE_ORIGIN}/claims/${r.claim_id}` : null,
    note: r.note,
  }));
  const text = shaped.length
    ? shaped.map((r) => `${r.changed_at}  ${r.entity || ""}  ${r.kind}  ${r.old_value || ""} -> ${r.new_value || ""}`).join("\n")
    : "No changes match this query.";
  return {
    content: [{ type: "text", text }],
    structuredContent: { changes: shaped },
    isError: false,
    resultCount: shaped.length,
  };
}

async function toolAsk(args, { env, request }) {
  const q = String((args && args.question) || "").trim();
  if (!q) {
    return {
      content: [{ type: "text", text: "ask requires a non-empty question." }],
      structuredContent: { claims: [], entities: [] },
      isError: true,
      resultCount: 0,
    };
  }
  const normalized = normalizeQuestion(q);
  if (!isSmokeTestUa(request)) {
    const hash = await sha256Hex(normalized);
    const ts = isoNow();
    try {
      await upsertQuestion(env, { textRaw: q, textNorm: normalized, hash, source: "mcp", ts });
    } catch {
      // logging the question must never break the tool response
    }
  }
  const result = await searchEntitiesAndClaims(env, normalized);
  const claims = result.claims.slice(0, 10).map((c) => ({
    id: c.id,
    entity_id: c.entity_id,
    field: c.field,
    value: c.value,
    statement: c.statement,
    evidence_url: c.evidence_url,
    evidence_quote: c.evidence_quote,
    evidence_date: c.evidence_date,
    method: c.method,
    verified_at: c.verified_at,
    confidence: c.confidence,
    claim_url: `${SITE_ORIGIN}/claims/${c.id}`,
  }));
  const entities = result.entities.map((e) => ({ slug: e.slug, name: e.name, vendor: e.vendor, kind: e.kind }));
  const text = claims.length
    ? claims.map((c) => `${c.statement} (${c.claim_url})`).join("\n")
    : "No published claims matched this question. It has been logged to the ledger as a gap.";
  return {
    content: [{ type: "text", text }],
    structuredContent: { claims, entities },
    isError: false,
    resultCount: claims.length,
  };
}

async function toolSubmitNote(args, { env, request, ipHeader }) {
  const targetType = args && args.target_type;
  const targetIdRaw = args && args.target_id;
  const body = args && args.body;
  const token = args && args.token;

  if (!token || typeof token !== "string") {
    return {
      content: [{ type: "text", text: "submit_note requires a client token issued by Rattlesnakes By Mail." }],
      isError: true,
      resultCount: 0,
    };
  }
  const tokenHash = await sha256Hex(token);
  let clientName = null;
  if (env.KV) {
    try {
      clientName = await env.KV.get(`mcp_token:${tokenHash}`);
    } catch {
      clientName = null;
    }
  }
  if (!clientName) {
    return {
      content: [{ type: "text", text: "submit_note requires a client token issued by Rattlesnakes By Mail." }],
      isError: true,
      resultCount: 0,
    };
  }
  if (targetType !== "claim" && targetType !== "entity" && targetType !== "question") {
    return { content: [{ type: "text", text: 'target_type must be "claim", "entity", or "question".' }], isError: true, resultCount: 0 };
  }
  if (!body || typeof body !== "string" || !body.trim()) {
    return { content: [{ type: "text", text: "submit_note requires a non-empty body." }], isError: true, resultCount: 0 };
  }
  if (body.length > 2000) {
    return { content: [{ type: "text", text: "submit_note body must be 2000 characters or fewer." }], isError: true, resultCount: 0 };
  }
  const resolvedTargetId = await resolveNoteTarget(env, targetType, targetIdRaw);
  if (resolvedTargetId === null) {
    return { content: [{ type: "text", text: `No ${targetType} exists with id "${targetIdRaw}".` }], isError: true, resultCount: 0 };
  }

  const dateStr = isoDate();
  const clientKey = `mcp_rl:client:${clientName}:${dateStr}`;
  const ip = ipHeader || "";
  const ipHash = await hashIp(env, ip, dateStr);
  const ipKey = `mcp_rl:ip:${ipHash}:${dateStr}`;

  const clientCount = await kvGetCount(env, clientKey);
  const ipCount = await kvGetCount(env, ipKey);
  if (clientCount >= SUBMIT_NOTE_CLIENT_DAILY_LIMIT || ipCount >= SUBMIT_NOTE_IP_DAILY_LIMIT) {
    return { content: [{ type: "text", text: "Rate limit reached for submit_note." }], isError: true, resultCount: 0 };
  }

  if (isSmokeTestUa(request)) {
    // Our own verification traffic: every other validation above still
    // ran for real, but nothing is written and no rate-limit counter moves.
    return {
      content: [{ type: "text", text: "Note not recorded: this request identified itself as test traffic (User-Agent rsbm-smoke/*)." }],
      structuredContent: { id: null, status: "skipped_test_traffic" },
      isError: false,
      resultCount: 0,
    };
  }

  const noteId = await insertNote(env, {
    ts: isoNow(),
    targetType,
    targetId: resolvedTargetId,
    body: body.trim().slice(0, 2000),
    authorClaim: `mcp:${clientName}`,
    uaRaw: request.headers.get("User-Agent") || "",
    ipHash,
  });
  await kvIncrCount(env, clientKey, 24 * 3600);
  await kvIncrCount(env, ipKey, 24 * 3600);

  return {
    content: [{ type: "text", text: `Note ${noteId} submitted and pending review.` }],
    structuredContent: { id: noteId, status: "pending" },
    isError: false,
    resultCount: 1,
  };
}

async function callTool(name, args, argsHash, deps) {
  const { env, ctx } = deps;
  const cacheable = CACHEABLE_TOOLS.has(name);
  if (cacheable && env.KV) {
    try {
      const cached = await env.KV.get(`mcp_cache:${name}:${argsHash}`, "json");
      if (cached) return cached;
    } catch {
      // fall through to a fresh call
    }
  }
  let result;
  switch (name) {
    case "lookup_crawler":
      result = await toolLookupCrawler(args, deps);
      break;
    case "identify_user_agent":
      result = await toolIdentifyUserAgent(args, deps);
      break;
    case "list_changes":
      result = await toolListChanges(args, deps);
      break;
    case "ask":
      result = await toolAsk(args, deps);
      break;
    case "submit_note":
      result = await toolSubmitNote(args, deps);
      break;
    default:
      return { notFoundTool: true, resultCount: 0 };
  }
  if (cacheable && env.KV && !result.isError) {
    ctx.waitUntil(
      env.KV.put(`mcp_cache:${name}:${argsHash}`, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS }).catch(() => {})
    );
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
        serverInfo: { name: MCP_SERVER_NAME, version: SERVER_VERSION },
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
  if (request.method === "GET") {
    return jsonRaw(
      { error: "method_not_allowed", message: "POST a JSON-RPC 2.0 request to this endpoint. There is no SSE stream in v1." },
      405,
      corsHeaders({ Allow: "POST" })
    );
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
