// Sitemaps (spec 4.4): /sitemap.xml is an index whose children carry the
// newest lastmod they contain. lastmod is updated_at; nothing without a
// real date gets one.

import { escapeXml } from "./util.js";
import { all } from "./db.js";
import { SITE_ORIGIN, SITE_NAME } from "./site.js";

const STATIC_PAGES = ["/", "/incidents", "/actors", "/outlets", "/journalists", "/cases", "/timeline", "/news", "/glossary", "/explainers", "/about", "/methodology", "/editorial-policy", "/corrections", "/changes", "/data", "/feeds", "/mcp", "/search"];

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
    UNION ALL SELECT MAX(published_at) FROM news_desk_notes WHERE state = 'published'
    UNION ALL SELECT MAX(changed_at) FROM changes`);
  const [inc, news, chg] = latest.map((r) => r.m);
  const lm = { "/incidents": inc, "/timeline": inc, "/news": news, "/changes": chg, "/": [inc, news].filter(Boolean).sort().pop() };
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
  return out;
}

async function newsEntries(env) {
  const rows = await all(env, "SELECT slug, published_at FROM news_desk_notes WHERE state = 'published' ORDER BY published_at DESC");
  return rows.map((r) => ({ loc: `/news/${r.slug}`, lastmod: r.published_at }));
}

async function machineEntries(env) {
  const base = [...(await pagesEntries(env)), ...(await recordEntries(env)), ...(await newsEntries(env))];
  const out = [];
  for (const e of base) {
    const b = e.loc === "/" ? "/index" : e.loc;
    out.push({ loc: `${b}.md`, lastmod: e.lastmod }, { loc: `${b}.json`, lastmod: e.lastmod });
  }
  const claims = await all(env, "SELECT id, created_at FROM claims WHERE status = 'current' ORDER BY id");
  for (const c of claims) out.push({ loc: `/claims/${c.id}`, lastmod: c.created_at });
  out.push({ loc: "/llms.txt", lastmod: null }, { loc: "/llms-full.txt", lastmod: null }, { loc: "/data/datapackage.json", lastmod: null });
  return out;
}

export async function renderSitemap(env, name) {
  if (name === "pages") return urlset(await pagesEntries(env));
  if (name === "incidents") return urlset(await recordEntries(env));
  if (name === "news") return urlset(await newsEntries(env));
  if (name === "machine") return urlset(await machineEntries(env));
  if (name === "news-google") {
    const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const rows = await all(env, "SELECT slug, title, published_at FROM news_desk_notes WHERE state = 'published' AND published_at >= ? ORDER BY published_at DESC", cutoff);
    return urlset(rows.map((r) => ({
      loc: `/news/${r.slug}`,
      lastmod: r.published_at,
      extra: `<news:news><news:publication><news:name>${escapeXml(SITE_NAME)}</news:name><news:language>en</news:language></news:publication><news:publication_date>${r.published_at}</news:publication_date><news:title>${escapeXml(r.title)}</news:title></news:news>`,
    })), ' xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
  }
  return null;
}

export async function renderSitemapIndex(env) {
  const children = [
    ["pages", await pagesEntries(env)],
    ["incidents", await recordEntries(env)],
    ["news", await newsEntries(env)],
    ["news-google", await newsEntries(env)],
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
