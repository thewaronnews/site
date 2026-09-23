// The open knowledge export (spec 4.5): a Frictionless Data Package (v2
// profile, tabular resources that v1 validators accept) of the public
// record, written nightly to R2 (data/YYYY-MM-DD/ and latest/, served at
// /data/...) and, when GITHUB_TOKEN is set, committed to the data repo.
// Not exported: submissions, instrument tables, questions, mcp_calls,
// admin_*, revisions. Published rows only, plus withdrawn rows with prose
// nulled; reverted notes keep revert_reason with a null note.

import { isoNow, isoDate, sha256Hex } from "./util.js";
import { all, insertExportRow } from "./db.js";
import { ENUMS } from "./records.js";
import { commitFilesToGithub, githubConfigured } from "./github.js";
import {
  SITE_NAME, SITE_ORIGIN, SITE_SUBTITLE, DATA_LICENSE, DATA_LICENSE_SPDX, LICENSE_URL, ATTRIBUTION_TEXT,
  PUBLISHER_NAME, DATAPACKAGE_NAME, DATA_REPO_DEFAULT,
} from "./site.js";

const PROSE = {
  incidents: ["summary", "what_happened", "stated_justification", "effect_on_reporting", "unknowns"],
  cases: ["holding", "unknowns"],
  actors: ["unknowns"],
  outlets: ["unknowns"],
  explainers: ["body_md", "dek", "unknowns"],
  glossary_terms: ["definition", "body_md"],
};

// table -> {sql, pk, fks, enums, descriptions}
function tableDefs() {
  const visible = (t) => `SELECT id FROM ${t} WHERE pub_state IN ('published','withdrawn')`;
  return {
    incidents: { sql: `SELECT * FROM incidents WHERE pub_state IN ('published','withdrawn') ORDER BY id`, pk: ["id"], enums: { occurred_on_precision: "precision", level: "level", type: "incident_type", status: "incident_status", outcome: "outcome", granularity: "granularity", stage: "stage", pub_state: null }, desc: "One row per recorded incident: a dated government action that limited reporting." },
    events: { sql: `SELECT * FROM events WHERE pub_state = 'published' AND (incident_id IN (${visible("incidents")}) OR case_id IN (${visible("cases")})) ORDER BY id`, pk: ["id"], fks: [["incident_id", "incidents"], ["case_id", "cases"], ["claim_id", "claims"]], enums: { occurred_on_precision: "precision", kind: "event_kind" }, desc: "Dated developments of an incident or case, each backed by a claim." },
    actors: { sql: `SELECT * FROM actors WHERE pub_state IN ('published','withdrawn') ORDER BY id`, pk: ["id"], enums: { kind: "actor_kind", body_type: "body_type" }, desc: "Officials and bodies named in incidents. No descriptive or party field by design." },
    outlets: { sql: `SELECT * FROM outlets WHERE pub_state IN ('published','withdrawn') ORDER BY id`, pk: ["id"], enums: { kind: "outlet_kind" }, desc: "News organizations named in incidents." },
    journalists: { sql: `SELECT * FROM journalists WHERE pub_state IN ('published','withdrawn') ORDER BY id`, pk: ["id"], fks: [["outlet_id", "outlets"]], desc: "Journalists named in incidents; professional facts only." },
    cases: { sql: `SELECT * FROM cases WHERE pub_state IN ('published','withdrawn') ORDER BY id`, pk: ["id"], enums: { court_level: "court_level", status: "case_status" }, desc: "Court cases connected to incidents." },
    sources: { sql: `SELECT id, url, final_url, title, publisher, outlet_id, source_kind, published_on, first_seen, last_checked, http_status, link_state, link_state_since, consecutive_failures, wayback_url, wayback_saved_at, archive_attempts, created_at FROM sources ORDER BY id`, pk: ["id"], enums: { source_kind: "source_kind" }, desc: "Every source the record cites, with its latest link state and Wayback snapshot." },
    claims: { sql: `SELECT * FROM claims WHERE (subject_type = 'incident' AND subject_id IN (${visible("incidents")})) OR (subject_type = 'case' AND subject_id IN (${visible("cases")})) OR (subject_type = 'actor' AND subject_id IN (${visible("actors")})) OR (subject_type = 'outlet' AND subject_id IN (${visible("outlets")})) OR (subject_type = 'journalist' AND subject_id IN (${visible("journalists")})) OR subject_type = 'event' ORDER BY id`, pk: ["id"], fks: [["source_id", "sources"]], enums: { method: "method", confidence: "confidence" }, desc: "The atomic record: one dated statement with a verbatim quote, source, method and check date. All statuses; claims are append-only." },
    tactics: { sql: `SELECT * FROM tactics ORDER BY sort`, pk: ["slug"], desc: "The fixed taxonomy of tactics governments use against journalists, with a plain definition of each." },
    countries: { sql: `SELECT * FROM countries ORDER BY iso2`, pk: ["iso2"], desc: "ISO 3166-1 countries with continent, UN M49 region and the latest RSF World Press Freedom Index rank where recorded." },
    incident_tactics: { sql: `SELECT * FROM incident_tactics WHERE incident_id IN (${visible("incidents")})`, pk: ["incident_id", "tactic_slug"], fks: [["incident_id", "incidents"]], desc: "The tactics each incident used; is_primary marks the main one." },
    coverage_items: { sql: `SELECT id, url, title, publisher, published_at, summary, jev_in_scope, jev_model, tactic_guess, tactic_confidence, country_guess, incident_id, fetched_at FROM coverage_items WHERE state = 'shown' ORDER BY id`, pk: ["id"], desc: "Recent coverage: links to reporting from the last 60 days, with the automated relevance score and tactic and country guesses. Headlines and summaries belong to their publishers." },
    explainers: { sql: `SELECT * FROM explainers WHERE pub_state IN ('published','withdrawn') ORDER BY id`, pk: ["id"], desc: "Explainer articles." },
    glossary_terms: { sql: `SELECT * FROM glossary_terms WHERE pub_state IN ('published','withdrawn') ORDER BY id`, pk: ["id"], desc: "Glossary terms and definitions." },
    incident_actors: { sql: `SELECT * FROM incident_actors WHERE incident_id IN (${visible("incidents")}) AND actor_id IN (${visible("actors")})`, pk: ["incident_id", "actor_id", "role"], fks: [["incident_id", "incidents"], ["actor_id", "actors"]], enums: { role: "actor_role" }, desc: "Which actors took part in which incidents, and in what role." },
    incident_outlets: { sql: `SELECT * FROM incident_outlets WHERE incident_id IN (${visible("incidents")}) AND outlet_id IN (${visible("outlets")})`, pk: ["incident_id", "outlet_id", "relation"], fks: [["incident_id", "incidents"], ["outlet_id", "outlets"]], enums: { relation: "outlet_relation" }, desc: "Outlets affected by or party to incidents." },
    incident_journalists: { sql: `SELECT * FROM incident_journalists WHERE incident_id IN (${visible("incidents")}) AND journalist_id IN (${visible("journalists")})`, pk: ["incident_id", "journalist_id", "relation"], fks: [["incident_id", "incidents"], ["journalist_id", "journalists"]], enums: { relation: "journalist_relation" }, desc: "Journalists affected by or party to incidents." },
    incident_cases: { sql: `SELECT * FROM incident_cases WHERE incident_id IN (${visible("incidents")}) AND case_id IN (${visible("cases")})`, pk: ["incident_id", "case_id", "relation"], fks: [["incident_id", "incidents"], ["case_id", "cases"]], enums: { relation: "case_relation" }, desc: "Cases arising from incidents or cited as precedent." },
    incident_sources: { sql: `SELECT * FROM incident_sources WHERE incident_id IN (${visible("incidents")})`, pk: ["incident_id", "source_id"], fks: [["incident_id", "incidents"], ["source_id", "sources"]], enums: { role: "source_role" }, desc: "Sources cited by each incident." },
    incident_related: { sql: `SELECT * FROM incident_related WHERE incident_id IN (${visible("incidents")}) AND related_id IN (${visible("incidents")})`, pk: ["incident_id", "related_id"], fks: [["incident_id", "incidents"]], enums: { relation: "related_relation" }, desc: "Links between related incidents." },
    case_parties: { sql: `SELECT * FROM case_parties WHERE case_id IN (${visible("cases")})`, pk: ["case_id", "party_type", "party_id", "side"], fks: [["case_id", "cases"]], enums: { party_type: "party_type", side: "side" }, desc: "Parties to each case." },
    case_sources: { sql: `SELECT * FROM case_sources WHERE case_id IN (${visible("cases")})`, pk: ["case_id", "source_id"], fks: [["case_id", "cases"], ["source_id", "sources"]], enums: { role: "case_source_role" }, desc: "Court documents and reporting for each case." },
    explainer_sources: { sql: `SELECT * FROM explainer_sources WHERE explainer_id IN (${visible("explainers")})`, pk: ["explainer_id", "source_id"], fks: [["explainer_id", "explainers"], ["source_id", "sources"]], desc: "Sources cited by explainers." },
    glossary_sources: { sql: `SELECT * FROM glossary_sources WHERE term_id IN (${visible("glossary_terms")})`, pk: ["term_id", "source_id"], fks: [["term_id", "glossary_terms"], ["source_id", "sources"]], desc: "Sources for glossary terms." },
    changes: { sql: `SELECT * FROM changes ORDER BY id`, pk: ["id"], desc: "The public ledger of new, superseded, disputed and retired claims, publications, revisions, withdrawals, reverted notes and link-state changes." },
  };
}

const INT_COLS = new Set(["id", "revision", "sort", "word_count", "surfer_score", "surfer_exception", "http_status", "consecutive_failures", "archive_attempts", "is_correction", "party_id"]);
const DATETIME_COLS = new Set(["created_at", "updated_at", "published_at", "changed_at", "reverted_at", "first_seen", "last_checked", "link_state_since"]);
const DATE_COLS = new Set(["occurred_on", "ended_on", "status_updated_on", "reviewed_on", "next_review_on", "filed_on", "decided_on", "term_start", "term_end", "story_date"]);

const COMMON_DESC = {
  id: "Stable numeric identifier.",
  slug: "URL identifier; the record lives at https://thewaronnews.com/<section>/<slug>.",
  pub_state: "draft, published or withdrawn. Withdrawn rows keep identity fields; prose is null.",
  published_at: "UTC timestamp of first publication.",
  reviewed_on: "Date of the last full review against sources.",
  next_review_on: "Date the next full review is due.",
  revision: "Revision number; every prose change appends a revision.",
  created_at: "UTC timestamp the row was created.",
  updated_at: "UTC timestamp of the last content change.",
  unknowns: "What the record does not establish, stated in terms of the record.",
  occurred_on: "Date of the action (first day of the period when imprecise).",
  occurred_on_precision: "day, month, year or approximate.",
  jurisdiction: "US (federal), ISO 3166-2 (US-LA), place (US-LA:new-orleans) or ISO 3166-1 alpha-2.",
  country: "ISO 3166-1 alpha-2 country code.",
  status: "Status value from the table's enumerated list.",
  summary: "Direct answer to what happened, with {c:ID} claim references.",
  what_happened: "Narrative of the action, Markdown with {c:ID} claim references.",
  stated_justification: "The reason the actor gave, quoted verbatim, with claim references.",
  effect_on_reporting: "What changed for reporting, with claim references.",
  statement: "One English sentence stating the fact.",
  evidence_quote: "Verbatim quotation of 300 characters or fewer from the source.",
  verified_at: "Date the claim was checked against its source.",
  method: "How the claim is established.",
  source_id: "sources.id the claim or note rests on.",
  link_state: "unchecked, live, paywalled, bot_blocked, dead or redirected.",
  wayback_url: "Internet Archive snapshot of the source.",
};

function fieldType(col) {
  if (INT_COLS.has(col) || /_id$/.test(col)) return "integer";
  if (DATETIME_COLS.has(col)) return "datetime";
  if (DATE_COLS.has(col)) return "date";
  return "string";
}

function csvField(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const lines = [columns.map(csvField).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvField(r[c])).join(","));
  return lines.join("\n") + "\n";
}

async function columnsOf(env, table, rows) {
  if (rows.length) return Object.keys(rows[0]);
  if (table === "sources") return ["id", "url", "final_url", "title", "publisher", "outlet_id", "source_kind", "published_on", "first_seen", "last_checked", "http_status", "link_state", "link_state_since", "consecutive_failures", "wayback_url", "wayback_saved_at", "archive_attempts", "created_at"];
  const info = await all(env, `PRAGMA table_info(${table})`);
  return info.map((c) => c.name);
}

function tableSchema(table, def, columns) {
  const fields = columns.map((c) => {
    const f = { name: c, type: fieldType(c), description: COMMON_DESC[c] || `${c.replace(/_/g, " ")} (${table}).` };
    const en = def.enums && def.enums[c];
    if (en && ENUMS[en]) f.constraints = { enum: ENUMS[en] };
    if (c === "pub_state") f.constraints = { enum: ["published", "withdrawn"] };
    return f;
  });
  const schema = { fields, primaryKey: def.pk };
  if (def.fks && def.fks.length) {
    schema.foreignKeys = def.fks.filter(([col]) => columns.includes(col)).map(([col, ref]) => ({ fields: [col], reference: { resource: ref, fields: ["id"] } }));
  }
  return schema;
}

export async function buildExport(env, dateStr = isoDate()) {
  const defs = tableDefs();
  const tables = {};
  for (const [name, def] of Object.entries(defs)) {
    let rows = await all(env, def.sql);
    if (PROSE[name]) {
      rows = rows.map((r) => {
        if (r.pub_state !== "withdrawn") return r;
        const c = { ...r };
        for (const col of PROSE[name]) c[col] = null;
        return c;
      });
    }
    const columns = await columnsOf(env, name, rows);
    tables[name] = { rows, columns, csv: toCsv(columns, rows), schema: tableSchema(name, def, columns), description: def.desc };
  }
  return { date: dateStr, tables };
}

function datapackage(dateStr, tables, repo) {
  return {
    $schema: "https://datapackage.org/profiles/2.0/datapackage.json",
    name: DATAPACKAGE_NAME,
    title: SITE_NAME,
    description: `${SITE_SUBTITLE} The public record of ${SITE_ORIGIN}: incidents, events, actors, outlets, journalists, cases, sources, claims, tactics, countries, recent coverage, explainers, glossary terms, their join tables and the change ledger.`,
    homepage: SITE_ORIGIN,
    version: dateStr.replace(/-/g, "."),
    created: isoNow(),
    licenses: [{ name: DATA_LICENSE_SPDX, path: LICENSE_URL, title: "Creative Commons Attribution 4.0" }],
    contributors: [{ title: PUBLISHER_NAME, roles: ["publisher", "editor"] }],
    sources: [{ title: SITE_NAME, path: SITE_ORIGIN }],
    keywords: ["press freedom", "journalism", "government", "first amendment", "open data"],
    ...(repo ? { repository: repo } : {}),
    resources: Object.entries(tables).map(([name, t]) => ({
      name,
      path: `data/${name}.csv`,
      type: "table",
      scheme: "file",
      format: "csv",
      mediatype: "text/csv",
      encoding: "utf-8",
      description: t.description,
      schema: t.schema,
    })),
  };
}

function readme(dateStr, rowCounts) {
  const lines = [
    `# ${SITE_NAME}: dataset`,
    "",
    `${SITE_SUBTITLE} This repository is the nightly export of ${SITE_ORIGIN} as a Frictionless Data Package under ${DATA_LICENSE}.`,
    "",
    "Every fact on the site is a claim: one dated statement with a verbatim quotation of up to 300 characters, the source address, the kind of source, the date it was checked and an archived copy. Claims are never edited; a new claim supersedes an old one and both stay in `claims`, linked by `supersedes_id` and `superseded_by`.",
    "",
    "## Files",
    "",
    "- `datapackage.json`: the Data Package descriptor with a Table Schema per table (types, enums, keys).",
    "- `data/<table>.csv`: the latest rows, which the descriptor points to.",
    "- `json/<table>.json`: the same rows as JSON.",
    "- `snapshots/YYYY-MM-DD/`: weekly snapshots (Sundays and on schema change).",
    "",
    `## Tables (export of ${dateStr})`,
    "",
    "| Table | Rows |",
    "| --- | --- |",
    ...Object.entries(rowCounts).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Licence and attribution",
    "",
    `${DATA_LICENSE} (${LICENSE_URL}). Credit: "${ATTRIBUTION_TEXT}". Cite a single fact by its claim URL, ${SITE_ORIGIN}/claims/<id>. Quotations and linked sources keep their owners' terms.`,
    "",
    "## Method",
    "",
    `See ${SITE_ORIGIN}/methodology and ${SITE_ORIGIN}/editorial-policy.`,
    "",
  ];
  return lines.join("\n");
}

function citationCff(dateStr) {
  return `cff-version: 1.2.0
message: "If you use this dataset, please cite it as below."
title: "${SITE_NAME}"
type: dataset
authors:
  - name: "${PUBLISHER_NAME}"
version: "${dateStr.replace(/-/g, ".")}"
date-released: "${dateStr}"
url: "${SITE_ORIGIN}"
license: ${DATA_LICENSE_SPDX}
`;
}

const LICENSE_FALLBACK = `Creative Commons Attribution 4.0 International (CC BY 4.0)

Full legal code: ${LICENSE_URL}legalcode

You are free to share and adapt this material for any purpose, even
commercially, with appropriate credit, a link to the licence, and an
indication of any changes.
`;

async function licenseText() {
  try {
    const res = await fetch("https://creativecommons.org/licenses/by/4.0/legalcode.txt");
    if (res.ok) return await res.text();
  } catch {
    // fallback below
  }
  return LICENSE_FALLBACK;
}

function contentTypeFor(key) {
  if (key.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (key.endsWith(".json")) return "application/json; charset=utf-8";
  if (key.endsWith(".md")) return "text/markdown; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export async function runExport(env, kind = "daily") {
  const dateStr = isoDate();
  const built = await buildExport(env, dateStr);
  const repo = env.DATA_REPO || DATA_REPO_DEFAULT;
  const rowCounts = {};
  const pkgFiles = {};
  for (const [name, t] of Object.entries(built.tables)) {
    pkgFiles[`data/${name}.csv`] = t.csv;
    pkgFiles[`json/${name}.json`] = JSON.stringify(t.rows, null, 2);
    rowCounts[name] = t.rows.length;
  }
  const dp = datapackage(dateStr, built.tables, repo);
  pkgFiles["datapackage.json"] = JSON.stringify(dp, null, 2);
  pkgFiles["README.md"] = readme(dateStr, rowCounts);
  pkgFiles["CITATION.cff"] = citationCff(dateStr);
  pkgFiles["LICENSE"] = await licenseText();

  const notes = [];
  if (env.EXPORTS) {
    const puts = [];
    for (const [path, body] of Object.entries(pkgFiles)) {
      puts.push(env.EXPORTS.put(`data/${dateStr}/${path}`, body, { httpMetadata: { contentType: contentTypeFor(path) } }));
      puts.push(env.EXPORTS.put(`latest/${path}`, body, { httpMetadata: { contentType: contentTypeFor(path) } }));
    }
    await Promise.all(puts);
  } else {
    notes.push("R2 binding missing; nothing written.");
  }

  // Unchanged payload (ignoring timestamps) skips the GitHub commit.
  const hashBasis = Object.entries(pkgFiles).filter(([p]) => p !== "datapackage.json" && p !== "CITATION.cff" && p !== "README.md").map(([p, b]) => `${p}:${b}`).join("\n");
  const payloadHash = await sha256Hex(hashBasis);
  let githubCommit = null;
  if (!githubConfigured(env)) {
    notes.push("GitHub skipped: GITHUB_TOKEN, GITHUB_ORG or GITHUB_REPO not set.");
  } else {
    let last = null;
    try { last = env.KV ? await env.KV.get("export:last_payload_hash") : null; } catch { last = null; }
    if (last === payloadHash) {
      notes.push("No change since the last export; GitHub commit skipped.");
    } else {
      const files = { ...pkgFiles };
      const sunday = new Date(`${dateStr}T00:00:00Z`).getUTCDay() === 0;
      if (sunday) {
        for (const [p, b] of Object.entries(pkgFiles)) {
          if (p.startsWith("data/") || p.startsWith("json/") || p === "datapackage.json") files[`snapshots/${dateStr}/${p}`] = b;
        }
      }
      const res = await commitFilesToGithub(env, files, `${kind === "manual" ? "Manual" : "Nightly"} export ${dateStr}`);
      githubCommit = res.sha;
      if (res.error) notes.push(`GitHub: ${res.method}: ${res.error}`);
      if (githubCommit && env.KV) {
        try { await env.KV.put("export:last_payload_hash", payloadHash); } catch { /* best effort */ }
      }
    }
  }

  return insertExportRow(env, {
    ts: isoNow(), kind, r2Key: `data/${dateStr}/`, githubCommit, rowCounts, version: dp.version, note: notes.join(" ") || null,
  });
}
