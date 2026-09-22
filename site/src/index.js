import { resolveFormat, contentTypeFor } from "./negotiate.js";
import { SITE_ORIGIN, SECTIONS, LLMS_TXT_HEAD, OG_IMAGE_PATH } from "./site.js";
import ogImageBuffer from "./rattlesnakes-by-mail.png";
import { renderHtml, renderMarkdown, buildAlternates } from "./render.js";
import { observe, isAnalyticsEligible } from "./logger.js";
import { runNightly } from "./cron.js";
import { sha256Hex, isoNow } from "./util.js";
import { listEntities, listAllCurrentClaims, listAllChangesForExport } from "./db.js";
import { handleMcpRequest, MCP_SERVER_MANIFEST } from "./mcp.js";
import { handleAdminRequest } from "./admin.js";
import { handle as discoveryHandle, robotsExtra, linkHeaderValue } from "./discovery.js";
import { handle as fieldsHandle, listPaths as fieldsListPaths } from "./fields.js";
import { handle as compareHandle, listPaths as compareListPaths } from "./compare.js";
import {
  homeHandler, crawlersListHandler, crawlerDetailHandler, claimsHandler, claimDetailHandler,
  changesHandler, changesAtomHandler, observedHandler, observedDetailHandler,
  questionsHandler, questionDetailHandler, searchHandler, dataHandler,
  dataLatestHandler, methodHandler, notFoundDoc, methodNotAllowedDoc, notesSubmitHandler,
} from "./routes.js";

const ROUTES = [
  { methods: ["GET"], test: (p) => p === "/", fn: (ctx) => homeHandler(ctx) },
  { methods: ["GET"], test: (p) => p === "/crawlers", fn: (ctx) => crawlersListHandler(ctx) },
  { methods: ["GET"], test: (p) => /^\/crawlers\/([a-z0-9-]+)$/.test(p), fn: (ctx) => crawlerDetailHandler(ctx, ctx.basePath.match(/^\/crawlers\/([a-z0-9-]+)$/)[1]) },
  { methods: ["GET"], test: (p) => p === "/claims", fn: (ctx) => claimsHandler(ctx) },
  { methods: ["GET"], test: (p) => /^\/claims\/(\d+)$/.test(p), fn: (ctx) => claimDetailHandler(ctx, ctx.basePath.match(/^\/claims\/(\d+)$/)[1]) },
  { methods: ["GET"], test: (p) => p === "/changes", fn: (ctx) => changesHandler(ctx) },
  { methods: ["GET"], test: (p) => p === "/observed", fn: (ctx) => observedHandler(ctx) },
  { methods: ["GET"], test: (p) => /^\/observed\/([a-z0-9-]+)$/.test(p), fn: (ctx) => observedDetailHandler(ctx, ctx.basePath.match(/^\/observed\/([a-z0-9-]+)$/)[1]) },
  { methods: ["GET"], test: (p) => p === "/questions", fn: (ctx) => questionsHandler(ctx) },
  { methods: ["GET"], test: (p) => /^\/questions\/([a-f0-9]+)$/.test(p), fn: (ctx) => questionDetailHandler(ctx, ctx.basePath.match(/^\/questions\/([a-f0-9]+)$/)[1]) },
  { methods: ["GET", "POST"], test: (p) => p === "/search", fn: (ctx) => searchHandler(ctx) },
  { methods: ["POST"], test: (p) => p === "/notes", fn: (ctx) => notesSubmitHandler(ctx) },
  { methods: ["GET"], test: (p) => p === "/data", fn: (ctx) => dataHandler(ctx) },
  { methods: ["GET"], test: (p) => p === "/data/latest", fn: (ctx) => dataLatestHandler(ctx) },
  { methods: ["GET"], test: (p) => p === "/method", fn: () => methodHandler() },
];

let ogImageEtag = null;
async function getOgImageEtag() {
  if (!ogImageEtag) {
    const digest = await crypto.subtle.digest("SHA-256", ogImageBuffer);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    ogImageEtag = `W/"${hex.slice(0, 27)}"`;
  }
  return ogImageEtag;
}

// Social preview image (og:image), served from a bundled Data module so
// bots (Facebook/Slack/Discord/etc.) get a stable, cacheable URL with no D1
// or R2 round-trip. Never noindex; nothing here may block or rate-limit a
// crawler.
async function ogImageHandler(request) {
  const etag = await getOgImageEtag();
  const headers = {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400",
    "ETag": etag,
  };
  const inm = request.headers.get("If-None-Match");
  if (inm && inm === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(ogImageBuffer, { status: 200, headers });
}

async function styleCssHandler() {
  const css = `:root{color-scheme:light dark;--fg:#1a1a1a;--bg:#fdfdfb;--muted:#5a5a5a;--line:#dedad2;--accent:#2a5a4a;}@media (prefers-color-scheme:dark){:root{--fg:#e8e6e1;--bg:#14140f;--muted:#a6a29a;--line:#33322a;--accent:#7fd6b6;}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}header,footer{padding:0.75rem 1rem;border-bottom:1px solid var(--line);}footer{border-top:1px solid var(--line);border-bottom:none;font-size:0.85rem;color:var(--muted);}header a.home{font-weight:600;color:var(--fg);text-decoration:none;}nav{display:flex;flex-wrap:wrap;gap:0.25rem 1rem;}nav a{color:var(--muted);text-decoration:none;font-size:0.9rem;}nav a:hover{color:var(--accent);text-decoration:underline;}main{max-width:72ch;margin:0 auto;padding:1.5rem 1rem 3rem;}h1{font-size:1.6rem;margin:0.2rem 0 1rem;}h2{font-size:1.15rem;margin:2rem 0 0.5rem;border-top:1px solid var(--line);padding-top:1.25rem;}h3{font-size:1rem;margin:1.25rem 0 0.4rem;}p{max-width:72ch;}p.subtitle{color:var(--muted);margin-top:-0.5rem;}dl{display:grid;grid-template-columns:max-content 1fr;gap:0.35rem 1rem;margin:0.5rem 0;}dt{font-weight:600;color:var(--muted);white-space:nowrap;}dd{margin:0;word-break:break-word;}.table{overflow-x:auto;}table{border-collapse:collapse;width:100%;margin:0.5rem 0;font-size:0.95rem;display:block;max-width:100%;overflow-x:auto;}th,td{border-bottom:1px solid var(--line);text-align:left;padding:0.4rem 0.6rem;vertical-align:top;white-space:normal;overflow-wrap:break-word;word-break:normal;}th{color:var(--muted);font-weight:600;}.wrap{white-space:normal;min-width:20ch;overflow-wrap:break-word;word-break:normal;}.mark{letter-spacing:0.1em;}ul{padding-left:1.2rem;}a{color:var(--accent);}li a{overflow-wrap:anywhere;}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}code{background:rgba(127,127,127,0.12);padding:0.05rem 0.3rem;border-radius:3px;font-size:0.9em;overflow-wrap:anywhere;white-space:normal;max-width:100%;}pre{max-width:100%;overflow-wrap:anywhere;overflow-x:auto;}img{max-width:100%;}form{margin:0.75rem 0;}label{display:block;font-size:0.9rem;color:var(--muted);margin:0.5rem 0 0.2rem;}input[type=text],textarea{width:100%;max-width:36rem;padding:0.4rem;border:1px solid var(--line);border-radius:4px;background:transparent;color:var(--fg);font:inherit;}button{margin-top:0.6rem;padding:0.4rem 0.9rem;border:1px solid var(--line);border-radius:4px;background:transparent;color:var(--fg);font:inherit;cursor:pointer;}.tag{display:inline-block;font-size:0.75rem;color:var(--muted);border:1px solid var(--line);border-radius:3px;padding:0.05rem 0.4rem;}html{overflow-x:hidden;}`;
  return new Response(css, { status: 200, headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
}

async function respondDoc(doc, format, request, status = 200, analytics = false) {
  const alt = buildAlternates(doc.path);
  let body;
  if (format === "json") {
    body = JSON.stringify(doc.data ?? {}, null, 2);
  } else if (format === "md") {
    body = renderMarkdown(doc);
  } else {
    body = renderHtml(doc, alt, analytics);
  }
  const etag = `W/"${(await sha256Hex(body)).slice(0, 27)}"`;
  const headers = {
    "Content-Type": contentTypeFor(format),
    "Link": `<${SITE_ORIGIN}${alt.md}>; rel="alternate"; type="text/markdown", <${SITE_ORIGIN}${alt.json}>; rel="alternate"; type="application/json", <${SITE_ORIGIN}${alt.html}>; rel="alternate"; type="text/html"`,
    "ETag": etag,
    "Cache-Control": "public, max-age=60",
  };
  if (doc.updatedAt) {
    try {
      headers["Last-Modified"] = new Date(doc.updatedAt).toUTCString();
    } catch {
      // skip if unparsable
    }
  }
  const inm = request.headers.get("If-None-Match");
  if (inm && inm === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status, headers });
}

function textResponse(body, contentType, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=300" } });
}

async function robotsTxt() {
  return `User-agent: *
Allow: /

Sitemap: ${SITE_ORIGIN}/sitemap.xml
${robotsExtra(SITE_ORIGIN)}
`;
}

async function sitemapXml(env) {
  const entities = await listEntities(env);
  const claims = await listAllCurrentClaims(env, 5000);
  const changes = await listAllChangesForExport(env);

  // Per-entity and site-wide lastmod, derived from the changes ledger
  // (falls back to the entity's own updated_at when it has no changes).
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

  const entries = [
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
    entries.push({ loc: `/crawlers/${e.slug}`, lastmod });
    entries.push({ loc: `/observed/${e.slug}`, lastmod: null });
  }
  // Every current claim gets its own sitemap entry, lastmod = the date the
  // claim was created (a claim is never edited in place, so created_at is
  // stable for the lifetime of the claim).
  for (const c of claims) {
    entries.push({ loc: `/claims/${c.id}`, lastmod: (c.created_at || "").slice(0, 10) || null });
  }

  for (const p of await fieldsListPaths(env)) entries.push({ loc: p, lastmod: null });
  for (const p of await compareListPaths(env)) entries.push({ loc: p, lastmod: null });

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((u) => `  <url><loc>${SITE_ORIGIN}${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>`;
  return body;
}

async function llmsTxt(env) {
  const entities = await listEntities(env);
  const lines = [
    LLMS_TXT_HEAD,
    "",
    "## Crawlers",
    "",
    ...entities.map((e) => `- [${e.name}](${SITE_ORIGIN}/crawlers/${e.slug}.md): ${e.vendor}, ${e.kind}, purpose ${e.purpose || "unspecified"}`),
    "",
    "## Reference",
    "",
    `- [/data.md](${SITE_ORIGIN}/data.md): dataset landing, schema, licence`,
    `- [/data/latest.json](${SITE_ORIGIN}/data/latest.json): manifest of the nightly export`,
    `- [/method.md](${SITE_ORIGIN}/method.md): verification method`,
    `- [/changes.xml](${SITE_ORIGIN}/changes.xml): changelog as Atom`,
  ];
  return lines.join("\n") + "\n";
}

// Serves the R2-backed nightly export snapshots directly (spec section 9,
// P0.5): /data/latest.json is the manifest, /data/latest/<table>.<ext> and
// /data/<YYYY-MM-DD>/<table>.<ext> are the dated snapshots themselves.
// Returns null when the path is under /data/ but matches none of these
// shapes, so the caller can fall through to the ordinary 404 doc.
async function dataExportResponse(env, pathname) {
  if (!env.EXPORTS) return null;
  let r2Key = null;
  let ext = null;
  if (pathname === "/data/latest.json") {
    r2Key = "latest/manifest.json";
    ext = "json";
  } else {
    let m = pathname.match(/^\/data\/latest\/([a-z_]+)\.(json|csv)$/);
    if (m) {
      r2Key = `latest/${m[1]}.${m[2]}`;
      ext = m[2];
    } else {
      m = pathname.match(/^\/data\/(\d{4}-\d{2}-\d{2})\/([a-z_]+)\.(json|csv)$/);
      if (m) {
        r2Key = `data/${m[1]}/${m[2]}.${m[3]}`;
        ext = m[3];
      }
    }
  }
  if (!r2Key) return null;
  const obj = await env.EXPORTS.get(r2Key);
  if (!obj) {
    return new Response(JSON.stringify({ error: "not_found", key: r2Key }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const contentType = ext === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";
  return new Response(obj.body, {
    status: 200,
    headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
  });
}

async function llmsFullTxt(env) {
  const entities = await listEntities(env);
  const lines = ["# Rattlesnakes By Mail: full entity detail", ""];
  for (const e of entities) {
    lines.push(`## ${e.name}`);
    lines.push(`vendor: ${e.vendor}`);
    lines.push(`kind: ${e.kind}`);
    lines.push(`purpose: ${e.purpose || ""}`);
    lines.push(`ua_token: ${e.ua_token || "none"}`);
    lines.push(`robots_token: ${e.robots_token || ""}`);
    lines.push(`ip_list_url: ${e.ip_list_url || "none published"}`);
    lines.push(`docs_url: ${e.docs_url || ""}`);
    lines.push(`status: ${e.status}`);
    if (e.notes) lines.push(`notes: ${e.notes}`);
    lines.push("");
  }
  return lines.join("\n");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname;

    // www -> apex, permanent redirect. https is enforced at the zone level.
    if (host === "www.rattlesnakesbymail.com") {
      url.hostname = "rattlesnakesbymail.com";
      return Response.redirect(url.toString(), 301);
    }

    // HEAD support (whole site): treat HEAD as GET through the entire
    // pipeline below, then strip the body from the final response just
    // before returning it, keeping the same status and headers. /mcp is
    // exempted: it already answers HEAD directly (200, no body), which
    // differs from what GET /mcp returns (405), so HEAD /mcp keeps seeing
    // the real HEAD request instead of being routed through the GET path.
    const originalRequest = request;
    const isHead = request.method === "HEAD";
    if (isHead && url.pathname !== "/mcp") {
      request = new Request(request, { method: "GET" });
    }

    let response;
    let formatServed;

    try {
      if (url.pathname === "/style.css") {
        formatServed = "css";
        response = await styleCssHandler();
      } else if (url.pathname === OG_IMAGE_PATH) {
        formatServed = "png";
        response = await ogImageHandler(request);
      } else if (url.pathname === "/robots.txt") {
        formatServed = "txt";
        response = textResponse(await robotsTxt(), "text/plain; charset=utf-8");
      } else if (url.pathname === "/sitemap.xml") {
        formatServed = "xml";
        response = textResponse(await sitemapXml(env), "application/xml; charset=utf-8");
      } else if (url.pathname === "/llms.txt") {
        formatServed = "txt";
        response = textResponse(await llmsTxt(env), "text/plain; charset=utf-8");
      } else if (url.pathname === "/llms-full.txt") {
        formatServed = "txt";
        response = textResponse(await llmsFullTxt(env), "text/plain; charset=utf-8");
      } else if (env.INDEXNOW_KEY && url.pathname === `/${env.INDEXNOW_KEY}.txt`) {
        // IndexNow key file (P0.7): dispatched directly, never through the
        // doc dispatcher, never listed in the sitemap. The key is a plain
        // Worker var, meant to be publicly readable at this exact URL.
        formatServed = "txt";
        response = textResponse(env.INDEXNOW_KEY, "text/plain; charset=utf-8");
      } else if (url.pathname === "/changes.xml") {
        formatServed = "xml";
        response = textResponse(await changesAtomHandler(env), "application/atom+xml; charset=utf-8");
      } else if (url.pathname === "/mcp") {
        formatServed = "json";
        response = await handleMcpRequest(request, env, ctx);
      } else if (url.pathname === "/.well-known/mcp/server.json") {
        formatServed = "json";
        response = textResponse(JSON.stringify(MCP_SERVER_MANIFEST, null, 2), "application/json; charset=utf-8");
      } else if (url.pathname === "/.well-known/agent.json" || url.pathname === "/.well-known/agent-card.json" || url.pathname === "/sitemap-machine.xml" || url.pathname === "/sitemap-index.xml") {
        formatServed = url.pathname.endsWith(".xml") ? "xml" : "json";
        response = await discoveryHandle(request, env, url);
      } else if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
        // Admin API (P0.5): dispatched directly, like /mcp above, so it
        // never touches format negotiation, HTML rendering, the GA4 tag or
        // the WebMCP script. Every response is JSON, never cached, and
        // marked noindex inside admin.js itself.
        formatServed = "json";
        response = await handleAdminRequest(request, env, ctx, url);
      } else if (url.pathname.startsWith("/data/") && /\.(json|csv)$/.test(url.pathname)) {
        const exportResponse = await dataExportResponse(env, url.pathname);
        formatServed = url.pathname.endsWith(".csv") ? "csv" : "json";
        response = exportResponse || await respondDoc(notFoundDoc(url.pathname), "json", request, 404, false);
      } else {
        const { format, basePath } = resolveFormat(request, url.pathname);
        formatServed = format;
        // Analytics tag eligibility (P0.7): HTML only, never /admin (guard
        // added now so P0.5 inherits it), and only when the instrument
        // classifies the request as human.
        const analytics = format === "html" && !basePath.startsWith("/admin")
          ? await isAnalyticsEligible(env, request.headers.get("User-Agent") || "")
          : false;
        const route = ROUTES.find((r) => r.test(basePath));
        const family = (basePath === "/fields" || basePath.startsWith("/fields/")) ? fieldsHandle
          : (basePath === "/compare" || basePath.startsWith("/compare/")) ? compareHandle : null;
        if (family && request.method === "GET") {
          response = (await family(request, env, url, format, basePath))
            || await respondDoc(notFoundDoc(basePath), format, request, 404, analytics);
        } else if (!route) {
          response = await respondDoc(notFoundDoc(basePath), format, request, 404, analytics);
        } else if (!route.methods.includes(request.method)) {
          response = await respondDoc(methodNotAllowedDoc(basePath, route.methods), format, request, 405, analytics);
          response.headers.set("Allow", route.methods.join(", "));
        } else {
          const routeCtx = { env, request, url, ctx, basePath };
          const doc = await route.fn(routeCtx);
          if (!doc) {
            response = await respondDoc(notFoundDoc(basePath), format, request, 404, analytics);
          } else if (doc instanceof Response) {
            response = doc;
          } else {
            response = await respondDoc(doc, format, request, 200, analytics);
          }
        }
      }
    } catch (err) {
      formatServed = "json";
      response = new Response(JSON.stringify({ error: "internal_error", message: String(err && err.message || err) }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    try { response.headers.append("Link", linkHeaderValue(SITE_ORIGIN)); } catch (_e) { /* immutable response */ }
    if (isHead && response.body) {
      response = new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    ctx.waitUntil(observe(originalRequest, response, env, formatServed));
    return response;
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runNightly(env, ctx));
  },
};
