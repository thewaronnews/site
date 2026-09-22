// Sitemaps (spec 4.4): /sitemap.xml is an index whose children carry the
// newest lastmod they contain. lastmod is updated_at; nothing without a
// real date gets one.

import { escapeXml } from "./util.js";
import { all } from "./db.js";
import { SITE_ORIGIN, SITE_NAME } from "./site.js";

const STATIC_PAGES = ["/", "/incidents", "/countries", "/continents", "/tactics", "/compare", "/eras", "/leaders", "/coverage", "/actors", "/outlets", "/journalists", "/cases", "/timeline", "/glossary", "/about", "/sources-and-standards", "/editorial-policy", "/corrections", "/terms", "/privacy", "/changes", "/data", "/feeds", "/mcp", "/search"];

function maxDate(entries) {
  return entries.reduce((m, e) => (e.lastmod && (!m || e.lastmod > m) ? e.lastmod : m), null);
}

function urlset(entries, extraNs = "") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${extraNs}>
${entries.map((e) => `<url><loc>${escapeXml(SITE_ORIGIN + e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}${e.extra || ""}</url>`).join("\n")}
</urlset>
`;
}

async function pagesEntries(env) {
  const latest = await all(env, `SELECT MAX(updated_at) AS m FROM incidents WHERE pub_state = 'published'
    UNION ALL SELECT MAX(fetched_at) FROM coverage_items WHERE state = 'shown'
    UNION ALL SELECT MAX(changed_at) FROM changes`);
  const [inc, cov, chg] = latest.map((r) => r.m);
  const lm = { "/incidents": inc, "/timeline": inc, "/countries": inc, "/continents": inc, "/tactics": inc, "/compare": inc, "/eras": inc, "/leaders": inc, "/coverage": cov, "/changes": chg, "/": [inc, cov].filter(Boolean).sort().pop() };
  return STATIC_PAGES.map((p) => ({ loc: p, lastmod: lm[p] || null }));
}

async function recordEntries(env) {
  const out = [];
  const specs = [["incidents", "/incidents/"], ["cases", "/cases/"], ["actors", "/actors/"], ["outlets", "/outlets/"], ["journalists", "/journalists/"], ["glossary_terms", "/glossary/"], ["explainers", "/explainers/"]];
  for (const [t, p] of specs) {
    const rows = await all(env, `SELECT slug, updated_at FROM ${t} WHERE pub_state = 'published' ORDER BY id`);
    for (const r of rows) out.push({ loc: `${p}${r.slug}`, lastmod: r.updated_at });
  }
  const years = await all(env, "SELECT DISTINCT substr(occurred_on, 1, 4) AS y, MAX(updated_at) AS m FROM incidents WHERE pub_state = 'published' GROUP BY y ORDER BY y");
  for (const y of years) out.push({ loc: `/timeline/${y.y}`, lastmod: y.m });
  const q = (sql) => all(env, sql);
  for (const r of await q("SELECT lower(country) AS k, MAX(updated_at) AS m FROM incidents WHERE pub_state = 'published' GROUP BY country ORDER BY country")) out.push({ loc: `/countries/${r.k}`, lastmod: r.m });
  for (const r of await q("SELECT continent AS k, MAX(updated_at) AS m FROM incidents WHERE pub_state = 'published' AND continent IS NOT NULL GROUP BY continent ORDER BY continent")) out.push({ loc: `/continents/${r.k}`, lastmod: r.m });
  for (const r of await q("SELECT t.slug AS k, MAX(i.updated_at) AS m FROM tactics t LEFT JOIN incident_tactics it ON it.tactic_slug = t.slug LEFT JOIN incidents i ON i.id = it.incident_id AND i.pub_state = 'published' GROUP BY t.slug ORDER BY t.sort")) out.push({ loc: `/tactics/${r.k}`, lastmod: r.m });
  for (const r of await q("SELECT era AS k, MAX(updated_at) AS m FROM incidents WHERE pub_state = 'published' GROUP BY era ORDER BY era")) out.push({ loc: `/eras/${r.k}`, lastmod: r.m });
  for (const r of await q("SELECT i.leader_slug AS k, MAX(i.updated_at) AS m FROM incidents i JOIN actors a ON a.slug = i.leader_slug AND a.pub_state = 'published' WHERE i.pub_state = 'published' GROUP BY i.leader_slug ORDER BY i.leader_slug")) out.push({ loc: `/leaders/${r.k}`, lastmod: r.m });
  return out;
}

async function machineEntries(env) {
  const base = [...(await pagesEntries(env)), ...(await recordEntries(env))];
  const out = [];
  for (const e of base) {
    const b = e.loc === "/" ? "/index" : e.loc;
    out.push({ loc: `${b}.md`, lastmod: e.lastmod }, { loc: `${b}.json`, lastmod: e.lastmod });
  }
  const claims = await all(env, "SELECT id, created_at FROM claims WHERE status = 'current' ORDER BY id");
  for (const c of claims) out.push({ loc: `/claims/${c.id}`, lastmod: c.created_at });
  out.push({ loc: "/incidents.csv", lastmod: null }, { loc: "/llms.txt", lastmod: null }, { loc: "/llms-full.txt", lastmod: null }, { loc: "/data/datapackage.json", lastmod: null });
  return out;
}

export async function renderSitemap(env, name) {
  if (name === "pages") return urlset(await pagesEntries(env));
  if (name === "incidents") return urlset(await recordEntries(env));
  return null;
}

export async function renderSitemapIndex(env) {
  const children = [
    ["pages", await pagesEntries(env)],
    ["incidents", await recordEntries(env)],
    ["machine", await machineEntries(env)],
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${children.map(([n, entries]) => {
    const lm = maxDate(entries);
    return `<sitemap><loc>${SITE_ORIGIN}/sitemaps/${n}.xml</loc>${lm ? `<lastmod>${lm}</lastmod>` : ""}</sitemap>`;
  }).join("\n")}
</sitemapindex>
`;
}
