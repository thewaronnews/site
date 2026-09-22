// Discovery surfaces for agents and crawlers (P1, discovery pass): an A2A
// agent card, a machine-only sitemap of the .md/.json views, a sitemap
// index, and small helpers other modules append into robots.txt and Link
// headers with. This file adds no routes to index.js on its own; the
// integrator dispatches handle() from fetch() and appends robotsExtra()
// and linkHeaderValue() where index.js builds robots.txt and its headers.

import { SITE_NAME, SITE_ORIGIN, PUBLISHER_NAME, PUBLISHER_URL } from "./site.js";
import { listEntities, listAllCurrentClaims, listAllChangesForExport } from "./db.js";
import { TOOLS, MCP_SERVER_MANIFEST } from "./mcp.js";
import { listPaths as fieldsListPaths } from "./fields.js";
import { listPaths as compareListPaths } from "./compare.js";

const SERVER_VERSION = MCP_SERVER_MANIFEST.version;

export const OBSERVED_PATHS = [
  "/.well-known/agent.json",
  "/.well-known/agent-card.json",
  "/sitemap-machine.xml",
  "/sitemap-index.xml",
];

function jsonResponse(body) {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function xmlResponse(body) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function agentCard() {
  return {
    name: SITE_NAME,
    description:
      "A public record of documented and observed behaviour of AI crawlers, fetchers and search bots. Every claim carries a vendor quote, a date and a source URL. Dataset published under CC BY 4.0.",
    url: SITE_ORIGIN,
    provider: {
      organization: PUBLISHER_NAME,
      url: PUBLISHER_URL,
    },
    version: SERVER_VERSION,
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json", "text/markdown"],
    skills: TOOLS.map((t) => ({
      id: t.name,
      name: t.title,
      description: t.description,
      tags: ["mcp", "read"],
    })),
    mcp: {
      endpoint: `${SITE_ORIGIN}/mcp`,
      transport: "streamable-http",
      serverManifest: `${SITE_ORIGIN}/.well-known/mcp/server.json`,
    },
    links: {
      data: `${SITE_ORIGIN}/data`,
      changes: `${SITE_ORIGIN}/changes.xml`,
      sitemap: `${SITE_ORIGIN}/sitemap.xml`,
      sitemapMachine: `${SITE_ORIGIN}/sitemap-machine.xml`,
      llms: `${SITE_ORIGIN}/llms.txt`,
      mcpManifest: `${SITE_ORIGIN}/.well-known/mcp/server.json`,
    },
  };
}

// Reuses the same URL enumeration as the HTML/JSON sitemap (index.js
// sitemapXml): entities, current claims and the fixed section pages, from
// the same db.js reads. Each entry becomes its .md and .json pair here,
// since this sitemap exists to point machine readers straight at those
// views instead of the negotiated HTML.
async function machineEntries(env) {
  const entities = await listEntities(env);
  const claims = await listAllCurrentClaims(env, 5000);
  const changes = await listAllChangesForExport(env);

  let latestChangeDate = null;
  const latestChangeByEntity = new Map();
  for (const c of changes) {
    const d = (c.changed_at || "").slice(0, 10);
    if (!d) continue;
    if (!latestChangeDate || d > latestChangeDate) latestChangeDate = d;
    if (c.entity_id != null) {
      const prev = latestChangeByEntity.get(c.entity_id);
      if (!prev || d > prev) latestChangeByEntity.set(c.entity_id, d);
    }
  }

  const bases = [
    { loc: "/", lastmod: latestChangeDate },
    { loc: "/crawlers", lastmod: null },
    { loc: "/claims", lastmod: null },
    { loc: "/changes", lastmod: latestChangeDate },
    { loc: "/observed", lastmod: null },
    { loc: "/questions", lastmod: null },
    { loc: "/data", lastmod: null },
    { loc: "/data/latest", lastmod: null },
    { loc: "/method", lastmod: null },
  ];
  for (const e of entities) {
    const lastmod = latestChangeByEntity.get(e.id) || (e.updated_at || "").slice(0, 10) || null;
    bases.push({ loc: `/crawlers/${e.slug}`, lastmod });
    bases.push({ loc: `/observed/${e.slug}`, lastmod: null });
  }
  for (const c of claims) {
    bases.push({ loc: `/claims/${c.id}`, lastmod: (c.created_at || "").slice(0, 10) || null });
  }

  for (const p of await fieldsListPaths(env)) bases.push({ loc: p, lastmod: null });
  for (const p of await compareListPaths(env)) bases.push({ loc: p, lastmod: null });

  const entries = [];
  for (const b of bases) {
    entries.push({ loc: `${b.loc}.md`, lastmod: b.lastmod });
    entries.push({ loc: `${b.loc}.json`, lastmod: b.lastmod });
  }
  return entries;
}

async function sitemapMachineXml(env) {
  const entries = await machineEntries(env);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((u) => `  <url><loc>${SITE_ORIGIN}${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>`;
  return body;
}

function sitemapIndexXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${SITE_ORIGIN}/sitemap.xml</loc></sitemap>
  <sitemap><loc>${SITE_ORIGIN}/sitemap-machine.xml</loc></sitemap>
</sitemapindex>`;
}

// Called from fetch() in index.js. Returns a Response for a matched path,
// or null so the caller falls through to its own dispatch chain.
export async function handle(request, env, url) {
  const pathname = url.pathname;
  if (pathname === "/.well-known/agent.json" || pathname === "/.well-known/agent-card.json") {
    return jsonResponse(agentCard());
  }
  if (pathname === "/sitemap-machine.xml") {
    return xmlResponse(await sitemapMachineXml(env));
  }
  if (pathname === "/sitemap-index.xml") {
    return xmlResponse(sitemapIndexXml());
  }
  return null;
}

// Lines to append to the end of robots.txt (index.js robotsTxt()).
export function robotsExtra(origin) {
  return [
    "",
    "# Rattlesnakes By Mail is a machine-first reference on AI crawlers.",
    "# Every page is published as HTML, as Markdown at the .md suffix, and as JSON at the .json suffix.",
    `# MCP endpoint (streamable HTTP): ${origin}/mcp`,
    `# Agent card: ${origin}/.well-known/agent.json`,
    `# Dataset: ${origin}/data`,
    `Sitemap: ${origin}/sitemap-index.xml`,
    `Sitemap: ${origin}/sitemap-machine.xml`,
  ].join("\n");
}

// Value for a Link response header pointing agents at the MCP endpoint,
// the agent card, and the machine sitemap.
export function linkHeaderValue(origin) {
  return `</mcp>; rel="service", </.well-known/agent.json>; rel="service-desc", </sitemap-machine.xml>; rel="sitemap"`;
}
