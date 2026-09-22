// Small dependency-free helpers shared across the Worker.

export function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function isoNow(d = new Date()) {
  return d.toISOString();
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

const INTERNAL_HOSTS = new Set(["rattlesnakesbymail.com", "www.rattlesnakesbymail.com"]);

// Builds an <a> tag. When href is absolute and its host is not this site,
// the link opens in a new tab (target="_blank") and gets rel="noopener",
// merged into any rel value already given in attrs (so rel="me" becomes
// rel="me noopener"). Relative hrefs, and absolute hrefs on this host, are
// left plain. mailto: and other non-http(s) schemes are always left plain.
export function a(href, text, attrs = {}) {
  const merged = { ...attrs };
  let external = false;
  if (/^https?:\/\//i.test(href)) {
    try {
      external = !INTERNAL_HOSTS.has(new URL(href).hostname);
    } catch {
      external = false;
    }
  }
  if (external) {
    merged.target = "_blank";
    const rel = new Set((merged.rel || "").split(/\s+/).filter(Boolean));
    rel.add("noopener");
    merged.rel = [...rel].join(" ");
  }
  const attrStr = Object.entries(merged)
    .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
    .join("");
  return `<a href="${escapeHtml(href)}"${attrStr}>${escapeHtml(text)}</a>`;
}

export function escapeXml(s) {
  return escapeHtml(s);
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
