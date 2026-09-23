// Site-wide constants and fixed copy for The War On News (thewaronnews.com),
// Crank #3. Every public string here follows the voice guide: no em dashes,
// no characterizing words outside quotation marks.

export const SITE_NAME = "The War On News";
export const SITE_SUBTITLE = "How governments have limited journalists, 1900 to today.";
export const SITE_DESCRIPTOR = SITE_SUBTITLE;
export const SITE_ORIGIN = "https://thewaronnews.com";
export const SITE_HOST = "thewaronnews.com";
export const MCP_SERVER_NAME = "com.thewaronnews/thewaronnews";
export const MCP_SERVER_TITLE = SITE_NAME;

export const PUBLISHER_NAME = "Peter Benes";
export const PUBLISHER_LOCATION = "Prince Edward County, Ontario";
export const PUBLISHER_URL = "https://thewaronnews.com/about";
export const EDITOR_NAME = PUBLISHER_NAME;

export const CONTACT_CORRECTIONS = "corrections@thewaronnews.com";
export const CONTACT_TIPS = "tips@thewaronnews.com";
export const CONTACT_HELLO = "hello@thewaronnews.com";

export const DATA_LICENSE = "CC BY 4.0";
export const DATA_LICENSE_SPDX = "CC-BY-4.0";
export const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
export const ATTRIBUTION_TEXT = "The War On News, thewaronnews.com";
export const DATA_REPO_DEFAULT = "https://github.com/thewaronnews/data";
export const DATAPACKAGE_NAME = "the-war-on-news";

export const COPYRIGHT_YEAR = "2026";

// 40-word definition used on the home page, in JSON-LD and in llms.txt.
export const HOME_DEFINITION = "The War On News is a dated, sourced record of actions by governments, officials, regulators, courts and legislatures that limited journalists' ability to gather or publish news, from 1900 to today. Browse it by country, by tactic or by time, and follow each tactic's ladder to see where it has led, from restricting access to eliminating journalists.";

export const HOME_METHOD_LINE = "Each entry states who did what and when, quotes the reason the official gave, and links to the reporting and court records it rests on. Every fact is a claim with a verbatim quotation, a source address, a method and a check date.";

export const HOME_DATA_LINE = "Every page is also published as Markdown (add .md) and JSON (add .json). The full record is a nightly Frictionless Data Package under CC BY 4.0 at /data, and a public MCP server at /mcp lets AI assistants search and fetch it.";

export const META_DESCRIPTION_HOME = "A dated, sourced record of how governments have limited journalists since 1900, by country, tactic and era, with outcomes, court cases, data and MCP.";

// Primary navigation (Atlas design, 2026-09-22). `match` lists the path
// prefixes that mark an item as current.
export const SECTIONS = [
  { label: "United States", path: "/united-states" },
  { label: "Countries", path: "/countries", match: ["/countries", "/continents"] },
  { label: "Tactics", path: "/tactics" },
  { label: "Ladders", path: "/ladders" },
  { label: "Timeline", path: "/timeline", match: ["/timeline", "/eras"] },
  { label: "Coverage", path: "/coverage" },
  { label: "Search", path: "/search", match: ["/search"] },
  { label: "About", path: "/about", match: ["/about", "/context", "/sources-and-standards", "/terms", "/privacy", "/corrections", "/editorial-policy"] },
];

// Masthead descriptor (HTML only; Peter, 2026-09-22: make clear the subject
// is journalism and fact-based reporting).
export const MASTHEAD_DESCRIPTOR = "A record of government actions against journalism and fact-based reporting, 1900 to today";

// Footer (brief 2026-09-22, "Copy rules").
export const FOOTER_LINKS = [
  { label: "What this record is about", path: "/context" },
  { label: "Terms of use", path: "/terms" },
  { label: "Privacy", path: "/privacy" },
  { label: "Corrections", path: "/corrections" },
  { label: "Sources and standards", path: "/sources-and-standards" },
  { label: "Contact", path: "/about#contact" },
  { label: "Data", path: "/data" },
  { label: "MCP", path: "/mcp" },
  { label: "Feeds", path: "/feeds" },
];

export const CONTINENTS = {
  africa: "Africa",
  asia: "Asia",
  europe: "Europe",
  "north-america": "North America",
  "south-america": "South America",
  oceania: "Oceania",
  antarctica: "Antarctica",
};

// Tier of government that acted (v2; brief 2026-09-22).
export const LEVEL_LABELS = { national: "National", state_or_province: "State or province", municipal: "Municipal", supranational: "Supranational" };

// Escalation stages (v3 ladder brief), in ladder order. Definitions are in
// content/page-notes.json (PAGE_NOTES.stages).
export const STAGE_ORDER = ["restrict", "pressure", "punish", "silence", "eliminate"];
export const STAGE_LABELS = { restrict: "Restrict", pressure: "Pressure", punish: "Punish", silence: "Silence", eliminate: "Eliminate" };

export const OUTCOME_LABELS = { reversed: "Reversed", upheld: "Upheld by a court", sustained: "Sustained", ongoing: "Ongoing", unknown: "Unknown" };

// Human-readable labels for enum values (display only; data keeps the enum).
export const INCIDENT_TYPE_LABELS = {
  access_ban: "Access ban",
  credential_revocation: "Credential revocation",
  lawsuit_against_press: "Lawsuit against the press",
  regulatory_pressure: "Regulatory action",
  funding_cut: "Funding cut",
  arrest_or_detention: "Arrest or detention",
  subpoena_or_seizure: "Subpoena or seizure",
  legislation: "Legislation",
  physical_obstruction: "Physical obstruction",
  other: "Other",
};

export const INCIDENT_STATUS_LABELS = {
  in_effect: "in effect",
  in_litigation: "in litigation",
  enjoined: "enjoined",
  reversed: "reversed",
  expired: "expired",
  resolved: "resolved",
  historical: "historical",
};

export const CASE_STATUS_LABELS = {
  pending: "pending",
  decided: "decided",
  on_appeal: "on appeal",
  settled: "settled",
  dismissed: "dismissed",
  withdrawn: "withdrawn",
};

// Link states stay in the data and the .json twins; public pages show only
// the source and, when the original no longer resolves, the archived copy.
export const LINK_STATE_LABELS = {
  unchecked: "unchecked",
  live: "resolves",
  paywalled: "subscription",
  bot_blocked: "resolves, refuses automated checks",
  dead: "no longer resolves",
  redirected: "moved",
};

export const COUNTRY_NAMES = {
  US: "United States", HU: "Hungary", IN: "India", IL: "Israel", PS: "Palestine", RU: "Russia",
  SV: "El Salvador", HK: "Hong Kong", TR: "Türkiye", GB: "United Kingdom", CA: "Canada",
};

export const SUBDIVISION_NAMES = { "US-LA": "Louisiana", "US-FL": "Florida", "US-DC": "District of Columbia" };

export const COVERAGE_PAGE_DAYS = 60;
