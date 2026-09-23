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
Sitemap: ${SITE_ORIGIN}/sitemaps/machine.xml
`;
}

export async function llmsTxt(env) {
  const incidents = await all(env, "SELECT slug, title, occurred_on, country, tactic_primary FROM incidents WHERE pub_state = 'published' ORDER BY occurred_on DESC");
  const cases = await all(env, "SELECT slug, caption, filed_on, decided_on, status FROM cases WHERE pub_state = 'published' ORDER BY COALESCE(filed_on, decided_on) DESC");
  const tactics = await all(env, "SELECT slug, name FROM tactics ORDER BY sort");
  const countries = await all(env, "SELECT DISTINCT i.country AS iso2, c.name FROM incidents i JOIN countries c ON c.iso2 = i.country WHERE i.pub_state = 'published' ORDER BY c.name");
  const lines = [
    `# ${SITE_NAME}`,
    "> How governments have limited journalists, 1900 to today: a dated, sourced record by country, by tactic and by era, with the head of government at the time, the issue of the day and the outcome.",
    "> Every page exists as HTML, .md and .json; list views also as CSV (?format=csv). Every fact is a claim with a verbatim quote, source URL, method and verification date. CC BY 4.0.",
    `> Published by ${PUBLISHER_NAME}, Ontario, Canada. The development of this site and its content were assisted with AI.`,
    "## Ways in",
    `- [Incidents, with filters](${SITE_ORIGIN}/incidents.md): country, continent, tactic, stage, from, to, level, actor, leader, outlet, outcome, source_kind, has_case`,
    `- [The United States chapter](${SITE_ORIGIN}/united-states.md): the focal case; 2025 to 2026, the record since 1917, and where each tactic in use now has led elsewhere`,
    `- [Ladders](${SITE_ORIGIN}/ladders.md): each tactic's incidents by escalation stage (restrict, pressure, punish, silence, eliminate); /ladders/<tactic> takes stage, continent, from, to`,
    `- [Countries](${SITE_ORIGIN}/countries.md): each with its RSF World Press Freedom Index 2026 rank`,
    `- [Tactics](${SITE_ORIGIN}/tactics.md)`,
    `- [Eras since 1900](${SITE_ORIGIN}/eras.md)`,
    `- [Timeline](${SITE_ORIGIN}/timeline.md)`,
    `- [Cases](${SITE_ORIGIN}/cases.md)`,
    `- [Recent coverage](${SITE_ORIGIN}/coverage.md)`,
    `- [Search](${SITE_ORIGIN}/search.md?q=press+pass)`,
    `- [What this record is about](${SITE_ORIGIN}/context.md): the premise, the definition of journalism used here, and the economic pressures on it`,
    "> The number of entries for a country reflects the depth of this record, not the severity of that country's conduct; the record is deepest for the United States. No view ranks countries by count.",
    "## Ladders",
    ...tactics.map((t) => `- [${t.name}](${SITE_ORIGIN}/ladders/${t.slug}.md)`),
    "## Tactics",
    ...tactics.map((t) => `- [${t.name}](${SITE_ORIGIN}/tactics/${t.slug}.md)`),
    "## Countries",
    ...countries.map((c) => `- [${c.name}](${SITE_ORIGIN}/countries/${c.iso2.toLowerCase()}.md)`),
    "## Incidents",
    ...incidents.map((i) => `- [${i.title}](${SITE_ORIGIN}/incidents/${i.slug}.md): ${i.occurred_on}, ${i.country}${i.tactic_primary ? `, ${i.tactic_primary}` : ""}`),
    "## Cases",
    ...cases.map((c) => `- [${c.caption}](${SITE_ORIGIN}/cases/${c.slug}.md): ${c.filed_on || c.decided_on || ""}, ${c.status}`),
    "## Data and tools",
    `- [Dataset](${SITE_ORIGIN}/data.md): CSV, JSON, Frictionless datapackage.json; all incidents as CSV at ${SITE_ORIGIN}/incidents.csv`,
    `- [MCP server](${SITE_ORIGIN}/mcp.md): Streamable HTTP at /mcp`,
    "## Policies",
    `- [Sources and standards](${SITE_ORIGIN}/sources-and-standards.md), [Editorial policy](${SITE_ORIGIN}/editorial-policy.md), [Corrections](${SITE_ORIGIN}/corrections.md), [Terms of use](${SITE_ORIGIN}/terms.md), [Privacy](${SITE_ORIGIN}/privacy.md)`,
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
    description: "How governments have limited journalists, 1900 to today: a dated, sourced record by country, tactic and era. Every fact carries a verbatim quote, source URL, method and check date. Dataset under CC BY 4.0.",
    url: SITE_ORIGIN,
    provider: { organization: PUBLISHER_NAME, url: PUBLISHER_URL },
    version: MCP_SERVER_MANIFEST.version,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json", "text/markdown"],
    skills: TOOLS.map((t) => ({ id: t.name, name: t.title, description: t.description, tags: ["mcp", t.annotations && t.annotations.readOnlyHint ? "read" : "write"] })),
    mcp: { endpoint: `${SITE_ORIGIN}/mcp`, transport: "streamable-http", serverManifest: `${SITE_ORIGIN}/.well-known/mcp/server.json` },
    links: {
      data: `${SITE_ORIGIN}/data`, datapackage: `${SITE_ORIGIN}/data/datapackage.json`, incidents_csv: `${SITE_ORIGIN}/incidents.csv`, changes: `${SITE_ORIGIN}/changes.xml`, coverage: `${SITE_ORIGIN}/coverage/feed.json`,
      sitemap: `${SITE_ORIGIN}/sitemap.xml`, llms: `${SITE_ORIGIN}/llms.txt`, feeds: `${SITE_ORIGIN}/feeds`,
    },
  };
}

export function linkHeaderValue() {
  return `</mcp>; rel="service", </.well-known/agent.json>; rel="service-desc", </sitemaps/machine.xml>; rel="sitemap"`;
}
