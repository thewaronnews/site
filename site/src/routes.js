// Public page handlers. Each returns a doc (see render.js), a Response, or
// null (404). The same doc renders as HTML, Markdown and JSON.

import {
  a, escapeHtml, extLink, isoNow, isoDate, sha256Hex, normalizeQuestion, proseDate, mdToPlain, truncate,
  safeJsonParse, linkStateLabel,
} from "./util.js";
import {
  all, first, sourceObject, listIncidents, getIncidentFull, listActors, getActorFull, listOutlets, getOutletFull,
  listJournalists, getJournalistFull, listCases, getCaseFull, listNotes, countPublishedNotes, getNoteBySlug, noteWithSources,
  listGlossary, getGlossaryTerm, listExplainers, getExplainer, getClaim, attachSources, getSource, listSourceChecks,
  listChanges, listRevertedNotes, recordPathFor, searchRecords, upsertQuestion, getLastExport,
} from "./db.js";
import { Footnotes, linkCell } from "./render.js";
import {
  incidentLd, noteLd, actorLd, outletLd, journalistLd, caseLd, articleLd, definedTermLd, definedTermSetLd, datasetLd, websiteLd,
} from "./jsonld.js";
import {
  SITE_NAME, SITE_ORIGIN, SITE_SUBTITLE, HOME_DEFINITION, HOME_METHOD_LINE, HOME_DATA_LINE, INCIDENT_TYPE_LABELS,
  INCIDENT_STATUS_LABELS, CASE_STATUS_LABELS, LEVEL_LABELS, COUNTRY_NAMES, SUBDIVISION_NAMES, DATA_LICENSE, LICENSE_URL,
  ATTRIBUTION_TEXT, CONTACT_CORRECTIONS, DATA_REPO_DEFAULT,
} from "./site.js";
import { POLICY_PAGES, POLICY_VERSION } from "./content.js";
import { FEED_LIST } from "./feeds.js";
import { TOOLS, SUPPORTED_PROTOCOL_VERSIONS } from "./mcp.js";
import { hashIp } from "./logger.js";

const LICENSE = { name: DATA_LICENSE, url: LICENSE_URL };
const NEWS_PAGE_SIZE = 30;

function citeAs(title, path) {
  return `${title}. ${ATTRIBUTION_TEXT}. ${SITE_ORIGIN}${path}. Retrieved ${isoDate()}.`;
}

function placeLabel(jurisdiction, country) {
  const j = String(jurisdiction || "");
  const sub = SUBDIVISION_NAMES[j.split(":")[0]];
  const place = j.includes(":") ? j.split(":")[1].replace(/-/g, " ") : null;
  if (sub) return [place, sub, "United States"].filter(Boolean).join(", ");
  if (j === "US") return "United States (federal)";
  return COUNTRY_NAMES[country] || COUNTRY_NAMES[j] || j;
}

function incidentDate(r) {
  return proseDate(r.occurred_on, r.occurred_on_precision);
}

function incidentCard(r) {
  return {
    date: incidentDate(r),
    title: r.title,
    href: `/incidents/${r.slug}`,
    body: truncate(mdToPlain(r.summary), 240),
    meta: [INCIDENT_TYPE_LABELS[r.type], LEVEL_LABELS[r.level], `status: ${INCIDENT_STATUS_LABELS[r.status] || r.status}`].filter(Boolean).join(". "),
  };
}

function noteCard(n) {
  return { date: proseDate(String(n.published_at).slice(0, 10)), title: n.title, href: `/news/${n.slug}`, body: truncate(n.note, 240) };
}

// 410 for withdrawn records and reverted notes (spec 3.1): title, dates,
// reason, link to /corrections; the withdrawn text is not shown.
async function goneDoc(env, path, title, { publishedAt, withdrawnAt, reason }) {
  return {
    status: 410,
    path,
    title,
    noindex: true,
    blocks: [
      { k: "p", text: `This entry was withdrawn${withdrawnAt ? ` on ${String(withdrawnAt).slice(0, 10)}` : ""}. It was first published ${publishedAt ? String(publishedAt).slice(0, 10) : "on an unrecorded date"}.` },
      ...(reason ? [{ k: "p", text: `Reason: ${reason}` }] : []),
      { k: "html", html: `<p>The corrections policy and log are at ${a("/corrections", "/corrections")}.</p>`, text: `The corrections policy and log are at ${SITE_ORIGIN}/corrections.` },
    ],
    data: { status: "withdrawn", title, published_at: publishedAt || null, withdrawn_at: withdrawnAt || null, reason: reason || null, corrections: `${SITE_ORIGIN}/corrections` },
  };
}

async function withdrawnInfo(env, recordType, id) {
  return first(env, "SELECT changed_at, reason FROM changes WHERE kind = 'record_withdrawn' AND record_type = ? AND record_id = ? ORDER BY id DESC LIMIT 1", recordType, id);
}

export function notFoundDoc(path) {
  return {
    status: 404, path, title: "Not found", noindex: true,
    blocks: [{ k: "html", html: `<p>No page exists at this address. Start from ${a("/incidents", "the incident list")}, ${a("/timeline", "the timeline")} or ${a("/search", "search")}.</p>`, text: `No page exists at this address. Start from ${SITE_ORIGIN}/incidents, ${SITE_ORIGIN}/timeline or ${SITE_ORIGIN}/search.` }],
    data: { error: "not_found", path },
  };
}

export function methodNotAllowedDoc(path, allowed) {
  return { status: 405, path, title: "Method not allowed", noindex: true, blocks: [{ k: "p", text: `This address accepts ${allowed.join(", ")}.` }], data: { error: "method_not_allowed", allow: allowed } };
}

// ---------- home ----------

export async function homeHandler({ env }) {
  const notes = await listNotes(env, { limit: 5 });
  const incidents = await listIncidents(env, { limit: 5 });
  const counts = await first(env, `SELECT (SELECT COUNT(*) FROM incidents WHERE pub_state = 'published') AS incidents,
    (SELECT COUNT(*) FROM cases WHERE pub_state = 'published') AS cases,
    (SELECT COUNT(*) FROM claims WHERE status = 'current') AS claims,
    (SELECT COUNT(*) FROM sources) AS sources`);
  const blocks = [
    { k: "p", text: HOME_DEFINITION },
    { k: "p", text: HOME_METHOD_LINE },
    { k: "h2", text: "Latest from the News Desk" },
    { k: "cards", items: notes.map(noteCard), empty: "The News Desk has not published a note yet. Its first notes follow the editor's review of the first digest." },
    { k: "html", html: `<p>${a("/news", "All News Desk notes")}</p>`, text: `All News Desk notes: ${SITE_ORIGIN}/news` },
    { k: "h2", text: "Latest incidents" },
    { k: "cards", items: incidents.map(incidentCard), empty: "No incidents are published yet." },
    { k: "html", html: `<p>${a("/incidents", `All ${counts.incidents} incidents`)}, ${a("/timeline", "the timeline")} and ${a("/cases", "court cases")}.</p>`, text: `All ${counts.incidents} incidents: ${SITE_ORIGIN}/incidents. Timeline: ${SITE_ORIGIN}/timeline. Cases: ${SITE_ORIGIN}/cases.` },
    { k: "h2", text: "Data and tools" },
    { k: "p", text: HOME_DATA_LINE },
    { k: "feeds", items: [{ label: "datapackage.json", href: "/data/datapackage.json" }, { label: "MCP /mcp", href: "/mcp" }, { label: "llms.txt", href: "/llms.txt" }, { label: "Atom: News Desk", href: "/news/atom.xml" }, { label: "Atom: Incidents", href: "/incidents/atom.xml" }] },
  ];
  return {
    path: "/",
    title: SITE_NAME,
    subtitle: SITE_SUBTITLE,
    jsonld: websiteLd(),
    blocks,
    updatedAt: [incidents[0] && incidents[0].updated_at, notes[0] && notes[0].published_at].filter(Boolean).sort().pop() || null,
    data: {
      name: SITE_NAME, subtitle: SITE_SUBTITLE, definition: HOME_DEFINITION, counts,
      latest_notes: notes.map((n) => ({ slug: n.slug, title: n.title, published_at: n.published_at, url: `${SITE_ORIGIN}/news/${n.slug}` })),
      latest_incidents: incidents.map((i) => ({ slug: i.slug, title: i.title, occurred_on: i.occurred_on, type: i.type, status: i.status, url: `${SITE_ORIGIN}/incidents/${i.slug}` })),
      dataset: `${SITE_ORIGIN}/data`, mcp: `${SITE_ORIGIN}/mcp`, license: LICENSE,
    },
  };
}

// ---------- incidents ----------

export async function incidentsIndexHandler({ env, url }) {
  const f = {
    type: url.searchParams.get("type") || null,
    level: url.searchParams.get("level") || null,
    country: url.searchParams.get("country") || null,
    status: url.searchParams.get("status") || null,
  };
  const rows = await listIncidents(env, f);
  const all_ = await listIncidents(env, {});
  const facet = (key, labels) => [...new Set(all_.map((r) => r[key]))].sort().map((v) => a(`/incidents?${key}=${encodeURIComponent(v)}`, labels ? labels[v] || v : v)).join(" ");
  const active = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ");
  return {
    path: "/incidents",
    title: "Incidents",
    metaDescription: "Every recorded government action that limited journalists' ability to report, newest first, with type, level, country and status filters.",
    blocks: [
      { k: "p", text: `Each incident is a dated action by an official, government, regulator, court or legislature that limited journalists' ability to gather or publish news. ${rows.length} ${rows.length === 1 ? "incident matches" : "incidents match"}${active ? ` the filter ${active}` : ""}, newest first.` },
      { k: "html", html: `<p class="filters">Type: ${facet("type", INCIDENT_TYPE_LABELS)}<br>Level: ${facet("level", LEVEL_LABELS)}<br>Country: ${facet("country", COUNTRY_NAMES)}<br>Status: ${facet("status", INCIDENT_STATUS_LABELS)}${active ? `<br>${a("/incidents", "Clear filters")}` : ""}</p>`, text: "Filters: add ?type=, ?level=, ?country= or ?status= to the address." },
      {
        k: "table", headers: ["Date", "Incident", "Type", "Where", "Status"],
        rows: rows.map((r) => [incidentDate(r), linkCell(`/incidents/${r.slug}`, r.title), INCIDENT_TYPE_LABELS[r.type] || r.type, placeLabel(r.jurisdiction, r.country), INCIDENT_STATUS_LABELS[r.status] || r.status]),
      },
      { k: "feeds", items: FEED_LIST.filter((x) => x.href.startsWith("/incidents")) },
    ],
    updatedAt: rows.map((r) => r.updated_at).sort().pop() || null,
    data: {
      filter: f, count: rows.length,
      incidents: rows.map((r) => ({ ...r, url: `${SITE_ORIGIN}/incidents/${r.slug}` })),
      license: LICENSE,
    },
  };
}

function sourcesCount(full) {
  const ids = new Set((full.sources || []).map((s) => s.id));
  for (const c of full.claims || []) ids.add(c.source_id);
  return ids.size;
}

export async function incidentHandler({ env }, slug) {
  const full = await getIncidentFull(env, slug);
  if (!full) return null;
  const r = full.row;
  if (r.pub_state === "withdrawn") {
    const w = await withdrawnInfo(env, "incident", r.id);
    return goneDoc(env, `/incidents/${slug}`, r.title, { publishedAt: r.published_at, withdrawnAt: w && w.changed_at, reason: w && w.reason });
  }
  if (r.pub_state !== "published") return null;
  const fn = new Footnotes(full.claims);
  // Claims of linked records may be cited too.
  const refIds = [...`${r.summary} ${r.what_happened} ${r.stated_justification || ""} ${r.effect_on_reporting || ""}`.matchAll(/\{c:(\d+)\}/g)].map((m) => parseInt(m[1], 10));
  const missing = refIds.filter((id) => !fn.byId.has(id));
  if (missing.length) fn.add(await attachSources(env, await all(env, `SELECT * FROM claims WHERE id IN (${missing.map(() => "?").join(",")})`, ...missing)));

  const blocks = [{ k: "md", md: r.summary }];
  blocks.push({ k: "h2", text: "What happened" }, { k: "md", md: r.what_happened });
  if (r.stated_justification) blocks.push({ k: "h2", text: "What reason was given" }, { k: "md", md: r.stated_justification });
  if (r.effect_on_reporting) blocks.push({ k: "h2", text: "What changed for reporting" }, { k: "md", md: r.effect_on_reporting });
  const tl = [{ date: r.occurred_on, precision: r.occurred_on_precision, kind: "incident", label: r.title, incident_slug: null, case_slug: null, claim_id: null },
    ...full.events.map((e) => ({ date: e.occurred_on, precision: e.occurred_on_precision, kind: e.kind, label: e.label, incident_slug: null, case_slug: e.case_slug, claim_id: e.claim_id }))];
  blocks.push({ k: "h2", text: "Timeline" }, { k: "timeline", rows: tl });
  if (full.actors.length) {
    blocks.push({ k: "h2", text: "Who acted" }, {
      k: "table", headers: ["Name", "Role in this incident", "Office at the time"],
      rows: full.actors.map((x) => [linkCell(`/actors/${x.slug}`, x.name), x.role.replace(/_/g, " "), x.role_at_time || x.office || x.actor_role]),
    });
  }
  if (full.outlets.length || full.journalists.length) {
    blocks.push({ k: "h2", text: "Outlets and journalists" }, {
      k: "table", headers: ["Name", "Kind", "Relation"],
      rows: [
        ...full.outlets.map((o) => [linkCell(`/outlets/${o.slug}`, o.name), "outlet", o.relation]),
        ...full.journalists.map((j) => [linkCell(`/journalists/${j.slug}`, j.name), `journalist${j.outlet_name ? `, ${j.outlet_name}` : ""}`, j.relation]),
      ],
    });
  }
  if (full.cases.length) {
    blocks.push({ k: "h2", text: "Court cases" }, {
      k: "table", headers: ["Case", "Court", "Docket", "Status", "Relation"],
      rows: full.cases.map((c) => [linkCell(`/cases/${c.slug}`, c.caption), c.court, c.docket || "", CASE_STATUS_LABELS[c.status] || c.status, c.relation.replace(/_/g, " ")]),
    });
  }
  if (full.related.length) {
    blocks.push({ k: "h2", text: "Related incidents" }, { k: "ul", items: full.related.map((x) => linkCell(`/incidents/${x.slug}`, `${x.title} (${proseDate(x.occurred_on, x.occurred_on_precision)}, ${x.relation.replace(/_/g, " ")})`)) });
  }
  blocks.push({ k: "h2", text: "Sources" }, { k: "sources", sources: full.sources });
  const nSources = sourcesCount(full);
  const meta = { published: r.published_at, reviewed: r.reviewed_on, sources: nSources, status: r.status, statusAsOf: r.status_updated_on, unknowns: r.unknowns };
  const path = `/incidents/${slug}`;
  return {
    path,
    title: r.title,
    metaDescription: truncate(mdToPlain(r.summary), 160),
    ogType: "article",
    meta,
    footnotes: fn,
    breadcrumbs: [{ name: "Incidents", path: "/incidents" }],
    jsonld: incidentLd(full),
    blocks,
    updatedAt: r.updated_at,
    data: {
      ...r,
      external_ids: safeJsonParse(r.external_ids, {}),
      url: `${SITE_ORIGIN}${path}`,
      page_meta: meta,
      actors: full.actors.map((x) => ({ slug: x.slug, name: x.name, kind: x.kind, role: x.role, role_at_time: x.role_at_time, url: `${SITE_ORIGIN}/actors/${x.slug}` })),
      outlets: full.outlets.map((o) => ({ slug: o.slug, name: o.name, relation: o.relation, url: `${SITE_ORIGIN}/outlets/${o.slug}` })),
      journalists: full.journalists.map((j) => ({ slug: j.slug, name: j.name, outlet: j.outlet_slug, relation: j.relation, url: `${SITE_ORIGIN}/journalists/${j.slug}` })),
      cases: full.cases.map((c) => ({ slug: c.slug, caption: c.caption, court: c.court, docket: c.docket, status: c.status, relation: c.relation, url: `${SITE_ORIGIN}/cases/${c.slug}` })),
      related: full.related.map((x) => ({ slug: x.slug, title: x.title, relation: x.relation, url: `${SITE_ORIGIN}/incidents/${x.slug}` })),
      events: full.events,
      claims: full.claims.map((c) => ({ ...c, url: `${SITE_ORIGIN}/claims/${c.id}` })),
      sources: full.sources.map(sourceObject),
      revisions_url: `${SITE_ORIGIN}${path}/revisions`,
      license: LICENSE,
      cite_as: citeAs(r.title, path),
    },
  };
}

export async function revisionsHandler({ env }, table, type, slug) {
  const rec = await first(env, `SELECT id, pub_state, ${type === "case" ? "caption" : "title"} AS title FROM ${table} WHERE slug = ?`, slug);
  if (!rec || rec.pub_state !== "published") return null;
  const revs = await all(env, "SELECT revision, reason, is_correction, created_at FROM revisions WHERE record_type = ? AND record_id = ? ORDER BY revision", type, rec.id);
  const base = type === "case" ? "/cases/" : "/incidents/";
  return {
    path: `${base}${slug}/revisions`,
    title: `Revision history: ${rec.title}`,
    noindex: true,
    breadcrumbs: [{ name: type === "case" ? "Cases" : "Incidents", path: base.slice(0, -1) }, { name: rec.title, path: `${base}${slug}` }],
    blocks: [
      { k: "p", text: "Every change to this entry's text is kept as a numbered revision. Changes to individual facts are recorded as superseding claims, linked from each claim." },
      { k: "table", headers: ["Revision", "Date", "Reason", "Correction"], rows: revs.map((v) => [String(v.revision), v.created_at.slice(0, 10), v.reason, v.is_correction ? "yes" : "no"]) },
    ],
    data: { record_type: type, slug, revisions: revs },
  };
}

// ---------- actors / outlets / journalists ----------

export async function actorsIndexHandler({ env }) {
  const rows = await listActors(env);
  return {
    path: "/actors",
    title: "Actors",
    metaDescription: "Officials, offices, agencies, courts and legislatures named in the record, with the incidents in which each is named.",
    blocks: [
      { k: "p", text: "Officials and bodies named in the record. Each entry gives the role or office and the jurisdiction, and lists the incidents in which the actor is named. Entries carry no description or party label." },
      { k: "table", headers: ["Name", "Role or office", "Jurisdiction", "Incidents"], rows: rows.map((r) => [linkCell(`/actors/${r.slug}`, r.name), r.office || r.role, placeLabel(r.jurisdiction, r.country), String(r.incident_count)]) },
    ],
    updatedAt: rows.map((r) => r.updated_at).sort().pop() || null,
    data: { count: rows.length, actors: rows.map((r) => ({ ...r, url: `${SITE_ORIGIN}/actors/${r.slug}` })), license: LICENSE },
  };
}

function incidentsTable(incidents, roleKey, roleHeader) {
  return {
    k: "table", headers: ["Date", "Incident", roleHeader, "Status"],
    rows: incidents.map((i) => [incidentDate(i), linkCell(`/incidents/${i.slug}`, i.title), String(i[roleKey] || "").replace(/_/g, " "), INCIDENT_STATUS_LABELS[i.status] || i.status]),
  };
}

function claimsBlocks(claims) {
  if (!claims.length) return [];
  return [{ k: "h2", text: "Claims" }, { k: "ul", items: claims.map((c) => linkCell(`/claims/${c.id}`, `${c.statement} (checked ${String(c.verified_at).slice(0, 10)})`)) }];
}

export async function actorHandler({ env }, slug) {
  const full = await getActorFull(env, slug);
  if (!full) return null;
  const r = full.row;
  if (r.pub_state === "withdrawn") {
    const w = await withdrawnInfo(env, "actor", r.id);
    return goneDoc(env, `/actors/${slug}`, r.name, { publishedAt: r.published_at, withdrawnAt: w && w.changed_at, reason: w && w.reason });
  }
  if (r.pub_state !== "published") return null;
  const items = [["Kind", r.kind === "person" ? "person" : (r.body_type || "body").replace(/_/g, " ")], ["Role", r.role]];
  if (r.office) items.push(["Office", r.office]);
  items.push(["Jurisdiction", placeLabel(r.jurisdiction, r.country)]);
  if (r.term_start || r.term_end) items.push(["Term", `${r.term_start || "?"} to ${r.term_end || "present"}`]);
  if (r.official_url) items.push(["Official site", { html: a(r.official_url, r.official_url), text: r.official_url }]);
  if (r.wikidata_qid) items.push(["Wikidata", { html: a(`https://www.wikidata.org/wiki/${r.wikidata_qid}`, r.wikidata_qid), text: `https://www.wikidata.org/wiki/${r.wikidata_qid}` }]);
  const path = `/actors/${slug}`;
  const meta = { published: r.published_at, reviewed: r.reviewed_on, sources: new Set(full.claims.map((c) => c.source_id)).size, unknowns: r.unknowns };
  return {
    path, title: r.name, meta,
    metaDescription: `${r.name}: ${r.office || r.role}. Incidents in The War On News record in which ${r.name} is named.`,
    breadcrumbs: [{ name: "Actors", path: "/actors" }],
    jsonld: actorLd(r),
    blocks: [
      { k: "dl", items },
      { k: "h2", text: "Incidents" },
      full.incidents.length ? incidentsTable(full.incidents, "role", "Role") : { k: "p", text: "No published incident names this actor yet." },
      ...(full.cases.length ? [{ k: "h2", text: "Court cases" }, { k: "table", headers: ["Case", "Court", "Side"], rows: full.cases.map((c) => [linkCell(`/cases/${c.slug}`, c.caption), c.court, c.side]) }] : []),
      { k: "html", html: `<p>${a(`/timeline/actor/${slug}`, `Timeline for ${r.name}`)}</p>`, text: `Timeline: ${SITE_ORIGIN}/timeline/actor/${slug}` },
      ...claimsBlocks(full.claims),
    ],
    updatedAt: r.updated_at,
    data: { ...r, url: `${SITE_ORIGIN}${path}`, page_meta: meta, incidents: full.incidents.map((i) => ({ ...i, url: `${SITE_ORIGIN}/incidents/${i.slug}` })), cases: full.cases, claims: full.claims, license: LICENSE, cite_as: citeAs(r.name, path) },
  };
}

export async function outletsIndexHandler({ env }) {
  const rows = await listOutlets(env);
  return {
    path: "/outlets",
    title: "Outlets",
    metaDescription: "News organizations named in the record, with the incidents that affected each.",
    blocks: [
      { k: "p", text: "News organizations named in the record, with the incidents in which each is named." },
      { k: "table", headers: ["Outlet", "Kind", "Country", "Incidents"], rows: rows.map((r) => [linkCell(`/outlets/${r.slug}`, r.name), r.kind.replace(/_/g, " "), COUNTRY_NAMES[r.country] || r.country, String(r.incident_count)]) },
      { k: "html", html: `<p>${a("/journalists", "Journalists named in the record")}</p>`, text: `Journalists: ${SITE_ORIGIN}/journalists` },
    ],
    updatedAt: rows.map((r) => r.updated_at).sort().pop() || null,
    data: { count: rows.length, outlets: rows.map((r) => ({ ...r, url: `${SITE_ORIGIN}/outlets/${r.slug}` })), license: LICENSE },
  };
}

export async function outletHandler({ env }, slug) {
  const full = await getOutletFull(env, slug);
  if (!full) return null;
  const r = full.row;
  if (r.pub_state === "withdrawn") {
    const w = await withdrawnInfo(env, "outlet", r.id);
    return goneDoc(env, `/outlets/${slug}`, r.name, { publishedAt: r.published_at, withdrawnAt: w && w.changed_at, reason: w && w.reason });
  }
  if (r.pub_state !== "published") return null;
  const items = [["Kind", r.kind.replace(/_/g, " ")], ["Country", COUNTRY_NAMES[r.country] || r.country]];
  if (r.homepage_url) items.push(["Website", { html: a(r.homepage_url, r.homepage_url), text: r.homepage_url }]);
  const path = `/outlets/${slug}`;
  const meta = { published: r.published_at, reviewed: r.reviewed_on, sources: new Set(full.claims.map((c) => c.source_id)).size, unknowns: r.unknowns };
  return {
    path, title: r.name, meta,
    metaDescription: `${r.name}: incidents in The War On News record in which ${r.name} is named.`,
    breadcrumbs: [{ name: "Outlets", path: "/outlets" }],
    jsonld: outletLd(r),
    blocks: [
      { k: "dl", items },
      { k: "h2", text: "Incidents" },
      full.incidents.length ? incidentsTable(full.incidents, "relation", "Relation") : { k: "p", text: "No published incident names this outlet yet." },
      ...(full.journalists.length ? [{ k: "h2", text: "Journalists" }, { k: "ul", items: full.journalists.map((j) => linkCell(`/journalists/${j.slug}`, `${j.name}, ${j.role}`)) }] : []),
      ...claimsBlocks(full.claims),
    ],
    updatedAt: r.updated_at,
    data: { ...r, url: `${SITE_ORIGIN}${path}`, page_meta: meta, incidents: full.incidents, journalists: full.journalists, claims: full.claims, license: LICENSE, cite_as: citeAs(r.name, path) },
  };
}

export async function journalistsIndexHandler({ env }) {
  const rows = await listJournalists(env);
  return {
    path: "/journalists",
    title: "Journalists",
    metaDescription: "Journalists named in the record, with professional facts only.",
    blocks: [
      { k: "p", text: "Journalists named in the record. Entries hold professional facts only: name, outlet, role and the incidents in which each is named." },
      { k: "table", headers: ["Name", "Outlet", "Role"], rows: rows.map((r) => [linkCell(`/journalists/${r.slug}`, r.name), r.outlet_name || "", r.role]) },
    ],
    updatedAt: rows.map((r) => r.updated_at).sort().pop() || null,
    data: { count: rows.length, journalists: rows.map((r) => ({ ...r, url: `${SITE_ORIGIN}/journalists/${r.slug}` })), license: LICENSE },
  };
}

export async function journalistHandler({ env }, slug) {
  const full = await getJournalistFull(env, slug);
  if (!full) return null;
  const r = full.row;
  if (r.pub_state === "withdrawn") {
    const w = await withdrawnInfo(env, "journalist", r.id);
    return goneDoc(env, `/journalists/${slug}`, r.name, { publishedAt: r.published_at, withdrawnAt: w && w.changed_at, reason: w && w.reason });
  }
  if (r.pub_state !== "published") return null;
  const items = [["Role", r.role]];
  if (r.outlet_slug) items.push(["Outlet", linkCell(`/outlets/${r.outlet_slug}`, r.outlet_name)]);
  if (r.profile_url) items.push(["Profile", { html: a(r.profile_url, r.profile_url), text: r.profile_url }]);
  const path = `/journalists/${slug}`;
  const meta = { published: r.published_at, reviewed: r.reviewed_on, sources: new Set(full.claims.map((c) => c.source_id)).size };
  return {
    path, title: r.name, meta,
    metaDescription: `${r.name}, ${r.role}: incidents in The War On News record in which ${r.name} is named.`,
    breadcrumbs: [{ name: "Journalists", path: "/journalists" }],
    jsonld: journalistLd(r),
    blocks: [
      { k: "dl", items },
      { k: "h2", text: "Incidents" },
      full.incidents.length ? incidentsTable(full.incidents, "relation", "Relation") : { k: "p", text: "No published incident names this journalist yet." },
      ...claimsBlocks(full.claims),
    ],
    updatedAt: r.updated_at,
    data: { ...r, url: `${SITE_ORIGIN}${path}`, page_meta: meta, incidents: full.incidents, claims: full.claims, license: LICENSE },
  };
}

// ---------- cases ----------

export async function casesIndexHandler({ env }) {
  const rows = await listCases(env);
  return {
    path: "/cases",
    title: "Court cases",
    metaDescription: "Court cases connected to recorded incidents: caption, court, docket, dates and status.",
    blocks: [
      { k: "p", text: "Court cases that arise from recorded incidents or that later cases cite. Each entry gives the caption, court, docket number, dates and status, and quotes the holding where a court has ruled." },
      { k: "table", headers: ["Case", "Court", "Docket", "Filed", "Decided", "Status"], rows: rows.map((r) => [linkCell(`/cases/${r.slug}`, r.caption), r.court, r.docket || "", r.filed_on || "", r.decided_on || "", CASE_STATUS_LABELS[r.status] || r.status]) },
    ],
    updatedAt: rows.map((r) => r.updated_at).sort().pop() || null,
    data: { count: rows.length, cases: rows.map((r) => ({ ...r, url: `${SITE_ORIGIN}/cases/${r.slug}` })), license: LICENSE },
  };
}

export async function caseHandler({ env }, slug) {
  const full = await getCaseFull(env, slug);
  if (!full) return null;
  const r = full.row;
  if (r.pub_state === "withdrawn") {
    const w = await withdrawnInfo(env, "case", r.id);
    return goneDoc(env, `/cases/${slug}`, r.caption, { publishedAt: r.published_at, withdrawnAt: w && w.changed_at, reason: w && w.reason });
  }
  if (r.pub_state !== "published") return null;
  const fn = new Footnotes(full.claims);
  const refIds = [...String(r.holding || "").matchAll(/\{c:(\d+)\}/g)].map((m) => parseInt(m[1], 10)).filter((id) => !fn.byId.has(id));
  if (refIds.length) fn.add(await attachSources(env, await all(env, `SELECT * FROM claims WHERE id IN (${refIds.map(() => "?").join(",")})`, ...refIds)));
  const items = [["Caption", r.caption], ["Court", r.court], ["Court level", r.court_level]];
  if (r.docket) items.push(["Docket", r.docket]);
  if (r.reporter_citation) items.push(["Citation", r.reporter_citation]);
  if (r.filed_on) items.push(["Filed", r.filed_on]);
  if (r.decided_on) items.push(["Decided", r.decided_on]);
  if (r.judges) items.push(["Judges", r.judges]);
  items.push(["Status", CASE_STATUS_LABELS[r.status] || r.status]);
  if (r.courtlistener_url) items.push(["CourtListener", { html: a(r.courtlistener_url, r.courtlistener_url), text: r.courtlistener_url }]);
  const blocks = [{ k: "dl", items }];
  if (r.holding) blocks.push({ k: "h2", text: "What the court held" }, { k: "md", md: r.holding });
  if (full.parties.length) blocks.push({ k: "h2", text: "Parties" }, { k: "table", headers: ["Party", "Side"], rows: full.parties.map((p) => [p.slug ? linkCell(`/${p.party_type}s/${p.slug}`, p.name) : p.name, p.side]) });
  if (full.events.length) blocks.push({ k: "h2", text: "Timeline" }, { k: "timeline", rows: full.events.map((e) => ({ date: e.occurred_on, precision: e.occurred_on_precision, kind: e.kind, label: e.label, claim_id: e.claim_id })) });
  blocks.push({ k: "h2", text: "Incidents" }, full.incidents.length ? { k: "ul", items: full.incidents.map((i) => linkCell(`/incidents/${i.slug}`, `${i.title} (${i.relation.replace(/_/g, " ")})`)) } : { k: "p", text: "No published incident is linked yet." });
  blocks.push({ k: "h2", text: "Documents and reporting" }, { k: "sources", sources: full.documents });
  const path = `/cases/${slug}`;
  const meta = { published: r.published_at, reviewed: r.reviewed_on, sources: new Set([...full.documents.map((d) => d.id), ...full.claims.map((c) => c.source_id)]).size, unknowns: r.unknowns };
  return {
    path, title: r.caption, meta, footnotes: fn,
    subtitle: [r.court, r.docket ? `No. ${r.docket}` : null, r.filed_on ? `filed ${proseDate(r.filed_on)}` : r.decided_on ? `decided ${proseDate(r.decided_on)}` : null].filter(Boolean).join(", "),
    metaDescription: truncate(`${r.caption}, ${r.court}${r.docket ? `, No. ${r.docket}` : ""}. Status: ${CASE_STATUS_LABELS[r.status] || r.status}. ${mdToPlain(r.holding || "")}`, 160),
    breadcrumbs: [{ name: "Cases", path: "/cases" }],
    jsonld: caseLd(r),
    blocks,
    updatedAt: r.updated_at,
    data: {
      ...r, url: `${SITE_ORIGIN}${path}`, page_meta: meta, parties: full.parties,
      documents: full.documents.map((d) => ({ ...sourceObject(d), role: d.doc_role })), events: full.events,
      incidents: full.incidents.map((i) => ({ slug: i.slug, title: i.title, relation: i.relation, url: `${SITE_ORIGIN}/incidents/${i.slug}` })),
      claims: full.claims, revisions_url: `${SITE_ORIGIN}${path}/revisions`, license: LICENSE, cite_as: citeAs(r.caption, path),
    },
  };
}

// ---------- news desk ----------

export async function newsIndexHandler({ env }, page = 1) {
  const total = await countPublishedNotes(env);
  const pages = Math.max(1, Math.ceil(total / NEWS_PAGE_SIZE));
  if (page < 1 || page > pages) return null;
  const notes = await listNotes(env, { limit: NEWS_PAGE_SIZE, offset: (page - 1) * NEWS_PAGE_SIZE });
  const path = page === 1 ? "/news" : `/news/page/${page}`;
  const pager = pages > 1 ? `<nav class="pagination" aria-label="Pages">${Array.from({ length: pages }, (_, i) => i + 1).map((p) => (p === page ? `<span aria-current="page">${p}</span>` : a(p === 1 ? "/news" : `/news/page/${p}`, String(p)))).join("")}</nav>` : "";
  return {
    path,
    title: page === 1 ? "News Desk" : `News Desk, page ${page}`,
    metaDescription: "Short dated notes on new government actions that limit reporting, each naming and linking the outlet that reported it.",
    breadcrumbs: page === 1 ? [] : [{ name: "News Desk", path: "/news" }],
    blocks: [
      { k: "p", text: "Short dated notes on new government actions that limit reporting. Each note names the outlet that reported the story and links to it; the record entries and case pages carry the full sourcing." },
      { k: "cards", items: notes.map(noteCard), empty: "The News Desk has not published a note yet." },
      { k: "html", html: pager, text: pages > 1 ? `Pages: ${Array.from({ length: pages }, (_, i) => `${SITE_ORIGIN}${i === 0 ? "/news" : `/news/page/${i + 1}`}`).join(" ")}` : "" },
      { k: "feeds", items: FEED_LIST.filter((x) => x.href.startsWith("/news")) },
    ],
    updatedAt: notes[0] ? notes[0].published_at : null,
    data: { page, pages, total, notes: notes.map((n) => ({ id: n.id, slug: n.slug, title: n.title, note: n.note, story_date: n.story_date, published_at: n.published_at, url: `${SITE_ORIGIN}/news/${n.slug}` })) },
  };
}

export async function noteHandler({ env }, slug) {
  const n = await getNoteBySlug(env, slug);
  if (!n) return null;
  if (n.state === "reverted") return goneDoc(env, `/news/${slug}`, n.title, { publishedAt: n.published_at, withdrawnAt: n.reverted_at, reason: n.revert_reason });
  if (n.state !== "published") return null;
  const src = await noteWithSources(env, n);
  const path = `/news/${slug}`;
  const allSources = [src.primary, ...src.secondary].filter(Boolean);
  const meta = { published: n.published_at, reviewed: null, sources: allSources.length };
  const blocks = [
    { k: "html", html: `<div class="desk-note"><span class="desk-note__label">News Desk, ${escapeHtml(proseDate(String(n.published_at).slice(0, 10)))}</span><p>${escapeHtml(n.note)}</p></div>`, text: n.note },
  ];
  if (src.incident) blocks.push({ k: "html", html: `<p>Record entry: ${a(`/incidents/${src.incident.slug}`, src.incident.title)}</p>`, text: `Record entry: ${SITE_ORIGIN}/incidents/${src.incident.slug}` });
  blocks.push({ k: "h2", text: "Sources" }, { k: "sources", sources: allSources });
  const { jev_scores: _j, gates_passed: _g, run_id: _r, ...pub } = n;
  return {
    path, title: n.title, meta, ogType: "article",
    metaDescription: truncate(n.note, 160),
    breadcrumbs: [{ name: "News Desk", path: "/news" }],
    jsonld: noteLd(n, src, src.incident),
    blocks,
    updatedAt: n.published_at,
    data: { ...pub, secondary_source_ids: safeJsonParse(n.secondary_source_ids, []), url: `${SITE_ORIGIN}${path}`, primary_source: sourceObject(src.primary), secondary_sources: src.secondary.map(sourceObject), incident: src.incident ? { slug: src.incident.slug, title: src.incident.title, url: `${SITE_ORIGIN}/incidents/${src.incident.slug}` } : null, license: LICENSE },
  };
}

// ---------- glossary / explainers ----------

export async function glossaryIndexHandler({ env }) {
  const rows = await listGlossary(env);
  return {
    path: "/glossary",
    title: "Glossary",
    metaDescription: "Terms used in the record of government actions that limit reporting: credentials, press pools, prior restraint and more.",
    jsonld: definedTermSetLd(rows),
    blocks: [
      { k: "p", text: "Terms used in the record, with a definition and sources for each." },
      { k: "html", html: `<dl class="glossary">${rows.map((t) => `<dt id="${escapeHtml(t.slug)}">${a(`/glossary/${t.slug}`, t.term)}</dt><dd>${escapeHtml(t.definition)}</dd>`).join("")}</dl>`, text: rows.map((t) => `- **${t.term}**: ${t.definition} (${SITE_ORIGIN}/glossary/${t.slug})`).join("\n") },
    ],
    updatedAt: rows.map((r) => r.updated_at).sort().pop() || null,
    data: { count: rows.length, terms: rows.map((t) => ({ ...t, url: `${SITE_ORIGIN}/glossary/${t.slug}` })), license: LICENSE },
  };
}

export async function glossaryTermHandler({ env }, slug) {
  const full = await getGlossaryTerm(env, slug);
  if (!full) return null;
  const r = full.row;
  if (r.pub_state === "withdrawn") return goneDoc(env, `/glossary/${slug}`, r.term, { publishedAt: r.published_at });
  if (r.pub_state !== "published") return null;
  const seeAlso = safeJsonParse(r.see_also, []) || [];
  const path = `/glossary/${slug}`;
  const meta = { published: r.published_at, reviewed: r.reviewed_on, sources: full.sources.length };
  return {
    path, title: r.term, meta,
    metaDescription: truncate(r.definition, 160),
    breadcrumbs: [{ name: "Glossary", path: "/glossary" }],
    jsonld: definedTermLd(r),
    blocks: [
      { k: "md", md: r.definition },
      ...(r.body_md ? [{ k: "md", md: r.body_md }] : []),
      ...(seeAlso.length ? [{ k: "h2", text: "See also" }, { k: "ul", items: seeAlso.map((s) => linkCell(`/glossary/${s}`, s.replace(/-/g, " "))) }] : []),
      { k: "h2", text: "Sources" }, { k: "sources", sources: full.sources },
    ],
    updatedAt: r.updated_at,
    data: { ...r, see_also: seeAlso, url: `${SITE_ORIGIN}${path}`, page_meta: meta, sources: full.sources.map(sourceObject), license: LICENSE },
  };
}

export async function explainersIndexHandler({ env }) {
  const rows = await listExplainers(env);
  return {
    path: "/explainers",
    title: "Explainers",
    metaDescription: "Explainers on the rules, institutions and cases behind government actions that limit reporting.",
    blocks: [{ k: "cards", items: rows.map((r) => ({ date: r.published_at ? String(r.published_at).slice(0, 10) : "", title: r.title, href: `/explainers/${r.slug}`, body: r.dek })), empty: "No explainers are published yet." }],
    data: { count: rows.length, explainers: rows },
  };
}

export async function explainerHandler({ env }, slug) {
  const full = await getExplainer(env, slug);
  if (!full) return null;
  const r = full.row;
  if (r.pub_state === "withdrawn") return goneDoc(env, `/explainers/${slug}`, r.title, { publishedAt: r.published_at });
  if (r.pub_state !== "published") return null;
  const path = `/explainers/${slug}`;
  const meta = { published: r.published_at, reviewed: r.reviewed_on, sources: full.sources.length, unknowns: r.unknowns };
  return {
    path, title: r.title, subtitle: r.dek, meta, ogType: "article",
    metaDescription: truncate(r.dek, 160),
    breadcrumbs: [{ name: "Explainers", path: "/explainers" }],
    jsonld: articleLd({ title: r.title, path, published: r.published_at, modified: r.updated_at, citations: full.sources }),
    blocks: [{ k: "md", md: r.body_md, skipH1: true }, { k: "h2", text: "Sources" }, { k: "sources", sources: full.sources }],
    updatedAt: r.updated_at,
    data: { ...r, url: `${SITE_ORIGIN}${path}`, page_meta: meta, sources: full.sources.map(sourceObject), license: LICENSE },
  };
}

// ---------- claims / sources ----------

export async function claimHandler({ env }, id) {
  const c = await getClaim(env, id);
  if (!c) return null;
  const subjPath = c.subject_type === "event" ? null : await recordPathFor(env, c.subject_type, c.subject_id);
  const src = await getSource(env, c.source_id);
  const items = [
    ["Statement", c.statement],
    ["Field", c.field],
    ["Value", c.value ?? ""],
    ["About", subjPath ? linkCell(subjPath, `${c.subject_type} ${subjPath.split("/").pop()}`) : `${c.subject_type} ${c.subject_id}`],
  ];
  if (c.attribution) items.push(["Attribution", c.attribution]);
  items.push(["Source", { html: extLink(src), text: `${src.title}. ${src.url}` }], ["Publisher", src.publisher], ["Link state", linkStateLabel(src.link_state)]);
  items.push(["Method", c.method.replace(/_/g, " ")], ["Checked", String(c.verified_at).slice(0, 10)], ["Confidence", c.confidence], ["Status", c.status]);
  if (c.evidence_date) items.push(["Source date", c.evidence_date]);
  if (c.supersedes_id) items.push(["Supersedes", linkCell(`/claims/${c.supersedes_id}`, `Claim ${c.supersedes_id}`)]);
  if (c.superseded_by) items.push(["Superseded by", linkCell(`/claims/${c.superseded_by}`, `Claim ${c.superseded_by}`)]);
  if (c.supersede_reason) items.push(["Reason", c.supersede_reason]);
  const blocks = [{ k: "dl", items }];
  if (c.evidence_quote) blocks.push({ k: "h2", text: "Quotation from the source" }, { k: "html", html: `<blockquote class="claim-quote">${escapeHtml(c.evidence_quote)}</blockquote>`, text: `> ${c.evidence_quote}` });
  if (c.status === "superseded") blocks.unshift({ k: "notice", text: `This claim was superseded by claim ${c.superseded_by} (${c.supersede_reason || "update"}). It stays here so the history can be checked.` });
  return {
    path: `/claims/${id}`,
    title: `Claim ${id}`,
    subtitle: c.statement,
    metaDescription: truncate(c.statement, 160),
    meta: { published: c.created_at, reviewed: String(c.verified_at).slice(0, 10), sources: 1 },
    breadcrumbs: subjPath ? [{ name: subjPath.split("/")[1], path: `/${subjPath.split("/")[1]}` }, { name: subjPath.split("/").pop(), path: subjPath }] : [],
    blocks,
    updatedAt: c.created_at,
    data: { ...c, url: `${SITE_ORIGIN}/claims/${id}`, subject_url: subjPath ? `${SITE_ORIGIN}${subjPath}` : null, source: sourceObject(src), license: LICENSE },
  };
}

export async function sourceHandler({ env }, id) {
  const s = await getSource(env, id);
  if (!s) return null;
  const checks = await listSourceChecks(env, id);
  const claims = await all(env, "SELECT id, statement, status FROM claims WHERE source_id = ? ORDER BY id", id);
  const incidents = await all(env, "SELECT i.slug, i.title FROM incident_sources ins JOIN incidents i ON i.id = ins.incident_id WHERE ins.source_id = ? AND i.pub_state = 'published'", id);
  return {
    path: `/sources/${id}`,
    title: s.title,
    noindex: true,
    subtitle: `${s.publisher}${s.published_on ? `, ${s.published_on}` : ""}`,
    blocks: [
      { k: "dl", items: [["Address", { html: extLink(s, s.url), text: s.url }], ["Kind", s.source_kind.replace(/_/g, " ")], ["Link state", linkStateLabel(s.link_state)], ["State since", s.link_state_since || ""], ["Last checked", s.last_checked || "not yet"], ["Archived copy", s.wayback_url ? { html: a(s.wayback_url, s.wayback_url), text: s.wayback_url } : `none yet (${s.archive_attempts} attempts)`]] },
      { k: "h2", text: "Cited by" },
      { k: "ul", items: [...incidents.map((i) => linkCell(`/incidents/${i.slug}`, i.title)), ...claims.map((c) => linkCell(`/claims/${c.id}`, `Claim ${c.id}: ${c.statement}`))] },
      { k: "h2", text: "Check history" },
      checks.length ? { k: "table", headers: ["Checked", "Checker", "HTTP", "Observed"], rows: checks.map((c) => [c.checked_at, c.checker, String(c.http_status ?? ""), c.observed_state]) } : { k: "p", text: "No checks are recorded yet." },
    ],
    data: { ...sourceObject(s), source_kind: s.source_kind, last_checked: s.last_checked, archive_attempts: s.archive_attempts, checks, claims, incidents },
  };
}

// ---------- changes / corrections ----------

async function changeRows(env, rows) {
  const out = [];
  for (const c of rows) {
    const path = c.claim_id ? `/claims/${c.claim_id}` : await recordPathFor(env, c.record_type, c.record_id);
    out.push({ ...c, path });
  }
  return out;
}

export async function changesHandler({ env }) {
  const rows = await changeRows(env, await listChanges(env, { limit: 300 }));
  return {
    path: "/changes",
    title: "Changes",
    metaDescription: "The public ledger: every new, superseded, disputed and retired claim, publication, revision, withdrawal and reverted note.",
    blocks: [
      { k: "p", text: "Every change to the record, newest first. Claims are never edited: a change adds a claim that supersedes the old one, and both stay addressable." },
      { k: "feeds", items: [{ label: "Changes (Atom)", href: "/changes.xml" }] },
      { k: "table", headers: ["When", "Change", "Record", "Reason"], rows: rows.map((c) => [c.changed_at.slice(0, 10), `${c.kind.replace(/_/g, " ")}${c.is_correction ? " (correction)" : ""}`, c.path ? linkCell(c.path, c.path) : "", c.reason || ""]) },
    ],
    updatedAt: rows[0] ? rows[0].changed_at : null,
    data: { count: rows.length, changes: rows.map((c) => ({ ...c, url: c.path ? `${SITE_ORIGIN}${c.path}` : null })) },
  };
}

async function correctionLogBlocks(env) {
  const rows = await changeRows(env, await listChanges(env, { limit: 500, correctionsOnly: true }));
  const reverted = await listRevertedNotes(env);
  return {
    rows, reverted,
    blocks: [
      { k: "h2", text: "Correction log", id: "log" },
      rows.length || reverted.length
        ? { k: "table", headers: ["Date", "Change", "Page", "What changed"], rows: [
          ...rows.map((c) => [c.changed_at.slice(0, 10), c.kind.replace(/_/g, " "), c.path ? linkCell(c.path, c.path) : "", c.reason || ""]),
          ...reverted.map((n) => [String(n.reverted_at).slice(0, 10), "news desk note reverted", linkCell(`/news/${n.slug}`, n.title), n.revert_reason]),
        ] }
        : { k: "p", text: "No corrections have been published." },
    ],
  };
}

function submitFormBlock(kind = "correction") {
  return {
    k: "html",
    html: `<form method="post" action="/submit">
<input type="hidden" name="kind" value="${kind}">
<label for="target">Page address or claim number (optional)</label>
<input type="text" id="target" name="target" maxlength="300">
<label for="body">What is wrong, and what the record shows instead</label>
<textarea id="body" name="body" rows="5" maxlength="2000" required></textarea>
<label for="source_url">Link to a source (optional)</label>
<input type="url" id="source_url" name="source_url" maxlength="500">
<label for="author_claim">Who you are (optional)</label>
<input type="text" id="author_claim" name="author_claim" maxlength="200">
<button type="submit">Send for review</button>
</form>`,
    text: `To request a correction, email ${CONTACT_CORRECTIONS}, POST a form to ${SITE_ORIGIN}/submit (fields: kind, target, body, source_url, author_claim), or call the suggest_correction tool at ${SITE_ORIGIN}/mcp.`,
  };
}

function policyTitle(md) {
  const m = String(md).match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}

export async function policyHandler(ctx, slug, extraBlocks = []) {
  const md = POLICY_PAGES[slug];
  if (!md) return null;
  const title = policyTitle(md);
  const path = `/${slug}`;
  return {
    path, title,
    metaDescription: truncate(mdToPlain(md.replace(/^#.*$/m, "")), 160),
    blocks: [{ k: "md", md, skipH1: true }, ...extraBlocks],
    data: { slug, title, markdown: md, version: POLICY_VERSION, url: `${SITE_ORIGIN}${path}`, license: LICENSE },
  };
}

export async function correctionsHandler(ctx) {
  const { blocks, rows, reverted } = await correctionLogBlocks(ctx.env);
  const submitted = ctx.url.searchParams.get("submitted") === "1";
  const doc = await policyHandler(ctx, "corrections", [
    ...(submitted ? [{ k: "notice", text: "Thank you. The request is stored as pending and an editor will review it." }] : []),
    ...blocks,
    { k: "h2", text: "Request a correction" },
    submitFormBlock("correction"),
  ]);
  doc.data.log = rows.map((c) => ({ changed_at: c.changed_at, kind: c.kind, url: c.path ? `${SITE_ORIGIN}${c.path}` : null, reason: c.reason }));
  doc.data.reverted_notes = reverted;
  return doc;
}

export async function correctionsLogHandler({ env }) {
  const { blocks, rows, reverted } = await correctionLogBlocks(env);
  return {
    path: "/corrections/log",
    title: "Correction log",
    breadcrumbs: [{ name: "Corrections", path: "/corrections" }],
    blocks: [{ k: "html", html: `<p>Corrections and reverted News Desk notes, newest first, under the ${a("/corrections", "corrections policy")}.</p>`, text: `Corrections and reverted News Desk notes under the corrections policy (${SITE_ORIGIN}/corrections).` }, ...blocks.slice(1)],
    data: { log: rows, reverted_notes: reverted },
  };
}

// ---------- data / feeds / mcp docs ----------

export async function dataHandler({ env }) {
  const last = await getLastExport(env);
  const counts = last ? safeJsonParse(last.row_counts, {}) : {};
  const repo = env.DATA_REPO || DATA_REPO_DEFAULT;
  const tables = Object.keys(counts).length ? Object.entries(counts) : [];
  return {
    path: "/data",
    title: "Data",
    metaDescription: "The whole record as a nightly Frictionless Data Package (CSV and JSON with table schemas) under CC BY 4.0.",
    jsonld: datasetLd(last),
    blocks: [
      { k: "p", text: `The whole record is exported every night as a Frictionless Data Package: one CSV and one JSON file per table, with a Table Schema for each (types, allowed values, keys). The licence is ${DATA_LICENSE}; credit "${ATTRIBUTION_TEXT}".` },
      { k: "download", title: "Latest export", meta: last ? `Version ${last.datapackage_version || ""}, generated ${last.ts}.` : "The first export has not run yet.", links: [{ label: "datapackage.json", href: "/data/datapackage.json" }, { label: "incidents.csv", href: "/data/data/incidents.csv" }, { label: "claims.csv", href: "/data/data/claims.csv" }, { label: "incidents.json", href: "/data/json/incidents.json" }, { label: "README", href: "/data/README.md" }] },
      { k: "h2", text: "Tables" },
      tables.length ? { k: "table", headers: ["Table", "Rows", "CSV", "JSON"], rows: tables.map(([t, n]) => [t, String(n), linkCell(`/data/data/${t}.csv`, `${t}.csv`), linkCell(`/data/json/${t}.json`, `${t}.json`)]) } : { k: "p", text: "Row counts appear after the first export." },
      { k: "h2", text: "Other ways in" },
      { k: "ul", items: [
        { html: `Every page as Markdown or JSON: add ${escapeHtml(".md")} or ${escapeHtml(".json")} to its address, or send an Accept header.`, text: "Every page as Markdown or JSON: add .md or .json to its address, or send an Accept header." },
        linkCell("/mcp", "MCP server at /mcp (Streamable HTTP)"),
        linkCell("/feeds", "RSS, Atom and JSON Feed"),
        linkCell(repo, `GitHub repository ${repo.replace("https://github.com/", "")}`),
        { html: `Dated snapshots: /data/YYYY-MM-DD/datapackage.json`, text: `Dated snapshots: ${SITE_ORIGIN}/data/YYYY-MM-DD/datapackage.json` },
      ] },
    ],
    updatedAt: last ? last.ts : null,
    data: { last_export: last ? { ...last, row_counts: counts } : null, datapackage: `${SITE_ORIGIN}/data/datapackage.json`, repository: repo, license: LICENSE, attribution: ATTRIBUTION_TEXT },
  };
}

export async function feedsHandler() {
  return {
    path: "/feeds",
    title: "Feeds",
    metaDescription: "RSS, Atom and JSON Feed for the News Desk and the incident record, plus the change ledger.",
    blocks: [
      { k: "p", text: "Subscribe to the News Desk or to new and revised incident entries. Each feed carries the latest 50 items." },
      { k: "table", headers: ["Feed", "Address"], rows: FEED_LIST.map((f) => [f.label, linkCell(f.href, `${SITE_ORIGIN}${f.href}`)]) },
    ],
    data: { feeds: FEED_LIST.map((f) => ({ ...f, url: `${SITE_ORIGIN}${f.href}` })) },
  };
}

export async function mcpDocHandler() {
  return {
    path: "/mcp",
    title: "MCP server",
    metaDescription: "A public Model Context Protocol server for searching and fetching incidents, timelines, actors, cases and News Desk notes.",
    blocks: [
      { k: "p", text: `The War On News runs a public Model Context Protocol server at ${SITE_ORIGIN}/mcp (Streamable HTTP, JSON-RPC 2.0 over POST, no SSE). Read tools return the Markdown twin as content and the JSON twin as structuredContent. The one write tool, suggest_correction, needs a client token from the publisher and stores a pending request for review.` },
      { k: "dl", items: [["Endpoint", `${SITE_ORIGIN}/mcp`], ["Transport", "Streamable HTTP (POST)"], ["Protocol versions", SUPPORTED_PROTOCOL_VERSIONS.join(", ")], ["Server name", "com.thewaronnews/thewaronnews"], ["Manifest", linkCell("/.well-known/mcp/server.json", `${SITE_ORIGIN}/.well-known/mcp/server.json`)]] },
      { k: "h2", text: "Tools" },
      { k: "table", headers: ["Tool", "What it does", "Arguments"], rows: TOOLS.map((t) => [t.name, t.description, Object.keys(t.inputSchema.properties || {}).join(", ")]) },
      { k: "h2", text: "Example" },
      { k: "html", html: `<pre><code>curl -s ${SITE_ORIGIN}/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_incidents","arguments":{"query":"White House"}}}'</code></pre>`, text: `curl -s ${SITE_ORIGIN}/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_incidents","arguments":{"query":"White House"}}}'` },
    ],
    data: { endpoint: `${SITE_ORIGIN}/mcp`, transport: "streamable-http", protocol_versions: SUPPORTED_PROTOCOL_VERSIONS, tools: TOOLS },
  };
}

// ---------- search / submit ----------

export async function searchHandler({ env, request, url }) {
  let q = url.searchParams.get("q") || "";
  if (request.method === "POST") {
    const ct = request.headers.get("Content-Type") || "";
    if (ct.includes("application/json")) q = (await request.json().catch(() => ({}))).q || q;
    else {
      const form = await request.formData().catch(() => null);
      if (form) q = form.get("q") || q;
    }
  }
  q = String(q).slice(0, 300);
  let results = [];
  if (q.trim()) {
    results = await searchRecords(env, q);
    const ua = request.headers.get("User-Agent") || "";
    if (!ua.startsWith("twon-")) {
      const norm = normalizeQuestion(q);
      try {
        await upsertQuestion(env, { textRaw: q, textNorm: norm, hash: await sha256Hex(norm), source: "search", ts: isoNow(), resultCount: results.length });
      } catch {
        // logging never breaks search
      }
    }
  }
  return {
    path: "/search",
    title: q ? `Search: ${q}` : "Search",
    noindex: !!q,
    metaDescription: "Search incidents, cases, actors and glossary terms.",
    blocks: [
      { k: "html", html: `<form method="get" action="/search" role="search"><label for="q">Search the record</label><input type="search" id="q" name="q" value="${escapeHtml(q)}" maxlength="300"><button type="submit">Search</button></form>`, text: `Search: ${SITE_ORIGIN}/search?q=<terms>` },
      ...(q ? [{ k: "h2", text: `${results.length} ${results.length === 1 ? "result" : "results"}` }, { k: "table", headers: ["Result", "Kind", "Excerpt"], rows: results.map((r) => [linkCell(r.path, r.title), r.record_type.replace(/_/g, " "), r.snippet]) }] : []),
    ],
    data: { q, count: results.length, results: results.map((r) => ({ ...r, url: `${SITE_ORIGIN}${r.path}` })) },
  };
}

const SUBMIT_DAILY_LIMIT = 20;

export async function submitHandler({ env, request }) {
  const ct = request.headers.get("Content-Type") || "";
  let f = {};
  if (ct.includes("application/json")) f = await request.json().catch(() => ({}));
  else {
    const form = await request.formData().catch(() => null);
    if (form) for (const [k, v] of form.entries()) f[k] = String(v);
  }
  const kind = f.kind === "tip" ? "tip" : "correction";
  const body = String(f.body || "").trim().slice(0, 2000);
  const plain = (msg, status) => new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  if (!body) return plain("body is required.", 400);
  const ua = request.headers.get("User-Agent") || "";
  const dest = `${SITE_ORIGIN}/corrections?submitted=1`;
  if (ua.startsWith("twon-")) return Response.redirect(dest, 303);
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ipHash = await hashIp(env, ip, isoDate());
  const key = `submit_rl:${ipHash}:${isoDate()}`;
  let n = 0;
  try { n = parseInt((await env.KV.get(key)) || "0", 10) || 0; } catch { n = 0; }
  if (n >= SUBMIT_DAILY_LIMIT) return plain(`Limit is ${SUBMIT_DAILY_LIMIT} submissions per day per address.`, 429);
  try { await env.KV.put(key, String(n + 1), { expirationTtl: 172800 }); } catch { /* best effort */ }
  const target = String(f.target || "").trim().slice(0, 300);
  let targetType = null;
  let targetId = null;
  const m = target.match(/\/(incidents|actors|outlets|journalists|cases|claims|sources|news|explainers|glossary)\/([a-z0-9-]+)/);
  if (m) {
    const map = { incidents: ["incident", "incidents"], actors: ["actor", "actors"], outlets: ["outlet", "outlets"], journalists: ["journalist", "journalists"], cases: ["case", "cases"], claims: ["claim", null], sources: ["source", null], news: ["news_desk_note", "news_desk_notes"], explainers: ["explainer", "explainers"], glossary: ["glossary_term", "glossary_terms"] }[m[1]];
    targetType = map[0];
    if (!map[1]) targetId = parseInt(m[2], 10) || null;
    else {
      const r = await first(env, `SELECT id FROM ${map[1]} WHERE slug = ?`, m[2]);
      targetId = r ? r.id : null;
    }
  } else if (/^\d+$/.test(target)) {
    targetType = "claim";
    targetId = parseInt(target, 10);
  }
  await env.DB.prepare("INSERT INTO submissions (ts, channel, kind, target_type, target_id, body, source_url, author_claim, ua_raw, ip_hash, status) VALUES (?,?,?,?,?,?,?,?,?,?, 'pending')")
    .bind(isoNow(), "web", kind, targetType, targetId, body, String(f.source_url || "").slice(0, 500) || null, String(f.author_claim || "").slice(0, 200) || null, ua.slice(0, 500), ipHash).run();
  if (ct.includes("application/json")) return new Response(JSON.stringify({ status: "pending" }), { status: 202, headers: { "Content-Type": "application/json; charset=utf-8" } });
  return Response.redirect(dest, 303);
}

