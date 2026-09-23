// HTML and Markdown rendering over a small generic "doc" model.
// doc = {
//   path, title, subtitle?, metaDescription?, updatedAt?, noindex?,
//   meta?: {published, reviewed, sources, unknowns, status, statusAsOf},
//   breadcrumbs?: [{name, path}], jsonld?: object | object[],
//   blocks: [...], footnotes?: Footnotes, data: {...}
// }
// Blocks: p, h2, h3, dl, table, ul, html (with md text fallback), md
// (Markdown source with {c:ID} refs), sources, cards, timeline, notice.
//
// HTML-only fields (never read by renderMarkdown, never in doc.data, so the
// .md and .json twins do not depend on them): doc.layout ("home" | "record"
// | "reading"), doc.htmlBody(fn) (replaces the block rendering), doc.eyebrow,
// doc.art (illustration name or null), doc.headExtra (HTML under the title),
// and on a block: viewHtml (replaces that block's HTML) or hideHtml.

import { escapeHtml, a, aHtml, extLink, extLinkMd, mdToHtml, mdToMd, truncate, proseDate } from "./util.js";
import {
  SITE_NAME, SITE_SUBTITLE, SITE_ORIGIN, SECTIONS, FOOTER_LINKS, META_DESCRIPTION_HOME, PUBLISHER_NAME,
  DATA_LICENSE, LICENSE_URL, INCIDENT_STATUS_LABELS, COPYRIGHT_YEAR, MASTHEAD_DESCRIPTOR,
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

export function footnotesHtml(fn, heading = "Claims and evidence") {
  const items = fn.entries();
  if (!items.length) return "";
  const lis = items.map(({ n, id, claim }) => {
    if (!claim) return `<li id="fn-${n}">${a(`/claims/${id}`, `Claim ${id}`)}</li>`;
    const src = claim.source ? `<span class="claim-source">${extLink(claim.source)}${claim.source.publisher ? `, ${escapeHtml(claim.source.publisher)}` : ""}${claim.source.published_on ? `, ${escapeHtml(claim.source.published_on)}` : ""}.</span>` : "";
    const quote = claim.evidence_quote ? `<q class="claim-quote-inline">${escapeHtml(claim.evidence_quote)}</q>` : "";
    return `<li id="fn-${n}"><span class="claim__statement">${escapeHtml(claim.statement)}</span>${quote}${src}<span class="claim__check">${a(`/claims/${id}`, `Claim ${id}`)}, checked ${escapeHtml(String(claim.verified_at).slice(0, 10))}.</span></li>`;
  });
  return `<section class="footnotes" aria-labelledby="footnotes-h"><h2 id="footnotes-h">${escapeHtml(heading)}</h2><p class="muted">Each numbered claim quotes the source it rests on.</p><ol>${lis.join("")}</ol></section>`;
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

export function metaHtml(meta) {
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

export function cardHtml(c) {
  const meta = c.metaHtml || (c.meta ? escapeHtml(c.meta) : "");
  return `<article class="card${c.cls ? ` ${c.cls}` : ""}">${c.date || c.topHtml ? `<p class="card__meta">${c.topHtml || `<time>${escapeHtml(c.date)}</time>`}</p>` : ""}<h3 class="card__title">${a(c.href, c.title)}</h3>${c.body ? `<p class="card__body">${escapeHtml(c.body)}</p>` : ""}${meta ? `<p class="card__foot">${meta}</p>` : ""}</article>`;
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

export function blockToHtml(b, fn) {
  if (b.hideHtml) return "";
  if (b.viewHtml !== undefined) return b.viewHtml;
  switch (b.k) {
    case "p": return `<p${b.cls ? ` class="${b.cls}"` : ""}>${b.html ? b.html : escapeHtml(b.text)}</p>`;
    case "h2": return `<h2 id="${b.id || h2Id(b.text)}">${escapeHtml(b.text)}</h2>`;
    case "h3": return `<h3>${escapeHtml(b.text)}</h3>`;
    case "dl": return `<dl class="facts">${b.items.map(([t, d]) => `<div><dt>${escapeHtml(t)}</dt><dd>${cellHtml(d)}</dd></div>`).join("")}</dl>`;
    case "table": return `<div class="table-wrap"><table>${b.caption ? `<caption>${escapeHtml(b.caption)}</caption>` : ""}<thead><tr>${b.headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c, i) => `<td data-label="${escapeHtml(b.headers[i] || "")}">${cellHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    case "ul": return `<ul>${b.items.map((i) => `<li>${cellHtml(i)}</li>`).join("")}</ul>`;
    case "html": return b.html;
    case "md": return mdToHtml(b.md, { refFn: fn ? fn.ref : null, skipH1: !!b.skipH1, headingOffset: b.headingOffset || 0 });
    case "sources": return b.sources.length ? `<ol class="sources">${b.sources.map(sourceItemHtml).join("")}</ol>` : "<p>No sources are linked yet.</p>";
    case "cards": return b.items.length ? `<div class="cards">${b.items.map(cardHtml).join("")}</div>` : `<p>${escapeHtml(b.empty || "Nothing is published here yet.")}</p>`;
    case "timeline": return timelineHtml(b.rows);
    case "notice": return `<div class="notice"><p>${b.html || escapeHtml(b.text)}</p></div>`;
    case "feeds": return `<p class="feed-badges">${b.items.map((i) => aHtml(i.href, escapeHtml(i.label), { class: "feed-badge" })).join("")}</p>`;
    case "download": return `<div class="data-download"><div><strong>${escapeHtml(b.title)}</strong><p class="data-download__meta">${escapeHtml(b.meta || "")}</p></div><div class="data-download__links">${b.links.map((l) => a(l.href, l.label)).join("")}</div></div>`;
    default: return "";
  }
}

export function blockToMd(b, fn) {
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
t('ladder','One tactic\\'s incidents by escalation stage (restrict, pressure, punish, silence, eliminate), United States rows marked as the focal case, with RSF ranks.',{tactic:{type:'string'},stage:{type:'string'},continent:{type:'string'},from:{type:'string'},to:{type:'string'}},['tactic']);
t('get_united_states_chapter','The United States chapter: 2025 to 2026, the record since 1917, and where each tactic in use now has led elsewhere.',{});
t('recent_coverage','Recent reporting on government actions against journalists, newest first.',{limit:{type:'integer'}});
})();</script>`;

// ---------- illustrations (Etched Record masters, served from R2) ----------

export const ART = ["home-hero", "incident", "case", "actor", "tactic", "country", "coverage", "era-timeline", "explainer"];
export const ART_ALT = {
  "home-hero": "Engraving of a locked iron gate with a press pass hanging from it, a government building behind",
  incident: "Engraving of an empty press briefing room with a lectern and rows of chairs",
  case: "Engraving of a bundle of papers tied with ribbon on courthouse steps",
  actor: "Engraving of an official's desk with a signed, sealed document and a pen",
  tactic: "Engraving of a hand press bound in chains and a padlock",
  country: "Engraving of a globe beside an open atlas in a library",
  coverage: "Engraving of bundled newspapers and a radio on a doorstep",
  "era-timeline": "Engraving of a shelf of bound volumes lit by a desk lamp",
  explainer: "Engraving of a reading desk with an open reference book and a lamp",
  "tactic-access_ban": "Engraving of a panelled door barred by a brass turnstile gate",
  "tactic-credential_control": "Engraving of a desktop paper punch beside a stack of blank metal plates",
  "tactic-outlet_licensing": "Engraving of a brass padlock",
  "tactic-prior_restraint": "Engraving of a proof sheet with a blacked-out column and a hand stamp",
  "tactic-secrets_and_espionage_laws": "Engraving of a small lockbox with a combination dial",
  "tactic-insult_and_defamation_laws": "Engraving of a wooden courtroom gavel on its sound block",
  "tactic-surveillance_and_subpoenas": "Engraving of an antique telephone handset fitted with a metal clip",
  "tactic-funding_and_ownership_pressure": "Engraving of a rolled ledger page",
  "tactic-expulsion_and_visa_denial": "Engraving of a brass adjustable date stamp",
  "tactic-shutdowns_and_blocking": "Engraving of a severed telegraph wire beside a dark screen",
  "tactic-detention_and_violence": "Engraving of a notebook and pen behind iron cell bars",
  "tactic-lawsuits_against_press": "Engraving of a bound stack of court filing papers tied with a docket tag",
  "tactic-disinformation_labeling": "Engraving of a folded newspaper with a blank label pasted across it",
  "continent-africa": "Engraving of an open atlas showing the outline of Africa",
  "continent-americas": "Engraving of an open atlas showing the outline of North and South America",
  "continent-asia": "Engraving of an open atlas showing the outline of Asia",
  "continent-europe": "Engraving of an open atlas showing the outline of Europe",
  "continent-oceania": "Engraving of an open atlas showing the outline of Oceania and Australia",
  "continent-world": "Engraving of an open atlas world map with a magnifying glass",
};

// Per-slug illustrations generated 2026-09-23 ("Etched Record" set). Falls
// back to the generic "tactic" / "country" art when a slug has none.
const TACTIC_ART_SLUGS = new Set([
  "access_ban", "credential_control", "outlet_licensing", "prior_restraint", "secrets_and_espionage_laws",
  "insult_and_defamation_laws", "surveillance_and_subpoenas", "funding_and_ownership_pressure",
  "expulsion_and_visa_denial", "shutdowns_and_blocking", "detention_and_violence", "lawsuits_against_press",
  "disinformation_labeling",
]);
// Continent slugs (per CONTINENTS in site.js) mapped to the art generated for
// them; north-america/south-america share the single "americas" image, and
// antarctica (no dedicated image) falls back to the generic world atlas.
const CONTINENT_ART_SLUG = {
  africa: "africa", asia: "asia", europe: "europe", oceania: "oceania",
  "north-america": "americas", "south-america": "americas", antarctica: "world",
};

// Illustration for a path: its og:image and, where the page shows one, the
// header art. Null where a page has none of its own.
export function artFor(path) {
  const p = path || "/";
  if (p === "/" || p === "/united-states") return "home-hero";
  if (/^\/incidents\/[^/]+(\/revisions)?$/.test(p)) return "incident";
  if (/^\/cases(\/|$)/.test(p)) return "case";
  if (/^\/(actors|leaders|journalists|outlets)(\/|$)/.test(p)) return "actor";
  let m = p.match(/^\/(?:tactics|ladders)\/([a-z_]+)/);
  if (m) return TACTIC_ART_SLUGS.has(m[1]) ? `tactic-${m[1]}` : "tactic";
  if (/^\/(tactics|ladders)(\/|$)/.test(p)) return "tactic";
  m = p.match(/^\/continents\/([a-z-]+)/);
  if (m) return CONTINENT_ART_SLUG[m[1]] ? `continent-${CONTINENT_ART_SLUG[m[1]]}` : "country";
  if (/^\/(countries|continents)(\/|$)/.test(p)) return "country";
  if (/^\/explainers(\/|$)/.test(p)) return "explainer";
  if (/^\/coverage(\/|$)/.test(p)) return "coverage";
  if (/^\/(eras|timeline)(\/|$)/.test(p)) return "era-timeline";
  return null;
}

// Pages whose header carries the illustration (entity and section pages;
// not search, lists of records, claims, sources or long-form reading).
function showsArt(path) {
  return /^\/(united-states|countries|continents|tactics|ladders|eras|timeline|coverage|cases|leaders|actors|outlets|journalists|explainers)(\/|$)/.test(path || "")
    && !/^\/(actors|outlets|journalists)$/.test(path);
}

export function artImg(name, { sizes = "100vw", eager = false, alt = null, cls = "" } = {}) {
  const base = `/assets/img/${name}`;
  return `<img${cls ? ` class="${cls}"` : ""} src="${base}-800.webp" srcset="${base}-800.webp 800w, ${base}-1600.webp 1600w" sizes="${sizes}" width="1600" height="900" alt="${escapeHtml(alt === null ? ART_ALT[name] || "" : alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`;
}

// Gate-bar mark (favicon and masthead), accent colour, no text.
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#B93A0A"/><g fill="#FBEDE6"><path d="M6.5 26V11.2L7.75 8l1.25 3.2V26z"/><path d="M12.5 26V11.2L13.75 8l1.25 3.2V26z"/><path d="M18.5 26V11.2L19.75 8l1.25 3.2V26z"/><path d="M24.5 26V11.2L25.75 8l1.25 3.2V26z"/><rect x="5" y="13.5" width="22" height="2.2" rx=".6"/><rect x="5" y="21" width="22" height="2.2" rx=".6"/></g></svg>`;

// ---------- page chrome ----------

const EYEBROWS = [
  [/^\/incidents\/[^/]+\/revisions$/, "Revision history"], [/^\/incidents$/, "The record"], [/^\/cases\/[^/]+/, "Court case"], [/^\/cases$/, "The record"],
  [/^\/actors\//, "Actor"], [/^\/leaders\//, "Head of government"], [/^\/outlets\//, "Outlet"], [/^\/journalists\//, "Journalist"],
  [/^\/countries\//, "Country"], [/^\/continents\//, "Continent"], [/^\/tactics\//, "Tactic"], [/^\/ladders\//, "Ladder"],
  [/^\/eras\//, "Era"], [/^\/(timeline|eras)/, "By time"], [/^\/(countries|continents)$/, "By place"], [/^\/(tactics|ladders)$/, "By tactic"],
  [/^\/glossary\//, "Glossary"], [/^\/claims\//, "Claim"], [/^\/sources\//, "Source"], [/^\/united-states$/, "Focal chapter"],
  [/^\/coverage/, "Reporting from elsewhere"], [/^\/(data|feeds|mcp)$/, "Data and tools"], [/^\/(changes|corrections)/, "The record"],
];

function eyebrowFor(doc) {
  if (doc.eyebrow !== undefined) return doc.eyebrow;
  for (const [re, label] of EYEBROWS) if (re.test(doc.path || "")) return label;
  return null;
}

function navHtml(currentPath) {
  const p = currentPath || "";
  return `<nav class="nav wrap" aria-label="Sections"><ul>${SECTIONS.map((s) => {
    const cur = (s.match || [s.path]).some((m) => p === m || p.startsWith(`${m}/`));
    return `<li>${a(s.path, s.label, cur ? { "aria-current": "page" } : {})}</li>`;
  }).join("")}</ul></nav>`;
}

function mastheadHtml(doc) {
  const q = doc.path === "/search" && doc.data && doc.data.filters && doc.data.filters.q ? doc.data.filters.q : "";
  return `<header class="masthead">
<div class="wrap masthead__row">
<div class="brand"><a href="/" aria-hidden="true" tabindex="-1" class="brand__mark">${MARK_SVG}</a><div><p class="brand__name"><a href="/">${escapeHtml(SITE_NAME)}</a></p><p class="brand__desc">${escapeHtml(MASTHEAD_DESCRIPTOR)}</p></div></div>
<form class="hsearch" action="/search" method="get" role="search"><label class="vh" for="site-q">Search the record</label><input id="site-q" type="search" name="q" value="${escapeHtml(q)}" placeholder="Search the record" maxlength="200"><button type="submit">Search</button></form>
</div>
${navHtml(doc.path)}
</header>`;
}

// Footer copy fixed by the v2 brief (2026-09-22, "Copy rules").
function footerHtml() {
  return `<footer class="site-footer"><div class="wrap">
<p class="pub">${escapeHtml(SITE_NAME)} is published by ${a("/about", PUBLISHER_NAME)}.</p>
<p class="lic">&copy; ${COPYRIGHT_YEAR} ${escapeHtml(PUBLISHER_NAME)}. Text and data are licensed ${a(LICENSE_URL, DATA_LICENSE)} unless noted; quotations remain the property of their sources.</p>
<ul>${FOOTER_LINKS.map((l) => `<li>${a(l.path, l.label)}</li>`).join("")}</ul>
</div></footer>`;
}

export function crumbsHtml(breadcrumbs) {
  if (!(breadcrumbs || []).length) return "";
  return `<nav class="crumbs" aria-label="Breadcrumb">${[{ name: "Home", path: "/" }, ...breadcrumbs].map((c) => a(c.path, c.name)).join('<span aria-hidden="true">/</span>')}</nav>`;
}

function pageHeadHtml(doc, title) {
  const art = doc.art !== undefined ? doc.art : showsArt(doc.path) ? artFor(doc.path) : null;
  const eyebrow = eyebrowFor(doc);
  return `<header class="page-head${art ? " has-art" : ""}"><div>
${crumbsHtml(doc.breadcrumbs)}${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ""}
<h1>${escapeHtml(title)}</h1>
${doc.subtitle ? `<p class="subtitle">${escapeHtml(doc.subtitle)}</p>` : ""}${doc.headExtra || ""}
</div>${art ? `<figure class="page-art">${artImg(art, { sizes: "(min-width: 960px) 34vw, 100vw", eager: true })}</figure>` : ""}</header>`;
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
  let main;
  if (doc.layout === "home" || doc.layout === "record") {
    main = doc.htmlBody(fn);
  } else {
    const body = doc.htmlBody ? doc.htmlBody(fn) : (doc.blocks || []).map((b) => blockToHtml(b, fn)).join("\n");
    main = `<article class="page${doc.layout === "reading" ? " reading" : ""}">
${pageHeadHtml(doc, title)}
${metaHtml(doc.meta)}
<div class="content">
${body}
</div>
${fn ? footnotesHtml(fn) : ""}
</article>`;
  }
  const og = artFor(doc.path) || "home-hero";
  const ogImage = `${SITE_ORIGIN}/assets/img/${og}-og.jpg`;
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
<link rel="preload" href="/assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter-tight-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css?v=${SITE_CSS_VERSION}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#F2F5F8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0B1320" media="(prefers-color-scheme: dark)">
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
<meta property="og:type" content="${doc.ogType || "website"}">
<meta property="og:title" content="${escapeHtml(isHome ? SITE_NAME : title)}">
<meta property="og:description" content="${escapeHtml(metaDescription)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeHtml(ART_ALT[og])}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${ogImage}">
<meta name="twitter:image:alt" content="${escapeHtml(ART_ALT[og])}">
${jsonld}
${gtag}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${mastheadHtml(doc)}
<main id="main" class="wrap">
${main}
</main>
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
