// Discovery files: robots.txt (allow all, list sitemaps), llms.txt and
// llms-full.txt (spec 4.3), the agent card, and the Link header.

import { all } from "./db.js";
import { SITE_NAME, SITE_ORIGIN, PUBLISHER_NAME, PUBLISHER_URL } from "./site.js";
import { TOOLS, MCP_SERVER_MANIFEST } from "./mcp.js";
import { incidentHandler, caseHandler } from "./routes.js";
import { renderMarkdown } from "./render.js";

export function robotsTxt() {
  return `# ${SITE_NAME}: every crawler is welcome.
User-agent: *
Allow: /
Disallow: /admin/

# Every page is published as HTML, as Markdown (.md) and as JSON (.json).
# MCP endpoint (Streamable HTTP): ${SITE_ORIGIN}/mcp
# Dataset: ${SITE_ORIGIN}/data/datapackage.json
# llms.txt: ${SITE_ORIGIN}/llms.txt

Sitemap: ${SITE_ORIGIN}/sitemap.xml
Sitemap: ${SITE_ORIGIN}/sitemaps/pages.xml
Sitemap: ${SITE_ORIGIN}/sitemaps/incidents.xml
Sitemap: ${SITE_ORIGIN}/sitemaps/news.xml
Sitemap: ${SITE_ORIGIN}/sitemaps/news-google.xml
Sitemap: ${SITE_ORIGIN}/sitemaps/machine.xml
`;
}

export async function llmsTxt(env) {
  const incidents = await all(env, "SELECT slug, title, occurred_on, type FROM incidents WHERE pub_state = 'published' ORDER BY occurred_on DESC");
  const cases = await all(env, "SELECT slug, caption, filed_on, decided_on, status FROM cases WHERE pub_state = 'published' ORDER BY COALESCE(filed_on, decided_on) DESC");
  const lines = [
    `# ${SITE_NAME}`,
    "> A dated record of government actions that limit reporting. US-first, with global context.",
    "> Every page exists as HTML, .md and .json. Every fact is a claim with a verbatim quote, source URL, method and verification date. CC BY 4.0.",
    `> Editor and publisher: ${PUBLISHER_NAME}, Prince Edward County, Ontario. AI agents research, draft and check the site under his editorial control (see /methodology).`,
    "## Record",
    `- [Incidents](${SITE_ORIGIN}/incidents.md)`,
    `- [Timeline](${SITE_ORIGIN}/timeline.md)`,
    `- [Cases](${SITE_ORIGIN}/cases.md)`,
    `- [News Desk](${SITE_ORIGIN}/news.md)`,
    ...incidents.map((i) => `- [${i.title}](${SITE_ORIGIN}/incidents/${i.slug}.md): ${i.occurred_on}, ${i.type}`),
    ...cases.map((c) => `- [${c.caption}](${SITE_ORIGIN}/cases/${c.slug}.md): ${c.filed_on || c.decided_on || ""}, case, ${c.status}`),
    "## Data and tools",
    `- [Dataset](${SITE_ORIGIN}/data.md): CSV, JSON, Frictionless datapackage.json`,
    `- [MCP server](${SITE_ORIGIN}/mcp.md): Streamable HTTP at /mcp`,
    "## Policies",
    `- [Methodology](${SITE_ORIGIN}/methodology.md), [Editorial policy](${SITE_ORIGIN}/editorial-policy.md), [Corrections](${SITE_ORIGIN}/corrections.md)`,
  ];
  return lines.join("\n") + "\n";
}

export async function llmsFullTxt(env) {
  const incidents = await all(env, "SELECT slug FROM incidents WHERE pub_state = 'published' ORDER BY occurred_on DESC");
  const cases = await all(env, "SELECT slug FROM cases WHERE pub_state = 'published' ORDER BY id");
  const parts = [await llmsTxt(env)];
  for (const i of incidents) {
    const doc = await incidentHandler({ env, url: new URL(`${SITE_ORIGIN}/incidents/${i.slug}`) }, i.slug);
    if (doc && !doc.status) parts.push(renderMarkdown(doc));
  }
  for (const c of cases) {
    const doc = await caseHandler({ env, url: new URL(`${SITE_ORIGIN}/cases/${c.slug}`) }, c.slug);
    if (doc && !doc.status) parts.push(renderMarkdown(doc));
  }
  return parts.join("\n---\n\n");
}

export function agentCard() {
  return {
    name: SITE_NAME,
    description: "A dated, sourced record of government actions that limit journalists' ability to report. Every fact carries a verbatim quote, source URL, method and check date. Dataset under CC BY 4.0.",
    url: SITE_ORIGIN,
    provider: { organization: PUBLISHER_NAME, url: PUBLISHER_URL },
    version: MCP_SERVER_MANIFEST.version,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json", "text/markdown"],
    skills: TOOLS.map((t) => ({ id: t.name, name: t.title, description: t.description, tags: ["mcp", t.annotations && t.annotations.readOnlyHint ? "read" : "write"] })),
    mcp: { endpoint: `${SITE_ORIGIN}/mcp`, transport: "streamable-http", serverManifest: `${SITE_ORIGIN}/.well-known/mcp/server.json` },
    links: {
      data: `${SITE_ORIGIN}/data`, datapackage: `${SITE_ORIGIN}/data/datapackage.json`, changes: `${SITE_ORIGIN}/changes.xml`,
      sitemap: `${SITE_ORIGIN}/sitemap.xml`, llms: `${SITE_ORIGIN}/llms.txt`, feeds: `${SITE_ORIGIN}/feeds`,
    },
  };
}

export function linkHeaderValue() {
  return `</mcp>; rel="service", </.well-known/agent.json>; rel="service-desc", </sitemaps/machine.xml>; rel="sitemap"`;
}
