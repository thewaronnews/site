// robots.txt recipes, generated from the entities table at request time.
//
// Purpose: an agent asking "how do I block AI training but stay in AI
// search" (or any of the other common blocking questions) gets a ready
// robots.txt block plus the reasoning behind every line, instead of having
// to read all fifteen entity pages and work it out by hand. Recipes are
// computed from entities.purpose and entities.kind on every request, so a
// newly added entity is picked up automatically; nothing here is a static
// list of crawler names.
//
// Classification: entities.purpose already separates training / search /
// user_fetch / ads / mixed cleanly (migration 0001), so recipes classify by
// purpose, not by the coarser kind column (kind mixes "crawler" for both
// training and search bots). purpose = 'mixed' (currently only
// GoogleOther) does not fit a training/search split at all, so the
// training-vs-search recipe lists it, and any future purpose value this
// module does not recognise, as unclassified rather than guessing a side.
//
// Response shape: unlike the routes.js handlers, handle() below returns a
// Response (or null) directly, because it must also serve the .txt suffix,
// which negotiate.js's resolveFormat() does not know about. For html/md/
// json it renders through the same doc model and render.js helpers
// (renderHtml, renderMarkdown, buildAlternates) that back every other page.

import { SITE_NAME, SITE_ORIGIN } from "./site.js";
import { escapeHtml, a, isoNow } from "./util.js";
import { listEntities } from "./db.js";
import { renderHtml, renderMarkdown, buildAlternates } from "./render.js";
import { contentTypeFor } from "./negotiate.js";

function link(href, text) {
  return { html: a(href, text), text };
}

function code(text) {
  return { html: `<code>${escapeHtml(text)}</code>`, text };
}

const PURPOSE_LABEL = {
  training: "training",
  search: "search",
  user_fetch: "user-initiated fetch",
  ads: "ads review",
  mixed: "mixed / not classified as training or search",
};

function purposeOf(entity) {
  return entity.purpose || "unclassified";
}

async function claimsWithRobotsField(env) {
  const { results } = await env.DB.prepare(
    `SELECT claims.*, entities.slug AS entity_slug, entities.name AS entity_name
     FROM claims JOIN entities ON entities.id = claims.entity_id
     WHERE claims.status = 'current' AND claims.field LIKE '%robots%'
     ORDER BY claims.entity_id, claims.field`
  ).all();
  return results || [];
}

function vendorSlug(vendor) {
  return String(vendor).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// ---------- recipe definitions ----------
// Each recipe resolves, from the live entity list, to a set of rows
// {entity, action: 'block'|'allow', why} that becomes both the robots.txt
// block and the reasoning table. `unclassified` holds entities the recipe
// deliberately leaves out of the robots.txt block, with the reason why.

function recipeTrainingVsSearch(entities) {
  const rows = [];
  const unclassified = [];
  for (const e of entities) {
    const p = purposeOf(e);
    if (p === "training") {
      rows.push({ entity: e, action: "block", why: "purpose is training: this token controls or names an AI training crawler." });
    } else if (p === "search") {
      rows.push({ entity: e, action: "allow", why: "purpose is search: this token names a bot that surfaces pages in an AI search or answer product." });
    } else {
      unclassified.push({
        entity: e,
        why: `purpose is ${PURPOSE_LABEL[p] || p}, which this site's data does not cleanly place on either the training or the search side.`,
      });
    }
  }
  return {
    slug: "block-ai-training-allow-ai-search",
    title: "Block AI training, allow AI search",
    intro: (n) => `This recipe disallows every token this site classifies as an AI training crawler and allows every token it classifies as an AI search or answer-engine bot, covering ${n} token(s) in the robots.txt block below.`,
    rows,
    unclassified,
  };
}

function recipeBlockAll(entities) {
  const rows = entities.map((e) => ({ entity: e, action: "block", why: `documented ${e.kind.replace("_", " ")} token for ${e.vendor}.` }));
  return {
    slug: "block-all-ai-crawlers",
    title: "Block all documented AI crawlers",
    intro: (n) => `This recipe disallows every AI crawler, fetcher, search bot, ads bot and robots.txt policy token this site documents, ${n} token(s) in total.`,
    rows,
    unclassified: [],
  };
}

function recipeAllowAll(entities) {
  const rows = entities.map((e) => ({ entity: e, action: "allow", why: `documented ${e.kind.replace("_", " ")} token for ${e.vendor}, explicitly allowed.` }));
  return {
    slug: "allow-all-ai-crawlers",
    title: "Allow all documented AI crawlers",
    intro: (n) => `This recipe explicitly allows every AI crawler, fetcher, search bot, ads bot and robots.txt policy token this site documents, ${n} token(s) in total. Explicit Allow lines are only needed where another rule on the site would otherwise disallow these tokens; on a site with no such rule, allowing an unnamed token is already the default.`,
    rows,
    unclassified: [],
  };
}

function recipeBlockFetchers(entities) {
  const fetchers = entities.filter((e) => e.kind === "fetcher");
  const rows = fetchers.map((e) => ({ entity: e, action: "block", why: `kind is fetcher (purpose ${e.purpose}): this token names a user-initiated, on-demand fetch, not a scheduled crawl.` }));
  return {
    slug: "block-user-initiated-fetchers",
    title: "Block user-initiated fetchers",
    intro: (n) => `This recipe disallows the ${n} token(s) this site classifies as user-initiated fetchers, the tokens a vendor's assistant uses only when a person directs it to a specific page, as opposed to a scheduled crawl.`,
    rows,
    unclassified: [],
  };
}

function recipeBlockVendor(entities, vendor) {
  const vendorEntities = entities.filter((e) => vendorSlug(e.vendor) === vendor);
  const rows = vendorEntities.map((e) => ({ entity: e, action: "block", why: `documented ${e.kind.replace("_", " ")} token for ${e.vendor}.` }));
  const vendorName = vendorEntities[0] ? vendorEntities[0].vendor : vendor;
  return {
    slug: `block-${vendor}`,
    title: `Block ${vendorName}`,
    intro: (n) => `This recipe disallows every token this site documents for ${vendorName}, ${n} token(s) in total, covering every purpose the vendor publishes (training, search, user-initiated fetch, ads, or mixed).`,
    rows,
    unclassified: [],
  };
}

function recipeAllowOnlySearchVendor(entities, vendor) {
  const vendorEntities = entities.filter((e) => vendorSlug(e.vendor) === vendor);
  const rows = vendorEntities.map((e) => {
    if (purposeOf(e) === "search") {
      return { entity: e, action: "allow", why: `purpose is search: kept open so ${e.vendor}'s search or answer engine can still surface this site.` };
    }
    return { entity: e, action: "block", why: `purpose is ${PURPOSE_LABEL[purposeOf(e)] || purposeOf(e)}, not search, so this recipe disallows it.` };
  });
  const vendorName = vendorEntities[0] ? vendorEntities[0].vendor : vendor;
  return {
    slug: `allow-only-search-${vendor}`,
    title: `Allow only ${vendorName} search`,
    intro: (n) => `This recipe allows only the ${vendorName} token(s) this site classifies as search, and disallows every other ${vendorName} token, ${n} token(s) covered in total.`,
    rows,
    unclassified: [],
  };
}

async function buildRecipeList(env) {
  const entities = await listEntities(env);
  const vendors = [...new Set(entities.map((e) => vendorSlug(e.vendor)))].sort();
  const list = [
    recipeTrainingVsSearch(entities),
    recipeBlockAll(entities),
    recipeAllowAll(entities),
    recipeBlockFetchers(entities),
    ...vendors.map((v) => recipeBlockVendor(entities, v)),
    ...vendors.map((v) => recipeAllowOnlySearchVendor(entities, v)),
  ];
  return { entities, vendors, list };
}

function robotsBlockText(recipe) {
  const lines = [];
  for (const row of recipe.rows) {
    lines.push(`User-agent: ${row.entity.robots_token}`);
    lines.push(row.action === "allow" ? "Allow: /" : "Disallow: /");
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

function robotsBlockHtml(text) {
  return `<pre><code>${escapeHtml(text)}</code></pre>`;
}

// ---------- doc builders ----------

function recipesIndexDoc(list) {
  const rows = list.map((r) => [link(`/recipes/${r.slug}`, r.title), fmtCount(r.rows.length)]);
  return {
    path: "/recipes",
    title: "Robots.txt recipes",
    nav: true,
    description: "Ready-made robots.txt blocks, generated from the entities this site documents.",
    metaDescription: `${list.length} robots.txt recipes for AI crawlers, generated from documented entities on ${SITE_NAME}.`,
    updatedAt: isoNow(),
    jsonld: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Robots.txt recipes",
      url: `${SITE_ORIGIN}/recipes`,
      isPartOf: { name: SITE_NAME, url: SITE_ORIGIN },
    },
    blocks: [
      { k: "p", text: "Each recipe below is a robots.txt block built from this site's entity records, plus a table explaining why every token is blocked or allowed. Each recipe is also available as plain text at its own .txt path, for pasting directly into a robots.txt file." },
      { k: "table", headers: ["Recipe", "Tokens covered"], rows },
    ],
    data: { recipes: list.map((r) => ({ slug: r.slug, title: r.title, tokens: r.rows.length })) },
  };
}

function fmtCount(n) {
  return String(n);
}

function recipeDoc(recipe, robotsClaims) {
  const text = robotsBlockText(recipe);
  const relevantClaims = robotsClaims.filter((c) => recipe.rows.some((r) => r.entity.id === c.entity_id));

  const tableRows = recipe.rows.map((row) => [
    link(`/crawlers/${row.entity.slug}`, row.entity.name),
    row.entity.vendor,
    row.entity.kind,
    row.action === "allow" ? "Allow" : "Disallow",
    { html: escapeHtml(row.why), text: row.why, wrap: true },
  ]);

  const blocks = [
    { k: "p", text: recipe.intro(recipe.rows.length) },
    { k: "h2", text: "Robots.txt block" },
    { k: "html", html: robotsBlockHtml(text), text: "```\n" + text.trim() + "\n```" },
    { k: "h2", text: "Tokens in this recipe" },
    { k: "table", headers: ["Entity", "Vendor", "Kind", "Rule", "Why"], rows: tableRows },
  ];

  if (recipe.unclassified.length) {
    blocks.push({ k: "h2", text: "Not covered by this recipe" });
    blocks.push({
      k: "table",
      headers: ["Entity", "Vendor", "Kind", "Reason left out"],
      rows: recipe.unclassified.map((u) => [
        link(`/crawlers/${u.entity.slug}`, u.entity.name),
        u.entity.vendor,
        u.entity.kind,
        { html: escapeHtml(u.why), text: u.why, wrap: true },
      ]),
    });
  }

  if (relevantClaims.length) {
    blocks.push({ k: "h2", text: "Limits" });
    blocks.push({
      k: "table",
      headers: ["Entity", "Claim", "Statement"],
      rows: relevantClaims.map((c) => [
        link(`/crawlers/${c.entity_slug}`, c.entity_name),
        link(`/claims/${c.id}`, `claim ${c.id}`),
        { html: escapeHtml(c.statement), text: c.statement, wrap: true },
      ]),
    });
  }

  return {
    path: `/recipes/${recipe.slug}`,
    title: recipe.title,
    nav: true,
    description: recipe.intro(recipe.rows.length),
    metaDescription: recipe.intro(recipe.rows.length),
    updatedAt: isoNow(),
    jsonld: {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: recipe.title,
      url: `${SITE_ORIGIN}/recipes/${recipe.slug}`,
      isPartOf: { name: SITE_NAME, url: SITE_ORIGIN },
    },
    data: {
      slug: recipe.slug,
      title: recipe.title,
      summary: recipe.intro(recipe.rows.length),
      robots_txt: text,
      tokens: recipe.rows.map((r) => ({
        slug: r.entity.slug, name: r.entity.name, vendor: r.entity.vendor, kind: r.entity.kind,
        robots_token: r.entity.robots_token, action: r.action, why: r.why,
      })),
      unclassified: recipe.unclassified.map((u) => ({ slug: u.entity.slug, name: u.entity.name, vendor: u.entity.vendor, kind: u.entity.kind, why: u.why })),
      limits: relevantClaims.map((c) => ({ entity_slug: c.entity_slug, claim_id: c.id, field: c.field, statement: c.statement })),
    },
    blocks,
  };
}

// ---------- responses ----------

function txtResponse(body) {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60" } });
}

async function respondDoc(doc, format, status = 200) {
  const alt = buildAlternates(doc.path);
  let body;
  if (format === "json") body = JSON.stringify(doc.data ?? {}, null, 2);
  else if (format === "md") body = renderMarkdown(doc);
  else body = renderHtml(doc, alt, false);
  const headers = {
    "Content-Type": contentTypeFor(format),
    "Link": `<${SITE_ORIGIN}${alt.md}>; rel="alternate"; type="text/markdown", <${SITE_ORIGIN}${alt.json}>; rel="alternate"; type="application/json", <${SITE_ORIGIN}${alt.html}>; rel="alternate"; type="text/html"`,
    "Cache-Control": "public, max-age=60",
  };
  return new Response(body, { status, headers });
}

const RECIPE_PATH_RE = /^\/recipes\/([a-z0-9-]+)$/;

// handle(): matches the (request, env, url, format, basePath) call the
// integrator uses. `format` and `basePath` are expected to come from
// negotiate.js's resolveFormat() for the .md/.json/plain cases, exactly as
// index.js already computes them for every other route; this module does
// not call resolveFormat itself. The one exception is the .txt suffix,
// which resolveFormat does not recognise, so this function checks
// url.pathname directly for that case before looking at basePath/format at
// all. Returns a Response for every /recipes path it recognises, or null
// so the caller falls through to its own 404 handling.
export async function handle(request, env, url, format, basePath) {
  const pathname = url.pathname;

  if (pathname === "/recipes" || RECIPE_PATH_RE.test(pathname) || pathname === "/recipes.txt" || /^\/recipes\/([a-z0-9-]+)\.txt$/.test(pathname)) {
    // .txt: bare robots.txt block, never through the doc model.
    const txtMatch = pathname.match(/^\/recipes\/([a-z0-9-]+)\.txt$/);
    if (txtMatch) {
      const { list } = await buildRecipeList(env);
      const recipe = list.find((r) => r.slug === txtMatch[1]);
      if (!recipe) return null;
      const generated = new Date().toISOString().slice(0, 10);
      const header = `# Source: ${SITE_ORIGIN}/recipes/${recipe.slug}\n# Generated: ${generated}\n\n`;
      return txtResponse(header + robotsBlockText(recipe));
    }
    if (pathname === "/recipes.txt") return null; // index has no bare robots.txt form

    if (pathname === "/recipes") {
      const { list } = await buildRecipeList(env);
      const doc = recipesIndexDoc(list);
      return respondDoc(doc, format || "html");
    }

    const m = pathname.match(RECIPE_PATH_RE);
    if (m) {
      const { list } = await buildRecipeList(env);
      const recipe = list.find((r) => r.slug === m[1]);
      if (!recipe) return null;
      const robotsClaims = await claimsWithRobotsField(env);
      const doc = recipeDoc(recipe, robotsClaims);
      return respondDoc(doc, format || "html");
    }
  }

  return null;
}

// listPaths(): every base path (no format suffix) this module serves, for
// the sitemap. Mirrors buildRecipeList()'s slugs so a new entity or vendor
// is picked up automatically, the same way the recipes themselves are.
export async function listPaths(env) {
  const { list } = await buildRecipeList(env);
  return ["/recipes", ...list.map((r) => `/recipes/${r.slug}`)];
}
