// /compare and /compare/<slugA>-vs-<slugB>: comparison pages generated
// only from published (status='current') claims. Reuses the same doc model
// and rendering helpers the rest of the site uses (render.js, negotiate.js,
// util.js) so headers, ETag, canonical link and format alternates match
// every other page. Does not touch any existing file; wired in separately.
//
// Exports:
//   handle(request, env, url, format, basePath) -> Response | null
//   listPaths(env) -> string[]  (every /compare... base path, for the sitemap)

import { listEntities, listClaimsForEntity } from "./db.js";
import { renderHtml, renderMarkdown, buildAlternates, publisherOrg, authorPerson } from "./render.js";
import { contentTypeFor } from "./negotiate.js";
import { escapeHtml, a, sha256Hex, isoNow } from "./util.js";
import { SITE_NAME, SITE_ORIGIN } from "./site.js";

const PAIR_RE = /^\/compare\/([a-z0-9-]+)-vs-([a-z0-9-]+)$/;

function link(href, text) {
  return { html: a(href, text), text };
}

function pairPath(slugA, slugB) {
  return `/compare/${slugA}-vs-${slugB}`;
}

// Loads every entity plus a field -> current-claim map for it.
async function loadEntities(env) {
  const entities = await listEntities(env);
  const out = [];
  for (const entity of entities) {
    const claims = await listClaimsForEntity(env, entity.id);
    const byField = new Map();
    for (const c of claims) byField.set(c.field, c);
    out.push({ entity, byField });
  }
  return out.sort((x, y) => x.entity.slug.localeCompare(y.entity.slug));
}

// Builds the comparison data for one ordered pair (a.slug < b.slug).
// Returns null when neither side has any current claims to compare.
function buildPair(a, b) {
  const fieldSet = new Set([...a.byField.keys(), ...b.byField.keys()]);
  const hasSharedField = [...fieldSet].some((f) => a.byField.has(f) && b.byField.has(f));
  if (!hasSharedField) return null;
  const fields = [...fieldSet].sort();
  const rows = [];
  const sources = new Set();
  let claimsCount = 0;
  let lastVerified = null;
  for (const field of fields) {
    const ca = a.byField.get(field) || null;
    const cb = b.byField.get(field) || null;
    if (ca) {
      claimsCount++;
      if (ca.evidence_url) sources.add(ca.evidence_url);
      if (ca.verified_at && (!lastVerified || ca.verified_at > lastVerified)) lastVerified = ca.verified_at;
    }
    if (cb) {
      claimsCount++;
      if (cb.evidence_url) sources.add(cb.evidence_url);
      if (cb.verified_at && (!lastVerified || cb.verified_at > lastVerified)) lastVerified = cb.verified_at;
    }
    const same = Boolean(ca && cb && String(ca.value).trim() === String(cb.value).trim());
    rows.push({ field, claimA: ca, claimB: cb, same });
  }
  return {
    entityA: a.entity,
    entityB: b.entity,
    rows,
    differences: rows.filter((r) => !r.same),
    sources: [...sources].sort(),
    fieldsDocumented: fields.length,
    claimsCount,
    lastVerified,
  };
}

async function buildAllPairs(env) {
  const list = await loadEntities(env);
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const pair = buildPair(list[i], list[j]);
      if (pair) pairs.push(pair);
    }
  }
  return pairs;
}

function valueCell(claim) {
  if (!claim) return "not documented";
  return link(`/claims/${claim.id}`, claim.value ?? "");
}

function comparisonIndexDoc(pairs) {
  const groups = new Map();
  for (const p of pairs) {
    const key = p.entityA.slug;
    if (!groups.has(key)) groups.set(key, { entity: p.entityA, pairs: [] });
    groups.get(key).pairs.push(p);
  }
  const blocks = [
    { k: "p", text: "This page lists every documented pair of crawlers and how many fields each pair can be compared on, from published claims." },
  ];
  for (const { entity, pairs: entityPairs } of [...groups.values()].sort((x, y) => x.entity.slug.localeCompare(y.entity.slug))) {
    blocks.push({ k: "h2", text: entity.name, html: `<h2>${a(`/crawlers/${entity.slug}`, entity.name)}</h2>` });
    blocks.push({
      k: "table",
      headers: ["Compared with", "Fields documented", "Claims", "Last verified"],
      rows: entityPairs.map((p) => [
        link(pairPath(p.entityA.slug, p.entityB.slug), p.entityB.name),
        String(p.fieldsDocumented),
        String(p.claimsCount),
        p.lastVerified || "",
      ]),
    });
  }
  const latest = pairs.reduce((m, p) => (p.lastVerified && (!m || p.lastVerified > m) ? p.lastVerified : m), null);
  return {
    path: "/compare",
    title: "Compare",
    metaDescription: "Compare pairs of documented AI crawlers field by field, sourced from published claims.",
    updatedAt: latest || isoNow(),
    jsonld: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Compare",
      url: `${SITE_ORIGIN}/compare`,
      isPartOf: { name: SITE_NAME, url: SITE_ORIGIN },
      mainEntity: {
        "@type": "ItemList",
        itemListElement: pairs.map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${SITE_ORIGIN}${pairPath(p.entityA.slug, p.entityB.slug)}`,
          name: `${p.entityA.name} vs ${p.entityB.name}`,
        })),
      },
      publisher: publisherOrg(),
      author: authorPerson(),
    },
    blocks,
    data: {
      pairs: pairs.map((p) => ({
        slug_a: p.entityA.slug,
        slug_b: p.entityB.slug,
        name_a: p.entityA.name,
        name_b: p.entityB.name,
        path: pairPath(p.entityA.slug, p.entityB.slug),
        fields_documented: p.fieldsDocumented,
        claims: p.claimsCount,
        last_verified: p.lastVerified,
      })),
    },
  };
}

function pairDetailDoc(pair) {
  const { entityA, entityB, rows, differences, sources, fieldsDocumented, claimsCount, lastVerified } = pair;
  const opening = `${entityA.name} and ${entityB.name} compared on ${fieldsDocumented} documented field${fieldsDocumented === 1 ? "" : "s"}, from ${claimsCount} claim${claimsCount === 1 ? "" : "s"}, last verified ${lastVerified || "unknown"}.`;
  const blocks = [
    {
      k: "table",
      headers: ["Field", entityA.name, entityB.name, "Comparison"],
      rows: rows.map((r) => [r.field, valueCell(r.claimA), valueCell(r.claimB), r.same ? "same" : "different"]),
    },
    { k: "h2", text: "Differences" },
    differences.length
      ? {
          k: "table",
          headers: ["Field", `${entityA.name} statement`, `${entityB.name} statement`],
          rows: differences.map((r) => [
            r.field,
            r.claimA ? link(`/claims/${r.claimA.id}`, r.claimA.statement || r.claimA.value || "") : "not documented",
            r.claimB ? link(`/claims/${r.claimB.id}`, r.claimB.statement || r.claimB.value || "") : "not documented",
          ]),
        }
      : { k: "p", text: "No differing fields between these two entities." },
    { k: "h2", text: "Sources" },
    sources.length
      ? { k: "ul", items: sources.map((u) => link(u, u)) }
      : { k: "p", text: "No evidence URLs recorded for these claims." },
  ];
  const path = pairPath(entityA.slug, entityB.slug);
  return {
    path,
    title: `${entityA.name} vs ${entityB.name}`,
    description: opening,
    metaDescription: opening,
    updatedAt: lastVerified || isoNow(),
    jsonld: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${entityA.name} vs ${entityB.name}`,
      url: `${SITE_ORIGIN}${path}`,
      isPartOf: { name: SITE_NAME, url: SITE_ORIGIN },
      mainEntity: {
        "@type": "ItemList",
        itemListElement: [
          { "@type": "ListItem", position: 1, url: `${SITE_ORIGIN}/crawlers/${entityA.slug}`, name: entityA.name },
          { "@type": "ListItem", position: 2, url: `${SITE_ORIGIN}/crawlers/${entityB.slug}`, name: entityB.name },
        ],
      },
      publisher: publisherOrg(),
      author: authorPerson(),
    },
    blocks,
    data: {
      entity_a: { slug: entityA.slug, name: entityA.name },
      entity_b: { slug: entityB.slug, name: entityB.name },
      fields_documented: fieldsDocumented,
      claims: claimsCount,
      last_verified: lastVerified,
      fields: rows.map((r) => ({
        field: r.field,
        value_a: r.claimA ? r.claimA.value : null,
        value_b: r.claimB ? r.claimB.value : null,
        claim_id_a: r.claimA ? r.claimA.id : null,
        claim_id_b: r.claimB ? r.claimB.id : null,
        same: r.same,
      })),
      differences: differences.map((r) => ({
        field: r.field,
        statement_a: r.claimA ? r.claimA.statement : null,
        statement_b: r.claimB ? r.claimB.statement : null,
        claim_id_a: r.claimA ? r.claimA.id : null,
        claim_id_b: r.claimB ? r.claimB.id : null,
      })),
      sources,
    },
  };
}

// Builds the final Response for a doc, matching index.js's respondDoc:
// same Content-Type, alternate Link header, ETag/304 and Cache-Control.
async function respond(doc, format, request, status = 200) {
  const alt = buildAlternates(doc.path);
  let body;
  if (format === "json") {
    body = JSON.stringify(doc.data ?? {}, null, 2);
  } else if (format === "md") {
    body = renderMarkdown(doc);
  } else {
    body = renderHtml(doc, alt, false);
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
  if (inm && inm === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { status, headers });
}

function suffixFor(format) {
  if (format === "json") return ".json";
  if (format === "md") return ".md";
  return "";
}

// handle(request, env, url, format, basePath): mirrors the (ctx) -> doc
// pattern used by routes.js/index.js, but takes the already-negotiated
// format and basePath directly (per this task's spec) so it can return a
// full Response itself rather than a bare doc. Returns null for any path
// outside /compare, so an integrator can fall through to its normal 404.
export async function handle(request, env, url, format, basePath) {
  if (basePath === "/compare") {
    const pairs = await buildAllPairs(env);
    return respond(comparisonIndexDoc(pairs), format, request);
  }

  const m = PAIR_RE.exec(basePath);
  if (!m) return null;

  // slugA-vs-slugB uses a literal "-vs-" separator; since either slug could
  // itself contain hyphens, resolve the split against real entity slugs
  // rather than trusting the regex's first hyphen groups.
  const rawTail = basePath.slice("/compare/".length);
  const vsIdx = rawTail.indexOf("-vs-");
  if (vsIdx === -1) return null;
  const slugA = rawTail.slice(0, vsIdx);
  const slugB = rawTail.slice(vsIdx + 4);
  if (!slugA || !slugB) return null;

  if (slugA > slugB) {
    const canonical = pairPath(slugB, slugA) + suffixFor(format);
    return new Response(null, { status: 301, headers: { Location: canonical } });
  }

  const list = await loadEntities(env);
  const a1 = list.find((e) => e.entity.slug === slugA);
  const b1 = list.find((e) => e.entity.slug === slugB);
  if (!a1 || !b1) return null;

  const pair = buildPair(a1, b1);
  if (!pair) {
    const goneBody = `${slugA} and ${slugB} no longer share a documented field. This comparison is gone.`;
    if (format === "json") {
      return new Response(JSON.stringify({ error: "gone", message: goneBody }, null, 2), {
        status: 410,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    if (format === "md") {
      return new Response(`# Gone\n\n${goneBody}\n`, {
        status: 410,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }
    return new Response(`<!doctype html><html><head><title>Gone</title></head><body><p>${escapeHtml(goneBody)}</p></body></html>`, {
      status: 410,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return respond(pairDetailDoc(pair), format, request);
}

// listPaths(env): every base path under /compare, for the sitemap.
export async function listPaths(env) {
  const pairs = await buildAllPairs(env);
  return ["/compare", ...pairs.map((p) => pairPath(p.entityA.slug, p.entityB.slug))];
}
