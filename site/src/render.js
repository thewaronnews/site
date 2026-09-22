// Shared HTML/Markdown rendering over a small generic "doc" model.
// doc = {
//   path: '/crawlers/gptbot',        // canonical path, no format suffix
//   title: 'GPTBot',
//   nav: true|false,                 // show site chrome (home page vs sub-pages both true)
//   description: 'optional one-line subtitle',
//   jsonld: {...} | null,
//   blocks: [ {k:'p', text}, {k:'h2', text}, {k:'dl', items:[[term,desc]...]},
//             {k:'table', headers:[...], rows:[[...]]}, {k:'ul', items:[...] } ],
//   data: {...}                      // what the JSON view returns verbatim
// }

import { escapeHtml, a } from "./util.js";
import {
  SITE_NAME, SITE_DESCRIPTOR, SITE_ORIGIN, SECTIONS, JSONLD_DESCRIPTION, FOOTER, META_DESCRIPTION_HOME,
  PUBLISHER_NAME, PUBLISHER_URL, AUTHOR_NAME, AUTHOR_URL, AFFILIATION_NAME, AFFILIATION_URL,
  COPYRIGHT_HOLDER, COPYRIGHT_YEAR, GA4_MEASUREMENT_ID,
  SEARCH_LABEL, SEARCH_NOTE_LABEL, SEARCH_BUTTON, SEARCH_MD_LINE,
  NOTE_BODY_LABEL, NOTE_AUTHOR_LABEL, NOTE_SUBMIT_BUTTON,
  OG_IMAGE_PATH, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, OG_IMAGE_TYPE, OG_IMAGE_ALT,
} from "./site.js";

export function publisherOrg() {
  return { "@type": "Organization", name: PUBLISHER_NAME, url: PUBLISHER_URL };
}

export function authorPerson() {
  return {
    "@type": "Person",
    name: AUTHOR_NAME,
    url: AUTHOR_URL,
    worksFor: publisherOrg(),
    affiliation: { "@type": "Organization", name: AFFILIATION_NAME, url: AFFILIATION_URL },
  };
}


// Search form (shared by /, /questions and /search): one HTML form posted
// to /search, plus a plain-text fallback line for the Markdown view. JSON
// views never see blocks at all, so this never touches JSON.
export function searchFormBlock(q = "") {
  const html = `<form method="post" action="/search">
<label for="q">${escapeHtml(SEARCH_LABEL)}</label>
<input type="text" id="q" name="q" value="${escapeHtml(q)}" placeholder="e.g. does GPTBot respect robots.txt">
<label for="note">${escapeHtml(SEARCH_NOTE_LABEL)}</label>
<textarea id="note" name="note" rows="3" maxlength="2000"></textarea>
<button type="submit">${escapeHtml(SEARCH_BUTTON)}</button>
</form>`;
  return { k: "html", html, text: SEARCH_MD_LINE };
}

// Note form (shared by question, claim and entity pages): one HTML form
// posted to /notes with the target carried as hidden fields. No Markdown
// fallback text (NOTES_INVITATION already covers the plain-text guidance),
// so this contributes nothing to the Markdown view.
export function noteFormBlock(targetType, targetId) {
  const html = `<form method="post" action="/notes">
<input type="hidden" name="target_type" value="${escapeHtml(targetType)}">
<input type="hidden" name="target_id" value="${escapeHtml(String(targetId))}">
<label for="body">${escapeHtml(NOTE_BODY_LABEL)}</label>
<textarea id="body" name="body" rows="3" maxlength="2000"></textarea>
<label for="author_claim">${escapeHtml(NOTE_AUTHOR_LABEL)}</label>
<input type="text" id="author_claim" name="author_claim">
<button type="submit">${escapeHtml(NOTE_SUBMIT_BUTTON)}</button>
</form>`;
  return { k: "html", html, text: "" };
}

function navHtml() {
  const links = SECTIONS.map(s => a(s.path, s.label)).join('');
  return `<nav>${links}</nav>`;
}

// Renders one cell value that may be a plain scalar or a {html, text, wrap?}
// object built by routes.js (link(), code(), wrapCell()). The bug this
// guards against: `c && c.html ? c.html : escapeHtml(c ?? "")` falls through
// to the escapeHtml() branch whenever html is an empty string (a wrapCell of
// a NULL/empty value), and escapeHtml(c ?? "") then stringifies the *object*
// itself, since `c` is truthy and `??` only catches null/undefined. That
// produced the literal text "[object Object]" for any object cell whose
// html happened to be "". A cell object's html (even "") is always the
// right rendering; only a plain scalar goes through escapeHtml.
function cellHtml(c) {
  if (c && typeof c === "object") return c.html || "";
  return escapeHtml(c ?? "");
}

function blockToHtml(b) {
  switch (b.k) {
    case "p":
      return `<p>${b.html ? b.html : escapeHtml(b.text)}</p>`;
    case "h2":
      return `<h2>${b.html ? b.html : escapeHtml(b.text)}</h2>`;
    case "h3":
      return `<h3>${b.html ? b.html : escapeHtml(b.text)}</h3>`;
    case "dl":
      return `<dl>${b.items
        .map(([t, d]) => `<dt>${escapeHtml(t)}</dt><dd>${cellHtml(d)}</dd>`)
        .join("")}</dl>`;
    case "table":
      return `<div class="table"><table><thead><tr>${b.headers
        .map((h) => `<th>${escapeHtml(h)}</th>`)
        .join("")}</tr></thead><tbody>${b.rows
        .map((row) => `<tr>${row
          .map((c) => {
            const cls = c && typeof c === "object" && c.wrap ? ' class="wrap"' : "";
            return `<td${cls}>${cellHtml(c)}</td>`;
          })
          .join("")}</tr>`)
        .join("")}</tbody></table></div>`;
    case "ul":
      return `<ul>${b.items.map((i) => `<li>${cellHtml(i)}</li>`).join("")}</ul>`;
    case "html":
      return b.html; // pre-built trusted HTML fragment (forms, etc.)
    default:
      return "";
  }
}

function truncateDescription(text, max = 160) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

// WebMCP (spec section 8): registers the four read tools on
// document.modelContext, behind feature detection, matching the current
// Chrome/webmachinelearning API shape (document.modelContext.registerTool,
// not the older navigator.modelContext proposal). Same names, descriptions
// and inputSchema as /mcp's tools/list; each execute() calls /mcp with a
// same-origin JSON-RPC tools/call. submit_note is not registered. Kept
// under 2KB, ES5-compatible, no third-party host contacted.
const WEBMCP_SCRIPT = `<script>if(document.modelContext&&document.modelContext.registerTool){function rc(n,a){return fetch('/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:n,arguments:a}})}).then(function(r){return r.json()}).then(function(j){return j&&j.result&&j.result.content&&j.result.content[0]?j.result.content[0].text:'No result.'})}
document.modelContext.registerTool({name:'lookup_crawler',description:'Look up a documented crawler by name, slug, or user-agent string, and return its identity fields and current claims.',inputSchema:{type:'object',properties:{name_or_ua:{type:'string',description:'A crawler name, slug, or user-agent string.'}},required:['name_or_ua']},execute:function(a){return rc('lookup_crawler',a)}})
document.modelContext.registerTool({name:'identify_user_agent',description:'Match a raw User-Agent string against documented crawlers and return verification instructions.',inputSchema:{type:'object',properties:{user_agent:{type:'string',description:'A raw User-Agent header string.'}},required:['user_agent']},execute:function(a){return rc('identify_user_agent',a)}})
document.modelContext.registerTool({name:'list_changes',description:'List recorded changes to claims, newest first, filtered by date or entity.',inputSchema:{type:'object',properties:{since:{type:'string',description:'An ISO date; only changes on or after this date.'},entity:{type:'string',description:'An entity slug to filter to one crawler.'},limit:{type:'integer',description:'Max rows, up to 200.',maximum:200}}},execute:function(a){return rc('list_changes',a)}})
document.modelContext.registerTool({name:'ask',description:'Match a question against published claims and entities and log it to the ledger.',inputSchema:{type:'object',properties:{question:{type:'string',description:'A free-text question about crawlers or claims.'}},required:['question']},execute:function(a){return rc('ask',a)}})
}</script>`;

export function renderHtml(doc, alt, analytics = false) {
  const safeTitle = doc.title || SITE_NAME;
  let titleText;
  if (doc.path === "/") {
    titleText = `${SITE_NAME}: ${SITE_DESCRIPTOR}`;
  } else {
    titleText = `${escapeHtml(safeTitle)} | ${SITE_NAME}`;
  }
  const metaDescription = doc.path === "/"
    ? META_DESCRIPTION_HOME
    : truncateDescription(doc.metaDescription || doc.description);
  let jsonldObj;
  if (doc.path === "/") {
    jsonldObj = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      description: JSONLD_DESCRIPTION,
      url: SITE_ORIGIN,
      publisher: publisherOrg(),
      author: authorPerson(),
      copyrightHolder: { "@type": "Person", name: COPYRIGHT_HOLDER, url: AUTHOR_URL },
      copyrightYear: Number(COPYRIGHT_YEAR),
    };
  } else if (doc.jsonld) {
    jsonldObj = doc.jsonld;
  } else {
    jsonldObj = {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: safeTitle,
      url: `${SITE_ORIGIN}${doc.path || ""}`,
      isPartOf: { name: SITE_NAME, url: SITE_ORIGIN },
      publisher: publisherOrg(),
      author: authorPerson(),
    };
  }
  const jsonld = jsonldObj ? `<script type="application/ld+json">${JSON.stringify(jsonldObj)}</script>` : "";
  const rawTitle = doc.path === "/" ? `${SITE_NAME}: ${SITE_DESCRIPTOR}` : `${safeTitle} | ${SITE_NAME}`;
  const canonicalUrl = `${SITE_ORIGIN}${doc.path || ""}`;
  const ogImageUrl = `${SITE_ORIGIN}${OG_IMAGE_PATH}`;
  const ogTagsHtml = `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(rawTitle)}">
<meta property="og:description" content="${escapeHtml(metaDescription)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${escapeHtml(ogImageUrl)}">
<meta property="og:image:type" content="${escapeHtml(OG_IMAGE_TYPE)}">
<meta property="og:image:width" content="${OG_IMAGE_WIDTH}">
<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}">
<meta property="og:image:alt" content="${escapeHtml(OG_IMAGE_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(rawTitle)}">
<meta name="twitter:description" content="${escapeHtml(metaDescription)}">
<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}">
<meta name="twitter:image:alt" content="${escapeHtml(OG_IMAGE_ALT)}">`;
  // GA4 tag (P0.7): only for requests classified human, never for
  // Markdown/JSON views (this function renders HTML only) and never for
  // /admin (guarded at the call site). No tag means no script at all, not
  // even a comment.
  const gtagHtml = analytics
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}"></script>\n<script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', '${GA4_MEASUREMENT_ID}', {'anonymize_ip': true});</script>`
    : "";
  const body = (doc.blocks || []).map(blockToHtml).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${escapeHtml(metaDescription)}">
<title>${titleText}</title>
<link rel="alternate" type="text/markdown" href="${alt.md}">
<link rel="alternate" type="application/json" href="${alt.json}">
<link rel="stylesheet" href="/style.css">
${ogTagsHtml}
${jsonld}
${gtagHtml}
</head>
<body>
<header>${a("/", SITE_NAME, { class: "home" })}${navHtml()}</header>
<main>
<h1>${escapeHtml(safeTitle)}</h1>
${doc.description ? `<p class="subtitle">${escapeHtml(doc.description)}</p>` : ""}
${body}
</main>
<footer>${FOOTER}</footer>
${WEBMCP_SCRIPT}
</body>
</html>`;
}

function blockToMd(b) {
  switch (b.k) {
    case "p":
      return b.text;
    case "h2":
      return `## ${b.text}`;
    case "h3":
      return `### ${b.text}`;
    case "dl":
      return b.items.map(([t, d]) => `${t}: ${d && d.text !== undefined ? d.text : d ?? ""}`).join("\n");
    case "table": {
      const head = `| ${b.headers.join(" | ")} |`;
      const sep = `| ${b.headers.map(() => "---").join(" | ")} |`;
      const rows = b.rows.map((r) => `| ${r.map((c) => (c && c.text !== undefined ? c.text : c ?? "")).join(" | ")} |`);
      return [head, sep, ...rows].join("\n");
    }
    case "ul":
      return b.items.map((i) => `- ${i && i.text !== undefined ? i.text : i}`).join("\n");
    case "html":
      return b.text || ""; // plain-text fallback supplied alongside html
    default:
      return "";
  }
}

export function renderMarkdown(doc) {
  const parts = [];
  if (doc.path === "/") {
    parts.push(`# ${SITE_NAME}`);
    parts.push(SITE_DESCRIPTOR);
  } else {
    parts.push(`# ${doc.title || SITE_NAME}`);
    if (doc.description) parts.push(doc.description);
  }
  for (const b of doc.blocks || []) {
    const s = blockToMd(b);
    if (s) parts.push(s);
  }
  return parts.join("\n\n") + "\n";
}

export function buildAlternates(basePath) {
  if (!basePath || basePath === "/") {
    return { html: "/", md: "/.md", json: "/.json" };
  }
  return { html: basePath, md: `${basePath}.md`, json: `${basePath}.json` };
}
