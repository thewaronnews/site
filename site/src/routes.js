import {
  listEntities, getEntityBySlug, getEntityById,
  listClaimsForEntity, getClaim, listAllCurrentClaims,
  listChanges, listObservationDailyForEntity, listObservationDaily,
  observationWindowSummary, observationWindowFormats,
  upsertQuestion, insertNote,
  listPublishedQuestions, listGapQuestions, listPublishedNotesForTarget,
  searchEntitiesAndClaims, getLastExport, getQuestionById,
} from "./db.js";
import {
  SITE_NAME, SITE_DESCRIPTOR, SITE_ORIGIN, HOME_INTRO, HOME_DIFFERENTIATORS, METHOD_INTRO, METHOD_STATUS, METHOD_OBSERVED_HERE,
  NOTES_INVITATION, CLAIMS_INTRO, LICENSE_URL, ATTRIBUTION_TEXT, PUBLISHED_BY_SENTENCE, PUBLISHED_BY_SENTENCE_HTML,
  QUESTIONS_SUMMARY_TEMPLATE, QUESTIONS_LABEL_SENTENCE, DATA_REPO, DATA_LICENSE, NOTE_SUBMITTED_CONFIRMATION,
  UNVERIFIED_REQUEST_SENTENCE, NO_CHANGES_SENTENCE,
  OBSERVATIONS_HOME_TEMPLATE, OBSERVATIONS_FALLBACK_TEXT,
  DEFINITION_CRAWLERS, DEFINITION_CLAIMS, DEFINITION_CHANGES, DEFINITION_OBSERVED, DEFINITION_OBSERVED_ENTITY,
  DEFINITION_QUESTIONS, DEFINITION_DATA, DEFINITION_METHOD, DEFINITION_SEARCH, DEFINITION_ENTITY, DEFINITION_CLAIM,
  KIND_GLOSS, BLOCKING_HEADING, BLOCKING_SENTENCES,
  CRAWLERS_HOME_HEADING, CHANGES_HOME_HEADING, OBSERVATIONS_HOME_HEADING, QUESTIONS_HOME_HEADING,
  OBSERVATIONS_TABLE_INTRO, QUESTIONS_GAP_SENTENCE,
  RELATED_HEADING, FIELDS_LINK_HOME_SENTENCE, COMPARE_LINK_HOME_SENTENCE, COMPARE_WITH_HEADING, FIELDS_LINK_ENTITY_SENTENCE_TEMPLATE,
  DATASET_CONCEPT_DOI, DATASET_VERSION_DOI, DATASET_VERSION, DATASET_ZENODO_URL, DATASET_DOI_SENTENCE, DATASET_DOI_SENTENCE_HTML,
} from "./site.js";
import { escapeHtml, isoNow, isoDate, normalizeQuestion, sha256Hex, safeJsonParse, a } from "./util.js";
import { publisherOrg, authorPerson, searchFormBlock, noteFormBlock } from "./render.js";
import { listPaths as compareListPaths } from "./compare.js";

function link(href, text, attrs) {
  return { html: a(href, text, attrs), text };
}

function code(text) {
  return { html: `<code>${escapeHtml(text)}</code>`, text };
}

// compareWithLinks(env, entity, entities): "Compare with" links for a
// crawler detail page. SEPARABLE from the rest of the internal-links
// patch: this function plus its one call site in crawlerDetailHandler
// (and the compareWithItems block in that handler's `blocks` array) can
// be removed on their own without affecting the home page or /fields
// links. Filters compare.js's own listPaths() output (never builds
// /compare/<a>-vs-<b> URLs from scratch) so only pairs compare.js
// actually documents are linked; slugs are joined in the same
// alphabetical order compare.js's pairPath requires.
async function compareWithLinks(env, entity, entities) {
  const documentedPaths = new Set(await compareListPaths(env));
  const items = [];
  for (const other of entities) {
    if (other.slug === entity.slug) continue;
    const [slugA, slugB] = [entity.slug, other.slug].sort();
    const path = `/compare/${slugA}-vs-${slugB}`;
    if (documentedPaths.has(path)) {
      items.push({ slug: other.slug, name: other.name, path });
    }
  }
  return items;
}

// Marks a table cell as sentence-like: it may wrap at spaces instead of
// staying on one line like short tokens (dates, values, confidence, etc).
function wrapCell(cell) {
  if (cell && typeof cell === "object") return { ...cell, wrap: true };
  const text = cell === null || cell === undefined ? "" : String(cell);
  return { html: escapeHtml(text), text, wrap: true };
}

function fmtNum(n) {
  return n === null || n === undefined ? "0" : String(n);
}

// ---------- shared: page-definition paragraph (2026-09-15) ----------
// A plain {k:'p'} block renders identically, and correctly, in HTML
// (escaped) and Markdown (as-is), so a definition with no links needs no
// separate html/text pair.
function definitionBlock(text) {
  return { k: "p", text };
}

function fillTemplate(template, values) {
  let out = template;
  for (const [key, val] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(val);
  }
  return out;
}

// KIND_GLOSS: one paragraph above the Crawlers table, on / and on
// /crawlers. The two token names link to their backing claims in HTML
// only (first occurrence of each); plain text in Markdown.
function kindGlossBlock() {
  const text = KIND_GLOSS;
  let html = escapeHtml(text);
  html = html.replace("Google-Extended", a("/claims/62", "Google-Extended"));
  html = html.replace("Applebot-Extended", a("/claims/8", "Applebot-Extended"));
  return { k: "p", text, html };
}

// BLOCKING_BLOCK: a home-page-only section. Each sentence links its claim's
// key phrase in HTML only; Markdown appends "(claim <id>[, claim <id>...])".
const BLOCKING_LINKS = [
  [{ phrase: "train Gemini models", id: 59 }, { phrase: "ground Gemini features", id: 61 }],
  [{ phrase: "does not affect a site's inclusion in Google Search", id: 60 }],
  [{ phrase: "not to be used to train OpenAI's generative AI foundation models", id: 82 }, { phrase: "eligible to appear in ChatGPT search results", id: 83 }],
  [{ phrase: "ChatGPT-User fetches a page when a user asks ChatGPT a question", id: 23 }, { phrase: "robots.txt rules may not apply to a user-initiated fetch", id: 19 }],
  [{ phrase: "IP ranges the vendor publishes", id: 49 }, { phrase: "Google", id: 66 }, { phrase: "Apple", id: 12 }],
];
const BLOCKING_CLAIM_IDS = [
  [59, 61],
  [60],
  [82, 83],
  [19, 23],
  [49, 80, 65, 114, 11, 66, 12],
];

function blockingBlocks() {
  const heading = { k: "h2", text: BLOCKING_HEADING };
  const paras = BLOCKING_SENTENCES.map((sentence, i) => {
    let html = escapeHtml(sentence);
    for (const { phrase, id } of BLOCKING_LINKS[i]) {
      html = html.replace(escapeHtml(phrase), a(`/claims/${id}`, phrase));
    }
    const idsText = BLOCKING_CLAIM_IDS[i].map((id) => `claim ${id}`).join(", ");
    const text = `${sentence} (${idsText})`;
    return { k: "p", text, html };
  });
  return [heading, ...paras];
}

// OBSERVATIONS_HOME_TEMPLATE: the Observations differentiator, filled from
// the request-weighted 30-day summary. summary is already sorted by
// requests DESC (see observationWindowSummary), so summary[0] is the top
// entity. Falls back to the static two-sentence version when there is no
// observation data yet to fill it with.
// Returns two blocks (an h3 lead-in heading, then the paragraph body), not
// one: this is one of the home page's four lead-in sections (2026-09-17),
// promoted from a bold inline label to a real heading in HTML and
// Markdown. The JSON view never sees blocks, so it is unaffected.
function observationsHomeBlock(entitiesById, summary) {
  const top = summary[0];
  if (!top || !top.requests) {
    return [
      { k: "h3", text: "Observations" },
      { k: "p", text: OBSERVATIONS_FALLBACK_TEXT },
    ];
  }
  const entity = entitiesById[top.entity_id];
  const hasIpRange = !!(entity && entity.ip_list_url);
  const vendorPhrase = hasIpRange ? `${entity.vendor}'s published IP ranges` : "published IP ranges or reverse DNS";
  const body = OBSERVATIONS_HOME_TEMPLATE
    .replace("{top_entity}", top.entity_name)
    .replace("{requests}", fmtNum(top.requests))
    .replace("{verified_share}", pctText(top.verified_share))
    .replace("{vendor}'s published IP ranges", vendorPhrase);
  return [
    { k: "h3", text: "Observations" },
    { k: "p", text: body },
  ];
}

// QUESTIONS_HOME_LINE: the home questions sentence, filled from the
// published-question set. Top question = highest count, lowest id on
// ties. The question text links to /questions/<hash> in HTML only.
function pickTopQuestion(published) {
  let best = null;
  for (const q of published) {
    if (!best || q.count > best.count || (q.count === best.count && q.id < best.id)) best = q;
  }
  return best;
}

function questionsHomeLineBlock(gapsCount, publishedCount, topQuestion) {
  const nStr = String(gapsCount);
  const mStr = String(publishedCount);
  const topText = topQuestion ? topQuestion.text_raw : "no question has been published yet";
  const text = QUESTIONS_SUMMARY_TEMPLATE
    .replace("{n}", nStr).replace("{m}", mStr).replace("{top_question}", topText);
  let html;
  if (topQuestion) {
    const prefix = QUESTIONS_SUMMARY_TEMPLATE.split("{top_question}")[0]
      .replace("{n}", nStr).replace("{m}", mStr);
    html = escapeHtml(prefix) + a(`/questions/${topQuestion.hash}`, topQuestion.text_raw);
  } else {
    html = escapeHtml(text);
  }
  return { k: "p", text, html };
}

async function kvNum(env, key) {
  try {
    const v = await env.KV.get(key);
    return v ? parseInt(v, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

async function todayObservationSummary(env, dateStr) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT entity_id, COUNT(*) AS requests, SUM(ip_verified) AS verified,
              GROUP_CONCAT(DISTINCT format_served) AS formats
       FROM observations WHERE ts LIKE ? GROUP BY entity_id`
    ).bind(`${dateStr}%`).all();
    return results || [];
  } catch {
    return [];
  }
}

// ---------- shared: changes rows (Date | Entity | Claim | Kind | Old | New) ----------

// The claim a change is about, linked and labelled by its field (what
// changed), not just a bare claim id.
function claimCell(c) {
  if (!c.claim_id) return "";
  return link(`/claims/${c.claim_id}`, c.claim_field || `claim ${c.claim_id}`);
}

// For a "new" change, the new value is the claim's own current value (the
// claim the change is about), falling back to whatever the change row
// itself recorded, for the rare case a change outlives its claim's join.
function changeNewValueDisplay(c) {
  if (c.kind === "new" && c.claim_value !== null && c.claim_value !== undefined) return c.claim_value;
  return c.new_value;
}

// changed_at is stored as a full UTC timestamp; every table that shows it
// as a date column (this one) displays only the date part. The JSON view
// (routes.js `data:`) is built straight from the raw rows, so it keeps the
// full timestamp.
function dateOnly(ts) {
  return ts ? String(ts).slice(0, 10) : ts;
}

function changeRowCells(c, { withEntity }) {
  const cells = [dateOnly(c.changed_at)];
  if (withEntity) cells.push(c.entity_name ? link(`/crawlers/${c.entity_slug}`, c.entity_name) : "");
  cells.push(claimCell(c));
  cells.push(c.kind);
  cells.push(wrapCell(c.old_value));
  cells.push(wrapCell(changeNewValueDisplay(c)));
  return cells;
}

// Home page only: several claims for one entity landing on one day at the
// same kind (a seed batch, mostly) collapse into one row ("Bingbot | 11
// claims new | 2026-09-14") linking to that entity's changes, so the home
// page reads as a summary. /changes itself stays row-by-row (changesHandler
// does not call this).
function groupChangesForHome(changes, limit = 8) {
  const order = [];
  const groups = new Map();
  for (const c of changes) {
    // Collapse on the calendar date, not the full timestamp: several
    // claims for one entity landing on the same day, even at slightly
    // different times, are still one seed batch for the home page's
    // purposes.
    const key = `${c.entity_id}|${dateOnly(c.changed_at)}|${c.kind}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(c);
  }
  const rows = order.map((key) => {
    const items = groups.get(key);
    const first = items[0];
    if (items.length === 1) {
      return { date: dateOnly(first.changed_at), cells: changeRowCells(first, { withEntity: true }) };
    }
    const entityCell = first.entity_name ? link(`/crawlers/${first.entity_slug}`, first.entity_name) : "";
    const claimSummary = link(`/changes?entity=${first.entity_slug}`, `${items.length} claims`);
    return {
      date: dateOnly(first.changed_at),
      cells: [dateOnly(first.changed_at), entityCell, claimSummary, first.kind, "", ""],
    };
  });
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return rows.slice(0, limit).map((r) => r.cells);
}

// ---------- shared: request-weighted observation summary ----------
// (Defect 2, 2026-09-15 audit): verified_share must never be averaged across
// days, since that is a mean of daily ratios, not sum(verified)/sum(total).
// Every page that reports a multi-day verified share uses this: it sums
// verified_requests and requests separately over the window and divides
// once, at the end.

function daysAgoIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return isoDate(d);
}

function shareOf(verified, requests) {
  return requests ? verified / requests : null;
}

function pctText(share) {
  return share === null ? "no data yet" : `${Math.round(share * 100)}%`;
}

const OBSERVED_WINDOW_DAYS = 30;

async function observedSummary(env, days = OBSERVED_WINDOW_DAYS) {
  const cutoff = daysAgoIso(days);
  const [rows, formatsByEntity] = await Promise.all([
    observationWindowSummary(env, cutoff),
    observationWindowFormats(env, cutoff),
  ]);
  return rows.map((r) => {
    const requests = r.requests || 0;
    const verified = r.verified_requests || 0;
    const formatsSet = formatsByEntity[r.entity_id];
    return {
      entity_id: r.entity_id,
      entity_slug: r.entity_slug,
      entity_name: r.entity_name,
      requests,
      verified_requests: verified,
      verified_share: shareOf(verified, requests),
      formats: formatsSet ? [...formatsSet].sort() : [],
      first_seen: r.first_seen || null,
      last_seen: r.last_seen || null,
    };
  });
}

// ---------- 404 / 405 ----------

export function notFoundDoc(path) {
  return {
    path,
    title: "Not found",
    description: "No record exists at this path.",
    blocks: [{ k: "p", text: "This path does not correspond to a record, entity, claim, change, observation, or question in the dataset." }],
    data: { error: "not_found", path },
  };
}

export function methodNotAllowedDoc(path, allowed) {
  return {
    path,
    title: "Method not allowed",
    description: `This path only accepts: ${allowed.join(", ")}.`,
    blocks: [{ k: "p", text: `This path only accepts the following methods: ${allowed.join(", ")}.` }],
    data: { error: "method_not_allowed", path, allowed },
  };
}

// ---------- / ----------

export async function homeHandler(ctx) {
  const { env } = ctx;
  const entities = await listEntities(env);
  // Fetched wide enough to cover every change on record (132 as of
  // 2026-09-15) so groupChangesForHome can collapse same-day/same-kind
  // batches correctly; only the top groups are actually shown.
  const changesRaw = await listChanges(env, { limit: 500 });
  const changeGroups = groupChangesForHome(changesRaw, 8);
  const summary = await observedSummary(env);
  const topCrawlers = summary.slice(0, 6);
  const gaps = await listGapQuestions(env, 500);
  const publishedQuestions = await listPublishedQuestions(env, 500);
  const entitiesById = Object.fromEntries(entities.map((e) => [e.id, e]));
  const topQuestion = pickTopQuestion(publishedQuestions);

  const homeIntroHtml = escapeHtml(HOME_INTRO).replace("Claim 47", a("/claims/47", "Claim 47"));

  const blocks = [
    { k: "p", text: HOME_INTRO, html: homeIntroHtml },
    ...observationsHomeBlock(entitiesById, summary),
    ...HOME_DIFFERENTIATORS.flatMap(d => [
      { k: "h3", text: d.label },
      { k: "p", text: d.text },
    ]),
    searchFormBlock(),
    ...blockingBlocks(),
    { k: "h2", text: "Crawlers", html: a("/crawlers", "Crawlers") },
    { k: "h3", text: CRAWLERS_HOME_HEADING },
    { k: "p", text: DEFINITION_CRAWLERS },
    kindGlossBlock(),
    {
      k: "table",
      headers: ["Vendor", "Name", "Kind", "Purpose"],
      rows: entities.map((e) => [e.vendor, link(`/crawlers/${e.slug}`, e.name), e.kind, e.purpose || ""]),
    },
    { k: "h2", text: "Changes", html: a("/changes", "Changes") },
    { k: "h3", text: CHANGES_HOME_HEADING },
    { k: "p", text: DEFINITION_CHANGES },
    changeGroups.length
      ? { k: "table", headers: ["Date", "Entity", "Claim", "Kind", "Old value", "New value"], rows: changeGroups }
      : { k: "p", text: NO_CHANGES_SENTENCE },
    { k: "h2", text: "Observations", html: a("/observed", "Observations") },
    { k: "h3", text: OBSERVATIONS_HOME_HEADING },
    { k: "p", text: OBSERVATIONS_TABLE_INTRO },
    topCrawlers.length
      ? { k: "table", headers: ["Crawler", "Requests (30d)", "Verified share", "Last seen"], rows: topCrawlers.map((s) => [link(`/observed/${s.entity_slug}`, s.entity_name), fmtNum(s.requests), pctText(s.verified_share), s.last_seen || ""]) }
      : { k: "p", text: "No crawler visits have been recorded yet." },
    { k: "h2", text: "Questions", html: a("/questions", "Questions") },
    { k: "h3", text: QUESTIONS_HOME_HEADING },
    { k: "p", text: QUESTIONS_GAP_SENTENCE },
    questionsHomeLineBlock(gaps.length, publishedQuestions.length, topQuestion),
    { k: "h2", text: RELATED_HEADING },
    { k: "p", html: FIELDS_LINK_HOME_SENTENCE.replace("/fields.", `${a("/fields", "/fields")}.`), text: FIELDS_LINK_HOME_SENTENCE },
    { k: "p", html: COMPARE_LINK_HOME_SENTENCE.replace("/compare.", `${a("/compare", "/compare")}.`), text: COMPARE_LINK_HOME_SENTENCE },
  ];

  return {
    path: "/",
    title: SITE_NAME,
    description: SITE_DESCRIPTOR,
    updatedAt: isoNow(),
    blocks,
    data: {
      generated_at: isoNow(),
      entities: entities.map((e) => ({ slug: e.slug, vendor: e.vendor, name: e.name, kind: e.kind, purpose: e.purpose, status: e.status })),
      recent_changes: changesRaw.slice(0, 30),
      recent_observations: topCrawlers,
      gap_count: gaps.length,
      related: [
        { title: "Fields", url: `${SITE_ORIGIN}/fields` },
        { title: "Compare", url: `${SITE_ORIGIN}/compare` },
      ],
    },
  };
}

// ---------- /crawlers ----------

export async function crawlersListHandler(ctx) {
  const { env } = ctx;
  const entities = await listEntities(env);
  return {
    path: "/crawlers",
    title: "Crawlers",
    metaDescription: "Every crawler, fetcher, search bot, ads bot, and robots.txt policy token documented on this site.",
    updatedAt: isoNow(),
    blocks: [
      definitionBlock(DEFINITION_CRAWLERS),
      kindGlossBlock(),
      {
        k: "table",
        headers: ["Vendor", "Name", "Kind", "Purpose", "Status"],
        rows: entities.map((e) => [e.vendor, link(`/crawlers/${e.slug}`, e.name), e.kind, e.purpose || "", e.status]),
      },
    ],
    data: { entities, definition: DEFINITION_CRAWLERS },
  };
}

// A published question "resolves to" an entity when any id in its
// matched_claim_ids array names a claim whose entity_id is that entity's
// id. Claim ownership does not change with a claim's status, so this
// checks every claim ever attributed to the entity, not just its current
// ones. Only published questions are considered: an unpublished gap is
// not a public record yet, even if an editor has already pointed its
// matched_claim_ids at a claim.
async function listQuestionsForEntity(env, entityId) {
  const allClaims = await listClaimsForEntity(env, entityId, { onlyCurrent: false });
  const claimIds = new Set(allClaims.map((c) => c.id));
  if (!claimIds.size) return [];
  const published = await listPublishedQuestions(env, 5000);
  const rows = [];
  for (const q of published) {
    const matched = safeJsonParse(q.matched_claim_ids, []);
    if (Array.isArray(matched) && matched.some((id) => claimIds.has(id))) {
      rows.push(q);
    }
  }
  return rows;
}

export async function crawlerDetailHandler(ctx, slug) {
  const { env, url } = ctx;
  const entity = await getEntityBySlug(env, slug);
  if (!entity) return null;
  const entities = await listEntities(env);
  // "Compare with" links (separable block, see compareWithLinks below):
  // filters compare.js's own listPaths() output rather than constructing
  // /compare/<a>-vs-<b> URLs by hand, so only pairs compare.js actually
  // documents are linked.
  const compareWithData = await compareWithLinks(env, entity, entities);
  const compareWithItems = compareWithData.map((it) => link(it.path, `${entity.name} vs ${it.name}`));
  const fieldsLinkEntityText = FIELDS_LINK_ENTITY_SENTENCE_TEMPLATE.replace("{name}", entity.name);
  const fieldsLinkEntityHtml = FIELDS_LINK_ENTITY_SENTENCE_TEMPLATE
    .replace("{name}", escapeHtml(entity.name))
    .replace("/fields.", `${a("/fields", "/fields")}.`);
  // P1.1: observed_here claims sort above vendor_doc (and any other
  // method) in the entity page's claims table, in HTML, Markdown and
  // JSON alike, since all three read from this same array. Array.sort is
  // stable (ES2019+), so within each method group the original order
  // (ORDER BY field from listClaimsForEntity) is unchanged.
  const claims = (await listClaimsForEntity(env, entity.id)).slice().sort(
    (a, b) => (a.method === "observed_here" ? 0 : 1) - (b.method === "observed_here" ? 0 : 1)
  );
  const dailyRows = await listObservationDailyForEntity(env, entity.id, 30);
  const requests30d = dailyRows.reduce((s, r) => s + (r.requests || 0), 0);
  // Request-weighted, not a mean of daily shares (2026-09-15 audit, defect
  // 2): sum(verified_requests) / sum(requests) over the window.
  const verifiedRequests30d = dailyRows.reduce(
    (s, r) => s + (r.verified_requests ?? Math.round((r.verified_share || 0) * (r.requests || 0))), 0
  );
  const verifiedShare30d = shareOf(verifiedRequests30d, requests30d);
  const changes = await listChanges(env, { entitySlug: slug, limit: 100 });
  const notes = await listPublishedNotesForTarget(env, "entity", entity.id);
  const entityQuestions = await listQuestionsForEntity(env, entity.id);

  const identity = [
    ["vendor", entity.vendor],
    ["kind", entity.kind],
    ["purpose", entity.purpose || ""],
    ["ua_token", entity.ua_token ? code(entity.ua_token) : "(none, see notes)"],
    ["robots_token", entity.robots_token ? code(entity.robots_token) : ""],
    ["ip_list_url", entity.ip_list_url ? link(entity.ip_list_url, entity.ip_list_url) : "(none published)"],
    ["docs_url", entity.docs_url ? link(entity.docs_url, entity.docs_url) : ""],
    ["status", entity.status],
  ];

  const entityDefinition = fillTemplate(DEFINITION_ENTITY, { name: entity.name, kind: entity.kind, vendor: entity.vendor });

  const blocks = [
    definitionBlock(entityDefinition),
    { k: "h2", text: "Identity" },
    { k: "dl", items: identity },
    entity.notes ? { k: "p", text: entity.notes } : null,
    { k: "h2", text: "Claims" },
    claims.length
      ? { k: "table", headers: ["Field", "Value", "Method", "Confidence"], rows: claims.map((c) => [link(`/claims/${c.id}`, c.field), c.value ? code(c.value) : "", c.method || "", c.confidence || "n/a"]) }
      : { k: "p", text: "No claims have been published for this entity yet. Seed data for this site covers entity identity only." },
    { k: "h2", text: "Observations" },
    { k: "dl", items: [
      ["requests, last 30 days", fmtNum(requests30d)],
      ["verified requests, last 30 days", fmtNum(verifiedRequests30d)],
      ["verified share, last 30 days", pctText(verifiedShare30d)],
      ["daily rows recorded", fmtNum(dailyRows.length)],
    ] },
    { k: "h2", text: "Changes" },
    changes.length
      ? { k: "table", headers: ["Date", "Claim", "Kind", "Old value", "New value"], rows: changes.map((c) => changeRowCells(c, { withEntity: false })) }
      : { k: "p", text: "No changes recorded for this entity yet." },
    ...(entityQuestions.length
      ? [
          { k: "h2", text: "Questions" },
          {
            k: "table",
            headers: ["Question", "Count", "Last seen"],
            rows: entityQuestions.map((q) => [wrapCell(link(`/questions/${q.hash}`, q.text_raw)), fmtNum(q.count), dateOnly(q.ts_last)]),
          },
        ]
      : []),
    { k: "h2", text: "Notes" },
    notes.length
      ? { k: "table", headers: ["Date", "Author", "Body"], rows: notes.map((n) => [dateOnly(n.ts), n.author_claim || "unspecified", wrapCell(n.body)]) }
      : { k: "p", text: "No published notes for this entity yet." },
    // ---- Compare-with block: SEPARABLE. To cut it, remove this segment
    // (up to but not including the fields-link paragraph below) plus the
    // compareWithItems/compareWithLinks() call near the top of this
    // handler; nothing else in the page depends on it. ----
    ...(compareWithItems.length ? [{ k: "h2", text: COMPARE_WITH_HEADING }, { k: "ul", items: compareWithItems }] : []),
    { k: "p", html: fieldsLinkEntityHtml, text: fieldsLinkEntityText },
    { k: "p", text: NOTES_INVITATION },
    noteFormBlock("entity", entity.id),
    url.searchParams.get("submitted") === "1" ? { k: "p", text: NOTE_SUBMITTED_CONFIRMATION } : null,
  ].filter(Boolean);

  return {
    path: `/crawlers/${slug}`,
    title: entity.name,
    description: `${entity.vendor} ${entity.kind.replace("_", " ")}, purpose: ${entity.purpose || "unspecified"}.`,
    metaDescription: `${entity.name}: ${entity.vendor} ${entity.kind.replace("_", " ")}, purpose ${entity.purpose || "unspecified"}. Claims, observations and changes on ${SITE_NAME}.`,
    updatedAt: entity.updated_at,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: entity.name,
      url: `${SITE_ORIGIN}/crawlers/${slug}`,
      isPartOf: { name: SITE_NAME, url: SITE_ORIGIN },
      about: { "@type": "SoftwareApplication", name: entity.name, applicationCategory: "Crawler", author: entity.vendor },
      publisher: publisherOrg(),
      author: authorPerson(),
    },
    blocks,
    data: {
      entity,
      claims,
      observed: { requests_30d: requests30d, verified_requests_30d: verifiedRequests30d, verified_share_30d: verifiedShare30d, daily_rows: dailyRows },
      changes,
      questions: entityQuestions.map((q) => ({ hash: q.hash, text: q.text_raw, count: q.count, last_seen: dateOnly(q.ts_last) })),
      notes,
      definition: entityDefinition,
      fields_url: `${SITE_ORIGIN}/fields`,
      compare_with: compareWithData.map((it) => ({ slug: it.slug, name: it.name, url: `${SITE_ORIGIN}${it.path}` })),
    },
  };
}

// ---------- /claims ----------

export async function claimsHandler(ctx) {
  const { env } = ctx;
  const entities = await listEntities(env);
  const groups = [];
  const flatRows = [];
  for (const entity of entities) {
    const claims = await listClaimsForEntity(env, entity.id);
    if (!claims.length) continue;
    groups.push({ entity, claims });
    for (const c of claims) {
      flatRows.push({
        id: c.id,
        entity_slug: entity.slug,
        entity_name: entity.name,
        field: c.field,
        value: c.value,
        statement: c.statement,
        confidence: c.confidence,
        verified_at: c.verified_at,
        status: c.status,
      });
    }
  }

  const blocks = [
    definitionBlock(DEFINITION_CLAIMS),
    ...groups.flatMap(({ entity, claims }) => [
      {
        k: "h2",
        text: entity.name,
        html: `<h2>${a(`/crawlers/${entity.slug}`, entity.name)}</h2>`,
      },
      {
        k: "table",
        headers: ["Field", "Value", "Confidence", "Verified"],
        rows: claims.map((c) => [
          link(`/claims/${c.id}`, c.field),
          c.value ? code(c.value) : "",
          c.confidence || "n/a",
          c.verified_at || "",
        ]),
      },
    ]),
  ];

  return {
    path: "/claims",
    title: "Claims",
    metaDescription: CLAIMS_INTRO,
    updatedAt: isoNow(),
    blocks,
    data: { claims: flatRows, definition: DEFINITION_CLAIMS },
  };
}

// ---------- /claims/:id ----------

export async function claimDetailHandler(ctx, id) {
  const { env, url } = ctx;
  const claim = await getClaim(env, id);
  if (!claim) return null;
  const entity = await getEntityById(env, claim.entity_id);
  const superseding = claim.supersedes_id ? await getClaim(env, claim.supersedes_id) : null;
  const notes = await listPublishedNotesForTarget(env, "claim", claim.id);

  let evidenceQuoteDisplay = claim.evidence_quote || "";
  if (claim.evidence_quote && claim.evidence_date) {
    evidenceQuoteDisplay = `${claim.evidence_quote} source dated ${claim.evidence_date}`;
  }

  const claimDefinition = fillTemplate(DEFINITION_CLAIM, { entity: entity ? entity.name : String(claim.entity_id) });

  const blocks = [
    definitionBlock(claimDefinition),
    { k: "dl", items: [
      ["entity", entity ? link(`/crawlers/${entity.slug}`, entity.name) : String(claim.entity_id)],
      ["field", claim.field],
      ["value", claim.value ? code(claim.value) : ""],
      ["statement", claim.statement],
      ["evidence_url", claim.evidence_url ? link(claim.evidence_url, claim.evidence_url) : ""],
      ["evidence_quote", evidenceQuoteDisplay],
      ["method", claim.method || ""],
      ["verified_at", claim.verified_at || ""],
      ["confidence", claim.confidence || "n/a"],
      ["status", claim.status],
      ["supersedes", superseding ? link(`/claims/${superseding.id}`, `claim ${superseding.id}`) : "none"],
    ] },
    { k: "h2", text: "Notes" },
    notes.length
      ? { k: "table", headers: ["Date", "Author", "Body"], rows: notes.map((n) => [dateOnly(n.ts), n.author_claim || "unspecified", wrapCell(n.body)]) }
      : { k: "p", text: "No published notes for this claim yet." },
    { k: "p", text: NOTES_INVITATION },
    noteFormBlock("claim", claim.id),
    url.searchParams.get("submitted") === "1" ? { k: "p", text: NOTE_SUBMITTED_CONFIRMATION } : null,
  ].filter(Boolean);

  return {
    path: `/claims/${id}`,
    title: `Claim ${id}`,
    description: claim.statement,
    updatedAt: claim.updated_at,
    blocks,
    data: { claim, entity, notes, definition: claimDefinition },
  };
}

// ---------- /changes ----------

export async function changesHandler(ctx) {
  const { env, url } = ctx;
  const entitySlug = url.searchParams.get("entity") || null;
  const changes = await listChanges(env, { entitySlug, limit: 200 });
  return {
    path: "/changes",
    title: "Changes",
    metaDescription: "The cross-vendor changelog. Every claim that is added, updated, superseded, retired, or disputed, in one place.",
    updatedAt: changes[0] ? changes[0].changed_at : isoNow(),
    blocks: [
      definitionBlock(DEFINITION_CHANGES),
      changes.length ? null : { k: "p", text: NO_CHANGES_SENTENCE },
      changes.length
        ? { k: "table", headers: ["Date", "Entity", "Claim", "Kind", "Old value", "New value"], rows: changes.map((c) => changeRowCells(c, { withEntity: true })) }
        : null,
      { k: "p", text: "An Atom feed of this page is available at /changes.xml." },
    ].filter(Boolean),
    data: { changes, definition: DEFINITION_CHANGES },
  };
}

export async function changesAtomHandler(env) {
  const changes = await listChanges(env, { limit: 50 });
  const updated = changes[0] ? new Date(changes[0].changed_at).toISOString() : isoNow();
  const entries = changes.map((c) => {
    const entityName = c.entity_name || "unknown";
    const title = c.claim_field ? `${entityName}: ${c.claim_field} ${c.kind}` : `${entityName}: ${c.kind}`;
    const summary = c.claim_statement || `${c.kind}: ${c.old_value || ""} to ${changeNewValueDisplay(c) || ""}`.trim();
    return `
  <entry>
    <title>${escapeHtml(title)}</title>
    <id>${SITE_ORIGIN}/changes#${c.id}</id>
    <updated>${new Date(c.changed_at).toISOString()}</updated>
    <link href="${SITE_ORIGIN}/crawlers/${c.entity_slug || ""}"/>
    <summary>${escapeHtml(summary)}</summary>
  </entry>`;
  }).join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeHtml(`${SITE_NAME}: changes`)}</title>
  <id>${SITE_ORIGIN}/changes.xml</id>
  <updated>${updated}</updated>
  <link href="${SITE_ORIGIN}/changes.xml" rel="self"/>
  <link href="${SITE_ORIGIN}/changes"/>${entries}
</feed>`;
}

// ---------- /observed ----------

export async function observedHandler(ctx) {
  const { env } = ctx;
  const today = isoDate();
  const todayRows = await todayObservationSummary(env, today);
  const entities = await listEntities(env);
  const byId = Object.fromEntries(entities.map((e) => [e.id, e]));
  const humanToday = await kvNum(env, `human_count:${today}`);
  const summary = await observedSummary(env, OBSERVED_WINDOW_DAYS);

  const todayTable = todayRows.map((r) => {
    const e = byId[r.entity_id];
    return [e ? link(`/crawlers/${e.slug}`, e.name) : String(r.entity_id), fmtNum(r.requests), fmtNum(r.verified), r.formats || ""];
  });

  const summaryTable = summary.map((s) => [
    link(`/observed/${s.entity_slug}`, s.entity_name),
    fmtNum(s.requests),
    fmtNum(s.verified_requests),
    pctText(s.verified_share),
    s.formats.join(", "),
    s.first_seen || "",
    s.last_seen || "",
  ]);

  return {
    path: "/observed",
    title: "Observed",
    metaDescription: "The census: which crawlers actually fetch this site, and whether their identity could be verified.",
    updatedAt: isoNow(),
    blocks: [
      definitionBlock(DEFINITION_OBSERVED),
      { k: "p", text: UNVERIFIED_REQUEST_SENTENCE },
      { k: "h2", text: "Today, not yet rolled up" },
      { k: "p", text: `Human-looking traffic today: ${fmtNum(humanToday)} request${humanToday === 1 ? "" : "s"}, counted only in aggregate.` },
      todayTable.length
        ? { k: "table", headers: ["Entity", "Requests", "Verified", "Formats"], rows: todayTable }
        : { k: "p", text: "No identified crawler requests recorded yet today." },
      { k: "h2", text: `Summary, last ${OBSERVED_WINDOW_DAYS} days` },
      { k: "p", text: `Verified share is request-weighted: sum of verified requests divided by sum of requests over the window, not a mean of daily shares.` },
      summaryTable.length
        ? { k: "table", headers: ["Entity", "Requests", "Verified requests", "Verified share", "Formats", "First seen", "Last seen"], rows: summaryTable }
        : { k: "p", text: "No rolled-up observation days yet. The nightly job runs at 03:17 UTC." },
    ],
    data: {
      today: { date: today, human_count: humanToday, by_entity: todayRows },
      summary,
      definition: DEFINITION_OBSERVED,
    },
  };
}

export async function observedDetailHandler(ctx, slug) {
  const { env } = ctx;
  const entity = await getEntityBySlug(env, slug);
  if (!entity) return null;
  const dailyRows = await listObservationDailyForEntity(env, entity.id, 90);
  const today = isoDate();
  const todaySummary = (await todayObservationSummary(env, today)).find((r) => r.entity_id === entity.id) || null;
  const summary = (await observedSummary(env, OBSERVED_WINDOW_DAYS)).find((s) => s.entity_id === entity.id) || null;
  const observedEntityDefinition = fillTemplate(DEFINITION_OBSERVED_ENTITY, { name: entity.name });

  return {
    path: `/observed/${slug}`,
    title: `Observed: ${entity.name}`,
    description: `Daily request counts and verified share for ${entity.name}.`,
    updatedAt: isoNow(),
    blocks: [
      definitionBlock(observedEntityDefinition),
      { k: "p", text: UNVERIFIED_REQUEST_SENTENCE },
      { k: "p", text: todaySummary ? `Today: ${fmtNum(todaySummary.requests)} requests, ${fmtNum(todaySummary.verified)} verified.` : "No requests recorded from this entity yet today." },
      { k: "h2", text: `Summary, last ${OBSERVED_WINDOW_DAYS} days` },
      { k: "dl", items: summary ? [
        ["requests", fmtNum(summary.requests)],
        ["verified requests", fmtNum(summary.verified_requests)],
        ["verified share (request-weighted)", pctText(summary.verified_share)],
        ["formats requested", summary.formats.join(", ") || "none"],
        ["first seen", summary.first_seen || "n/a"],
        ["last seen", summary.last_seen || "n/a"],
      ] : [["requests", "0"], ["verified share (request-weighted)", "no data yet"]] },
      { k: "h2", text: "Daily rollup" },
      dailyRows.length
        ? { k: "table", headers: ["Date", "Requests", "Verified share"], rows: dailyRows.map((r) => [r.date, fmtNum(r.requests), r.verified_share === null ? "" : `${Math.round(r.verified_share * 100)}%`]) }
        : { k: "p", text: "No rolled-up observation days yet for this entity." },
    ],
    data: { entity_slug: slug, today: todaySummary, summary, daily: dailyRows, definition: observedEntityDefinition },
  };
}

// ---------- /questions ----------

// A seeded question was inserted by the site's own research (a prompt
// batch run against an AI engine); an organic question came from a real
// visitor or agent, through the search box or the MCP server. Sources is
// a JSON array: seeded rows carry the literal "prompt_batch" (or, from
// earlier tooling, "seeded") plus one "engine:<name>" entry per engine it
// was drawn from; organic rows carry source kinds like "search" or "mcp".
function questionLabel(sourcesArr) {
  return sourcesArr.includes("seeded") || sourcesArr.includes("prompt_batch") ? "seeded" : "organic";
}

function questionSourcesDisplay(sourcesArr) {
  if (questionLabel(sourcesArr) === "seeded") {
    return sourcesArr
      .filter((s) => typeof s === "string" && s.startsWith("engine:"))
      .map((s) => s.slice("engine:".length))
      .join(", ");
  }
  return sourcesArr.join(", ");
}

export async function questionsHandler(ctx) {
  const { env } = ctx;
  const published = await listPublishedQuestions(env, 200);
  const gaps = await listGapQuestions(env, 500);
  const shaped = published.map((q) => {
    const sourcesArr = safeJsonParse(q.sources, []);
    return { ...q, label: questionLabel(sourcesArr), sources_display: questionSourcesDisplay(sourcesArr) };
  });
  return {
    path: "/questions",
    title: "Questions",
    metaDescription: "The ledger: what visitors and agents ask this site, and whether it resolves to a claim.",
    updatedAt: isoNow(),
    blocks: [
      definitionBlock(DEFINITION_QUESTIONS),
      { k: "p", text: `${gaps.length} question${gaps.length === 1 ? "" : "s"} are recorded as unresolved gaps. ${published.length} question${published.length === 1 ? "" : "s"} are published below.` },
      { k: "p", text: QUESTIONS_LABEL_SENTENCE },
      searchFormBlock(),
      published.length
        ? { k: "table", headers: ["Question", "Count", "Label", "Sources", "Gap"], rows: shaped.map((q) => [wrapCell(link(`/questions/${q.hash}`, q.text_raw)), fmtNum(q.count), q.label, q.sources_display, q.gap ? "yes" : "no"]) }
        : { k: "p", text: "No questions have been published to the ledger yet. Nothing publishes without being promoted by an editor." },
    ],
    data: { published: shaped, gap_count: gaps.length, definition: DEFINITION_QUESTIONS },
  };
}

export async function questionDetailHandler(ctx, hash) {
  const { env, url } = ctx;
  const q = await env.DB.prepare(`SELECT * FROM questions WHERE hash = ?`).bind(hash).first();
  if (!q) return null;
  const sourcesArr = safeJsonParse(q.sources, []);
  const label = questionLabel(sourcesArr);
  const sourcesDisplay = questionSourcesDisplay(sourcesArr);
  const sourcesWord = label === "seeded" ? "engines" : "sources";
  const factsLine = `Label ${label}. ${sourcesWord.charAt(0).toUpperCase()}${sourcesWord.slice(1)} ${sourcesDisplay || "none"}. Count ${fmtNum(q.count)}. First seen ${(q.ts_first || "").slice(0, 10)}. Last seen ${(q.ts_last || "").slice(0, 10)}.`;

  const matchedIds = safeJsonParse(q.matched_claim_ids, []);
  const matchedClaims = [];
  for (const cid of matchedIds) {
    const c = await getClaim(env, cid);
    if (c) matchedClaims.push(c);
  }

  const notesDesc = await listPublishedNotesForTarget(env, "question", q.id);
  const notesAsc = notesDesc.slice().reverse();
  const noteBlocks = notesAsc.map((n) => {
    const date = (n.ts || "").slice(0, 10);
    const author = n.author_claim || "unspecified";
    return {
      k: "html",
      html: `<p>${escapeHtml(date)} <span class="author">${escapeHtml(author)}</span>: ${escapeHtml(n.body)}</p>`,
      text: `${date} ${author}: ${n.body}`,
    };
  });

  const blocks = [
    url.searchParams.get("submitted") === "1" ? { k: "p", text: NOTE_SUBMITTED_CONFIRMATION } : null,
    { k: "p", text: factsLine },
    { k: "h2", text: "Claims" },
    matchedClaims.length
      ? { k: "ul", items: matchedClaims.map((c) => link(`/claims/${c.id}`, c.statement)) }
      : { k: "p", text: "No claim answers this question yet." },
    { k: "h2", text: "Notes" },
    ...noteBlocks,
    { k: "p", text: NOTES_INVITATION },
    noteFormBlock("question", q.id),
  ].filter(Boolean);

  return {
    path: `/questions/${hash}`,
    title: q.text_raw,
    description: `Asked ${fmtNum(q.count)} time${q.count === 1 ? "" : "s"}.`,
    updatedAt: q.ts_last,
    blocks,
    data: {
      question: { ...q, label, sources_display: sourcesDisplay },
      claims: matchedClaims,
      notes: notesAsc,
    },
  };
}

// ---------- /search ----------

export async function searchHandler(ctx) {
  const { env, request, url } = ctx;
  let q = url.searchParams.get("q") || "";
  let note = "";
  if (request.method === "POST") {
    const ct = request.headers.get("Content-Type") || "";
    if (ct.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      q = body.q || q;
      note = body.note || "";
    } else {
      const form = await request.formData().catch(() => null);
      if (form) {
        q = form.get("q") || q;
        note = form.get("note") || "";
      }
    }
  }

  const blocks = [definitionBlock(DEFINITION_SEARCH), searchFormBlock(q)];

  let entities = [];
  let claims = [];
  let normalized = "";
  const uaHeader = request.headers.get("User-Agent") || "";
  const isSmokeTest = uaHeader.startsWith("rsbm-smoke/");
  if (q.trim()) {
    normalized = normalizeQuestion(q);
    if (!isSmokeTest) {
      const hash = await sha256Hex(normalized);
      const ts = isoNow();
      let questionId = null;
      try {
        questionId = await upsertQuestion(env, { textRaw: q, textNorm: normalized, hash, source: "search", ts });
      } catch {
        // logging the question must never break the search response
      }
      if (note && note.trim() && questionId) {
        try {
          const ip = request.headers.get("CF-Connecting-IP") || "";
          const ipHash = await sha256Hex(`${ip}:${isoDate()}`);
          await insertNote(env, { ts, targetType: "question", targetId: questionId, body: note.trim().slice(0, 2000), uaRaw: uaHeader, ipHash });
        } catch {
          // best effort
        }
      }
    }
    const result = await searchEntitiesAndClaims(env, normalized);
    entities = result.entities;
    claims = result.claims;
    blocks.push({ k: "h2", text: "Results" });
    if (entities.length === 0 && claims.length === 0) {
      blocks.push({ k: "p", text: "No entities or claims matched this query. It has been logged to the ledger as a gap." });
    } else {
      if (entities.length) blocks.push({ k: "table", headers: ["Entity"], rows: entities.map((e) => [link(`/crawlers/${e.slug}`, e.name)]) });
      if (claims.length) blocks.push({ k: "table", headers: ["Claim"], rows: claims.map((c) => [wrapCell(link(`/claims/${c.id}`, c.statement))]) });
    }
  }

  return {
    path: "/search",
    title: "Search",
    metaDescription: "Search matches claims and entities by term overlap and logs the question to the ledger.",
    updatedAt: isoNow(),
    blocks,
    data: { q, normalized, entities, claims, definition: DEFINITION_SEARCH },
  };
}

// ---------- /notes ----------

const NOTES_RATE_LIMIT_PER_DAY = 20;
const NOTE_TARGET_TYPES = ["claim", "entity", "question"];

async function notesRateLimitOk(env, ipHash, dateStr) {
  if (!env.KV) return true;
  const key = `notes_rl:${ipHash}:${dateStr}`;
  try {
    const current = await env.KV.get(key);
    const n = current ? parseInt(current, 10) || 0 : 0;
    if (n >= NOTES_RATE_LIMIT_PER_DAY) return false;
    await env.KV.put(key, String(n + 1), { expirationTtl: 172800 });
    return true;
  } catch {
    return true; // a KV outage never blocks a submission, only the counter is lost
  }
}

function plainText(body, status) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

// Handles POST /notes for all three note targets (claim, entity, question).
// Same insertNote path the /search form has always used: status pending,
// ua_raw and a per-day-salted ip_hash recorded, never the raw IP. A request
// from the smoke-test UA writes nothing (site-wide convention) and redirects
// without the confirmation query, since nothing was actually recorded.
export async function notesSubmitHandler(ctx) {
  const { env, request } = ctx;
  const uaHeader = request.headers.get("User-Agent") || "";
  const isSmokeTest = uaHeader.startsWith("rsbm-smoke/");

  const ct = request.headers.get("Content-Type") || "";
  let targetType, targetIdRaw, bodyRaw, authorClaimRaw;
  if (ct.includes("application/json")) {
    const j = await request.json().catch(() => ({}));
    targetType = j.target_type;
    targetIdRaw = j.target_id;
    bodyRaw = j.body;
    authorClaimRaw = j.author_claim;
  } else {
    const form = await request.formData().catch(() => null);
    targetType = form ? form.get("target_type") : null;
    targetIdRaw = form ? form.get("target_id") : null;
    bodyRaw = form ? form.get("body") : null;
    authorClaimRaw = form ? form.get("author_claim") : null;
  }

  if (!NOTE_TARGET_TYPES.includes(targetType)) {
    return plainText(`target_type must be one of: ${NOTE_TARGET_TYPES.join(", ")}.`, 400);
  }
  const targetId = parseInt(targetIdRaw, 10);
  if (!Number.isInteger(targetId)) {
    return plainText("target_id is required and must be an integer.", 400);
  }
  const trimmedBody = String(bodyRaw || "").trim().slice(0, 2000);
  if (!trimmedBody) {
    return plainText("body is required.", 400);
  }
  const authorClaim = String(authorClaimRaw || "").trim().slice(0, 200) || null;

  let redirectPath;
  if (targetType === "question") {
    const target = await getQuestionById(env, targetId);
    if (!target) return plainText(`No question with id ${targetId}.`, 404);
    redirectPath = `/questions/${target.hash}`;
  } else if (targetType === "claim") {
    const target = await getClaim(env, targetId);
    if (!target) return plainText(`No claim with id ${targetId}.`, 404);
    redirectPath = `/claims/${targetId}`;
  } else {
    const target = await getEntityById(env, targetId);
    if (!target) return plainText(`No entity with id ${targetId}.`, 404);
    redirectPath = `/crawlers/${target.slug}`;
  }

  if (isSmokeTest) {
    return Response.redirect(`${SITE_ORIGIN}${redirectPath}`, 303);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const dateStr = isoDate();
  const ipHash = await sha256Hex(`${ip}:${dateStr}`);
  const allowed = await notesRateLimitOk(env, ipHash, dateStr);
  if (!allowed) {
    return plainText(`Limit is ${NOTES_RATE_LIMIT_PER_DAY} note submissions per day per address.`, 429);
  }

  try {
    await insertNote(env, {
      ts: isoNow(),
      targetType,
      targetId,
      body: trimmedBody,
      authorClaim,
      uaRaw: uaHeader,
      ipHash,
    });
  } catch {
    // logging the note must never break the redirect
  }

  return Response.redirect(`${SITE_ORIGIN}${redirectPath}?submitted=1`, 303);
}

// ---------- /data ----------

const EXPORT_TABLES = [
  ["entities", "One row per crawler, fetcher, search bot, ads bot, or robots.txt policy token."],
  ["claims", "One row per atomic, dated, evidenced fact about an entity."],
  ["changes", "The cross-vendor changelog of claim additions, updates, and disputes."],
  ["observation_daily", "Nightly rollup of crawler requests by entity and day. Raw per-request rows are never exported."],
  ["questions", "Published questions from the ledger: normalised text, count, sources, gap status. Unpublished questions and raw question text are never exported."],
  ["notes", "Published notes only. Unpublished notes, and the ua_raw, ip_hash and reviewer_note fields, are never exported."],
  ["mcp_calls_daily", "Daily aggregate of MCP tool calls by tool and client, with a mean latency. Individual calls and args_hash are never exported."],
];

export async function dataHandler(ctx) {
  const { env } = ctx;
  const entities = await listEntities(env);
  const claims = await listAllCurrentClaims(env, 5000);
  const lastExport = await getLastExport(env);
  const exportDate = lastExport ? lastExport.r2_key.replace(/^data\//, "").replace(/\/$/, "") : null;

  const distribution = EXPORT_TABLES.flatMap(([name]) => [
    {
      "@type": "DataDownload",
      name: `${name}.json`,
      contentUrl: `${SITE_ORIGIN}/data/latest/${name}.json`,
      encodingFormat: "application/json",
    },
    {
      "@type": "DataDownload",
      name: `${name}.csv`,
      contentUrl: `${SITE_ORIGIN}/data/latest/${name}.csv`,
      encodingFormat: "text/csv",
    },
  ]);

  return {
    path: "/data",
    title: "Data",
    metaDescription: "What this dataset contains, its schema, its licence, and where to fetch it.",
    updatedAt: lastExport ? lastExport.ts : isoNow(),
    jsonld: {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `${SITE_NAME} crawler and claim dataset`,
      description: "Entities, claims, changes, observed crawler traffic, published questions, and published notes for AI crawlers and AI search engines.",
      license: LICENSE_URL,
      url: `${SITE_ORIGIN}/data`,
      creator: authorPerson(),
      publisher: publisherOrg(),
      isAccessibleForFree: true,
      creditText: ATTRIBUTION_TEXT,
      distribution,
      identifier: `https://doi.org/${DATASET_CONCEPT_DOI}`,
      sameAs: [`https://doi.org/${DATASET_CONCEPT_DOI}`, DATASET_ZENODO_URL],
      version: DATASET_VERSION,
    },
    blocks: [
      definitionBlock(DEFINITION_DATA),
      { k: "p", text: `This dataset holds ${fmtNum(entities.length)} entities and ${fmtNum(claims.length)} current claims.` },
      { k: "p", text: exportDate ? `The most recent export ran on ${exportDate}.` : "No export has run yet. The nightly job runs at 03:17 UTC." },
      { k: "h2", text: "Tables" },
      { k: "table", headers: ["Table", "Contents", "JSON", "CSV"], rows: EXPORT_TABLES.map(([name, desc]) => [
        name,
        wrapCell(desc),
        link(`/data/latest/${name}.json`, `${name}.json`),
        link(`/data/latest/${name}.csv`, `${name}.csv`),
      ]) },
      { k: "p", text: exportDate ? `Dated snapshots for this export are also available under /data/${exportDate}/, one JSON file and one CSV file per table listed above.` : "Dated snapshots are also available under /data/YYYY-MM-DD/ once the first export runs, one JSON file and one CSV file per table listed above." },
      { k: "h2", text: "Licence and attribution" },
      { k: "p", text: `${DATA_LICENSE}. Attribute rattlesnakesbymail.com as ${ATTRIBUTION_TEXT} and link to the specific claim URL used.` },
      { k: "p", text: PUBLISHED_BY_SENTENCE, html: PUBLISHED_BY_SENTENCE_HTML },
      { k: "p", text: DATASET_DOI_SENTENCE, html: DATASET_DOI_SENTENCE_HTML },
      { k: "h2", text: "Access" },
      { k: "ul", items: [
        link("/data/latest.json", "/data/latest.json, the manifest of the most recent export"),
        link(DATA_REPO, `${DATA_REPO}, the public GitHub repository`),
        link("/crawlers", "/crawlers, the entity index"),
        link("/changes.xml", "/changes.xml, the changelog as Atom"),
      ] },
      { k: "p", text: "A zip archive of the full export is not offered in this version. Every table is reachable individually as JSON and as CSV." },
    ],
    data: {
      entity_count: entities.length,
      current_claim_count: claims.length,
      license: "CC-BY-4.0",
      repo: DATA_REPO,
      last_export: lastExport,
      tables: EXPORT_TABLES.map(([name, desc]) => ({ name, description: desc })),
      definition: DEFINITION_DATA,
      dataset_doi: {
        concept_doi: DATASET_CONCEPT_DOI,
        version_doi: DATASET_VERSION_DOI,
        version: DATASET_VERSION,
        zenodo_url: DATASET_ZENODO_URL,
      },
    },
  };
}

export async function dataLatestHandler(ctx) {
  const { env } = ctx;
  const entities = await listEntities(env);
  const claims = await listAllCurrentClaims(env, 5000);
  const changes = await listChanges(env, { limit: 500 });
  const observationDaily = await listObservationDaily(env, 90);
  const questions = await listPublishedQuestions(env, 500);
  const payload = {
    generated_at: isoNow(),
    license: "CC-BY-4.0",
    entities,
    claims,
    changes,
    observation_daily: observationDaily,
    published_questions: questions,
  };
  return {
    path: "/data/latest",
    title: "Latest export",
    description: "A live JSON export of the public tables: entities, claims, changes, observation_daily, published questions.",
    updatedAt: isoNow(),
    blocks: [
      { k: "p", text: `This export covers ${fmtNum(entities.length)} entities, ${fmtNum(claims.length)} current claims, ${fmtNum(changes.length)} changes, ${fmtNum(observationDaily.length)} observation-day rows, and ${fmtNum(questions.length)} published questions.` },
      { k: "p", text: "Fetch the raw data at /data/latest.json." },
    ],
    data: payload,
  };
}

// ---------- /method ----------

export async function methodHandler() {
  return {
    path: "/method",
    title: "Method",
    description: DEFINITION_METHOD,
    updatedAt: "2026-09-13T00:00:00Z",
    blocks: [
      { k: "p", text: METHOD_INTRO },
      { k: "h2", text: "Claims" },
      { k: "p", text: "Each claim carries an evidence quote of 300 characters or fewer, taken verbatim from the cited URL. Each claim carries a verification method: vendor_doc, observed_here, third_party, or test_here. A claim is never edited in place. A change to a claim creates a new claim that supersedes the old one, and both stay addressable at their own URLs." },
      { k: "p", text: METHOD_OBSERVED_HERE },
      { k: "h2", text: "Observations" },
      { k: "p", text: "Every request is matched against each entity's user agent pattern. A match with a published IP range is checked against that range and marked ip_verified when it falls inside it. A match with no IP range match falls back to Cloudflare's verified bot category when the request carries one. An unverified match is stored with ip_verified set to 0, because a user agent string can be set to any value by any client. Unmatched requests whose user agent contains bot, crawler, spider, fetch, agent, or http are tallied by user agent string in a daily count, capped at 500 distinct strings per day. All other unmatched requests are counted once in a daily human total and never stored per request. Every IP address is hashed with SHA-256 salted by the date before storage, for both bots and humans, and the raw IP address is never stored." },
      { k: "h2", text: "Questions" },
      { k: "p", text: "Every search query is normalised to lowercase, stripped of punctuation, and lightly stemmed, then hashed and counted. A query is matched against current claims and entities by term overlap. A query that matches nothing is recorded as a gap. Nothing publishes to /questions automatically. An editor promotes a gap to a published question." },
      { k: "h2", text: "Notes" },
      { k: "p", text: "A note submitted through the search form is stored with status pending. No note publishes without review." },
      { k: "h2", text: "Status of this site" },
      { k: "p", text: METHOD_STATUS },
      { k: "p", text: PUBLISHED_BY_SENTENCE, html: PUBLISHED_BY_SENTENCE_HTML },
    ],
    data: { updated_at: "2026-09-13", definition: DEFINITION_METHOD },
  };
}
