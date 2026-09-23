// The War On News (thewaronnews.com) Worker entry point: fetch + scheduled.
// Plain ES modules, no bundler. Every public page answers as HTML, as
// Markdown (.md or Accept: text/markdown) and as JSON (.json or Accept:
// application/json), from one doc per route (render.js).

import { resolveFormat, contentTypeFor } from "./negotiate.js";
import { SITE_ORIGIN, SITE_HOST } from "./site.js";
import { renderHtml, renderMarkdown, buildAlternates, MARK_SVG } from "./render.js";
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
  homeHandler, incidentHandler, revisionsHandler, actorsIndexHandler, actorHandler,
  outletsIndexHandler, outletHandler, journalistsIndexHandler, journalistHandler, casesIndexHandler, caseHandler,
  glossaryIndexHandler, glossaryTermHandler, explainersIndexHandler, explainerHandler,
  claimHandler, sourceHandler, changesHandler, correctionsHandler, correctionsLogHandler, policyHandler,
  dataHandler, feedsHandler, mcpDocHandler, submitHandler, notFoundDoc, methodNotAllowedDoc,
} from "./routes.js";
import {
  incidentsListHandler, searchV2Handler, incidentsCsvHandler, countriesIndexHandler, countryHandler, continentsIndexHandler,
  continentHandler, tacticsIndexHandler, tacticHandler, erasIndexHandler, eraHandler, leadersIndexHandler,
  leaderHandler, coverageHandler,
} from "./v2routes.js";
import { laddersIndexHandler, ladderHandler, unitedStatesHandler } from "./ladders.js";
import { runCoverage } from "./coverage.js";

const S = "([a-z0-9-]{1,80})";
const G = ["GET"];

const ROUTES = [
  [G, /^\/$/, (c) => homeHandler(c)],
  [G, /^\/incidents$/, (c) => incidentsListHandler(c)],
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
  [G, /^\/countries$/, (c) => countriesIndexHandler(c)],
  [G, /^\/countries\/([a-z]{2})$/, (c, m) => countryHandler(c, m[1])],
  [G, /^\/continents$/, (c) => continentsIndexHandler(c)],
  [G, /^\/continents\/([a-z-]{4,20})$/, (c, m) => continentHandler(c, m[1])],
  [G, /^\/tactics$/, (c) => tacticsIndexHandler(c)],
  [G, /^\/tactics\/([a-z_]{3,40})$/, (c, m) => tacticHandler(c, m[1])],
  [G, /^\/ladders$/, (c) => laddersIndexHandler(c)],
  [G, /^\/ladders\/([a-z_]{3,40})$/, (c, m) => ladderHandler(c, m[1])],
  [G, /^\/united-states$/, (c) => unitedStatesHandler(c)],
  [G, /^\/eras$/, (c) => erasIndexHandler(c)],
  [G, /^\/eras\/(\d{4}s)$/, (c, m) => eraHandler(c, m[1])],
  [G, /^\/leaders$/, (c) => leadersIndexHandler(c)],
  [G, new RegExp(`^/leaders/${S}$`), (c, m) => leaderHandler(c, m[1])],
  [G, /^\/coverage$/, (c) => coverageHandler(c)],
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
  [G, /^\/context$/, (c) => policyHandler(c, "context")],
  [G, /^\/sources-and-standards$/, (c) => policyHandler(c, "sources-and-standards")],
  [G, /^\/terms$/, (c) => policyHandler(c, "terms")],
  [G, /^\/privacy$/, (c) => policyHandler(c, "privacy")],
  [G, /^\/editorial-policy$/, (c) => policyHandler(c, "editorial-policy")],
  [G, /^\/data$/, (c) => dataHandler(c)],
  [G, /^\/feeds$/, () => feedsHandler()],
  [G, /^\/mcp$/, () => mcpDocHandler()],
  [["GET", "POST"], /^\/search$/, (c) => searchV2Handler(c)],
  [["POST"], /^\/submit$/, (c) => submitHandler(c)],
];

async function respondDoc(doc, format, env, request, analytics = false) {
  const status = doc.status || 200;
  const alt = buildAlternates(doc.path, doc.query || "");
  let body;
  if (format === "json") body = JSON.stringify(doc.data ?? {}, null, 2);
  else if (format === "md") body = renderMarkdown(doc);
  else body = renderHtml(doc, alt, analytics, env.GA4_MEASUREMENT_ID || "");
  const headers = {
    "Content-Type": contentTypeFor(format),
    "Link": `<${encodeURI(SITE_ORIGIN + alt.md)}>; rel="alternate"; type="text/markdown", <${encodeURI(SITE_ORIGIN + alt.json)}>; rel="alternate"; type="application/json", <${encodeURI(SITE_ORIGIN + alt.html)}>; rel="canonical"; type="text/html"`,
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

// Illustrations and fonts (Atlas design, 2026-09-22) from R2, uploaded by
// tools/upload-assets.sh under the same key: /assets/img/<name>-<size>.webp
// (and -og.jpg), /assets/fonts/<file>.woff2. Names never change content in
// place, so the cache is a year and immutable.
const ASSET_TYPES = { webp: "image/webp", jpg: "image/jpeg", png: "image/png", woff2: "font/woff2", txt: "text/plain; charset=utf-8" };
async function assetFile(env, pathname) {
  const m = pathname.match(/^\/(assets\/(?:img|fonts)\/[a-zA-Z0-9-]+\.(webp|jpg|png|woff2|txt))$/);
  const miss = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60" } });
  if (!m || !env.EXPORTS) return miss();
  const obj = await env.EXPORTS.get(m[1]);
  if (!obj) return miss();
  const headers = { "Content-Type": ASSET_TYPES[m[2]], "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" };
  if (obj.httpEtag) headers.ETag = obj.httpEtag;
  return new Response(obj.body, { status: 200, headers });
}

function redirect301(path) {
  return new Response(null, { status: 301, headers: { Location: `${SITE_ORIGIN}${path}`, "Cache-Control": "public, max-age=3600" } });
}

// Permanent moves (v2): /methodology became /sources-and-standards; the
// News Desk pages and feeds became Recent coverage; country codes and
// decades have one canonical spelling. v3: /compare became /ladders.
function v2Redirect(p, search) {
  let m;
  if ((m = p.match(/^\/methodology(\.md|\.json)?$/))) return `/sources-and-standards${m[1] || ""}`;
  if (/^\/news(\/page\/\d+)?(\.md|\.json)?$/.test(p)) return "/coverage";
  if ((m = p.match(/^\/news\/(feed\.xml|atom\.xml|feed\.json)$/))) return `/coverage/${m[1]}`;
  if ((m = p.match(/^\/countries\/([A-Za-z]{2})(\.md|\.json)?$/)) && /[A-Z]/.test(m[1])) return `/countries/${m[1].toLowerCase()}${m[2] || ""}${search}`;
  if ((m = p.match(/^\/tactics\/([a-z]+(?:-[a-z]+)+)(\.md|\.json)?$/))) return `/tactics/${m[1].replace(/-/g, "_")}${m[2] || ""}`;
  if ((m = p.match(/^\/eras\/(\d{3})0(\.md|\.json)?$/))) return `/eras/${m[1]}0s${m[2] || ""}`;
  // v3: /compare (tactic x country matrix) became /ladders. A tactic moves
  // to its ladder; from, to and continent carry over; other parameters drop.
  if ((m = p.match(/^\/compare(\.md|\.json)?$/))) {
    const q = new URLSearchParams(search);
    const tactic = String(q.get("tactic") || "").toLowerCase().replace(/-/g, "_");
    const keep = new URLSearchParams();
    for (const k of ["stage", "continent", "from", "to"]) if (q.get(k)) keep.set(k, q.get(k));
    const qs = keep.toString() ? `?${keep}` : "";
    if (/^[a-z_]{3,40}$/.test(tactic)) return `/ladders/${tactic}${m[1] || ""}${qs}`;
    return `/ladders${m[1] || ""}${qs}`;
  }
  if ((m = p.match(/^\/ladders\/([a-z]+(?:-[a-z]+)+)(\.md|\.json)?$/))) return `/ladders/${m[1].replace(/-/g, "_")}${m[2] || ""}${search}`;
  return null;
}

async function directRoute(request, env, ctx, url) {
  const p = url.pathname;
  const moved = v2Redirect(p, url.search);
  if (moved) return ["html", redirect301(moved)];
  if (p === "/incidents.csv") return ["csv", await incidentsCsvHandler({ env, url })];
  if (p === "/assets/site.css") return ["css", text(SITE_CSS, "text/css; charset=utf-8", "public, max-age=31536000, immutable")];
  if (p === "/favicon.svg" || p === "/favicon.ico") return ["svg", text(MARK_SVG, "image/svg+xml", "public, max-age=604800")];
  if (p.startsWith("/assets/img/") || p.startsWith("/assets/fonts/")) return ["asset", await assetFile(env, p)];
  if (p === "/robots.txt") return ["txt", text(robotsTxt(), "text/plain; charset=utf-8")];
  if (p === "/llms.txt") return ["txt", text(await llmsTxt(env), "text/plain; charset=utf-8")];
  if (p === "/llms-full.txt") return ["txt", text(await llmsFullTxt(env), "text/plain; charset=utf-8")];
  if (p === "/sitemap.xml") return ["xml", text(await renderSitemapIndex(env), "application/xml; charset=utf-8")];
  let m = p.match(/^\/sitemaps\/(pages|incidents|machine)\.xml$/);
  if (m) return ["xml", text(await renderSitemap(env, m[1]), "application/xml; charset=utf-8")];
  if (env.INDEXNOW_KEY && p === `/${env.INDEXNOW_KEY}.txt`) return ["txt", text(env.INDEXNOW_KEY, "text/plain; charset=utf-8", "public, max-age=86400")];
  if (p === "/changes.xml") return ["xml", text(await changesAtom(env), "application/atom+xml; charset=utf-8")];
  m = p.match(/^\/(coverage|incidents)\/(feed\.xml|atom\.xml|feed\.json)$/);
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
    // Illustrations, fonts and the favicon are page furniture, not page
    // views: they are not logged, so the human and crawler tallies stay per page.
    if (formatServed !== "asset" && formatServed !== "svg") ctx.waitUntil(observe(originalRequest, response, env, formatServed));
    return response;
  },

  // Two cron triggers (deploy.sh): the nightly job at 07:17 UTC and the
  // hourly recent-coverage collector. POST /admin/cron/coverage runs the
  // hourly job on demand (operator scope).
  async scheduled(event, env, ctx) {
    if (event && event.cron === "17 7 * * *") ctx.waitUntil(runNightly(env));
    else ctx.waitUntil(runCoverage(env).catch((e) => env.KV && env.KV.put("coverage:last_error", JSON.stringify({ at: new Date().toISOString(), error: String(e && e.message || e) }))));
  },
};
