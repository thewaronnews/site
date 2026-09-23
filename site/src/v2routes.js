// v2 public views (brief 2026-09-22): faceted /incidents and /search,
// countries, continents, tactics, eras, leaders and recent coverage. v3
// (ladder brief): no view ranks countries by count; countries carry their
// RSF rank; the ladders and the United States chapter are in ladders.js. Every handler returns a doc (render.js),
// so each page also answers as .md and .json; list views take
// ?format=csv. Templates stay plain: the chosen design is applied to
// render.js afterwards.

import { a, escapeHtml, extLink, proseDate, mdToPlain, truncate, isoNow, sha256Hex, normalizeQuestion } from "./util.js";
import { all, first, upsertQuestion } from "./db.js";
import { linkCell } from "./render.js";
import {
  refData, readFilters, canonicalQuery, queryIncidents, describeFilters, incidentsCsv, csvResponse, searchAll, countryName,
  hasFacets, MAX_PAGE_SIZE, FACET_KEYS, inText, rsfText, rsfData,
} from "./search.js";
import { listCoverage } from "./coverage.js";
import {
  SITE_ORIGIN, CONTINENTS, LEVEL_LABELS, OUTCOME_LABELS, STAGE_LABELS, DATA_LICENSE, LICENSE_URL, ATTRIBUTION_TEXT,
} from "./site.js";
import { PAGE_NOTES } from "./content.js";

const LICENSE = { name: DATA_LICENSE, url: LICENSE_URL };
const ERA_FIRST = 1900;
// v3 (ladder brief): shown wherever the record's per-country depth could be
// read as a ranking of countries.
export const COUNTS_CAVEAT = PAGE_NOTES.counts_caveat;

// ---------- RSF rank (v3) ----------

export function rsfHtml(c) {
  const t = rsfText(c);
  if (!t) return escapeHtml("RSF rank: not recorded");
  return c.press_freedom_source_url ? a(c.press_freedom_source_url, t, { class: "rsf-rank" }) : escapeHtml(t);
}

// Short form for a column headed "RSF 2026 rank": "64th of 180".
function rsfShort(c) {
  const t = rsfText(c);
  if (!t) return { html: "not recorded", text: "not recorded" };
  const short = t.replace(/^RSF \d{4} rank: /, "");
  return c.press_freedom_source_url ? { html: a(c.press_freedom_source_url, short, { class: "rsf-rank" }), text: `[${short}](${c.press_freedom_source_url})` } : { html: escapeHtml(short), text: short };
}

export function rsfMd(c) {
  const t = rsfText(c);
  if (!t) return "RSF rank: not recorded";
  return c.press_freedom_source_url ? `[${t}](${c.press_freedom_source_url})` : t;
}

// Country name linked to its page, followed by its RSF rank.
export function countryRsfCell(ref, iso2) {
  const c = ref.countries.get(String(iso2 || "").toUpperCase());
  const name = c ? c.name : iso2;
  const href = `/countries/${String(iso2).toLowerCase()}`;
  return { html: `${a(href, name)} <small class="rsf">(${rsfHtml(c)})</small>`, text: `[${name}](${SITE_ORIGIN}${href}) (${rsfMd(c)})` };
}

function caveatBlock() {
  return { k: "p", cls: "counts-caveat", text: COUNTS_CAVEAT };
}

// ---------- shared pieces ----------

function incidentJson(r) {
  return {
    slug: r.slug, title: r.title, occurred_on: r.occurred_on, occurred_on_precision: r.occurred_on_precision,
    country: r.country, country_name: r.country_name, continent: r.continent, jurisdiction: r.jurisdiction, level: r.level,
    tactic_primary: r.tactic_primary, tactics: r.tactics, leader_slug: r.leader_slug, leader_name: r.leader_name,
    issue_of_the_day: r.issue_of_the_day || null, outcome: r.outcome, outcome_on: r.outcome_on || null, outcome_note: r.outcome_note || null,
    stage: r.stage || null, ladder_note: r.ladder_note || null, rsf: r.rsf || null,
    era: r.era, granularity: r.granularity, status: r.status, case_count: r.case_count, summary: mdToPlain(r.summary), url: r.url,
  };
}

function leaderCell(r) {
  return r.leader_slug && r.leader_name ? linkCell(`/leaders/${r.leader_slug}`, r.leader_name) : "";
}

function tacticCell(r) {
  return r.tactic_primary ? linkCell(`/tactics/${r.tactic_primary}`, r.tactic_name || r.tactic_primary) : "";
}

function countryCell(r) {
  const c = { press_freedom_rank_latest: r.rsf && r.rsf.rank, press_freedom_rank_year: r.rsf && r.rsf.year, press_freedom_source_url: r.rsf && r.rsf.source_url };
  const href = `/countries/${r.country.toLowerCase()}`;
  return { html: `${a(href, r.country_name)} <small class="rsf">(${rsfHtml(c)})</small>`, text: `[${r.country_name}](${SITE_ORIGIN}${href}) (${rsfMd(c)})` };
}

function outcomeText(r) {
  const o = OUTCOME_LABELS[r.outcome] || "Unknown";
  return r.outcome_on ? `${o} (${proseDate(r.outcome_on)})` : o;
}

export function incidentTable(rows, { caption = null, cols = ["date", "incident", "country", "tactic", "leader", "outcome"] } = {}) {
  const H = { date: "Date", incident: "Incident", country: "Country", tactic: "Tactic", stage: "Stage", leader: "Head of government", outcome: "Outcome" };
  const cell = {
    date: (r) => proseDate(r.occurred_on, r.occurred_on_precision),
    incident: (r) => linkCell(`/incidents/${r.slug}`, r.title),
    country: countryCell,
    tactic: tacticCell,
    stage: (r) => STAGE_LABELS[r.stage] || "",
    leader: leaderCell,
    outcome: outcomeText,
  };
  return { k: "table", caption, headers: cols.map((c) => H[c]), rows: rows.map((r) => cols.map((c) => cell[c](r))) };
}

function incidentCards(rows) {
  return {
    k: "cards",
    items: rows.map((r) => ({
      date: proseDate(r.occurred_on, r.occurred_on_precision),
      title: r.title,
      href: `/incidents/${r.slug}`,
      body: truncate(mdToPlain(r.summary), 240),
      meta: [`${r.country_name} (${r.rsf ? r.rsf.label : "RSF rank: not recorded"})`, r.tactic_name, r.leader_name ? `head of government ${r.leader_name}` : null, `outcome: ${(OUTCOME_LABELS[r.outcome] || "Unknown").toLowerCase()}`].filter(Boolean).join(". "),
    })),
    empty: "No incident matches this view.",
  };
}

function countBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const keys = Array.isArray(r[key]) ? r[key] : [r[key]];
    for (const k of keys) if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])));
}

function groupBy(rows, fn) {
  const m = new Map();
  for (const r of rows) {
    const k = fn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function downloadsBlock(path, query, label = "this view") {
  const sep = query ? "&" : "?";
  return {
    k: "download",
    title: `Download ${label}`,
    meta: `CSV, JSON or Markdown. ${DATA_LICENSE}; credit "${ATTRIBUTION_TEXT}".`,
    links: [
      { label: "CSV", href: `${path}${query}${sep}format=csv` },
      { label: "JSON", href: `${path === "/" ? "/index" : path}.json${query}` },
      { label: "Markdown", href: `${path === "/" ? "/index" : path}.md${query}` },
    ],
  };
}

function downloadsData(path, query) {
  const sep = query ? "&" : "?";
  return { csv: `${SITE_ORIGIN}${path}${query}${sep}format=csv`, json: `${SITE_ORIGIN}${path}.json${query}`, md: `${SITE_ORIGIN}${path}.md${query}` };
}

function wantsCsv(url) {
  return url.searchParams.get("format") === "csv";
}

function csvName(base, f) {
  const bits = [base, ...FACET_KEYS.filter((k) => f[k]).map((k) => `${k}-${String(f[k]).replace(/[^a-zA-Z0-9-]+/g, "-")}`)];
  return `${bits.join("_").slice(0, 120)}.csv`;
}

// ---------- faceted list (/incidents and /search) ----------

function optionList(values, selected, labelFn, counts) {
  return values.map((v) => `<option value="${escapeHtml(v)}"${v === selected ? " selected" : ""}>${escapeHtml(labelFn(v))}${counts && counts[v] ? ` (${counts[v]})` : ""}</option>`).join("");
}

function filterFormHtml(action, f, ref, base) {
  const sel = (name, label, opts) => `<label for="f-${name}">${escapeHtml(label)}</label><select id="f-${name}" name="${name}"><option value="">Any</option>${opts}</select>`;
  const countryCodes = Object.keys(base.country).sort((x, y) => countryName(ref, x).localeCompare(countryName(ref, y)));
  return `<form class="filters" method="get" action="${action}" role="search">
<label for="f-q">Words</label><input type="search" id="f-q" name="q" value="${escapeHtml(f.q || "")}" maxlength="200">
${sel("country", "Country", optionList(countryCodes, f.country, (c) => countryName(ref, c)))}
${sel("continent", "Continent", optionList(Object.keys(CONTINENTS).filter((c) => base.continent[c]), f.continent, (c) => CONTINENTS[c]))}
${sel("tactic", "Tactic", optionList(ref.tacticList.map((t) => t.slug), f.tactic, (t) => ref.tactics.get(t).name, base.tactic))}
${sel("stage", "Stage", optionList(Object.keys(STAGE_LABELS), f.stage, (st) => STAGE_LABELS[st], base.stage))}
${sel("level", "Level of government", optionList(Object.keys(LEVEL_LABELS), f.level, (l) => LEVEL_LABELS[l], base.level))}
${sel("outcome", "Outcome", optionList(Object.keys(OUTCOME_LABELS), f.outcome, (o) => OUTCOME_LABELS[o], base.outcome))}
${sel("leader", "Head of government", optionList(Object.keys(base.leader).sort((x, y) => ((ref.actors.get(x) || {}).name || x).localeCompare((ref.actors.get(y) || {}).name || y)), f.leader, (l) => (ref.actors.get(l) || {}).name || l))}
${sel("has_case", "Court case", optionList(["1", "0"], f.has_case, (v) => (v === "1" ? "With a court case" : "Without a court case"), base.has_case))}
<label for="f-from">From (year or date)</label><input type="text" id="f-from" name="from" value="${escapeHtml(f.from || "")}" inputmode="numeric" pattern="\\d{4}(-\\d{2}(-\\d{2})?)?" placeholder="1900">
<label for="f-to">To (year or date)</label><input type="text" id="f-to" name="to" value="${escapeHtml(f.to || "")}" inputmode="numeric" pattern="\\d{4}(-\\d{2}(-\\d{2})?)?" placeholder="2026">
<label for="f-sort">Sort by</label><select id="f-sort" name="sort">${optionList(["date", "date_asc", "country", "tactic", ...(f.q ? ["relevance"] : [])], f.sort || (f.q ? "relevance" : "date"), (s) => ({ date: "Date, newest first", date_asc: "Date, oldest first", country: "Country", tactic: "Tactic", relevance: "Best match" })[s])}</select>
<label for="f-view">Show as</label><select id="f-view" name="view">${optionList(["table", "cards"], f.view || "table", (v) => (v === "table" ? "Table" : "Cards"))}</select>
${f.actor ? `<input type="hidden" name="actor" value="${escapeHtml(f.actor)}">` : ""}${f.outlet ? `<input type="hidden" name="outlet" value="${escapeHtml(f.outlet)}">` : ""}${f.source_kind ? `<input type="hidden" name="source_kind" value="${escapeHtml(f.source_kind)}">` : ""}
<button type="submit">Apply</button> ${hasFacets(f) || f.q ? a(action, "Clear all") : ""}
</form>`;
}

// v3: countries, continents and heads of government are listed in
// alphabetical or map order without counts (a count per country reads as a
// ranking of countries); countries carry their RSF rank instead.
function facetLinks(path, f, facets, ref) {
  const link = (k, v, label, n) => a(`${path}${canonicalQuery({ ...f, [k]: v, page: undefined })}`, n === null ? label : `${label} (${n})`);
  const line = (title, k, labelFn, { order = null, counts = true } = {}) => {
    const entries = Object.entries(facets[k] || {});
    if (!entries.length) return "";
    const sorted = order ? entries.sort((x, y) => order(x[0], y[0])) : entries.sort((x, y) => y[1] - x[1]);
    return `<p class="facet"><strong>${escapeHtml(title)}:</strong> ${sorted.map(([v, n]) => link(k, v, labelFn(v), counts ? n : null)).join(" ")}</p>`;
  };
  const byLabel = (fn) => (x, y) => fn(x).localeCompare(fn(y));
  const cName = (c) => countryName(ref, c);
  const lName = (l) => (ref.actors.get(l) || {}).name || l;
  const contOrder = Object.keys(CONTINENTS);
  const stageOrder = Object.keys(STAGE_LABELS);
  return [
    line("Country", "country", (c) => { const t = rsfText(ref.countries.get(c)); return t ? `${cName(c)}, ${t}` : cName(c); }, { order: byLabel(cName), counts: false }),
    line("Continent", "continent", (c) => CONTINENTS[c] || c, { order: (x, y) => contOrder.indexOf(x) - contOrder.indexOf(y), counts: false }),
    line("Tactic", "tactic", (t) => (ref.tactics.get(t) || {}).name || t),
    line("Stage", "stage", (st) => STAGE_LABELS[st] || st, { order: (x, y) => stageOrder.indexOf(x) - stageOrder.indexOf(y) }),
    line("Outcome", "outcome", (o) => OUTCOME_LABELS[o] || o),
    line("Level", "level", (l) => LEVEL_LABELS[l] || l),
    line("Head of government", "leader", lName, { order: byLabel(lName), counts: false }),
  ].join("");
}

function facetsJson(facets, ref) {
  const named = (m, fn) => Object.entries(m).map(([value, count]) => ({ value, label: fn(value), count })).sort((x, y) => y.count - x.count);
  // No per-country (or per-continent, per-leader) counts; alphabetical or map order.
  const listed = (m, fn, order) => Object.keys(m).map((value) => ({ value, label: fn(value) })).sort(order || ((x, y) => x.label.localeCompare(y.label)));
  const contOrder = Object.keys(CONTINENTS);
  return {
    country: listed(facets.country, (c) => countryName(ref, c)).map((x) => ({ ...x, rsf: rsfData(ref.countries.get(x.value)) })),
    continent: listed(facets.continent, (c) => CONTINENTS[c] || c, (x, y) => contOrder.indexOf(x.value) - contOrder.indexOf(y.value)),
    tactic: named(facets.tactic, (t) => (ref.tactics.get(t) || {}).name || t),
    stage: named(facets.stage, (st) => STAGE_LABELS[st] || st).sort((x, y) => Object.keys(STAGE_LABELS).indexOf(x.value) - Object.keys(STAGE_LABELS).indexOf(y.value)),
    level: named(facets.level, (l) => LEVEL_LABELS[l] || l),
    outcome: named(facets.outcome, (o) => OUTCOME_LABELS[o] || o),
    leader: listed(facets.leader, (l) => (ref.actors.get(l) || {}).name || l),
    era: named(facets.era, (e) => e),
    year: named(facets.year, (y) => y).sort((x, y) => x.value.localeCompare(y.value)),
    has_case: named(facets.has_case, (v) => (v === "1" ? "with a court case" : "without a court case")),
  };
}

function pagerBlock(path, f, res) {
  if (res.pages <= 1) return null;
  const links = [];
  for (let p = 1; p <= res.pages; p++) {
    const href = `${path}${canonicalQuery({ ...f, page: p > 1 ? String(p) : undefined })}`;
    links.push(p === res.page ? `<span aria-current="page">${p}</span>` : a(href, String(p)));
  }
  return { k: "html", html: `<nav class="pagination" aria-label="Pages">${links.join(" ")}</nav>`, text: `Page ${res.page} of ${res.pages}.${res.page < res.pages ? ` Next: ${SITE_ORIGIN}${path}${canonicalQuery({ ...f, page: String(res.page + 1) })}` : ""}` };
}

async function facetedDoc({ env, url, request }, path) {
  const ref = await refData(env);
  const f = readFilters(url.searchParams, ref);
  const isSearch = path === "/search";
  if (wantsCsv(url)) {
    const res = await queryIncidents(env, f, { paginate: false });
    return csvResponse(incidentsCsv(res.all), csvName(isSearch ? "search" : "incidents", f));
  }
  const res = await queryIncidents(env, f);
  const base = hasFacets(f) || f.q ? (await queryIncidents(env, {}, { paginate: false })).facets : res.facets;
  const query = canonicalQuery(f);
  const lead = isSearch ? (f.q ? `Search: "${f.q}"` : "Search") : f.q ? `Incidents matching "${f.q}"` : "Incidents";
  const title = describeFilters(f, ref, { lead });
  const pageNote = res.pages > 1 ? ` Showing ${res.rows.length} on page ${res.page} of ${res.pages}.` : "";
  const blocks = [];
  if (!isSearch) blocks.push({ k: "p", text: "Each incident is a dated action by a government, an official, a regulator, a court or a legislature that limited journalists' ability to gather or publish news." });
  blocks.push(caveatBlock());
  blocks.push({ k: "html", html: filterFormHtml(path, f, ref, base), text: `Filters: ${FACET_KEYS.join(", ")}, plus q, sort (date, date_asc, country, tactic, relevance), per_page (up to ${MAX_PAGE_SIZE}), page and view (table or cards), as query parameters.` });
  blocks.push({ k: "p", cls: "result-count", text: `${res.total} ${res.total === 1 ? "incident matches" : "incidents match"}${hasFacets(f) || f.q ? " this view" : ""}.${pageNote}` });
  blocks.push({ k: "html", html: `<div class="facets">${facetLinks(path, f, res.facets, ref)}</div>`, text: "" });
  blocks.push(f.view === "cards" ? incidentCards(res.rows) : res.rows.length ? incidentTable(res.rows) : { k: "p", text: "No incident matches this view. Remove a filter to widen it." });
  const pager = pagerBlock(path, f, res);
  if (pager) blocks.push(pager);
  blocks.push(downloadsBlock(path, query));
  let others = [];
  if (isSearch && f.q) {
    others = (await searchAll(env, f.q, { limit: 40 })).filter((h) => h.record_type !== "incident");
    blocks.push({ k: "h2", text: "Other records" });
    blocks.push(others.length
      ? { k: "table", headers: ["Result", "Kind", "Excerpt"], rows: others.map((h) => [h.url ? { html: extLink({ url: h.url, title: h.title, link_state: "live" }), text: `[${h.title}](${h.url})` } : linkCell(h.path, h.title), h.record_type === "coverage_item" ? `recent coverage${h.publisher ? `, ${h.publisher}` : ""}` : h.record_type.replace(/_/g, " "), h.snippet]) }
      : { k: "p", text: "No country, tactic, person, body, outlet, case, glossary term or recent coverage matches these words." });
    const ua = request.headers.get("User-Agent") || "";
    if (!ua.startsWith("twon-")) {
      const norm = normalizeQuestion(f.q);
      try { await upsertQuestion(env, { textRaw: f.q, textNorm: norm, hash: await sha256Hex(norm), source: "search", ts: isoNow(), resultCount: res.total + others.length }); } catch { /* never breaks search */ }
    }
  }
  if (!isSearch) blocks.push({ k: "feeds", items: [{ label: "Incidents (RSS)", href: "/incidents/feed.xml" }, { label: "Incidents (Atom)", href: "/incidents/atom.xml" }, { label: "Incidents (JSON Feed)", href: "/incidents/feed.json" }, { label: "All incidents (CSV)", href: "/incidents.csv" }] });
  return {
    path,
    query,
    title,
    noindex: isSearch && !!f.q,
    metaDescription: isSearch
      ? "Search the record of how governments have limited journalists: incidents by country, tactic, date, head of government and outcome, plus people, outlets, cases and tactics."
      : `${title}. ${res.total} dated, sourced incidents, filterable by country, continent, tactic, year, level of government, head of government, outlet, outcome and court case.`,
    breadcrumbs: isSearch || !query ? [] : [{ name: "Incidents", path: "/incidents" }],
    blocks,
    updatedAt: res.all.map((r) => r.updated_at).sort().pop() || null,
    data: {
      title, canonical_url: `${SITE_ORIGIN}${path}${query}`, filters: f, sort: res.sort, count: res.total, page: res.page, pages: res.pages, per_page: res.perPage,
      counts_caveat: COUNTS_CAVEAT, facets: facetsJson(res.facets, ref), results: res.rows.map(incidentJson),
      ...(isSearch ? { other_results: others.map((h) => ({ ...h, url: h.url || `${SITE_ORIGIN}${h.path}` })) } : {}),
      downloads: downloadsData(path, query), license: LICENSE,
    },
  };
}

export async function incidentsListHandler(ctx) {
  return facetedDoc(ctx, "/incidents");
}

export async function searchV2Handler(ctx) {
  if (ctx.request.method === "POST") {
    const ct = ctx.request.headers.get("Content-Type") || "";
    let q = "";
    if (ct.includes("application/json")) q = (await ctx.request.json().catch(() => ({}))).q || "";
    else { const form = await ctx.request.formData().catch(() => null); if (form) q = form.get("q") || ""; }
    return Response.redirect(`${SITE_ORIGIN}/search${q ? `?q=${encodeURIComponent(String(q).slice(0, 200))}` : ""}`, 303);
  }
  return facetedDoc(ctx, "/search");
}

export async function incidentsCsvHandler({ env, url }) {
  const ref = await refData(env);
  const f = readFilters(url.searchParams, ref);
  const res = await queryIncidents(env, f, { paginate: false });
  return csvResponse(incidentsCsv(res.all), hasFacets(f) ? csvName("incidents", f) : "incidents.csv");
}

// ---------- countries and continents ----------

export async function countriesIndexHandler({ env }) {
  const ref = await refData(env);
  const res = await queryIncidents(env, {}, { paginate: false });
  const byCountry = groupBy(res.all, (r) => r.country);
  const blocks = [
    { k: "p", text: "Countries in the record, grouped by continent and listed alphabetically, each with its rank in the 2026 World Press Freedom Index of Reporters Without Borders (RSF), a Paris-based press-freedom organisation. Rank 1 of 180 is the freest." },
    caveatBlock(),
  ];
  const data = [];
  for (const [cont, contName] of Object.entries(CONTINENTS)) {
    const list = ref.countryList.filter((c) => c.continent === cont && byCountry.has(c.iso2)).sort((x, y) => x.name.localeCompare(y.name));
    if (!list.length) continue;
    blocks.push({ k: "h2", text: contName });
    blocks.push({ k: "table", headers: ["RSF 2026 rank", "Country", "Years in the record"], rows: list.map((c) => {
      const years = byCountry.get(c.iso2).map((r) => r.occurred_on.slice(0, 4)).sort();
      return [rsfShort(c), linkCell(`/countries/${c.iso2.toLowerCase()}`, c.name), years[0] === years[years.length - 1] ? years[0] : `${years[0]} to ${years[years.length - 1]}`];
    }) });
    blocks.push({ k: "html", html: `<p>${a(`/continents/${cont}`, `All of ${contName}`)}</p>`, text: `All of ${contName}: ${SITE_ORIGIN}/continents/${cont}` });
    for (const c of list) data.push({ iso2: c.iso2, name: c.name, continent: c.continent, region: c.region, rsf: rsfData(c), url: `${SITE_ORIGIN}/countries/${c.iso2.toLowerCase()}` });
  }
  blocks.push({ k: "html", html: `<p>${a("/united-states", "The United States: the focal chapter")} · ${a("/ladders", "Ladders: where each tactic has led")}</p>`, text: `The United States: ${SITE_ORIGIN}/united-states. Ladders: ${SITE_ORIGIN}/ladders` });
  return {
    path: "/countries",
    title: "Countries",
    metaDescription: "Every country in the record of how governments have limited journalists, by continent and alphabetically, with each country's RSF 2026 press-freedom rank.",
    blocks,
    data: { counts_caveat: COUNTS_CAVEAT, count: data.length, countries: data, license: LICENSE },
  };
}

export async function countryHandler({ env, url }, iso) {
  const ref = await refData(env);
  const c = ref.countries.get(String(iso).toUpperCase());
  if (!c) return null;
  const path = `/countries/${c.iso2.toLowerCase()}`;
  const res = await queryIncidents(env, { country: c.iso2, sort: "date_asc" }, { paginate: false });
  if (wantsCsv(url)) return csvResponse(incidentsCsv(res.all), `incidents_${c.iso2.toLowerCase()}.csv`);
  const rows = res.all;
  const blocks = [];
  const the = inText(c.name);
  const The = `${the.charAt(0).toUpperCase()}${the.slice(1)}`;
  blocks.push({ k: "html", html: `<p class="rsf-line">${rsfHtml(c)}. World Press Freedom Index of Reporters Without Borders (RSF); rank 1 is the freest.</p>`, text: `${rsfMd(c)}. World Press Freedom Index of Reporters Without Borders (RSF); rank 1 is the freest.` });
  blocks.push(caveatBlock());
  blocks.push({ k: "p", text: `${The} is in ${c.region}, ${CONTINENTS[c.continent]}. The record holds ${rows.length} ${rows.length === 1 ? "incident" : "incidents"} in which the government of ${the}, or an official, court or legislature there, limited journalists' ability to report.` });
  if (c.iso2 === "US") {
    blocks.push({ k: "html", html: `<p>${a("/united-states", "The United States chapter")}: the situation in 2025 and 2026, the record from 1917 to 2019, and where each tactic in use now has led in other countries.</p>`, text: `The United States chapter: ${SITE_ORIGIN}/united-states` });
  }
  if (!rows.length) {
    blocks.push({ k: "p", text: `No incident in ${the} is recorded yet.` });
  } else {
    const tactics = countBy(rows, "tactics");
    blocks.push({ k: "h2", text: "Tactics used" });
    blocks.push({ k: "ul", items: tactics.map(([t, n]) => ({ html: `${a(`/incidents?country=${c.iso2}&tactic=${t}`, `${(ref.tactics.get(t) || {}).name || t}: ${n} ${n === 1 ? "incident" : "incidents"}`)} · ${a(`/ladders/${t}`, "ladder")}`, text: `[${(ref.tactics.get(t) || {}).name || t}: ${n}](${SITE_ORIGIN}/incidents?country=${c.iso2}&tactic=${t}), ladder: ${SITE_ORIGIN}/ladders/${t}` })) });
    const leaders = countBy(rows.filter((r) => r.leader_slug), "leader_slug");
    if (leaders.length) {
      blocks.push({ k: "h2", text: "Heads of government at the time" });
      blocks.push({ k: "ul", items: leaders.map(([l, n]) => linkCell(`/leaders/${l}`, `${(ref.actors.get(l) || {}).name || l}: ${n} ${n === 1 ? "incident" : "incidents"}`)) });
    }
    blocks.push({ k: "h2", text: "Incidents by year" });
    const byYear = groupBy([...rows].reverse(), (r) => r.occurred_on.slice(0, 4));
    for (const [y, list] of byYear) {
      blocks.push({ k: "h3", text: y });
      blocks.push(incidentTable(list, { cols: ["date", "incident", "tactic", "stage", "leader", "outcome"] }));
    }
    blocks.push({ k: "html", html: `<p>${a("/ladders", "Ladders: where each tactic has led")} · ${a(`/timeline/country/${c.iso2.toLowerCase()}`, `Timeline for ${c.name}`)} · ${a(`/continents/${c.continent}`, CONTINENTS[c.continent])}</p>`, text: `Ladders: ${SITE_ORIGIN}/ladders. Timeline: ${SITE_ORIGIN}/timeline/country/${c.iso2.toLowerCase()}.` });
    blocks.push(downloadsBlock(path, "", `incidents in ${the}`));
  }
  const byYearJson = {};
  for (const r of rows) (byYearJson[r.occurred_on.slice(0, 4)] ||= []).push(incidentJson(r));
  return {
    path,
    title: c.name,
    subtitle: `Government actions against journalists in ${the}`,
    metaDescription: `${c.name}: ${rsfText(c) || "RSF rank not recorded"}. Recorded government actions that limited journalists, by year, with tactics, stages, heads of government, outcomes and sources.`,
    breadcrumbs: [{ name: "Countries", path: "/countries" }],
    blocks,
    updatedAt: rows.map((r) => r.updated_at).sort().pop() || null,
    data: {
      iso2: c.iso2, name: c.name, continent: c.continent, region: c.region,
      press_freedom: c.press_freedom_rank_latest ? { index: "RSF World Press Freedom Index", rank: c.press_freedom_rank_latest, year: c.press_freedom_rank_year, of: 180, label: rsfText(c), source_url: c.press_freedom_source_url } : null,
      counts_caveat: COUNTS_CAVEAT,
      ...(c.iso2 === "US" ? { chapter_url: `${SITE_ORIGIN}/united-states` } : {}),
      incident_count: rows.length, tactics: countBy(rows, "tactics").map(([t, n]) => ({ slug: t, name: (ref.tactics.get(t) || {}).name, count: n, ladder_url: `${SITE_ORIGIN}/ladders/${t}` })),
      leaders: countBy(rows.filter((r) => r.leader_slug), "leader_slug").map(([l, n]) => ({ slug: l, name: (ref.actors.get(l) || {}).name || null, count: n, url: `${SITE_ORIGIN}/leaders/${l}` })),
      incidents_by_year: byYearJson, downloads: downloadsData(path, ""), license: LICENSE,
    },
  };
}

export async function continentsIndexHandler({ env }) {
  const ref = await refData(env);
  const res = await queryIncidents(env, {}, { paginate: false });
  const present = groupBy(res.all, (r) => r.continent);
  const rows = Object.entries(CONTINENTS).map(([slug, name]) => {
    const codes = [...new Set((present.get(slug) || []).map((r) => r.country))].sort((x, y) => countryName(ref, x).localeCompare(countryName(ref, y)));
    return { slug, name, countries: codes };
  }).filter((r) => r.countries.length);
  const blocks = [
    { k: "p", text: "The record by continent. Each continent lists the countries in the record alphabetically, with each country's RSF 2026 press-freedom rank." },
    caveatBlock(),
  ];
  for (const r of rows) {
    blocks.push({ k: "h2", text: r.name });
    blocks.push({ k: "ul", items: r.countries.map((cc) => countryRsfCell(ref, cc)) });
    blocks.push({ k: "html", html: `<p>${a(`/continents/${r.slug}`, `All of ${r.name}`)}</p>`, text: `All of ${r.name}: ${SITE_ORIGIN}/continents/${r.slug}` });
  }
  return {
    path: "/continents",
    title: "Continents",
    metaDescription: "The record of government actions against journalists, by continent, with each country's RSF 2026 press-freedom rank.",
    blocks,
    data: { counts_caveat: COUNTS_CAVEAT, continents: rows.map((r) => ({ slug: r.slug, name: r.name, url: `${SITE_ORIGIN}/continents/${r.slug}`, countries: r.countries.map((cc) => ({ iso2: cc, name: countryName(ref, cc), rsf: rsfData(ref.countries.get(cc)), url: `${SITE_ORIGIN}/countries/${cc.toLowerCase()}` })) })), license: LICENSE },
  };
}

export async function continentHandler({ env, url }, slug) {
  const name = CONTINENTS[slug];
  if (!name) return null;
  const ref = await refData(env);
  const path = `/continents/${slug}`;
  const res = await queryIncidents(env, { continent: slug }, { paginate: false });
  if (wantsCsv(url)) return csvResponse(incidentsCsv(res.all), `incidents_${slug}.csv`);
  const rows = res.all;
  const codes = [...new Set(rows.map((r) => r.country))].sort((x, y) => countryName(ref, x).localeCompare(countryName(ref, y)));
  const blocks = [
    caveatBlock(),
    { k: "h2", text: "Countries" },
    codes.length ? { k: "ul", items: codes.map((cc) => countryRsfCell(ref, cc)) } : { k: "p", text: `No incident in ${name} is recorded yet.` },
  ];
  if (rows.length) {
    blocks.push({ k: "h2", text: "Tactics used" }, { k: "ul", items: ref.tacticList.filter((t) => rows.some((r) => r.tactics.includes(t.slug))).map((t) => ({ html: `${a(`/incidents?continent=${slug}&tactic=${t.slug}`, t.name)} · ${a(`/ladders/${t.slug}?continent=${slug}`, "ladder")}`, text: `[${t.name}](${SITE_ORIGIN}/incidents?continent=${slug}&tactic=${t.slug}), ladder: ${SITE_ORIGIN}/ladders/${t.slug}?continent=${slug}` })) });
    blocks.push({ k: "h2", text: "Incidents" }, incidentTable(rows));
    blocks.push({ k: "html", html: `<p>${a("/ladders", "Ladders: where each tactic has led")}</p>`, text: `Ladders: ${SITE_ORIGIN}/ladders` });
    blocks.push(downloadsBlock(path, "", `incidents in ${name}`));
  }
  return {
    path, title: name,
    subtitle: `Government actions against journalists in ${name}`,
    metaDescription: `${name}: recorded government actions against journalists by country, tactic and year, with each country's RSF 2026 press-freedom rank.`,
    breadcrumbs: [{ name: "Continents", path: "/continents" }],
    blocks,
    data: { slug, name, counts_caveat: COUNTS_CAVEAT, countries: codes.map((cc) => ({ iso2: cc, name: countryName(ref, cc), rsf: rsfData(ref.countries.get(cc)), url: `${SITE_ORIGIN}/countries/${cc.toLowerCase()}` })), incidents: rows.map(incidentJson), downloads: downloadsData(path, ""), license: LICENSE },
  };
}

// ---------- tactics ----------

export async function tacticsIndexHandler({ env }) {
  const ref = await refData(env);
  const res = await queryIncidents(env, {}, { paginate: false });
  const rows = ref.tacticList.map((t) => {
    const inc = res.all.filter((r) => r.tactics.includes(t.slug));
    const first_ = inc.map((r) => r.occurred_on).sort()[0] || t.first_recorded_on || null;
    return { ...t, incident_count: inc.length, country_count: new Set(inc.map((r) => r.country)).size, first_recorded_on: first_ };
  });
  return {
    path: "/tactics",
    title: "Tactics",
    metaDescription: "The thirteen tactics governments use to limit journalists, from access bans to detention, each defined and linked to every recorded incident.",
    blocks: [
      { k: "p", text: "The record sorts every incident by tactic, using one fixed list. An incident can use more than one tactic; one is its main tactic." },
      { k: "table", headers: ["Tactic", "What it means", "Incidents", "Countries", "Earliest in the record"], rows: rows.map((t) => [linkCell(`/tactics/${t.slug}`, t.name), t.definition, String(t.incident_count), String(t.country_count), t.first_recorded_on ? t.first_recorded_on.slice(0, 4) : ""]) },
      { k: "html", html: `<p>${a("/ladders", "Ladders: where each tactic has led, stage by stage")}</p>`, text: `Ladders: ${SITE_ORIGIN}/ladders` },
    ],
    data: { tactics: rows.map((t) => ({ slug: t.slug, name: t.name, definition: t.definition, incident_count: t.incident_count, country_count: t.country_count, first_recorded_on: t.first_recorded_on, url: `${SITE_ORIGIN}/tactics/${t.slug}` })), license: LICENSE },
  };
}

export async function tacticHandler({ env, url }, slug) {
  const ref = await refData(env);
  const t = ref.tactics.get(slug);
  if (!t) return null;
  const path = `/tactics/${slug}`;
  const res = await queryIncidents(env, { tactic: slug }, { paginate: false });
  if (wantsCsv(url)) return csvResponse(incidentsCsv(res.all), `incidents_${slug}.csv`);
  const rows = res.all;
  const earliest = rows.map((r) => r.occurred_on).sort()[0] || t.first_recorded_on || null;
  const blocks = [{ k: "p", text: t.definition }];
  if (t.notes) blocks.push({ k: "p", text: t.notes });
  blocks.push({ k: "p", text: rows.length ? `The earliest incident in the record using this tactic is dated ${proseDate(earliest)}.` : "No incident using this tactic is recorded yet." });
  blocks.push({ k: "html", html: `<p>${a(`/ladders/${slug}`, `The ladder for ${t.name.toLowerCase()}: where this tactic has led, stage by stage`)}</p>`, text: `Ladder: ${SITE_ORIGIN}/ladders/${slug}` });
  blocks.push(caveatBlock());
  // v3: countries in alphabetical order with their RSF rank, never by count.
  const byCountry = groupBy(rows, (r) => r.country);
  const order = [...byCountry.keys()].sort((x, y) => countryName(ref, x).localeCompare(countryName(ref, y)));
  const dataByCountry = [];
  if (rows.length) blocks.push({ k: "h2", text: "Incidents by country and year" });
  for (const cc of order) {
    const list = byCountry.get(cc).sort((x, y) => x.occurred_on.localeCompare(y.occurred_on));
    const cRow = ref.countries.get(cc);
    blocks.push({ k: "h3", text: `${countryName(ref, cc)}, ${rsfText(cRow) || "RSF rank: not recorded"}` });
    blocks.push(incidentTable(list, { cols: ["date", "incident", "stage", "leader", "outcome"] }));
    const years = {};
    for (const r of list) (years[r.occurred_on.slice(0, 4)] ||= []).push(incidentJson(r));
    dataByCountry.push({ country: cc, country_name: countryName(ref, cc), rsf: rsfData(cRow), by_year: years });
  }
  if (rows.length) {
    blocks.push({ k: "html", html: `<p>${a(`/ladders/${slug}`, "The ladder for this tactic")} · ${a(`/incidents?tactic=${slug}`, "Filter these incidents")}</p>`, text: `Ladder: ${SITE_ORIGIN}/ladders/${slug}` });
    blocks.push(downloadsBlock(path, "", "these incidents"));
  }
  return {
    path, title: t.name,
    metaDescription: truncate(`${t.name}: ${t.definition}`, 160),
    breadcrumbs: [{ name: "Tactics", path: "/tactics" }],
    jsonld: { "@context": "https://schema.org", "@type": "DefinedTerm", name: t.name, description: t.definition, inDefinedTermSet: `${SITE_ORIGIN}/tactics`, url: `${SITE_ORIGIN}${path}` },
    blocks,
    updatedAt: rows.map((r) => r.updated_at).sort().pop() || null,
    data: { slug, name: t.name, definition: t.definition, notes: t.notes || null, first_recorded_on: earliest, incident_count: rows.length, ladder_url: `${SITE_ORIGIN}/ladders/${slug}`, counts_caveat: COUNTS_CAVEAT, by_country: dataByCountry, downloads: downloadsData(path, ""), license: LICENSE },
  };
}

// ---------- compare ----------
// /compare (tactic x country matrix) was replaced by /ladders in v3; the
// route answers 301 (index.js v2Redirect), carrying tactic, from, to and
// continent over to /ladders/<tactic>.

// ---------- eras ----------

function decades(to = new Date().getUTCFullYear()) {
  const out = [];
  for (let d = ERA_FIRST; d <= to; d += 10) out.push(`${d}s`);
  return out;
}

export async function erasIndexHandler({ env }) {
  const res = await queryIncidents(env, {}, { paginate: false });
  const by = groupBy(res.all, (r) => r.era);
  const rows = decades().map((d) => ({ decade: d, count: (by.get(d) || []).length, countries: new Set((by.get(d) || []).map((r) => r.country)).size }));
  return {
    path: "/eras",
    title: "Eras",
    metaDescription: "Government actions against journalists decade by decade since 1900: anchor incidents for each decade and region, and every well-sourced incident since 2020.",
    blocks: [
      { k: "p", text: "The record runs from 1900 to today. Before 2020 it holds anchor incidents: well-documented cases that show what governments did in each decade and region. From 2020 it aims to hold every well-sourced incident." },
      { k: "table", headers: ["Decade", "Incidents", "Countries"], rows: rows.map((r) => [r.count ? linkCell(`/eras/${r.decade}`, r.decade) : r.decade, String(r.count), String(r.countries)]) },
    ],
    data: { eras: rows.map((r) => ({ ...r, url: `${SITE_ORIGIN}/eras/${r.decade}` })), license: LICENSE },
  };
}

export async function eraHandler({ env, url }, decade) {
  const m = String(decade).match(/^(\d{3})0s$/);
  if (!m) return null;
  const y = parseInt(`${m[1]}0`, 10);
  if (y < ERA_FIRST || y > new Date().getUTCFullYear()) return null;
  const ref = await refData(env);
  const path = `/eras/${decade}`;
  const res = await queryIncidents(env, { from: String(y), to: String(y + 9), sort: "date_asc" }, { paginate: false });
  if (wantsCsv(url)) return csvResponse(incidentsCsv(res.all), `incidents_${decade}.csv`);
  const rows = res.all;
  const blocks = [{ k: "p", text: rows.length ? `${rows.length} recorded ${rows.length === 1 ? "incident" : "incidents"} dated ${y} to ${y + 9}, by continent and region.` : `No incident dated ${y} to ${y + 9} is recorded yet.` }];
  const byCont = groupBy(rows, (r) => r.continent || "unknown");
  const dataGroups = [];
  for (const [cont, name] of Object.entries(CONTINENTS)) {
    const list = byCont.get(cont);
    if (!list) continue;
    blocks.push({ k: "h2", text: name });
    const byRegion = groupBy(list, (r) => (ref.countries.get(r.country) || {}).region || name);
    for (const [region, rl] of byRegion) {
      if (byRegion.size > 1) blocks.push({ k: "h3", text: region });
      blocks.push(incidentTable(rl));
      dataGroups.push({ continent: cont, region, incidents: rl.map(incidentJson) });
    }
  }
  const prev = y - 10 >= ERA_FIRST ? `${y - 10}s` : null;
  const next = y + 10 <= new Date().getUTCFullYear() ? `${y + 10}s` : null;
  blocks.push({ k: "html", html: `<p>${[prev ? a(`/eras/${prev}`, `The ${prev}`) : "", a("/eras", "All eras"), next ? a(`/eras/${next}`, `The ${next}`) : ""].filter(Boolean).join(" · ")}</p>`, text: "" });
  if (rows.length) blocks.push(downloadsBlock(path, "", `the ${decade}`));
  return {
    path, title: `The ${decade}`,
    subtitle: `Government actions against journalists, ${y} to ${y + 9}`,
    metaDescription: `Government actions against journalists in the ${decade}, by continent and region, with tactics, heads of government and outcomes.`,
    breadcrumbs: [{ name: "Eras", path: "/eras" }],
    blocks,
    data: { decade, from: `${y}-01-01`, to: `${y + 9}-12-31`, count: rows.length, groups: dataGroups, downloads: downloadsData(path, ""), license: LICENSE },
  };
}

// ---------- leaders ----------

export async function leadersIndexHandler({ env }) {
  const ref = await refData(env);
  const res = await queryIncidents(env, {}, { paginate: false });
  // v3: alphabetical by name, with the country and its RSF rank; no counts.
  const slugs = [...new Set(res.all.filter((r) => r.leader_slug).map((r) => r.leader_slug))];
  const lname = (l) => (ref.actors.get(l) || {}).name || l;
  const rows = slugs.map((l) => ({ slug: l, name: lname(l), country: res.all.find((r) => r.leader_slug === l).country })).sort((x, y) => x.name.localeCompare(y.name));
  return {
    path: "/leaders",
    title: "Heads of government",
    metaDescription: "Heads of government in office when recorded actions against journalists took place, with the incidents under each.",
    blocks: [
      { k: "p", text: "The head of government in office when each incident took place, alphabetically. This person may differ from the official who acted." },
      caveatBlock(),
      rows.length ? { k: "table", headers: ["Name", "Country"], rows: rows.map((r) => [linkCell(`/leaders/${r.slug}`, r.name), countryRsfCell(ref, r.country)]) } : { k: "p", text: "No head of government is recorded yet." },
    ],
    data: { counts_caveat: COUNTS_CAVEAT, leaders: rows.map((r) => ({ slug: r.slug, name: r.name, country: r.country, url: `${SITE_ORIGIN}/leaders/${r.slug}` })), license: LICENSE },
  };
}

export async function leaderHandler({ env, url }, slug) {
  const actor = await first(env, "SELECT * FROM actors WHERE slug = ?", slug);
  if (!actor || actor.pub_state !== "published") return null;
  const path = `/leaders/${slug}`;
  const res = await queryIncidents(env, { leader: slug, sort: "date_asc" }, { paginate: false });
  if (wantsCsv(url)) return csvResponse(incidentsCsv(res.all), `incidents_leader_${slug}.csv`);
  const rows = res.all;
  const ref = await refData(env);
  const blocks = [
    { k: "p", text: `${actor.name}${actor.office ? `, ${actor.office}` : actor.role ? `, ${actor.role}` : ""}, was head of government when ${rows.length} recorded ${rows.length === 1 ? "incident" : "incidents"} took place. The official who acted in each may be someone else; each incident names them.` },
  ];
  if (rows.length) {
    blocks.push({ k: "h2", text: "Tactics used" }, { k: "ul", items: countBy(rows, "tactics").map(([t, n]) => linkCell(`/incidents?leader=${slug}&tactic=${t}`, `${(ref.tactics.get(t) || {}).name || t}: ${n}`)) });
    blocks.push({ k: "h2", text: "Incidents" }, incidentTable(rows, { cols: ["date", "incident", "country", "tactic", "outcome"] }));
    blocks.push(downloadsBlock(path, "", "these incidents"));
  }
  blocks.push({ k: "html", html: `<p>${a(`/actors/${slug}`, `Full entry for ${actor.name}`)}</p>`, text: `Actor entry: ${SITE_ORIGIN}/actors/${slug}` });
  return {
    path, title: actor.name,
    subtitle: "As head of government",
    metaDescription: `Recorded government actions against journalists while ${actor.name} was head of government, with tactics, outcomes and sources.`,
    breadcrumbs: [{ name: "Heads of government", path: "/leaders" }],
    blocks,
    updatedAt: rows.map((r) => r.updated_at).sort().pop() || actor.updated_at,
    data: { slug, name: actor.name, office: actor.office, role: actor.role, country: actor.country, actor_url: `${SITE_ORIGIN}/actors/${slug}`, incident_count: rows.length, incidents: rows.map(incidentJson), downloads: downloadsData(path, ""), license: LICENSE },
  };
}

// ---------- recent coverage ----------

export async function coverageHandler({ env, url }) {
  const ref = await refData(env);
  const f = {};
  const cc = String(url.searchParams.get("country") || "").toUpperCase();
  if (ref.countries.has(cc)) f.country = cc;
  const tactic = url.searchParams.get("tactic");
  if (tactic && ref.tactics.has(tactic)) f.tactic = tactic;
  const items = await listCoverage(env, { state: "shown", limit: 400, ...f });
  const query = canonicalQuery(f);
  const byDay = groupBy(items, (i) => String(i.published_at || i.fetched_at).slice(0, 10));
  const blocks = [
    { k: "p", text: "Recent reporting from news organisations and press-freedom groups on government actions against journalists anywhere in the world, newest first. Items are collected every hour from news feeds and kept for 60 days. The headlines and summaries are the publishers' own; follow the links to read the reporting. An item here is not yet an entry in the record." },
    { k: "feeds", items: [{ label: "RSS", href: "/coverage/feed.xml" }, { label: "Atom", href: "/coverage/atom.xml" }, { label: "JSON Feed", href: "/coverage/feed.json" }] },
  ];
  if (!items.length) blocks.push({ k: "p", text: "No recent coverage is listed yet." });
  for (const [day, list] of byDay) {
    blocks.push({ k: "h2", text: proseDate(day), id: `d-${day}` });
    blocks.push({
      k: "html",
      html: `<ul class="coverage-list">${list.map((i) => `<li class="coverage-item">${extLink({ url: i.url, title: i.title, link_state: "live" })}<span class="coverage-item__meta">${escapeHtml(i.publisher || new URL(i.url).hostname)}${i.published_at ? `, <time datetime="${escapeHtml(i.published_at)}">${escapeHtml(proseDate(i.published_at.slice(0, 10)))}</time>` : ""}${i.country_guess ? `. ${a(`/countries/${i.country_guess.toLowerCase()}`, countryName(ref, i.country_guess))}` : ""}${i.incident_slug ? `. Record entry: ${a(`/incidents/${i.incident_slug}`, i.incident_title)}` : ""}</span>${i.summary ? `<p class="coverage-item__summary">${escapeHtml(i.summary)}</p>` : ""}</li>`).join("")}</ul>`,
      text: list.map((i) => `- [${i.title}](${i.url}), ${i.publisher || ""}${i.published_at ? `, ${i.published_at.slice(0, 10)}` : ""}${i.summary ? `. ${i.summary}` : ""}`).join("\n"),
    });
  }
  return {
    path: "/coverage",
    query,
    title: f.country || f.tactic ? `Recent coverage${f.tactic ? `: ${ref.tactics.get(f.tactic).name.toLowerCase()}` : ""}${f.country ? `, ${countryName(ref, f.country)}` : ""}` : "Recent coverage",
    metaDescription: "Links to recent reporting on government actions against journalists worldwide, collected hourly and grouped by day.",
    blocks,
    updatedAt: items[0] ? items[0].fetched_at : null,
    data: {
      filters: f, count: items.length, retention_days: 60,
      items: items.map((i) => ({ id: i.id, url: i.url, title: i.title, publisher: i.publisher, published_at: i.published_at, summary: i.summary, country_guess: i.country_guess, tactic_guess: i.tactic_guess, relevance_score: i.jev_in_scope, incident: i.incident_slug ? `${SITE_ORIGIN}/incidents/${i.incident_slug}` : null, fetched_at: i.fetched_at })),
      feeds: { rss: `${SITE_ORIGIN}/coverage/feed.xml`, atom: `${SITE_ORIGIN}/coverage/atom.xml`, json: `${SITE_ORIGIN}/coverage/feed.json` },
    },
  };
}

export const V2_STATIC_PAGES = ["/countries", "/continents", "/tactics", "/ladders", "/united-states", "/eras", "/leaders", "/coverage"];
export { decades };
