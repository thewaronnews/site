// Cross-vendor field pages (P?, 2026-09-17): one page per distinct claim
// field, built only from published (status = 'current') claims. Where the
// entity page reads "everything about GPTBot", this file answers
// "everything about robots_txt_compliance, across every crawler" - the
// question an agent actually asks ("which crawlers obey robots.txt",
// "which publish IP ranges").
//
// New file only: this module does not import from routes.js and nothing
// in routes.js or index.js imports from here yet. An integrator wires
// /fields and /fields/<field> into the ROUTES table in index.js and calls
// listPaths() from sitemapXml. Suggested wiring (index.js, not made here):
//
//   import { handle as fieldsHandle, listPaths as fieldsListPaths } from "./fields.js";
//   ...
//   } else if (url.pathname === "/fields" || /^\/fields\/([a-z0-9_]+)(\.md|\.json)?$/.test(url.pathname)) {
//     const { format, basePath } = resolveFormat(request, url.pathname);
//     formatServed = format;
//     response = (await fieldsHandle(request, env, url, format, basePath))
//       || await respondDoc(notFoundDoc(basePath), format, request, 404, false);
//   }
//
// and, in sitemapXml(), append `for (const p of await fieldsListPaths(env)) entries.push({ loc: p, lastmod: null });`

import { listEntities, listAllCurrentClaims } from "./db.js";
import { renderHtml, renderMarkdown, buildAlternates, publisherOrg, authorPerson } from "./render.js";
import { contentTypeFor } from "./negotiate.js";
import { escapeHtml, isoNow, a, sha256Hex } from "./util.js";
import { SITE_ORIGIN, SITE_NAME } from "./site.js";

const FIELD_PATH_RE = /^\/fields\/([a-z0-9_]+)$/;

function link(href, text) {
  return { html: a(href, text), text };
}

function code(text) {
  return { html: `<code>${escapeHtml(text)}</code>`, text };
}

function wrapCell(cell) {
  if (cell && typeof cell === "object") return { ...cell, wrap: true };
  const text = cell === null || cell === undefined ? "" : String(cell);
  return { html: escapeHtml(text), text, wrap: true };
}

function fmtNum(n) {
  return n === null || n === undefined ? "0" : String(n);
}

// underscores to spaces only, nothing else: the label is exactly the
// field name reworded for reading, no invented meaning.
function fieldLabel(field) {
  return field.split("_").join(" ");
}

function fieldDescription(field) {
  return `Whether and how each crawler documents ${fieldLabel(field)}.`;
}

async function groupClaimsByField(env) {
  const claims = await listAllCurrentClaims(env, 5000);
  const byField = new Map();
  for (const c of claims) {
    if (!byField.has(c.field)) byField.set(c.field, []);
    byField.get(c.field).push(c);
  }
  return byField;
}

function fieldsIndexDoc(byField) {
  const fields = [...byField.keys()].sort();
  const rows = fields.map((f) => {
    const claims = byField.get(f);
    const entityCount = new Set(claims.map((c) => c.entity_id)).size;
    return [link(`/fields/${f}`, f), fmtNum(entityCount), fieldDescription(f)];
  });
  return {
    path: "/fields",
    title: "Fields",
    description: "Every claim field documented across crawlers, one page per field.",
    metaDescription: "Index of claim fields documented across AI crawlers, with the number of crawlers documented for each field.",
    updatedAt: isoNow(),
    jsonld: {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `${SITE_NAME} claim fields index`,
      description: "Every distinct claim field tracked across AI crawlers and AI search bots, cross-referenced by which entities document it.",
      url: `${SITE_ORIGIN}/fields`,
      creator: authorPerson(),
      publisher: publisherOrg(),
      isAccessibleForFree: true,
    },
    blocks: [
      { k: "p", text: "Each field below groups every current claim of that field across all documented crawlers on one page, so a question like which crawlers obey robots.txt or which crawlers publish IP ranges can be answered by field instead of by crawler." },
      fields.length
        ? { k: "table", headers: ["Field", "Crawlers documented", "Description"], rows }
        : { k: "p", text: "No claim fields are published yet." },
    ],
    data: {
      fields: fields.map((f) => ({
        field: f,
        label: fieldLabel(f),
        entities_documented: new Set(byField.get(f).map((c) => c.entity_id)).size,
        claims: byField.get(f).length,
      })),
    },
  };
}

async function fieldDetailDoc(env, field, claims) {
  const entities = await listEntities(env);
  const entitiesById = new Map(entities.map((e) => [e.id, e]));
  const matched = claims.filter((c) => entitiesById.has(c.entity_id));
  if (!matched.length) return null;

  const vendors = new Set(matched.map((c) => entitiesById.get(c.entity_id).vendor));
  const verifiedDates = matched.map((c) => c.verified_at).filter(Boolean).sort();
  const lastVerified = verifiedDates.length ? verifiedDates[verifiedDates.length - 1] : "unknown";
  const label = fieldLabel(field);

  const sorted = matched.slice().sort((a, b) => {
    const ea = entitiesById.get(a.entity_id);
    const eb = entitiesById.get(b.entity_id);
    return (ea.name || "").localeCompare(eb.name || "");
  });

  const documentedIds = new Set(matched.map((c) => c.entity_id));
  const notDocumented = entities.filter((e) => !documentedIds.has(e.id));
  const sources = [...new Set(matched.map((c) => c.evidence_url).filter(Boolean))];

  const openingText = `${label} across ${documentedIds.size} crawlers from ${vendors.size} vendors, from ${matched.length} claims, last verified ${lastVerified}.`;

  const blocks = [
    { k: "p", text: openingText },
    {
      k: "table",
      headers: ["Crawler", "Vendor", "Value", "Method", "Verified", "Claim"],
      rows: sorted.map((c) => {
        const e = entitiesById.get(c.entity_id);
        return [
          link(`/crawlers/${e.slug}`, e.name),
          e.vendor,
          c.value ? code(c.value) : wrapCell(c.statement || ""),
          c.method || "",
          c.verified_at || "",
          link(`/claims/${c.id}`, `claim ${c.id}`),
        ];
      }),
    },
    { k: "h2", text: "Not documented" },
    notDocumented.length
      ? {
          k: "table",
          headers: ["Crawler", "Vendor"],
          rows: notDocumented.map((e) => [link(`/crawlers/${e.slug}`, e.name), e.vendor]),
        }
      : { k: "p", text: "Every documented crawler has a claim for this field." },
    { k: "h2", text: "Sources" },
    sources.length
      ? { k: "table", headers: ["Source"], rows: sources.map((s) => [link(s, s)]) }
      : { k: "p", text: "No evidence URLs are recorded for this field yet." },
  ];

  return {
    path: `/fields/${field}`,
    title: `${label} across crawlers`,
    description: openingText,
    metaDescription: openingText,
    updatedAt: isoNow(),
    jsonld: {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `${field} - cross-vendor claim field`,
      description: `Every current claim for the "${field}" field, across every tracked AI crawler and AI search bot, with confidence and verification status.`,
      url: `${SITE_ORIGIN}/fields/${field}`,
      creator: authorPerson(),
      publisher: publisherOrg(),
      isAccessibleForFree: true,
    },
    blocks,
    data: {
      field,
      label,
      entities_documented: documentedIds.size,
      vendors_documented: vendors.size,
      claims: matched.length,
      last_verified: lastVerified,
      rows: sorted.map((c) => {
        const e = entitiesById.get(c.entity_id);
        return {
          entity_slug: e.slug,
          entity_name: e.name,
          vendor: e.vendor,
          value: c.value,
          statement: c.statement,
          method: c.method,
          verified_at: c.verified_at,
          confidence: c.confidence,
          claim_id: c.id,
        };
      }),
      not_documented: notDocumented.map((e) => ({ slug: e.slug, name: e.name, vendor: e.vendor })),
      sources,
    },
  };
}

// Renders a doc into a Response for the given format, matching the
// html/md/json content types, Link-alternate header, ETag/If-None-Match/304
// and Last-Modified behaviour that index.js's own respondDoc() and
// compare.js's respond() already provide for every other route. This is a
// local copy (not a shared module) per this session's brief: no
// respond.js, no changes to index.js.
async function respond(doc, format, request) {
  if (!doc) return null;
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
  const inm = request && request.headers.get("If-None-Match");
  if (inm && inm === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}

// handle(request, env, url, format, basePath): mirrors the shape of
// index.js's own per-route call, but flattened into one function (rather
// than index.js's {methods, test, fn(ctx)} route-table entry plus its
// separate respondDoc step) since this file owns its own response
// rendering. `format` and `basePath` are exactly what
// negotiate.js's resolveFormat(request, url.pathname) already produces,
// so the integrator computes them once in index.js and passes them in;
// `request` and `url` are passed through for parity with routes.js
// handlers even though this file does not currently need them beyond
// format/basePath. Returns a Response for a matched path, or null (never
// throws) for anything else, so the integrator falls back to its own
// notFoundDoc/respondDoc for a 404 exactly as it does for an unmatched
// route today.
export async function handle(request, env, url, format, basePath) {
  if (basePath === "/fields") {
    const byField = await groupClaimsByField(env);
    return respond(fieldsIndexDoc(byField), format, request);
  }
  const m = basePath.match(FIELD_PATH_RE);
  if (m) {
    const field = m[1];
    const byField = await groupClaimsByField(env);
    const claims = byField.get(field);
    if (!claims || !claims.length) return null;
    const doc = await fieldDetailDoc(env, field, claims);
    return respond(doc, format, request);
  }
  return null;
}

// listPaths(env): every base path this module serves, for the sitemap
// ("/fields" plus "/fields/<field>" for each distinct field among
// current claims). No .md/.json suffixes, matching how index.js's own
// sitemapXml lists every other page (e.g. "/crawlers/gptbot", not
// "/crawlers/gptbot.md").
export async function listPaths(env) {
  const byField = await groupClaimsByField(env);
  const fields = [...byField.keys()].sort();
  return ["/fields", ...fields.map((f) => `/fields/${f}`)];
}
