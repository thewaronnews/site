import { a } from "./util.js";
export const SITE_NAME = "Rattlesnakes By Mail";
export const SITE_DESCRIPTOR = "A Field Guide to the Crawlers of the Web";
export const SITE_ORIGIN = "https://rattlesnakesbymail.com";
export const MCP_SERVER_NAME = SITE_NAME;
export const DATA_LICENSE = "CC BY 4.0";
export const DATA_REPO = "https://github.com/crank-box/rattlesnakesbymail-data";
export const DATASET_CONCEPT_DOI = "10.5281/zenodo.22830000";
export const DATASET_VERSION_DOI = "10.5281/zenodo.22830001";
export const DATASET_VERSION = "v2026.09";
export const DATASET_ZENODO_URL = "https://zenodo.org/records/22830001";
export const GA4_MEASUREMENT_ID = "G-1FERXLQWWS";

export const OG_IMAGE_PATH = "/images/rattlesnakes-by-mail.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_IMAGE_TYPE = "image/png";
export const OG_IMAGE_ALT = "A rattlesnake curled into a circle, biting its own rattle, with a robotic camera lens for an eye.";

export const PUBLISHER_NAME = "Benes the Menace";
export const PUBLISHER_URL = "https://benesthemenace.com/";
export const AUTHOR_NAME = "Peter Benes";
export const AUTHOR_URL = "https://benesthemenace.com/pages/peter-benes";
export const AFFILIATION_NAME = "Attention Optimization";
export const AFFILIATION_URL = "https://attentionoptimization.com/";
export const COPYRIGHT_HOLDER = AUTHOR_NAME;
export const COPYRIGHT_YEAR = "2026";
export const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
export const ATTRIBUTION_TEXT = "Rattlesnakes By Mail, rattlesnakesbymail.com";

export const SECTIONS = [
  { label: "Crawlers", path: "/crawlers" },
  { label: "Claims", path: "/claims" },
  { label: "Changes", path: "/changes" },
  { label: "Observations", path: "/observed" },
  { label: "Questions", path: "/questions" },
  { label: "Data", path: "/data" },
  { label: "Method", path: "/method" },
];

export const HOME_INTRO = "Rattlesnakes By Mail is a reference on how AI crawlers and AI search engines read the web. Each page on Rattlesnakes By Mail is a record, and each fact on a record is a dated claim. Three formats serve the same content: HTML, Markdown at the .md suffix, and JSON at the .json suffix. The same URL answers Accept: text/markdown and application/json. Claim 47, for example, states: ClaudeBot honours industry standard robots.txt directives that signal do not crawl. Claim 47 carries confidence high and the method vendor_doc, quotes Anthropic's crawler documentation dated 2026-04-07, and was verified on 2026-09-13.";

// The Observations differentiator is built at render time from live 30-day
// figures (OBSERVATIONS_HOME_TEMPLATE, see homeHandler); these three pieces
// are its fixed sentences and its ship-if-not-ready fallback.
export const OBSERVATIONS_FIXED_INTRO = "Rattlesnakes By Mail logs each request from an identified crawler and publishes per-crawler daily counts at /observed.";

export const OBSERVATIONS_UNVERIFIED_SENTENCE = "An unverified request means the request IP address did not match a published range, and an unverified request is not evidence that the user agent was spoofed.";

export const OBSERVATIONS_HOME_TEMPLATE = `${OBSERVATIONS_FIXED_INTRO} {top_entity} made {requests} requests in the last 30 days and {verified_share} of the requests were verified against {vendor}'s published IP ranges. ${OBSERVATIONS_UNVERIFIED_SENTENCE}`;

export const OBSERVATIONS_FALLBACK_TEXT = `${OBSERVATIONS_FIXED_INTRO} Each daily count states the share of requests whose identity was verified against the vendor's published IP ranges or reverse DNS.`;

export const HOME_DIFFERENTIATORS = [
  { label: "Claims", text: "Every fact on Rattlesnakes By Mail is a dated claim with a verbatim vendor quote, a source URL, a method and a confidence, published at /claims. A published claim is never edited: a change creates a new claim that supersedes the old claim, both claims stay addressable, and every supersession is listed at /changes." },
  { label: "Questions", text: "Rattlesnakes By Mail records every search query made on the site, matches each query against the published claims, and publishes the unmatched queries as gaps at /questions. A seeded question carries the label seeded, and an organic question carries the source the query arrived from." },
  { label: "Data", text: "Rattlesnakes By Mail exports each public table nightly as JSON and as CSV under CC BY 4.0 to the public GitHub repository crank-box/rattlesnakesbymail-data. The dataset and the nightly export are described at /data." },
];

// Shared empty-state sentence for the changes ledger: worded so it stays
// true whenever it actually renders (i.e. only when the row count is 0).
export const NO_CHANGES_SENTENCE = "No changes are recorded yet.";

// Home-page-only lead-in headings (2026-09-19, revised the same day): one
// heading above each of the four data sections below the differentiators
// (Crawlers, Changes, Observations, Questions), so a visitor reaches one
// plain-language sentence before a table instead of going straight from
// a bare H2 into data. The first version of these four headings all read
// "For humans", which described the audience and not the section; each
// heading now states what the section below the heading contains, in the
// words a reader searching for that material would use. Crawlers and
// Changes reuse their own page's DEFINITION_* text verbatim below the
// heading (no equivalent context exists earlier on the home page).
// Observations and Questions get their own short sentences instead,
// because DEFINITION_OBSERVED and DEFINITION_QUESTIONS would repeat
// sentences the differentiator paragraphs above already state. Sentence
// openers are kept distinct across the four headings (Which, How, AI,
// Questions) after an audit flagged four repeated openers on this page.
export const CRAWLERS_HOME_HEADING = "Which AI crawlers exist, and what each crawler does";

export const CHANGES_HOME_HEADING = "How AI crawler documentation has changed, by date";

export const OBSERVATIONS_HOME_HEADING = "AI crawler traffic data from the last 30 days";

export const QUESTIONS_HOME_HEADING = "Questions about AI crawlers with no documented answer";

export const OBSERVATIONS_TABLE_INTRO = "The table below ranks every crawler by requests logged on Rattlesnakes By Mail in the last 30 days, with the share Rattlesnakes By Mail could verify against each vendor's published identity.";

export const QUESTIONS_GAP_SENTENCE = "A gap is a question that matched no published claim, and a gap appears at /questions only once an editor publishes it.";

// ---------- Page definitions (2026-09-15): one short definition paragraph
// placed directly under each page's H1, above its first table or section.
// {name}/{vendor}/{kind}/{entity} are filled at render time from the row.

export const DEFINITION_CRAWLERS = "The Crawlers index of Rattlesnakes By Mail lists every automated agent and every robots.txt policy token that Rattlesnakes By Mail documents, one row per entity. An entity is one named agent, or one named robots.txt token, that a vendor publishes and documents separately, and each entity holds its own record at its own URL. Rattlesnakes By Mail covers six vendors: Anthropic, OpenAI, Google, Microsoft, Apple and Perplexity. Fifteen rows cover crawlers, fetchers, search bots, one ads bot and two robots.txt policy tokens.";

export const DEFINITION_CLAIMS = "The Claims ledger of Rattlesnakes By Mail holds every fact published on Rattlesnakes By Mail, one claim per row. A claim is one atomic dated statement about one entity, carrying a verbatim vendor quote of 300 characters or fewer, a source URL, a verification method and a confidence. A published claim is never edited. A correction creates a new claim that supersedes the older claim, both claims stay addressable at their own URLs, and every supersession appears at /changes.";

export const DEFINITION_CHANGES = "The Changes log of Rattlesnakes By Mail records every movement in the claim ledger, one row per claim that entered the ledger, moved within the ledger, or left the ledger. A change row names the date, the entity, the kind of change, the old value and the new value. Kinds read as follows: new marks a claim published for the first time, updated marks a claim whose value changed, superseded marks a claim replaced by a newer claim, retired marks a claim withdrawn without a replacement, and disputed marks a claim a reviewer has flagged against contrary evidence.";

export const DEFINITION_OBSERVED = "The Observations census of Rattlesnakes By Mail reports which crawlers fetched Rattlesnakes By Mail, how many requests each crawler made, and how many of the requests carried an identity that matched a published source. An observation is one logged request from a user agent that matches a documented entity pattern. Identity is confirmed by matching the request IP address against the vendor's published IP ranges, by reverse DNS where the vendor documents a reverse DNS method, or by Cloudflare's verified bot category when the request carries one. An unverified request means the request IP address did not match a published range, and an unverified request is not evidence that the user agent was spoofed.";

export const DEFINITION_OBSERVED_ENTITY = "The {name} observation record on Rattlesnakes By Mail counts every request that Rattlesnakes By Mail logged from {name}, day by day. Each daily row states the request count, the share of requests whose identity matched the vendor's published IP ranges or reverse DNS, and the formats served. A row appears only after Rattlesnakes By Mail logged at least one request from {name}. Raw per-request rows are never exported, and every IP address is hashed with SHA-256 salted by the date before storage.";

export const DEFINITION_QUESTIONS = "The question ledger of Rattlesnakes By Mail records what visitors and agents ask Rattlesnakes By Mail, and whether each question resolves to a published claim. Questions arrive from the search box on Rattlesnakes By Mail, from the ask tool on the MCP server at /mcp, and from the site's own research against AI engines. A gap is a question that matched no current claim and no entity by term overlap. A gap stays in the ledger until an editor promotes the gap to a published question, and nothing publishes to /questions automatically.";

export const DEFINITION_DATA = "The open dataset of Rattlesnakes By Mail is the machine-readable copy of every public table on Rattlesnakes By Mail. Rattlesnakes By Mail exports each public table nightly as JSON and as CSV to the public GitHub repository crank-box/rattlesnakesbymail-data. The export carries the CC BY 4.0 licence. Attribution reads: Rattlesnakes By Mail, rattlesnakesbymail.com, with a link to the specific claim URL used.";

export const DEFINITION_METHOD = "The Method page of Rattlesnakes By Mail states the rules by which Rattlesnakes By Mail produces a claim, identifies a crawler, counts an observation, and moderates the question ledger, dated 2026-09-13.";

export const DEFINITION_SEARCH = "Search on Rattlesnakes By Mail answers a query from the published claims, matching claims and entities by term overlap. Each query enters the question ledger, and a query that matched no claim is recorded as a gap. A note can travel with a query, and a submitted note stays pending until a reviewer publishes the note.";

export const DEFINITION_ENTITY = "The {name} record on Rattlesnakes By Mail is the full published file on {name}, a {kind} from {vendor}. Each fact on the {name} record is a dated claim with a verbatim quote from {vendor}, a source URL, a verification method and a confidence. Sections run in a fixed order: Identity, Claims, Observations, Changes, Questions, Notes.";

export const DEFINITION_CLAIM = "A claim page on Rattlesnakes By Mail publishes one claim about one entity, here {entity}. The claim page states the field, the value, the statement, the source URL, the verbatim evidence quote, the verification method, the confidence, the date the claim was verified, and the claim that the published claim supersedes. A claim page is permanent: the claim is never edited, and a superseded claim stays addressable at the same URL.";

// One paragraph above the Crawlers table, on both / and /crawlers. The
// two token names (Google-Extended, Applebot-Extended) link to their
// backing claims (62, 8) in HTML only; plain text in Markdown.
export const KIND_GLOSS = "Kind separates what an agent does from who operates the agent. A crawler fetches pages on the vendor's own schedule, with no user waiting on the fetch. A fetcher retrieves one page at the moment a user asks an assistant a question. A search_bot fetches pages to build and serve the index behind an AI answer engine. An ads_bot fetches pages submitted as advertisements and checks the pages against the vendor's advertising policies. A policy_token is a name that appears only in robots.txt, and a policy token governs how a vendor may use content the vendor already crawled. Google-Extended and Applebot-Extended are robots.txt tokens with no crawler behind either token: Google documents that Google-Extended has no separate HTTP request user agent string and that crawling is done with existing Google user agent strings, and Apple documents that Applebot-Extended does not correspond to a separate crawler user agent string.";

// A new home-page section, after the four differentiator paragraphs and
// the search form, before the Crawlers heading. Claim ids from the source
// note become links on the claim's key phrase in HTML only; Markdown
// appends " (claim <id>)" after each sentence (see routes.js).
export const BLOCKING_HEADING = "Blocking";

export const BLOCKING_SENTENCES = [
  "Disallowing Google-Extended in robots.txt stops Google from using already-crawled content to train Gemini models and to ground Gemini features.",
  "Google documents that Google-Extended does not affect a site's inclusion in Google Search and is not used as a ranking signal in Google Search.",
  "Disallowing GPTBot in robots.txt signals to OpenAI that crawled content is not to be used to train OpenAI's generative AI foundation models, and allowing OAI-SearchBot alongside that disallow keeps a site eligible to appear in ChatGPT search results.",
  "A GPTBot disallow does not govern ChatGPT-User, because OpenAI documents that ChatGPT-User fetches a page when a user asks ChatGPT a question and that robots.txt rules may not apply to a user-initiated fetch.",
  "Crawler identity is checked against the IP ranges the vendor publishes, and Google and Apple document a reverse DNS method in addition.",
];

export const METHOD_INTRO = "This page describes how Rattlesnakes By Mail produces, records and publishes every fact on the site. The instrument logs every request from an identified crawler and publishes per-crawler daily counts with the share of requests whose identity was verified against the vendor's published IP ranges or reverse DNS. The claim ledger records every fact as a dated claim with a verbatim vendor quote, a source URL, a method and a confidence, and a published claim is never edited: a change creates a new claim that supersedes the old claim, and both claims stay addressable. The question ledger records every search query made on the site, matches each query against the published claims, and publishes the unmatched queries as gaps. The dataset exports every public table nightly as JSON and as CSV under CC BY 4.0 to the public GitHub repository crank-box/rattlesnakesbymail-data.";

export const METHOD_OBSERVED_HERE = "An observed_here claim records what the Rattlesnakes By Mail instrument logged for one named crawler on Rattlesnakes By Mail during a stated window. The evidence for an observed_here claim is the /observed page for that crawler together with the crawler census covering that window. The first window runs from 2026-09-13T20:00Z to 2026-09-15T09:00Z and its census carries the date 2026-09-15. An observed_here claim carries confidence high when the crawler's ratio of verified requests to all requests is above 95 percent, where a verified request is a request whose identity matched the vendor's published IP ranges or documented reverse DNS method, and the crawler's request count in the window is above 50, and confidence medium in every other case. An observed_here claim describes requests made to Rattlesnakes By Mail only and is not a statement about how the crawler behaves on any other site. A reader who wants the raw counts behind an observed_here claim reads the census document named in the claim's note.";

export const METHOD_STATUS = "Rattlesnakes By Mail covers 15 crawlers and agents from six vendors: OpenAI, Anthropic, Perplexity, Google, Microsoft and Apple. 132 claims were published on 2026-09-13 and 2026-09-14, and every one of those claims carries the method vendor_doc. The instrument has recorded requests since 2026-09-13. A note submitted by a visitor is held pending until a reviewer publishes the note, and nothing on Rattlesnakes By Mail blocks, challenges or rate-limits any crawler.";

export const LLMS_TXT_HEAD = "# Rattlesnakes By Mail\n\nA Field Guide to the Crawlers of the Web: a reference on how AI crawlers and AI search engines read the web, where every page exists as HTML, as Markdown at the .md suffix, and as JSON at the .json suffix.\nObservations at /observed, claims at /claims, questions at /questions, and the open dataset at /data.";

export const JSONLD_DESCRIPTION = "A field guide to the crawlers of the web: dated, quoted, sourced claims about AI crawlers, with per-crawler request counts, in HTML, Markdown and JSON.";

export const META_DESCRIPTION_HOME = "Rattlesnakes By Mail is a reference on how AI crawlers and AI search engines read the web. Dated, sourced claims and per-crawler request counts.";

export const CLAIMS_INTRO = "Every claim on Rattlesnakes By Mail is a dated statement with a verbatim vendor quote, a source URL, a method and a confidence.";

export const NOTES_INVITATION = "Send a correction by POST to /notes with a target and a body, or use the form on this page. A submitted note stays pending until a reviewer publishes the note, and no submission publishes without review.";

// Internal links: home page "Related" section and crawler detail page
// "Compare with" section (see routes.js homeHandler / crawlerDetailHandler).
export const RELATED_HEADING = "Related";
export const FIELDS_LINK_HOME_SENTENCE = "Every claimed field on every crawler has its own page at /fields.";
export const COMPARE_LINK_HOME_SENTENCE = "Any two crawlers can be compared side by side at /compare.";
export const COMPARE_WITH_HEADING = "Compare with";
export const FIELDS_LINK_ENTITY_SENTENCE_TEMPLATE = "Every claimed field for {name} is documented at /fields.";

export const QUESTIONS_SUMMARY_TEMPLATE = "{n} questions have been recorded as gaps since 2026-09-13, {m} of the questions are published at /questions, and the question raised most often so far is: {top_question}";

export const QUESTIONS_LABEL_SENTENCE = "A seeded question came from a tool or an AI engine during the site's own research. An organic question came from a visitor or an agent through the search box or the MCP server.";

export const UNVERIFIED_REQUEST_SENTENCE = "An unverified request is a request whose source IP address was outside the vendor's published ranges and whose reverse DNS did not resolve to the vendor; an unverified request is not proof of spoofing.";

export const SEARCH_LABEL = "Search claims and crawlers";

export const SEARCH_NOTE_LABEL = "Optional note for other visitors, published after review";

export const SEARCH_BUTTON = "Search";

export const SEARCH_MD_LINE = "Search: POST /search with q and an optional note, or use the ask tool on the MCP server at /mcp.";

export const NOTE_BODY_LABEL = "Note";

export const NOTE_AUTHOR_LABEL = "Who is writing: a person, a model, or an agent";

export const NOTE_SUBMIT_BUTTON = "Submit a note";

export const NOTE_SUBMITTED_CONFIRMATION = "Note received. A reviewer publishes notes.";

export const FOOTER = `<p>${SITE_NAME} is published by ${a(PUBLISHER_URL, PUBLISHER_NAME)}. Every page as HTML, .md and .json.</p><p><span class="mark">🐍✖️📮</span> © ${COPYRIGHT_YEAR} ${a(AUTHOR_URL, AUTHOR_NAME, { rel: "me" })}. Data under ${a(LICENSE_URL, DATA_LICENSE)}; attribute as ${ATTRIBUTION_TEXT}.</p>`;

export const PUBLISHED_BY_SENTENCE = `${SITE_NAME} is published by ${PUBLISHER_NAME}, the digital marketing consultancy of ${AUTHOR_NAME} in Prince Edward County, Ontario, and the findings feed ${AFFILIATION_NAME}, a service on AI-era search visibility.`;

export const PUBLISHED_BY_SENTENCE_HTML = PUBLISHED_BY_SENTENCE
  .replace(PUBLISHER_NAME, a(PUBLISHER_URL, PUBLISHER_NAME))
  .replace(AUTHOR_NAME, a(AUTHOR_URL, AUTHOR_NAME))
  .replace(AFFILIATION_NAME, a(AFFILIATION_URL, AFFILIATION_NAME));

export const DATASET_DOI_SENTENCE = `The dataset is archived at Zenodo under the concept DOI ${DATASET_CONCEPT_DOI}, which always resolves to the latest version; release ${DATASET_VERSION} has the version DOI ${DATASET_VERSION_DOI}.`;

export const DATASET_DOI_SENTENCE_HTML = DATASET_DOI_SENTENCE
  .replace(DATASET_CONCEPT_DOI, a(`https://doi.org/${DATASET_CONCEPT_DOI}`, DATASET_CONCEPT_DOI))
  .replace(DATASET_VERSION_DOI, a(`https://doi.org/${DATASET_VERSION_DOI}`, DATASET_VERSION_DOI));
