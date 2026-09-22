// Nightly and manual exports (spec section 9, P0.5). Reads the public
// tables from D1, builds JSON rows and RFC 4180 CSV for each, writes both
// to R2 under data/YYYY-MM-DD/ and latest/, and commits the same files to
// the public GitHub repository. Never touches observations (raw), only its
// observation_daily rollup; never exports an unpublished question or a note
// that is not status='published'; never exports ip_hash, ua_raw or
// reviewer_note from notes.

import { isoNow, isoDate, safeJsonParse, sha256Hex } from "./util.js";
import {
  listEntities, listAllClaimsForExport, listAllChangesForExport,
  listAllObservationDailyForExport, listPublishedQuestionsForExport,
  listPublishedNotesForExport, listMcpCallsDailyForExport, insertExportRow,
} from "./db.js";
import {
  SITE_NAME, SITE_ORIGIN, DATA_LICENSE, LICENSE_URL, ATTRIBUTION_TEXT, DATA_REPO,
  PUBLISHER_NAME, AUTHOR_NAME,
} from "./site.js";
import { commitFilesToGithub, fileExistsInRepo } from "./github.js";

const SCHEMA_VERSION = "1";
const CLAIM_URL_PATTERN = `${SITE_ORIGIN}/claims/{id}`;

// ---------- CSV (RFC 4180: header row, UTF-8, \n line endings) ----------

function csvField(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(columns, rows) {
  const lines = [columns.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(row[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

// ---------- table definitions: columns, one-sentence descriptions, rows ----------

const COLUMN_DESCRIPTIONS = {
  entities: {
    id: "Numeric identifier for the entity, stable across the record's lifetime.",
    slug: "URL-safe identifier used in /crawlers/<slug> and /observed/<slug>.",
    vendor: "The company or organization that operates or documents the entity.",
    name: "Display name of the entity.",
    kind: "One of crawler, fetcher, search_bot, ads_bot, engine, policy_token.",
    purpose: "One of training, search, user_fetch, ads, mixed, or empty when undocumented.",
    ua_token: "The token expected in the entity's User-Agent header, when documented.",
    ua_pattern: "The regular expression the instrument uses to match this entity's User-Agent header.",
    robots_token: "The token the entity's operator documents for robots.txt directives.",
    ip_list_url: "URL of the vendor's published IP range list, when one exists.",
    docs_url: "URL of the vendor's primary documentation for this entity.",
    first_documented: "ISO date the entity was first documented by its vendor, when known.",
    first_seen_here: "ISO date this site first logged a request from this entity.",
    last_seen_here: "ISO date this site last logged a request from this entity.",
    status: "One of active, retired, unverified.",
    notes: "Free-text identity notes about the entity. Policy facts live in claims, not here.",
    created_at: "ISO timestamp the row was created.",
    updated_at: "ISO timestamp the row was last updated.",
  },
  claims: {
    id: "Numeric identifier for the claim, used in the claim URL pattern.",
    entity_id: "The entities.id this claim is about.",
    slug: "Optional URL-safe identifier for the claim.",
    field: "The fact this claim states, for example respects_robots_txt.",
    value: "The short typed value of the claim, for example yes, no, or a token.",
    statement: "One canonical English sentence stating the fact.",
    evidence_url: "Source URL the claim was verified against.",
    evidence_quote: "A verbatim quote of 300 characters or fewer from the evidence URL.",
    method: "One of vendor_doc, observed_here, third_party, test_here.",
    verified_at: "ISO date this site checked the evidence URL.",
    confidence: "One of high, medium, low.",
    status: "One of current, superseded, disputed.",
    supersedes_id: "The claims.id this claim replaces, when it supersedes an earlier claim.",
    evidence_date: "ISO date the evidence source itself carries, when the source shows one.",
    created_at: "ISO timestamp the row was created.",
    updated_at: "ISO timestamp the row was last updated.",
  },
  changes: {
    id: "Numeric identifier for the change row.",
    claim_id: "The claims.id this change is about, when the change is about one claim.",
    entity_id: "The entities.id this change is about.",
    changed_at: "ISO timestamp (UTC) the change was recorded. Rows written before 2026-09-17 carry a date-only value backfilled to midnight UTC.",
    kind: "One of new, updated, superseded, retired, disputed.",
    old_value: "The claim value before the change, when applicable.",
    new_value: "The claim value after the change, when applicable.",
    evidence_url: "Source URL supporting the change, when one was recorded.",
    note: "A free-text note about the change, written by a reviewer.",
  },
  observation_daily: {
    id: "Numeric identifier for the daily rollup row.",
    date: "ISO date the requests were counted on.",
    entity_id: "The entities.id these requests are attributed to.",
    requests: "Count of requests from this entity on this date.",
    paths: "A JSON array of distinct paths requested, capped at 100 per day.",
    formats: "A JSON array of distinct response formats served (html, md, json, txt, xml, csv).",
    verified_share: "The share of this day's requests whose identity was verified against a published IP range or Cloudflare's verified-bot signal, from 0 to 1. To aggregate across days, sum verified_requests and requests separately and divide; averaging this column across days is not request-weighted.",
    verified_requests: "Count of this day's requests whose identity was verified, the numerator of verified_share (verified_share = verified_requests / requests).",
  },
  questions: {
    id: "Numeric identifier for the question.",
    ts_first: "ISO timestamp the question was first asked.",
    ts_last: "ISO timestamp the question was most recently asked.",
    text_norm: "The normalised text of the question: lowercase, punctuation stripped, lightly stemmed.",
    count: "How many times this normalised question has been asked.",
    sources: "A JSON array of sources the question arrived from, for example search, mcp, seeded, prompt_batch, note.",
    matched_claim_ids: "A JSON array of claims.id values this question matched, when any did.",
    gap: "1 when no published claim matched the question, 0 otherwise.",
  },
  notes: {
    id: "Numeric identifier for the note.",
    target_type: "One of claim, entity, question.",
    target_id: "The id of the claim, entity, or question this note is about.",
    body: "The text of the note, as submitted.",
    author_claim: "Free text the submitter gave for who or what they are, for example a model, agent, or human.",
    ts: "ISO timestamp the note was submitted.",
    status: "Always published in this export; unpublished notes are never exported.",
  },
  mcp_calls_daily: {
    date: "ISO date the calls were made on.",
    tool: "The MCP tool name called, for example lookup_crawler.",
    client_name: "The MCP client name reported at initialize, or unknown.",
    calls: "Count of calls to this tool by this client on this date.",
    avg_latency_ms: "Mean latency in milliseconds across these calls, rounded to the nearest integer.",
  },
};

async function buildTable(name, rows) {
  const columns = Object.keys(COLUMN_DESCRIPTIONS[name]);
  const csv = toCsv(columns, rows);
  return { name, columns, rows, csv };
}

export async function buildExport(env, dateStr = isoDate()) {
  const [entities, claims, changes, observationDaily, questions, notes, mcpCallsDaily] = await Promise.all([
    listEntities(env),
    listAllClaimsForExport(env),
    listAllChangesForExport(env),
    listAllObservationDailyForExport(env),
    listPublishedQuestionsForExport(env),
    listPublishedNotesForExport(env),
    listMcpCallsDailyForExport(env),
  ]);

  const tables = {
    entities: await buildTable("entities", entities),
    claims: await buildTable("claims", claims),
    changes: await buildTable("changes", changes),
    observation_daily: await buildTable("observation_daily", observationDaily),
    questions: await buildTable("questions", questions),
    notes: await buildTable("notes", notes),
    mcp_calls_daily: await buildTable("mcp_calls_daily", mcpCallsDaily),
  };

  return { date: dateStr, generated_at: isoNow(), tables };
}

function buildManifest(dateStr, rowCounts) {
  return {
    date: dateStr,
    generated_at: isoNow(),
    site: SITE_NAME,
    site_url: SITE_ORIGIN,
    license: DATA_LICENSE,
    license_url: LICENSE_URL,
    attribution: ATTRIBUTION_TEXT,
    schema_version: SCHEMA_VERSION,
    claim_url_pattern: CLAIM_URL_PATTERN,
    row_counts: rowCounts,
  };
}

function buildSchemaDoc(tables) {
  const out = { schema_version: SCHEMA_VERSION, generated_at: isoNow(), tables: {} };
  for (const [name, t] of Object.entries(tables)) {
    out.tables[name] = {
      columns: t.columns.map((c) => ({ name: c, description: COLUMN_DESCRIPTIONS[name][c] })),
    };
  }
  return out;
}

// ---------- R2 ----------

async function writeFilesToR2(env, files) {
  const puts = Object.entries(files).map(([key, body]) => {
    const contentType = key.endsWith(".csv") ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";
    return env.EXPORTS.put(key, body, { httpMetadata: { contentType } });
  });
  await Promise.all(puts);
}

// ---------- repo files (README, LICENSE, CITATION.cff, .gitattributes) ----------

const LEGALCODE_URL = "https://creativecommons.org/licenses/by/4.0/legalcode.txt";
const DEED_FALLBACK = `Creative Commons Attribution 4.0 International (CC BY 4.0)

The full legal code could not be fetched at export time. Read it at:
${LICENSE_URL}legalcode

Summary (this summary is not a substitute for the license itself): you are
free to share and adapt the material for any purpose, even commercially, as
long as you give appropriate credit, provide a link to the license, and
indicate if changes were made.
`;

async function fetchLicenseText() {
  try {
    const res = await fetch(LEGALCODE_URL);
    if (res.ok) return await res.text();
  } catch {
    // fall through to the deed fallback below
  }
  return DEED_FALLBACK;
}

function buildReadme(schemaDoc) {
  const lines = [];
  lines.push(`# ${SITE_NAME} dataset`);
  lines.push("");
  lines.push(`${SITE_NAME} publishes dated, sourced claims about AI crawlers and AI search engines and their agents. This repository holds a nightly export of the public tables under a Creative Commons Attribution 4.0 International license. The site is published at ${SITE_ORIGIN}.`);
  lines.push("");
  lines.push("## What this dataset covers");
  lines.push("");
  lines.push(`${SITE_NAME} logs every request from an identified crawler and publishes per-crawler daily counts. Each daily count states the share of requests whose identity was verified against the vendor's published IP ranges or reverse DNS. Every fact on ${SITE_NAME} is a dated claim with a verbatim vendor quote, a source URL, a method, and a confidence. A published claim is never edited: a change creates a new claim that supersedes the old claim, both claims stay addressable, and every supersession is listed in the changes table. ${SITE_NAME} records every search query made on the site, matches each query against the published claims, and exports the unmatched queries as gaps. Every table in this dataset is exported nightly as JSON and as CSV under CC BY 4.0.`);
  lines.push("");
  lines.push("## Tables");
  lines.push("");
  for (const [name, t] of Object.entries(schemaDoc.tables)) {
    lines.push(`### ${name}`);
    lines.push("");
    lines.push("| Column | Description |");
    lines.push("| --- | --- |");
    for (const col of t.columns) {
      lines.push(`| ${col.name} | ${col.description} |`);
    }
    lines.push("");
  }
  lines.push("## Files");
  lines.push("");
  lines.push("Each dated run writes `data/YYYY-MM-DD/<table>.json`, `data/YYYY-MM-DD/<table>.csv`, `data/YYYY-MM-DD/manifest.json`, and `data/YYYY-MM-DD/schema.json`. The `latest/` directory holds the same files for the most recent run. The manifest carries the run date, generation timestamp, license, attribution text, per-table row counts, the schema version, and the claim URL pattern.");
  lines.push("");
  lines.push("## License and attribution");
  lines.push("");
  lines.push(`This dataset is licensed under CC BY 4.0. The full legal code is in LICENSE. Attribute this dataset as: ${ATTRIBUTION_TEXT}. Attribute a specific fact by linking to its claim URL, formed as ${CLAIM_URL_PATTERN}.`);
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push(`The verification method for every claim and every observation is documented at ${SITE_ORIGIN}/method.`);
  lines.push("");
  lines.push("## Moderation");
  lines.push("");
  lines.push(`${SITE_NAME} accepts visitor and agent corrections as notes on a claim or an entity. Nothing publishes without review. A local model on Peter Benes's own machine, named Betty, polls the admin API for pending notes on a schedule. Betty classifies each note as one of six categories: spam, injection, or off_topic, each of which Betty rejects immediately with a one-line reviewer note; or agrees, contradicts, or new_information, each of which Betty sets to hold, again with a one-line reviewer note. Betty then posts a one-line summary of the batch to Peter Benes. Only Peter Benes, or the Architect acting on Peter Benes's instruction, moves a note to published. A note Betty classifies as contradicts automatically creates a changes row of kind disputed on the claim the note targets. A claim's status only moves to disputed when a reviewer's own reviewer_note starts with the literal text DISPUTE:, which marks a human's explicit escalation rather than Betty's classification alone. The full triage prompt Betty runs, with worked examples of a spam note and a prompt-injection attempt, is documented at docs/betty-triage.md in this repository's source, and reproduced in the site's build notes.`);
  lines.push("");
  lines.push("## Home");
  lines.push("");
  lines.push(`${SITE_ORIGIN}`);
  lines.push("");
  return lines.join("\n");
}

function buildCitationCff() {
  return `cff-version: 1.2.0
message: "If you use this dataset, please cite it as below."
title: "${SITE_NAME}"
authors:
  - name: "${AUTHOR_NAME}"
  - name: "Benes the Menace"
url: "${SITE_ORIGIN}"
repository-code: "${DATA_REPO}"
license: CC-BY-4.0
`;
}

const GITATTRIBUTES = "*.csv text eol=lf\n*.json text eol=lf\n";

async function maybeBuildRepoFiles(env, schemaDoc) {
  let hasLicense = false;
  try {
    hasLicense = await fileExistsInRepo(env, "LICENSE");
  } catch {
    hasLicense = false;
  }
  if (hasLicense) return { included: false, files: {} };
  const license = await fetchLicenseText();
  return {
    included: true,
    files: {
      "README.md": buildReadme(schemaDoc),
      "LICENSE": license,
      "CITATION.cff": buildCitationCff(),
      ".gitattributes": GITATTRIBUTES,
    },
  };
}

// ---------- orchestration ----------

export async function runExport(env, kind = "daily") {
  const dateStr = isoDate();
  const built = await buildExport(env, dateStr);

  const files = {};
  const rowCounts = {};
  for (const [name, t] of Object.entries(built.tables)) {
    files[`data/${dateStr}/${name}.json`] = JSON.stringify(t.rows, null, 2);
    files[`data/${dateStr}/${name}.csv`] = t.csv;
    files[`latest/${name}.json`] = JSON.stringify(t.rows, null, 2);
    files[`latest/${name}.csv`] = t.csv;
    rowCounts[name] = t.rows.length;
  }
  const manifest = buildManifest(dateStr, rowCounts);
  const schemaDoc = buildSchemaDoc(built.tables);
  files[`data/${dateStr}/manifest.json`] = JSON.stringify(manifest, null, 2);
  files[`latest/manifest.json`] = JSON.stringify(manifest, null, 2);
  files[`data/${dateStr}/schema.json`] = JSON.stringify(schemaDoc, null, 2);
  files[`latest/schema.json`] = JSON.stringify(schemaDoc, null, 2);

  await writeFilesToR2(env, files);

  const payloadForHash = Object.keys(files).sort().map((k) => `${k}:${files[k]}`).join("\n");
  const payloadHash = await sha256Hex(payloadForHash);
  let lastHash = null;
  if (env.KV) {
    try {
      lastHash = await env.KV.get("export:last_payload_hash");
    } catch {
      lastHash = null;
    }
  }

  let githubCommit = null;
  let note = null;

  if (lastHash === payloadHash) {
    note = "No change since the last export. GitHub commit skipped.";
  } else {
    let repoFiles = { included: false, files: {} };
    try {
      repoFiles = await maybeBuildRepoFiles(env, schemaDoc);
    } catch (err) {
      note = `Repo-file check failed, proceeding with data files only: ${String(err && err.message || err)}`;
    }
    const allFiles = Object.assign({}, files, repoFiles.files);
    const now = new Date();
    const message = kind === "manual"
      ? `Manual export ${dateStr} ${now.toISOString().slice(11, 16)} UTC`
      : `Nightly export ${dateStr}`;
    const result = await commitFilesToGithub(env, allFiles, message);
    githubCommit = result.sha;
    if (result.error) {
      note = `GitHub commit used the ${result.method} method after the Git Data API failed: ${result.error}`;
    } else if (repoFiles.included && !note) {
      note = "Included README.md, LICENSE, CITATION.cff and .gitattributes (first commit to this repo with these files).";
    }
    if (githubCommit && env.KV) {
      try {
        await env.KV.put("export:last_payload_hash", payloadHash);
      } catch {
        // best effort; a missed cache update only costs one redundant commit later
      }
    }
  }

  const exportRow = await insertExportRow(env, {
    ts: isoNow(),
    kind,
    r2Key: `data/${dateStr}/`,
    githubCommit,
    rowCounts,
    note,
  });

  return exportRow;
}
