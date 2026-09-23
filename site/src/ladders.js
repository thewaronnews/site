// v3 (brief v3-ladder-brief-2026-09-22): the ladder views and the United
// States chapter. A ladder takes one tactic and sets out its incidents by
// escalation stage (restrict, pressure, punish, silence, eliminate), then by
// date; rows from the United States, the focal case, are marked and come
// first within their stage. No view here ranks countries by how many
// entries the record holds; every country named carries its RSF rank.
// Templates stay structurally simple; the design pass restyles them.

import { a, escapeHtml, proseDate, mdToPlain, truncate } from "./util.js";
import { all, sourceObject } from "./db.js";
import { linkCell } from "./render.js";
import { refData, readFilters, canonicalQuery, queryIncidents, csvResponse, rsfData } from "./search.js";
import { incidentTable, rsfHtml, rsfMd, COUNTS_CAVEAT } from "./v2routes.js";
import { PAGE_NOTES } from "./content.js";
import { stageBarHtml, laneOpenHtml, rungCardsHtml } from "./views.js";
import {
  SITE_ORIGIN, CONTINENTS, OUTCOME_LABELS, STAGE_ORDER, STAGE_LABELS, CASE_STATUS_LABELS, DATA_LICENSE, LICENSE_URL, ATTRIBUTION_TEXT,
} from "./site.js";

const LICENSE = { name: DATA_LICENSE, url: LICENSE_URL };
const FOCAL = "US";
const LADDER_KEYS = ["stage", "continent", "from", "to"];
const STAGES = PAGE_NOTES.stages || {};

// ---------- shared ----------

// First sentence of a plain-text summary; abbreviations such as "U.S." or
// "Gen." do not end a sentence.
const ABBREV = /(?:\b(?:[A-Z]\.){1,3}|\b(?:Mr|Mrs|Ms|Dr|St|Gen|Jr|Sr|No|Lt|Col|Gov|Sen|Rep|Inc|Co|Corp|vs|v|Jan|Feb|Mar|Apr|Aug|Sept|Sep|Oct|Nov|Dec)\.)$/;
export function firstSentence(text, max = 300) {
  const t = String(text || "").trim();
  const re = /[.!?]["”']?\s+(?=["“]?[A-Z0-9])/g;
  let m;
  while ((m = re.exec(t))) {
    const end = m.index + m[0].trimEnd().length;
    if (ABBREV.test(t.slice(0, m.index + 1))) continue;
    return truncate(t.slice(0, end), max);
  }
  return truncate(t, max);
}

function oneLine(def) {
  return firstSentence(def, 240);
}

function outcomeText(r) {
  const o = OUTCOME_LABELS[r.outcome] || "Unknown";
  return r.outcome_on ? `${o} (${proseDate(r.outcome_on)})` : o;
}

// Distinct sources per incident: its listed sources plus the sources of its
// current claims.
async function sourceCounts(env) {
  const rows = await all(env, `SELECT incident_id, COUNT(DISTINCT source_id) AS n FROM (
    SELECT incident_id, source_id FROM incident_sources
    UNION SELECT subject_id AS incident_id, source_id FROM claims WHERE subject_type = 'incident' AND status = 'current'
  ) GROUP BY incident_id`);
  return new Map(rows.map((r) => [r.incident_id, r.n]));
}

function wantsCsv(url) {
  return url.searchParams.get("format") === "csv";
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rsfPlain(r) {
  return r.rsf ? r.rsf.label : "RSF rank: not recorded";
}

function countryHtml(r) {
  const c = { press_freedom_rank_latest: r.rsf && r.rsf.rank, press_freedom_rank_year: r.rsf && r.rsf.year, press_freedom_source_url: r.rsf && r.rsf.source_url };
  const focal = r.country === FOCAL ? `<strong class="focal-case">Focal case</strong> ` : "";
  return {
    html: `${focal}${a(`/countries/${r.country.toLowerCase()}`, r.country_name)} <small class="rsf">(${rsfHtml(c)})</small>`,
    text: `${r.country === FOCAL ? "Focal case: " : ""}[${r.country_name}](${SITE_ORIGIN}/countries/${r.country.toLowerCase()}) (${rsfMd(c)})`,
  };
}

function rungJson(r, sources) {
  return {
    slug: r.slug, title: r.title, occurred_on: r.occurred_on, occurred_on_precision: r.occurred_on_precision,
    stage: r.stage || null, focal_case: r.country === FOCAL,
    country: r.country, country_name: r.country_name, continent: r.continent, rsf: r.rsf || null,
    leader_slug: r.leader_slug, leader_name: r.leader_name,
    what_was_done: firstSentence(mdToPlain(r.summary)), outcome: r.outcome, outcome_on: r.outcome_on || null, outcome_note: r.outcome_note || null,
    ladder_note: r.ladder_note || null, sources_count: sources.get(r.id) || 0, tactic_primary: r.tactic_primary, tactics: r.tactics, url: r.url,
  };
}

// Stage order, then within a stage the focal case first, then date.
function ladderSort(x, y) {
  const sx = STAGE_ORDER.indexOf(x.stage);
  const sy = STAGE_ORDER.indexOf(y.stage);
  return (sx === -1 ? 99 : sx) - (sy === -1 ? 99 : sy)
    || (x.country === FOCAL ? 0 : 1) - (y.country === FOCAL ? 0 : 1)
    || x.occurred_on.localeCompare(y.occurred_on) || x.id - y.id;
}

function stageLegendBlock() {
  return {
    k: "dl",
    items: STAGE_ORDER.map((st) => [(STAGES[st] || {}).name || STAGE_LABELS[st], (STAGES[st] || {}).definition || ""]),
  };
}

function ladderFilters(url, ref) {
  const f = readFilters(url.searchParams, ref);
  const cf = {};
  for (const k of LADDER_KEYS) if (f[k]) cf[k] = f[k];
  return cf;
}

// ---------- /ladders ----------

export async function laddersIndexHandler({ env }) {
  const ref = await refData(env);
  const res = await queryIncidents(env, {}, { paginate: false });
  const rows = ref.tacticList.map((t) => {
    const inc = res.all.filter((r) => r.tactics.includes(t.slug));
    const stages = STAGE_ORDER.filter((st) => inc.some((r) => r.stage === st));
    const focal = inc.filter((r) => r.country === FOCAL);
    const focalStages = STAGE_ORDER.filter((st) => focal.some((r) => r.stage === st));
    return { t, stages, focalStages };
  });
  const blocks = [
    { k: "p", text: PAGE_NOTES.ladders_intro },
    { k: "p", cls: "counts-caveat", text: COUNTS_CAVEAT },
    { k: "h2", text: "The stages" },
    stageLegendBlock(),
    { k: "h2", text: "The thirteen tactics" },
    {
      k: "table",
      headers: ["Tactic", "What it is", "Stages in the record", "United States rows at"],
      rows: rows.map(({ t, stages, focalStages }) => [
        linkCell(`/ladders/${t.slug}`, t.name),
        oneLine(t.definition),
        stages.map((st) => STAGE_LABELS[st]).join(", ") || "None yet",
        focalStages.map((st) => STAGE_LABELS[st]).join(", ") || "None",
      ]),
    },
    { k: "html", html: `<p>${a("/united-states", "The United States chapter")} · ${a("/tactics", "All tactics, defined")} · ${a("/incidents", "All incidents, with filters")}</p>`, text: `The United States chapter: ${SITE_ORIGIN}/united-states. Tactics: ${SITE_ORIGIN}/tactics.` },
  ];
  return {
    path: "/ladders",
    title: "Ladders",
    subtitle: "Where each tactic has led, stage by stage",
    metaDescription: "For each of thirteen tactics governments use against journalists, the recorded incidents from restricting access to eliminating journalists, with the United States as the focal case.",
    blocks,
    data: {
      title: "Ladders", counts_caveat: COUNTS_CAVEAT,
      stages: STAGE_ORDER.map((st) => ({ slug: st, name: (STAGES[st] || {}).name || STAGE_LABELS[st], definition: (STAGES[st] || {}).definition || null })),
      tactics: rows.map(({ t, stages, focalStages }) => ({ slug: t.slug, name: t.name, definition: oneLine(t.definition), stages_in_record: stages, united_states_stages: focalStages, url: `${SITE_ORIGIN}/ladders/${t.slug}` })),
      united_states_chapter: `${SITE_ORIGIN}/united-states`, license: LICENSE,
    },
  };
}

// ---------- /ladders/<tactic> ----------

function ladderCsv(rungs) {
  const cols = ["stage", "focal_case", "occurred_on", "country", "country_name", "rsf_rank", "rsf_year", "rsf_source_url", "leader_name", "what_was_done", "outcome", "outcome_on", "ladder_note", "sources_count", "slug", "url"];
  const lines = [cols.join(",")];
  for (const r of rungs) {
    const v = { ...r, focal_case: r.focal_case ? "yes" : "no", rsf_rank: r.rsf && r.rsf.rank, rsf_year: r.rsf && r.rsf.year, rsf_source_url: r.rsf && r.rsf.source_url };
    lines.push(cols.map((c) => csvCell(v[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function optionList(values, selected, labelFn) {
  return values.map((v) => `<option value="${escapeHtml(v)}"${v === selected ? " selected" : ""}>${escapeHtml(labelFn(v))}</option>`).join("");
}

export async function ladderHandler({ env, url }, slug) {
  const ref = await refData(env);
  const t = ref.tactics.get(slug);
  if (!t) return null;
  const path = `/ladders/${slug}`;
  const cf = ladderFilters(url, ref);
  const query = canonicalQuery(cf);
  const res = await queryIncidents(env, { ...cf, tactic: slug }, { paginate: false });
  const sources = await sourceCounts(env);
  const rows = [...res.all].sort(ladderSort);
  const rungs = rows.map((r) => rungJson(r, sources));
  if (wantsCsv(url)) {
    const bits = [`ladder_${slug}`, ...LADDER_KEYS.filter((k) => cf[k]).map((k) => `${k}-${String(cf[k]).replace(/[^a-zA-Z0-9-]+/g, "-")}`)];
    return csvResponse(ladderCsv(rungs), `${bits.join("_")}.csv`);
  }
  const bits = [];
  if (cf.stage) bits.push(`stage: ${STAGE_LABELS[cf.stage].toLowerCase()}`);
  if (cf.continent) bits.push(`in ${CONTINENTS[cf.continent]}`);
  if (cf.from && cf.to) bits.push(`${cf.from} to ${cf.to}`);
  else if (cf.from) bits.push(`from ${cf.from}`);
  else if (cf.to) bits.push(`to ${cf.to}`);
  const title = `Ladder: ${t.name.toLowerCase()}${bits.length ? `, ${bits.join(", ")}` : ""}`;
  const blocks = [
    { k: "p", text: t.definition },
    { k: "p", cls: "counts-caveat", text: COUNTS_CAVEAT },
    { k: "html", html: `<form class="filters" method="get" action="${path}">
<div class="field"><label for="l-stage">Stage</label><select id="l-stage" name="stage"><option value="">Any</option>${optionList(STAGE_ORDER, cf.stage, (st) => STAGE_LABELS[st])}</select></div>
<div class="field"><label for="l-continent">Continent</label><select id="l-continent" name="continent"><option value="">Any</option>${optionList(Object.keys(CONTINENTS), cf.continent, (c) => CONTINENTS[c])}</select></div>
<div class="field"><label for="l-from">From (year or date)</label><input type="text" id="l-from" name="from" value="${escapeHtml(cf.from || "")}" inputmode="numeric" placeholder="1900"></div>
<div class="field"><label for="l-to">To (year or date)</label><input type="text" id="l-to" name="to" value="${escapeHtml(cf.to || "")}" inputmode="numeric" placeholder="2026"></div>
<div class="filters__actions"><button type="submit">Apply</button> ${query ? a(path, "Clear all") : ""}</div></form>`, text: "Narrow with ?stage= (restrict, pressure, punish, silence, eliminate), ?continent=, ?from= and ?to= (year or date)." },
  ];
  // Atlas design (HTML only): the filter form folds away, a stage bar leads
  // into one lane per stage, and each lane's table shows as rung cards.
  const formBlock = blocks[blocks.length - 1];
  formBlock.viewHtml = `<details class="refine"${query ? " open" : ""}><summary>Narrow this ladder</summary>${formBlock.html}</details>`;
  blocks.push({ k: "html", html: stageBarHtml(new Set(rows.map((r) => r.stage).filter(Boolean))), text: "" });
  const stagesJson = [];
  for (const st of [...STAGE_ORDER, null]) {
    const list = rows.filter((r) => (st === null ? !STAGE_ORDER.includes(r.stage) : r.stage === st));
    if (!list.length) continue;
    const name = st ? (STAGES[st] || {}).name || STAGE_LABELS[st] : "Stage not yet set";
    blocks.push({ k: "h2", text: name, id: st ? `stage-${st}` : "stage-unset", viewHtml: laneOpenHtml(st, name, st && STAGES[st] ? STAGES[st].definition : null) });
    if (st && STAGES[st]) blocks.push({ k: "p", cls: "stage-definition", text: STAGES[st].definition, hideHtml: true });
    blocks.push({
      viewHtml: rungCardsHtml(list.map((r) => {
        const j = rungJson(r, sources);
        return { slug: r.slug, country: r.country, country_name: r.country_name, rsf: r.rsf, occurred_on: r.occurred_on, occurred_on_precision: r.occurred_on_precision, leader_slug: r.leader_slug, leader_name: r.leader_name, what: j.what_was_done, note: j.ladder_note, outcome: r.outcome, outcome_on: r.outcome_on, sources: j.sources_count, focal: r.country === FOCAL };
      })),
      k: "table",
      headers: ["Date", "Country", "Head of government", "What was done", "Outcome", "Sources"],
      rows: list.map((r) => {
        const j = rungJson(r, sources);
        const note = j.ladder_note ? ` Note: ${j.ladder_note}` : "";
        return [
          proseDate(r.occurred_on, r.occurred_on_precision),
          countryHtml(r),
          r.leader_slug && r.leader_name ? linkCell(`/leaders/${r.leader_slug}`, r.leader_name) : "",
          { html: `${escapeHtml(j.what_was_done)}${note ? ` <em class="ladder-note">${escapeHtml(note.trim())}</em>` : ""} ${a(`/incidents/${r.slug}`, "Full entry")}`, text: `${j.what_was_done}${note} [Full entry](${r.url})` },
          outcomeText(r),
          String(j.sources_count),
        ];
      }),
    });
    stagesJson.push({ stage: st, name, definition: st && STAGES[st] ? STAGES[st].definition : null, rungs: list.map((r) => rungJson(r, sources)) });
  }
  if (!rows.length) blocks.push({ k: "p", text: "No incident matches. Widen the dates or remove a filter." });
  const sep = query ? "&" : "?";
  blocks.push({ k: "download", title: "Download this ladder", meta: `CSV, JSON or Markdown. ${DATA_LICENSE}; credit "${ATTRIBUTION_TEXT}".`, links: [{ label: "CSV", href: `${path}${query}${sep}format=csv` }, { label: "JSON", href: `${path}.json${query}` }, { label: "Markdown", href: `${path}.md${query}` }] });
  blocks.push({ k: "html", html: `<p>${a("/ladders", "All ladders")} · ${a(`/tactics/${slug}`, `${t.name}: by country and year`)} · ${a("/united-states", "The United States chapter")}</p>`, text: `All ladders: ${SITE_ORIGIN}/ladders. United States chapter: ${SITE_ORIGIN}/united-states` });
  return {
    path,
    query,
    title,
    metaDescription: truncate(`${t.name}: where this tactic has led, from restricting access to eliminating journalists, with dates, countries, RSF ranks, heads of government, outcomes and sources.`, 160),
    breadcrumbs: [{ name: "Ladders", path: "/ladders" }],
    blocks,
    updatedAt: rows.map((r) => r.updated_at).sort().pop() || null,
    data: {
      title, canonical_url: `${SITE_ORIGIN}${path}${query}`, filters: cf, counts_caveat: COUNTS_CAVEAT,
      tactic: { slug, name: t.name, definition: t.definition, url: `${SITE_ORIGIN}/tactics/${slug}` },
      focal_case: FOCAL, count: rungs.length, stages: stagesJson,
      downloads: { csv: `${SITE_ORIGIN}${path}${query}${sep}format=csv`, json: `${SITE_ORIGIN}${path}.json${query}`, md: `${SITE_ORIGIN}${path}.md${query}` },
      license: LICENSE,
    },
  };
}

// ---------- /united-states ----------

const NOW_FROM = "2025-01-01";

function decadeOf(d) {
  return `${String(d).slice(0, 3)}0s`;
}

export async function unitedStatesHandler({ env }) {
  const ref = await refData(env);
  const us = ref.countries.get(FOCAL);
  const res = await queryIncidents(env, { country: FOCAL, sort: "date_asc" }, { paginate: false });
  const everything = await queryIncidents(env, {}, { paginate: false });
  const sources = await sourceCounts(env);
  const rows = res.all;
  const now = rows.filter((r) => r.occurred_on >= NOW_FROM);
  const before = rows.filter((r) => r.occurred_on < NOW_FROM);
  const nowIds = now.map((r) => r.id);
  // Subqueries rather than id lists: D1 allows at most 100 bound parameters.
  const NOW_SQL = "SELECT id FROM incidents WHERE pub_state = 'published' AND country = ? AND occurred_on >= ?";
  const events = nowIds.length ? await all(env, `SELECT e.incident_id, e.occurred_on, e.occurred_on_precision, e.kind, e.label, c.slug AS case_slug FROM events e LEFT JOIN cases c ON c.id = e.case_id WHERE e.incident_id IN (${NOW_SQL}) AND e.pub_state = 'published' ORDER BY e.occurred_on, e.id`, FOCAL, NOW_FROM) : [];
  const eventsBy = new Map();
  for (const e of events) {
    if (!eventsBy.has(e.incident_id)) eventsBy.set(e.incident_id, []);
    eventsBy.get(e.incident_id).push(e);
  }
  const tname = (t) => (ref.tactics.get(t) || {}).name || t;

  const blocks = [
    { k: "html", html: `<p class="rsf-line">${rsfHtml(us)}. World Press Freedom Index of Reporters Without Borders (RSF); rank 1 is the freest.</p>`, text: `${rsfMd(us)}. World Press Freedom Index of Reporters Without Borders (RSF); rank 1 is the freest.` },
    { k: "p", text: PAGE_NOTES.us_chapter_intro },
    { k: "p", cls: "counts-caveat", text: `The record is deepest for the United States. ${COUNTS_CAVEAT}` },
  ];

  // Now
  blocks.push({ k: "h2", text: "Now", id: "now" });
  blocks.push({ k: "p", text: "Incidents dated 2025 and 2026, in date order." });
  const nowJson = [];
  for (const r of now) {
    const ev = eventsBy.get(r.id) || [];
    // Atlas (HTML only): each incident of the "Now" section is one panel.
    blocks.push({ k: "h3", text: `${proseDate(r.occurred_on, r.occurred_on_precision)}: ${r.title}`, viewHtml: `<article class="panel now-item"><p class="eyebrow"><time datetime="${escapeHtml(r.occurred_on)}">${escapeHtml(proseDate(r.occurred_on, r.occurred_on_precision))}</time></p><h3>${a(`/incidents/${r.slug}`, r.title)}</h3>` });
    blocks.push({ k: "p", text: mdToPlain(r.summary) });
    const facts = [
      ["Tactics", { html: r.tactics.map((t) => a(`/ladders/${t}`, tname(t))).join(", "), text: r.tactics.map(tname).join(", ") }],
      ["Stage", STAGE_LABELS[r.stage] || "Not set"],
    ];
    if (r.leader_name) facts.push(["Head of government", linkCell(`/leaders/${r.leader_slug}`, r.leader_name)]);
    facts.push(["Outcome", `${outcomeText(r)}${r.outcome_note ? `. ${r.outcome_note}` : ""}`]);
    facts.push(["Sources", String(sources.get(r.id) || 0)]);
    blocks.push({ k: "dl", items: facts });
    if (ev.length) {
      blocks.push({ k: "ul", viewHtml: `<ol class="events">${ev.map((e) => `<li><time datetime="${escapeHtml(e.occurred_on)}">${escapeHtml(proseDate(e.occurred_on, e.occurred_on_precision))}</time>${escapeHtml(e.label)}${e.case_slug ? ` (${a(`/cases/${e.case_slug}`, "court case")})` : ""}</li>`).join("")}</ol>`, items: ev.map((e) => ({ html: `<time datetime="${escapeHtml(e.occurred_on)}">${escapeHtml(proseDate(e.occurred_on, e.occurred_on_precision))}</time>: ${escapeHtml(e.label)}${e.case_slug ? ` (${a(`/cases/${e.case_slug}`, "court case")})` : ""}`, text: `${e.occurred_on}: ${e.label}` })) });
    }
    blocks.push({ k: "html", html: `<p>${a(`/incidents/${r.slug}`, "Full entry, with claims and sources")}</p>`, viewHtml: `<p class="cta">${a(`/incidents/${r.slug}`, "Full entry, with claims and sources")}</p></article>`, text: `Full entry: ${r.url}` });
    nowJson.push({ ...rungJson(r, sources), summary: mdToPlain(r.summary), events: ev.map((e) => ({ occurred_on: e.occurred_on, kind: e.kind, label: e.label, case: e.case_slug ? `${SITE_ORIGIN}/cases/${e.case_slug}` : null })) });
  }
  if (!now.length) blocks.push({ k: "p", text: "No incident dated 2025 or later is recorded yet." });

  // How it got here
  blocks.push({ k: "h2", text: "How it got here", id: "how-it-got-here" });
  blocks.push({ k: "p", text: "The earlier record, from 1917 to 2024, by decade." });
  const byDecade = new Map();
  for (const r of before) {
    const d = decadeOf(r.occurred_on);
    if (!byDecade.has(d)) byDecade.set(d, []);
    byDecade.get(d).push(r);
  }
  const historyJson = [];
  for (const [d, list] of byDecade) {
    const label = d === "2020s" ? "The 2020s, to 2024" : `The ${d}`;
    blocks.push({ k: "h3", text: label });
    blocks.push(incidentTable(list, { cols: ["date", "incident", "tactic", "stage", "leader", "outcome"] }));
    historyJson.push({ decade: d, incidents: list.map((r) => rungJson(r, sources)) });
  }

  // Tactics in use now
  blocks.push({ k: "h2", text: "Tactics in use now and where they have led", id: "tactics-in-use-now" });
  blocks.push({ k: "p", text: "For each tactic with a United States incident dated 2025 or later: the United States rows, the furthest stage the same tactic has reached elsewhere in the record, and the full ladder." });
  const tacticsNow = ref.tacticList.filter((t) => now.some((r) => r.tactics.includes(t.slug)));
  const tacticsJson = [];
  for (const t of tacticsNow) {
    const mine = now.filter((r) => r.tactics.includes(t.slug)).sort(ladderSort);
    const elsewhere = everything.all.filter((r) => r.country !== FOCAL && r.tactics.includes(t.slug) && STAGE_ORDER.includes(r.stage));
    const top = elsewhere.reduce((m, r) => Math.max(m, STAGE_ORDER.indexOf(r.stage)), -1);
    const topRows = top >= 0 ? elsewhere.filter((r) => STAGE_ORDER.indexOf(r.stage) === top).sort((x, y) => y.occurred_on.localeCompare(x.occurred_on)) : [];
    blocks.push({ k: "h3", text: t.name });
    blocks.push(incidentTable(mine, { cols: ["date", "incident", "stage", "outcome"] }));
    if (topRows.length) {
      const ex = topRows.slice(0, 4);
      blocks.push({
        k: "html",
        html: `<p>Elsewhere in the record, this tactic has reached the stage ${escapeHtml(STAGE_LABELS[STAGE_ORDER[top]])}: ${ex.map((r) => `${a(`/incidents/${r.slug}`, `${r.country_name}, ${r.occurred_on.slice(0, 4)}`)} <small class="rsf">(${escapeHtml(rsfPlain(r))})</small>`).join("; ")}.</p>`,
        text: `Elsewhere in the record, this tactic has reached the stage ${STAGE_LABELS[STAGE_ORDER[top]]}: ${ex.map((r) => `${r.country_name}, ${r.occurred_on.slice(0, 4)} (${rsfPlain(r)}) ${r.url}`).join("; ")}.`,
      });
    } else {
      blocks.push({ k: "p", text: "No incident outside the United States using this tactic is recorded yet." });
    }
    blocks.push({ k: "html", html: `<p>${a(`/ladders/${t.slug}`, `The full ladder for ${t.name.toLowerCase()}`)}</p>`, text: `Ladder: ${SITE_ORIGIN}/ladders/${t.slug}` });
    tacticsJson.push({
      slug: t.slug, name: t.name, ladder_url: `${SITE_ORIGIN}/ladders/${t.slug}`,
      united_states: mine.map((r) => rungJson(r, sources)),
      furthest_stage_elsewhere: top >= 0 ? STAGE_ORDER[top] : null,
      furthest_stage_examples: topRows.slice(0, 4).map((r) => ({ slug: r.slug, country: r.country, country_name: r.country_name, occurred_on: r.occurred_on, rsf: r.rsf || null, url: r.url })),
    });
  }

  // The law
  const cases = await all(env, `SELECT c.slug, c.caption, c.short_name, c.court, c.court_level, c.docket, c.filed_on, c.decided_on, c.holding, c.status FROM cases c
    WHERE c.pub_state = 'published' AND (c.court_level <> 'foreign' OR c.id IN (SELECT ic.case_id FROM incident_cases ic JOIN incidents i ON i.id = ic.incident_id WHERE i.country = ?))
    ORDER BY COALESCE(c.decided_on, c.filed_on)`, FOCAL);
  blocks.push({ k: "h2", text: "The law", id: "the-law" });
  blocks.push(cases.length ? {
    k: "table",
    headers: ["Case", "Court", "Filed", "Decided", "Status", "Holding"],
    rows: cases.map((c) => [linkCell(`/cases/${c.slug}`, c.caption), c.court, c.filed_on ? proseDate(c.filed_on) : "", c.decided_on ? proseDate(c.decided_on) : "", CASE_STATUS_LABELS[c.status] || c.status, truncate(mdToPlain(c.holding || ""), 240)]),
  } : { k: "p", text: "No United States court case is recorded yet." });

  // Sources
  const nowSourceRows = nowIds.length ? await all(env, `SELECT DISTINCT s.* FROM sources s WHERE s.id IN (
      SELECT source_id FROM incident_sources WHERE incident_id IN (${NOW_SQL})
      UNION SELECT source_id FROM claims WHERE subject_type = 'incident' AND status = 'current' AND subject_id IN (${NOW_SQL}))
    ORDER BY s.published_on DESC, s.publisher, s.id`, FOCAL, NOW_FROM, FOCAL, NOW_FROM) : [];
  const srcs = nowSourceRows.map(sourceObject);
  blocks.push({ k: "h2", text: "Sources", id: "sources" });
  blocks.push({ k: "p", text: "The sources cited by the 2025 and 2026 incidents above, newest first. Each incident's own page lists its sources with the claims they support." });
  blocks.push({ k: "sources", sources: srcs });
  if (us && us.press_freedom_source_url) blocks.push({ k: "html", html: `<p>RSF rank: ${a(us.press_freedom_source_url, "World Press Freedom Index, Reporters Without Borders")}.</p>`, text: `RSF rank: ${us.press_freedom_source_url}` });

  return {
    path: "/united-states",
    title: "The United States",
    subtitle: "The focal chapter: 2025 to 2026, the record since 1917, and where each tactic in use now has led elsewhere",
    metaDescription: "What the government of the United States has done to journalists in 2025 and 2026, the record since 1917, and where each tactic in use now has led in other countries.",
    breadcrumbs: [{ name: "Countries", path: "/countries" }],
    blocks,
    updatedAt: rows.map((r) => r.updated_at).sort().pop() || null,
    data: {
      title: "The United States", country: FOCAL, rsf: rsfData(us), counts_caveat: COUNTS_CAVEAT, url: `${SITE_ORIGIN}/united-states`, country_url: `${SITE_ORIGIN}/countries/us`,
      now: { from: NOW_FROM, incidents: nowJson },
      how_it_got_here: historyJson,
      tactics_in_use_now: tacticsJson,
      the_law: cases.map((c) => ({ slug: c.slug, caption: c.caption, court: c.court, docket: c.docket, filed_on: c.filed_on, decided_on: c.decided_on, status: c.status, holding: mdToPlain(c.holding || "") || null, url: `${SITE_ORIGIN}/cases/${c.slug}` })),
      sources: srcs,
      license: LICENSE,
    },
  };
}

