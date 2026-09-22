// The War On News (thewaronnews.com) Worker entry point: fetch + scheduled.
// Plain ES modules, no bundler. Every public page answers as HTML, as
// Markdown (.md or Accept: text/markdown) and as JSON (.json or Accept:
// application/json), from one doc per route (render.js).

import { resolveFormat, contentTypeFor } from "./negotiate.js";
import { SITE_ORIGIN, SITE_HOST } from "./site.js";
import { renderHtml, renderMarkdown, buildAlternates } from "./render.js";
import { observe, isAnalyticsEligible } from "./logger.js";
import { runNightly } from "./cron.js";
import { handleMcpRequest, MCP_SERVER_MANIFEST } from "./mcp.js";
import { handleAdminRequest } from "./admin.js";
import { robotsTxt, llmsTxt, llmsFullTxt, agentCard, linkHeaderValue } from "./discovery.js";
import { renderFeed, changesAtom } from "./feeds.js";
import { renderSitemap, renderSitemapIndex } from "./sitemaps.js";
import { timelineDoc } from "./timeline.js";
import { SITE_CSS } from "./css.js";
import {
  homeHandler, incidentsIndexHandler, incidentHandler, revisionsHandler, actorsIndexHandler, actorHandler,
  outletsIndexHandler, outletHandler, journalistsIndexHandler, journalistHandler, casesIndexHandler, caseHandler,
  newsIndexHandler, noteHandler, glossaryIndexHandler, glossaryTermHandler, explainersIndexHandler, explainerHandler,
  claimHandler, sourceHandler, changesHandler, correctionsHandler, correctionsLogHandler, policyHandler,
  dataHandler, feedsHandler, mcpDocHandler, searchHandler, submitHandler, notFoundDoc, methodNotAllowedDoc,
} from "./routes.js";

const S = "([a-z0-9-]{1,80})";
const G = ["GET"];

const ROUTES = [
  [G, /^\/$/, (c) => homeHandler(c)],
  [G, /^\/incidents$/, (c) => incidentsIndexHandler(c)],
  [G, new RegExp(`^/incidents/${S}$`), (c, m) => incidentHandler(c, m[1])],
  [G, new RegExp(`^/incidents/${S}/revisions$`), (c, m) => revisionsHandler(c, "incidents", "incident", m[1])],
  [G, /^\/actors$/, (c) => actorsIndexHandler(c)],
  [G, new RegExp(`^/actors/${S}$`), (c, m) => actorHandler(c, m[1])],
  [G, /^\/outlets$/, (c) => outletsIndexHandler(c)],
  [G, new RegExp(`^/outlets/${S}$`), (c, m) => outletHandler(c, m[1])],
  [G, /^\/journalists$/, (c) => journalistsIndexHandler(c)],
  [G, new RegExp(`^/journalists/${S}$`), (c, m) => journalistHandler(c, m[1])],
  [G, /^\/cases$/, (c) => casesIndexHandler(c)],
  [G, new RegExp(`^/cases/${S}$`), (c, m) => caseHandler(c, m[1])],
  [G, new RegExp(`^/cases/${S}/revisions$`), (c, m) => revisionsHandler(c, "cases", "case", m[1])],
  [G, /^\/timeline$/, (c) => timelineDoc(c.env, {})],
  [G, /^\/timeline\/(\d{4})$/, (c, m) => timelineDoc(c.env, { year: m[1] })],
  [G, new RegExp(`^/timeline/actor/${S}$`), (c, m) => timelineDoc(c.env, { actor: m[1] })],
  [G, /^\/timeline\/type\/([a-z_]+)$/, (c, m) => timelineDoc(c.env, { type: m[1] })],
  [G, /^\/timeline\/country\/([a-z]{2})$/, (c, m) => timelineDoc(c.env, { country: m[1] })],
  [G, /^\/news$/, (c) => newsIndexHandler(c, 1)],
  [G, /^\/news\/page\/(\d{1,4})$/, (c, m) => newsIndexHandler(c, parseInt(m[1], 10))],
  [G, new RegExp(`^/news/${S}$`), (c, m) => noteHandler(c, m[1])],
  [G, /^\/explainers$/, (c) => explainersIndexHandler(c)],
  [G, new RegExp(`^/explainers/${S}$`), (c, m) => explainerHandler(c, m[1])],
  [G, /^\/glossary$/, (c) => glossaryIndexHandler(c)],
  [G, new RegExp(`^/glossary/${S}$`), (c, m) => glossaryTermHandler(c, m[1])],
  [G, /^\/claims\/(\d{1,9})$/, (c, m) => claimHandler(c, parseInt(m[1], 10))],
  [G, /^\/sources\/(\d{1,9})$/, (c, m) => sourceHandler(c, parseInt(m[1], 10))],
  [G, /^\/changes$/, (c) => changesHandler(c)],
  [G, /^\/corrections$/, (c) => correctionsHandler(c)],
  [G, /^\/corrections\/log$/, (c) => correctionsLogHandler(c)],
  [G, /^\/about$/, (c) => policyHandler(c, "about")],
  [G, /^\/methodology$/, (c) => policyHandler(c, "methodology")],
  [G, /^\/editorial-policy$/, (c) => policyHandler(c, "editorial-policy")],
  [G, /^\/data$/, (c) => dataHandler(c)],
  [G, /^\/feeds$/, () => feedsHandler()],
  [G, /^\/mcp$/, () => mcpDocHandler()],
  [["GET", "POST"], /^\/search$/, (c) => searchHandler(c)],
  [["POST"], /^\/submit$/, (c) => submitHandler(c)],
];

async function respondDoc(doc, format, env, request, analytics = false) {
  const status = doc.status || 200;
  const alt = buildAlternates(doc.path);
  let body;
  if (format === "json") body = JSON.stringify(doc.data ?? {}, null, 2);
  else if (format === "md") body = renderMarkdown(doc);
  else body = renderHtml(doc, alt, analytics, env.GA4_MEASUREMENT_ID || "");
  const headers = {
    "Content-Type": contentTypeFor(format),
    "Link": `<${SITE_ORIGIN}${alt.md}>; rel="alternate"; type="text/markdown", <${SITE_ORIGIN}${alt.json}>; rel="alternate"; type="application/json", <${SITE_ORIGIN}${alt.html}>; rel="canonical"; type="text/html"`,
    "Cache-Control": status >= 400 ? "public, max-age=30" : "public, max-age=60",
    "Vary": "Accept",
  };
  if (doc.noindex) headers["X-Robots-Tag"] = "noindex";
  if (doc.updatedAt) {
    const d = new Date(doc.updatedAt);
    if (!Number.isNaN(d.getTime())) headers["Last-Modified"] = d.toUTCString();
  }
  return new Response(body, { status, headers });
}

function text(body, contentType, cache = "public, max-age=300", status = 200) {
  return new Response(body, { status, headers: { "Content-Type": contentType, "Cache-Control": cache } });
}

const R2_TYPES = { csv: "text/csv; charset=utf-8", json: "application/json; charset=utf-8", md: "text/markdown; charset=utf-8", cff: "text/plain; charset=utf-8", webp: "image/webp", png: "image/png" };

// /data/... files from R2 (spec 4.5): the latest Data Package at /data/,
// dated runs at /data/YYYY-MM-DD/. Illustrations at /images/<key>.webp.
async function r2File(env, pathname) {
  if (!env.EXPORTS) return null;
  let key = null;
  let m;
  if ((m = pathname.match(/^\/data\/(\d{4}-\d{2}-\d{2})\/((?:data\/|json\/)?[a-zA-Z0-9_.-]+)$/))) key = `data/${m[1]}/${m[2]}`;
  else if ((m = pathname.match(/^\/data\/((?:data\/|json\/)?[a-zA-Z0-9_.-]+)$/))) key = `latest/${m[1]}`;
  else if ((m = pathname.match(/^\/images\/([a-z0-9-]+\.(?:webp|png))$/))) key = `images/${m[1]}`;
  if (!key) return null;
  const obj = await env.EXPORTS.get(key);
  if (!obj) return new Response(JSON.stringify({ error: "not_found", path: pathname }), { status: 404, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" } });
  const ext = (key.match(/\.([a-z]+)$/) || [])[1];
  const type = key.endsWith("LICENSE") ? "text/plain; charset=utf-8" : R2_TYPES[ext] || "application/octet-stream";
  return new Response(obj.body, { status: 200, headers: { "Content-Type": type, "Cache-Control": key.startsWith("images/") ? "public, max-age=604800" : "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}

async function directRoute(request, env, ctx, url) {
  const p = url.pathname;
  if (p === "/assets/site.css") return ["css", text(SITE_CSS, "text/css; charset=utf-8", "public, max-age=31536000, immutable")];
  if (p === "/robots.txt") return ["txt", text(robotsTxt(), "text/plain; charset=utf-8")];
  if (p === "/llms.txt") return ["txt", text(await llmsTxt(env), "text/plain; charset=utf-8")];
  if (p === "/llms-full.txt") return ["txt", text(await llmsFullTxt(env), "text/plain; charset=utf-8")];
  if (p === "/sitemap.xml") return ["xml", text(await renderSitemapIndex(env), "application/xml; charset=utf-8")];
  let m = p.match(/^\/sitemaps\/(pages|incidents|news|news-google|machine)\.xml$/);
  if (m) return ["xml", text(await renderSitemap(env, m[1]), "application/xml; charset=utf-8")];
  if (env.INDEXNOW_KEY && p === `/${env.INDEXNOW_KEY}.txt`) return ["txt", text(env.INDEXNOW_KEY, "text/plain; charset=utf-8", "public, max-age=86400")];
  if (p === "/changes.xml") return ["xml", text(await changesAtom(env), "application/atom+xml; charset=utf-8")];
  m = p.match(/^\/(news|incidents)\/(feed\.xml|atom\.xml|feed\.json)$/);
  if (m) {
    const fmt = m[2] === "feed.xml" ? "rss" : m[2] === "atom.xml" ? "atom" : "json";
    const f = await renderFeed(env, m[1], fmt);
    return [fmt === "json" ? "json" : "xml", text(f.body, f.contentType)];
  }
  if (p === "/mcp" && request.method !== "GET") return ["json", await handleMcpRequest(request, env, ctx)];
  if (p === "/.well-known/mcp/server.json" || p === "/.well-known/mcp.json") return ["json", text(JSON.stringify(MCP_SERVER_MANIFEST, null, 2), "application/json; charset=utf-8")];
  if (p === "/.well-known/agent.json" || p === "/.well-known/agent-card.json") return ["json", text(JSON.stringify(agentCard(), null, 2), "application/json; charset=utf-8")];
  if (p === "/admin" || p.startsWith("/admin/")) return ["json", await handleAdminRequest(request, env, ctx, url)];
  if (p.startsWith("/data/") || p.startsWith("/images/")) {
    const r = await r2File(env, p);
    if (r) return [p.split(".").pop(), r];
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === `www.${SITE_HOST}`) {
      url.hostname = SITE_HOST;
      return Response.redirect(url.toString(), 301);
    }
    const originalRequest = request;
    const isHead = request.method === "HEAD";
    if (isHead) request = new Request(request, { method: "GET" });

    let response;
    let formatServed = "html";
    try {
      const direct = await directRoute(request, env, ctx, url);
      if (direct) {
        [formatServed, response] = direct;
      } else {
        let { format, basePath } = resolveFormat(request, url.pathname);
        if (basePath === "/index") basePath = "/";
        if (basePath.length > 1 && basePath.endsWith("/")) {
          return Response.redirect(`${SITE_ORIGIN}${basePath.replace(/\/+$/, "")}${url.search}`, 301);
        }
        formatServed = format;
        const analytics = format === "html" && env.GA4_MEASUREMENT_ID ? await isAnalyticsEligible(env, request.headers.get("User-Agent") || "") : false;
        let match = null;
        let route = null;
        for (const r of ROUTES) {
          const mm = basePath.match(r[1]);
          if (mm) { route = r; match = mm; break; }
        }
        const routeCtx = { env, request, url, ctx, basePath };
        if (!route) {
          response = await respondDoc(notFoundDoc(basePath), format, env, request);
        } else if (!route[0].includes(request.method)) {
          response = await respondDoc(methodNotAllowedDoc(basePath, route[0]), format, env, request);
          response.headers.set("Allow", route[0].join(", "));
        } else {
          const doc = await route[2](routeCtx, match);
          if (!doc) response = await respondDoc(notFoundDoc(basePath), format, env, request);
          else if (doc instanceof Response) response = doc;
          else response = await respondDoc(doc, format, env, request, analytics);
        }
      }
    } catch (err) {
      formatServed = "json";
      response = new Response(JSON.stringify({ error: "internal_error", message: String((err && err.message) || err) }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    try { response.headers.append("Link", linkHeaderValue()); } catch { /* immutable headers */ }
    if (isHead && response.body) {
      response = new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    ctx.waitUntil(observe(originalRequest, response, env, formatServed));
    return response;
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runNightly(env));
  },
};
