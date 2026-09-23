// Small dependency-free helpers shared across the Worker.

import { LINK_STATE_LABELS } from "./site.js";

export function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// UTC YYYY-MM-DDTHH:MM:SSZ (spec 2.1: *_at columns, no milliseconds).
export function isoNow(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function sha256Hex(input) {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Normalise a free-text question: lowercase, strip punctuation, collapse
// whitespace, very light stemming (drop trailing s/es on words > 4 chars).
export function normalizeQuestion(text) {
  let t = (text || "").toLowerCase();
  t = t.replace(/[^\p{L}\p{N}\s]/gu, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t
    .split(" ")
    .map((w) => (w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");
  return t;
}

export function termOverlapScore(a, b) {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let hits = 0;
  for (const w of setA) if (setB.has(w)) hits++;
  return hits / Math.max(setA.size, setB.size);
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function escapeXml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  }[c]));
}

export const INTERNAL_HOSTS = new Set(["thewaronnews.com", "www.thewaronnews.com"]);

export function isExternal(href) {
  if (!/^https?:\/\//i.test(href || "")) return false;
  try {
    return !INTERNAL_HOSTS.has(new URL(href).hostname);
  } catch {
    return false;
  }
}

function attrString(attrs) {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
    .join("");
}

// Builds an <a> tag. An absolute href on another host opens in a new tab
// with rel="noopener noreferrer" (merged into any rel already given).
// Relative hrefs and hrefs on this site are left plain.
export function a(href, text, attrs = {}) {
  const merged = { ...attrs };
  if (isExternal(href)) {
    merged.target = "_blank";
    const rel = new Set((merged.rel || "").split(/\s+/).filter(Boolean));
    rel.add("noopener");
    rel.add("noreferrer");
    merged.rel = [...rel].join(" ");
  }
  return `<a href="${escapeHtml(href)}"${attrString(merged)}>${escapeHtml(text)}</a>`;
}

// Same as a() but with pre-built inner HTML.
export function aHtml(href, innerHtml, attrs = {}) {
  const merged = { ...attrs };
  if (isExternal(href)) {
    merged.target = "_blank";
    merged.rel = "noopener noreferrer";
  }
  return `<a href="${escapeHtml(href)}"${attrString(merged)}>${innerHtml}</a>`;
}

// The only way an external source link is rendered (spec 3.3, v2 brief):
// the source, opening in a new tab, plus an "archived copy" link when a
// Wayback snapshot exists. Link states stay in the data and the .json
// twins; the page says nothing about them except, when the original no
// longer resolves, "original page no longer resolves; archived copy".
export function extLink(source, text) {
  if (!source) return "";
  const label = text || source.title || source.url;
  if (source.link_state === "dead") {
    const snap = source.wayback_url ? a(source.wayback_url, "archived copy") : "no archived copy is available";
    return `<span class="source__link">${escapeHtml(label)}</span> <small class="source__dead">(original page no longer resolves; ${snap})</small>`;
  }
  const href = source.link_state === "redirected" && source.final_url ? source.final_url : source.url;
  const archived = source.wayback_url ? ` <small class="claim-archived-link">${a(source.wayback_url, "archived copy")}</small>` : "";
  return `${a(href, label, { class: "source__link" })}${archived}`;
}

// Plain-text twin of extLink for the Markdown views.
export function extLinkMd(source) {
  if (!source) return "";
  const title = source.title || source.url;
  if (source.link_state === "dead") {
    return `${title}. ${source.url} (original page no longer resolves; ${source.wayback_url ? `archived copy: ${source.wayback_url}` : "no archived copy is available"})`;
  }
  const url = source.link_state === "redirected" && source.final_url ? source.final_url : source.url;
  return `${title}. ${url}${source.wayback_url ? ` Archived copy: ${source.wayback_url}` : ""}`;
}

export function linkStateLabel(state) {
  return LINK_STATE_LABELS[state] || state || "unchecked";
}

// data-state value for the .source badge in site.css.
export function linkStateAttr(source) {
  if (!source) return "unchecked";
  if (source.link_state === "dead") return "dead";
  return source.link_state || "unchecked";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "2026-09-19" -> "19 September 2026" (day-month-year, no ordinal, no
// comma, for a global reader; architect decision 2026-09-22). Honours
// precision. This is the site's own prose and the .md twin only: ISO dates
// in JSON stay untouched, and feeds.js builds RFC 822 / RFC 3339 dates
// independently of this function.
export function proseDate(iso, precision = "day") {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return String(iso);
  const y = m[1];
  const mo = m[2] ? MONTHS[parseInt(m[2], 10) - 1] : null;
  const d = m[3] ? parseInt(m[3], 10) : null;
  if (precision === "year" || !mo) return y;
  if (precision === "month") return `${mo} ${y}`;
  if (precision === "approximate") return `about ${mo} ${y}`;
  return d ? `${d} ${mo} ${y}` : `${mo} ${y}`;
}

// Partial ISO date for JSON-LD and timeline display, by precision.
export function partialIso(iso, precision = "day") {
  if (!iso) return null;
  if (precision === "year") return iso.slice(0, 4);
  if (precision === "month" || precision === "approximate") return iso.slice(0, 7);
  return iso.slice(0, 10);
}

export function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function slugOk(s) {
  return typeof s === "string" && s.length <= 80 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

export function wordCount(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

// Normalized URL for source upsert (spec 6): lowercase host, strip utm_*,
// fbclid, gclid and the fragment.
export function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    u.hostname = u.hostname.toLowerCase();
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(k) || k === "fbclid" || k === "gclid") u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return null;
  }
}

// ---------- Markdown ----------
// A small Markdown subset for policy pages and record prose: #/##/###
// headings, paragraphs, "- " lists, "> " blockquotes, [text](url), **bold**,
// *em*, `code`, and {c:ID} claim references, which the caller maps to
// footnote numbers. HTML in the source is escaped.

function inlineHtml(text, refFn) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const h = href.replace(/&amp;/g, "&");
    return aHtml(h, label);
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  out = out.replace(/\{c:(\d+)\}/g, (_m, id) => (refFn ? refFn(parseInt(id, 10), "html") : ""));
  return out;
}

function inlineText(text, refFn) {
  let out = String(text);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const abs = href.startsWith("/") ? `https://thewaronnews.com${href}` : href;
    return `[${label}](${abs})`;
  });
  out = out.replace(/\{c:(\d+)\}/g, (_m, id) => (refFn ? refFn(parseInt(id, 10), "md") : ""));
  return out;
}

export function splitParagraphs(md) {
  return String(md || "").replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export function mdToHtml(md, { refFn = null, headingOffset = 0, skipH1 = false } = {}) {
  const out = [];
  for (const block of splitParagraphs(md)) {
    const lines = block.split("\n");
    const h = block.match(/^(#{1,4})\s+(.*)$/);
    if (h && lines.length === 1) {
      const level = Math.min(6, h[1].length + headingOffset);
      if (skipH1 && h[1].length === 1) continue;
      // "## Contact {#contact}" sets the anchor explicitly (HTML only).
      const explicit = h[2].match(/^(.*?)\s*\{#([a-z0-9-]+)\}\s*$/);
      const text = explicit ? explicit[1] : h[2];
      const id = explicit ? explicit[2] : text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      out.push(`<h${level} id="${id}">${inlineHtml(text, refFn)}</h${level}>`);
      continue;
    }
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inlineHtml(l.replace(/^\s*[-*]\s+/, ""), refFn)}</li>`).join("")}</ul>`);
      continue;
    }
    if (lines.every((l) => /^>\s?/.test(l))) {
      out.push(`<blockquote><p>${inlineHtml(lines.map((l) => l.replace(/^>\s?/, "")).join(" "), refFn)}</p></blockquote>`);
      continue;
    }
    out.push(`<p>${inlineHtml(lines.join(" "), refFn)}</p>`);
  }
  return out.join("\n");
}

// Markdown twin of the same source: links made absolute, {c:ID} mapped.
export function mdToMd(md, { refFn = null, skipH1 = false } = {}) {
  const out = [];
  for (const block of splitParagraphs(md)) {
    if (skipH1 && /^#\s+/.test(block) && !block.includes("\n")) continue;
    out.push(inlineText(block, refFn));
  }
  return out.join("\n\n");
}

// Strip Markdown and claim refs to plain text (meta descriptions, feeds).
export function mdToPlain(md) {
  return String(md || "")
    .replace(/\{c:\d+\}/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(text, max = 160) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}\u2026`;
}
