// HTML and Markdown rendering over a small generic "doc" model.
// doc = {
//   path, title, subtitle?, metaDescription?, updatedAt?, noindex?,
//   meta?: {published, reviewed, sources, unknowns, status, statusAsOf},
//   breadcrumbs?: [{name, path}], jsonld?: object | object[],
//   blocks: [...], footnotes?: Footnotes, data: {...}
// }
// Blocks: p, h2, h3, dl, table, ul, html (with md text fallback), md
// (Markdown source with {c:ID} refs), sources, cards, timeline, notice.

import { escapeHtml, a, aHtml, extLink, extLinkMd, mdToHtml, mdToMd, truncate, proseDate } from "./util.js";
import {
  SITE_NAME, SITE_SUBTITLE, SITE_ORIGIN, SECTIONS, FOOTER_LINKS, META_DESCRIPTION_HOME, PUBLISHER_NAME,
  DATA_LICENSE, LICENSE_URL, INCIDENT_STATUS_LABELS, COPYRIGHT_YEAR,
} from "./site.js";
import { SITE_CSS_VERSION } from "./css.js";
import { breadcrumbLd } from "./jsonld.js";

// ---------- footnotes ({c:ID} -> numbered claim references) ----------

export class Footnotes {
  constructor(claims = []) {
    this.byId = new Map(claims.map((c) => [c.id, c]));
    this.order = [];
  }
  add(claims) {
    for (const c of claims) this.byId.set(c.id, c);
  }
  number(id) {
    let n = this.order.indexOf(id);
    if (n === -1) {
      this.order.push(id);
      n = this.order.length - 1;
    }
    return n + 1;
  }
  ref = (id, fmt) => {
    const n = this.number(id);
    if (fmt === "md") return `[${n}]`;
    return `<sup class="fn-ref"><a href="#fn-${n}" id="fnref-${id}-${n}" aria-label="Claim ${id}, footnote ${n}">${n}</a></sup>`;
  };
  entries() {
    return this.order.map((id, i) => ({ n: i + 1, id, claim: this.byId.get(id) || null }));
  }
}

function footnotesHtml(fn) {
  const items = fn.entries();
  if (!items.length) return "";
  const lis = items.map(({ n, id, claim }) => {
    if (!claim) return `<li id="fn-${n}">${a(`/claims/${id}`, `Claim ${id}`)}</li>`;
    const src = claim.source ? `<span class="claim-source">${extLink(claim.source)}${claim.source.publisher ? `, ${escapeHtml(claim.source.publisher)}` : ""}${claim.source.published_on ? `, ${escapeHtml(claim.source.published_on)}` : ""}.</span>` : "";
    const quote = claim.evidence_quote ? ` <q class="claim-quote-inline">${escapeHtml(claim.evidence_quote)}</q>` : "";
    return `<li id="fn-${n}">${escapeHtml(claim.statement)}${quote} ${src} ${a(`/claims/${id}`, `Claim ${id}`)}, checked ${escapeHtml(String(claim.verified_at).slice(0, 10))}.</li>`;
  });
  return `<section class="footnotes" aria-labelledby="footnotes-h"><h2 id="footnotes-h">Claims cited</h2><ol>${lis.join("")}</ol></section>`;
}

function footnotesMd(fn) {
  const items = fn.entries();
  if (!items.length) return "";
  const lines = items.map(({ n, id, claim }) => {
    if (!claim) return `[${n}] Claim ${id}: ${SITE_ORIGIN}/claims/${id}`;
    const q = claim.evidence_quote ? ` Quote: "${claim.evidence_quote}"` : "";
    const src = claim.source ? ` Source: ${claim.source.publisher || ""}${claim.source.published_on ? `, ${claim.source.published_on}` : ""}. ${extLinkMd(claim.source)}` : "";
    return `[${n}] ${claim.statement}${q}${src} Claim: ${SITE_ORIGIN}/claims/${id}, checked ${String(claim.verified_at).slice(0, 10)}.`;
  });
  return `## Claims cited\n\n${lines.join("\n\n")}`;
}

// ---------- meta block (spec 3.3) ----------

export function metaLines(meta) {
  if (!meta) return [];
  const lines = [];
  const first = [];
  if (meta.published) first.push(`Published ${String(meta.published).slice(0, 10)}.`);
  if (meta.reviewed) first.push(`Last reviewed ${String(meta.reviewed).slice(0, 10)}.`);
  if (meta.sources !== undefined && meta.sources !== null) first.push(`${meta.sources} ${meta.sources === 1 ? "source" : "sources"}.`);
  if (first.length) lines.push(first.join(" "));
  if (meta.status) lines.push(`Status: ${INCIDENT_STATUS_LABELS[meta.status] || meta.status}, as of ${meta.statusAsOf}.`);
  if (meta.unknowns) lines.push(`What we don't know: ${meta.unknowns}`);
  return lines;
}

function metaHtml(meta) {
  const lines = metaLines(meta);
  if (!lines.length) return "";
  return `<div class="page-meta">${lines.map((l) => {
    if (l.startsWith("Status:")) return `<p class="status-line"><strong>${escapeHtml(l)}</strong></p>`;
    if (l.startsWith("Published") || l.startsWith("Last reviewed")) return `<p><span class="reviewed-stamp">${escapeHtml(l)}</span></p>`;
    return `<p>${escapeHtml(l)}</p>`;
  }).join("")}</div>`;
}

// ---------- blocks ----------

function cellHtml(c) {
  if (c && typeof c === "object") return c.html || "";
  return escapeHtml(c ?? "");
}
function cellText(c) {
  if (c && typeof c === "object") return c.text ?? "";
  return String(c ?? "");
}

export function linkCell(href, text) {
  return { html: a(href, text), text: href.startsWith("/") ? `[${text}](${SITE_ORIGIN}${href})` : `[${text}](${href})` };
}

function h2Id(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sourceItemHtml(s) {
  const bits = [];
  if (s.publisher) bits.push(escapeHtml(s.publisher));
  if (s.published_on) bits.push(escapeHtml(s.published_on));
  if (s.cite_role || s.doc_role) bits.push(escapeHtml(s.cite_role || s.doc_role));
  return `<li class="source" id="source-${s.id}">${extLink(s)}<span class="source__meta">${bits.join(", ")}. ${a(`/sources/${s.id}`, "Source record")}</span></li>`;
}

function sourceItemMd(s, i) {
  const bits = [s.publisher, s.published_on].filter(Boolean).join(", ");
  return `${i + 1}. ${extLinkMd(s)}${bits ? ` (${bits})` : ""}.`;
}

function cardHtml(c) {
  return `<article class="incident"><div class="incident__date">${escapeHtml(c.date || "")}</div><div><h3 class="incident__title">${a(c.href, c.title)}</h3>${c.body ? `<p class="incident__body">${escapeHtml(c.body)}</p>` : ""}${c.meta ? `<p class="meta">${escapeHtml(c.meta)}</p>` : ""}</div></article>`;
}

function timelineHtml(rows) {
  if (!rows.length) return "<p>No dated entries match this view.</p>";
  const out = [];
  let year = null;
  for (const r of rows) {
    const y = r.date.slice(0, 4);
    if (y !== year) {
      out.push(`<h3 class="timeline-year">${a(`/timeline/${y}`, y)}</h3>`);
      year = y;
    }
    const target = r.incident_slug ? `/incidents/${r.incident_slug}` : r.case_slug ? `/cases/${r.case_slug}` : null;
    const label = target ? a(target, r.label) : escapeHtml(r.label);
    const claim = r.claim_id ? ` <sup class="fn-ref">${a(`/claims/${r.claim_id}`, "claim")}</sup>` : "";
    out.push(`<div class="timeline-entry"><div class="timeline-entry__date">${escapeHtml(proseDate(r.date, r.precision))}</div><div class="timeline-entry__body">${label}${claim}${r.kind && r.kind !== "incident" ? ` <small>(${escapeHtml(r.kind.replace(/_/g, " "))})</small>` : ""}</div></div>`);
  }
  return `<div class="timeline">${out.join("")}</div>`;
}

function timelineMd(rows) {
  if (!rows.length) return "No dated entries match this view.";
  return rows.map((r) => {
    const url = r.incident_slug ? `${SITE_ORIGIN}/incidents/${r.incident_slug}` : r.case_slug ? `${SITE_ORIGIN}/cases/${r.case_slug}` : "";
    return `- ${r.date.slice(0, r.precision === "year" ? 4 : r.precision === "day" ? 10 : 7)}: ${r.label}${r.incident_slug ? ` (incident ${r.incident_slug})` : ""}${url ? ` ${url}` : ""}`;
  }).join("\n");
}

function blockToHtml(b, fn) {
  switch (b.k) {
    case "p": return `<p${b.cls ? ` class="${b.cls}"` : ""}>${b.html ? b.html : escapeHtml(b.text)}</p>`;
    case "h2": return `<h2 id="${b.id || h2Id(b.text)}">${escapeHtml(b.text)}</h2>`;
    case "h3": return `<h3>${escapeHtml(b.text)}</h3>`;
    case "dl": return `<dl>${b.items.map(([t, d]) => `<dt>${escapeHtml(t)}</dt><dd>${cellHtml(d)}</dd>`).join("")}</dl>`;
    case "table": return `<div class="table-wrap"><table>${b.caption ? `<caption>${escapeHtml(b.caption)}</caption>` : ""}<thead><tr>${b.headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${cellHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    case "ul": return `<ul>${b.items.map((i) => `<li>${cellHtml(i)}</li>`).join("")}</ul>`;
    case "html": return b.html;
    case "md": return mdToHtml(b.md, { refFn: fn ? fn.ref : null, skipH1: !!b.skipH1, headingOffset: b.headingOffset || 0 });
    case "sources": return b.sources.length ? `<ul class="sources">${b.sources.map(sourceItemHtml).join("")}</ul>` : "<p>No sources are linked yet.</p>";
    case "cards": return b.items.length ? `<div class="stack">${b.items.map(cardHtml).join("")}</div>` : `<p>${escapeHtml(b.empty || "Nothing is published here yet.")}</p>`;
    case "timeline": return timelineHtml(b.rows);
    case "notice": return `<div class="notice"><p>${b.html || escapeHtml(b.text)}</p></div>`;
    case "feeds": return `<p class="feed-badges">${b.items.map((i) => aHtml(i.href, escapeHtml(i.label), { class: "feed-badge" })).join("")}</p>`;
    case "download": return `<div class="data-download"><div><strong>${escapeHtml(b.title)}</strong><p class="data-download__meta">${escapeHtml(b.meta || "")}</p></div><div class="data-download__links">${b.links.map((l) => a(l.href, l.label)).join("")}</div></div>`;
    default: return "";
  }
}

function blockToMd(b, fn) {
  switch (b.k) {
    case "p": return b.text ?? "";
    case "h2": return `## ${b.text}`;
    case "h3": return `### ${b.text}`;
    case "dl": return b.items.map(([t, d]) => `- ${t}: ${cellText(d)}`).join("\n");
    case "table": {
      const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
      return [`| ${b.headers.map(esc).join(" | ")} |`, `| ${b.headers.map(() => "---").join(" | ")} |`, ...b.rows.map((r) => `| ${r.map((c) => esc(cellText(c))).join(" | ")} |`)].join("\n");
    }
    case "ul": return b.items.map((i) => `- ${cellText(i)}`).join("\n");
    case "html": return b.text || "";
    case "md": return mdToMd(b.md, { refFn: fn ? fn.ref : null, skipH1: !!b.skipH1 });
    case "sources": return b.sources.length ? b.sources.map(sourceItemMd).join("\n") : "No sources are linked yet.";
    case "cards": return b.items.length ? b.items.map((c) => `- ${c.date ? `${c.date}: ` : ""}[${c.title}](${SITE_ORIGIN}${c.href})${c.body ? `. ${c.body}` : ""}`).join("\n") : (b.empty || "Nothing is published here yet.");
    case "timeline": return timelineMd(b.rows);
    case "notice": return b.text || "";
    case "feeds": return b.items.map((i) => `- ${i.label}: ${i.href.startsWith("/") ? SITE_ORIGIN + i.href : i.href}`).join("\n");
    case "download": return `${b.title}${b.meta ? `. ${b.meta}` : ""}\n${b.links.map((l) => `- ${l.label}: ${l.href.startsWith("/") ? SITE_ORIGIN + l.href : l.href}`).join("\n")}`;
    default: return "";
  }
}

// ---------- WebMCP (read tools on the page, feature-detected) ----------

const WEBMCP_SCRIPT = `<script>(function(){var mc=document.modelContext||navigator.modelContext;if(!mc||!mc.registerTool)return;function rc(n,a){return fetch('/mcp',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:n,arguments:a}})}).then(function(r){return r.json()}).then(function(j){return j&&j.result&&j.result.content&&j.result.content[0]?j.result.content[0].text:'No result.'})}
function t(n,d,p,r){mc.registerTool({name:n,description:d,inputSchema:{type:'object',properties:p,required:r||[]},execute:function(a){return rc(n,a||{})}})}
t('search_incidents','Search recorded incidents where governments or officials limited journalists\\' ability to report, with facets.',{query:{type:'string'},country:{type:'string'},continent:{type:'string'},tactic:{type:'string'},leader:{type:'string'},outcome:{type:'string'},from:{type:'string'},to:{type:'string'},limit:{type:'integer'}});
t('get_incident','One incident with timeline, actors, outlets, cases, claims and archived sources.',{slug:{type:'string'}},['slug']);
t('get_timeline','Dated timeline entries, oldest first.',{from:{type:'string'},to:{type:'string'},actor:{type:'string'},type:{type:'string'},limit:{type:'integer'}});
t('get_country','One country: incidents by year, tactics, heads of government, press-freedom rank.',{iso2:{type:'string'}},['iso2']);
t('get_tactic','One tactic: definition and incidents by country and year.',{slug:{type:'string'}},['slug']);
t('compare','Tactic by country matrix of dated incidents with head of government and outcome.',{tactic:{type:'string'},country:{type:'string'},from:{type:'string'},to:{type:'string'}});
t('recent_coverage','Recent reporting on government actions against journalists, newest first.',{limit:{type:'integer'}});
})();</script>`;

// ---------- page chrome ----------

function navHtml(currentPath) {
  return `<nav class="nav" aria-label="Sections"><ul>${SECTIONS.map((s) => {
    const cur = currentPath === s.path || (currentPath || "").startsWith(`${s.path}/`);
    return `<li>${a(s.path, s.label, cur ? { "aria-current": "page" } : {})}</li>`;
  }).join("")}</ul></nav>`;
}

// Footer copy fixed by the v2 brief (2026-09-22, "Copy rules").
function footerHtml() {
  return `<footer class="site-footer">
<p>${escapeHtml(SITE_NAME)} is published by ${a("/about", PUBLISHER_NAME)}.</p>
<p>&copy; ${COPYRIGHT_YEAR} ${escapeHtml(PUBLISHER_NAME)}. Text and data are licensed ${a(LICENSE_URL, DATA_LICENSE)} unless noted; quotations remain the property of their sources.</p>
<ul>${FOOTER_LINKS.map((l) => `<li>${a(l.path, l.label)}</li>`).join("")}</ul>
</footer>`;
}

// query: the canonical query string of a filtered view ("" or "?a=b"),
// carried onto the canonical link and the .md/.json alternates.
export function buildAlternates(basePath, query = "") {
  if (!basePath || basePath === "/") return { html: `/${query}`, md: `/index.md${query}`, json: `/index.json${query}` };
  return { html: `${basePath}${query}`, md: `${basePath}.md${query}`, json: `${basePath}.json${query}` };
}

export function renderHtml(doc, alt, analytics = false, ga4 = "") {
  const isHome = doc.path === "/";
  const title = doc.title || SITE_NAME;
  const titleText = isHome ? `${SITE_NAME}: ${SITE_SUBTITLE.replace(/\.$/, "")}` : `${title} | ${SITE_NAME}`;
  const metaDescription = isHome ? META_DESCRIPTION_HOME : truncate(doc.metaDescription || doc.subtitle || SITE_SUBTITLE, 160);
  const canonical = `${SITE_ORIGIN}${doc.path === "/" ? "/" : doc.path}${doc.query || ""}`;
  const lds = [];
  if (doc.jsonld) lds.push(...(Array.isArray(doc.jsonld) ? doc.jsonld : [doc.jsonld]));
  lds.push(breadcrumbLd(doc.breadcrumbs || [], doc.path, title));
  const jsonld = lds.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("\n");
  const gtag = analytics && ga4
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga4}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga4}',{'anonymize_ip':true});</script>`
    : "";
  const fn = doc.footnotes || null;
  const body = (doc.blocks || []).map((b) => blockToHtml(b, fn)).join("\n");
  const crumbs = (doc.breadcrumbs || []).length
    ? `<p class="meta breadcrumbs">${[{ name: "Home", path: "/" }, ...doc.breadcrumbs].map((c) => a(c.path, c.name)).join(" / ")}</p>`
    : "";
  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titleText)}</title>
<meta name="description" content="${escapeHtml(metaDescription)}">
${doc.noindex ? '<meta name="robots" content="noindex">\n' : ""}<link rel="canonical" href="${escapeHtml(canonical)}">
<link rel="alternate" type="text/markdown" href="${escapeHtml(alt.md)}">
<link rel="alternate" type="application/json" href="${escapeHtml(alt.json)}">
<link rel="alternate" type="application/atom+xml" title="${escapeHtml(SITE_NAME)}: Recent coverage" href="/coverage/atom.xml">
<link rel="alternate" type="application/atom+xml" title="${escapeHtml(SITE_NAME)}: Incidents" href="/incidents/atom.xml">
<link rel="stylesheet" href="/assets/site.css?v=${SITE_CSS_VERSION}">
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
<meta property="og:type" content="${doc.ogType || "website"}">
<meta property="og:title" content="${escapeHtml(isHome ? SITE_NAME : title)}">
<meta property="og:description" content="${escapeHtml(metaDescription)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta name="twitter:card" content="summary">
${jsonld}
${gtag}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="masthead"><div><p class="masthead__title">${a("/", SITE_NAME)}</p><p class="masthead__tagline">${escapeHtml(SITE_SUBTITLE)}</p></div></header>
<div class="site-shell">
${navHtml(doc.path)}
<main id="main">
${crumbs}
<article>
<h1>${escapeHtml(title)}</h1>
${doc.subtitle ? `<p class="subtitle">${escapeHtml(doc.subtitle)}</p>` : ""}
${metaHtml(doc.meta)}
${body}
${fn ? footnotesHtml(fn) : ""}
</article>
</main>
</div>
${footerHtml()}
${WEBMCP_SCRIPT}
</body>
</html>`;
}

export function renderMarkdown(doc) {
  const parts = [];
  if (doc.path === "/") {
    parts.push(`# ${SITE_NAME}`);
    parts.push(SITE_SUBTITLE);
  } else {
    parts.push(`# ${doc.title || SITE_NAME}`);
    if (doc.subtitle) parts.push(doc.subtitle);
  }
  const ml = metaLines(doc.meta);
  if (ml.length) parts.push(ml.join("\n\n"));
  const fn = doc.footnotes || null;
  for (const b of doc.blocks || []) {
    const s = blockToMd(b, fn);
    if (s) parts.push(s);
  }
  if (fn) {
    const f = footnotesMd(fn);
    if (f) parts.push(f);
  }
  parts.push(`Source page: ${SITE_ORIGIN}${doc.path === "/" ? "/" : doc.path}${doc.query || ""}. ${SITE_NAME}, ${DATA_LICENSE}.`);
  return parts.join("\n\n") + "\n";
}
