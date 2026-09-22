// Site-wide constants and fixed copy for The War On News (thewaronnews.com),
// Crank #3. Every public string here follows the voice guide: no em dashes,
// no characterizing words outside quotation marks.

export const SITE_NAME = "The War On News";
export const SITE_SUBTITLE = "A dated record of government actions that limit reporting.";
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
export const HOME_DEFINITION = "The War On News is a dated, sourced reference to actions by officials, governments, regulators and legislatures that limit journalists' ability to gather or publish news. It covers the United States first, with incidents from other countries for context.";

export const HOME_METHOD_LINE = "Each entry states who did what and when, quotes the reason the official gave, and links to the reporting and court records it rests on. Every fact is a claim with a verbatim quotation, a source address, a method and a check date.";

export const HOME_DATA_LINE = "Every page is also published as Markdown (add .md) and JSON (add .json). The full record is a nightly Frictionless Data Package under CC BY 4.0 at /data, and a public MCP server at /mcp lets AI assistants search and fetch it.";

export const META_DESCRIPTION_HOME = "A dated, sourced record of government actions that limit journalists' ability to report. US-first, with global context. Incidents, cases, timeline, data and MCP.";

export const SECTIONS = [
  { label: "Incidents", path: "/incidents" },
  { label: "Timeline", path: "/timeline" },
  { label: "Cases", path: "/cases" },
  { label: "News Desk", path: "/news" },
  { label: "Actors", path: "/actors" },
  { label: "Outlets", path: "/outlets" },
  { label: "Glossary", path: "/glossary" },
  { label: "Data", path: "/data" },
  { label: "Methodology", path: "/methodology" },
  { label: "About", path: "/about" },
];

export const FOOTER_LINKS = [
  { label: "About", path: "/about" },
  { label: "Methodology", path: "/methodology" },
  { label: "Editorial policy", path: "/editorial-policy" },
  { label: "Corrections", path: "/corrections" },
  { label: "Changes", path: "/changes" },
  { label: "Data", path: "/data" },
  { label: "Feeds", path: "/feeds" },
  { label: "MCP", path: "/mcp" },
  { label: "llms.txt", path: "/llms.txt" },
];

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

export const LEVEL_LABELS = { federal: "Federal", state: "State", local: "Local", foreign: "Foreign" };

export const LINK_STATE_LABELS = {
  unchecked: "unchecked",
  live: "live",
  paywalled: "subscription",
  bot_blocked: "live, blocks automated checks",
  dead: "offline",
  redirected: "moved",
};

export const COUNTRY_NAMES = {
  US: "United States", HU: "Hungary", IN: "India", IL: "Israel", PS: "Palestine", RU: "Russia",
  SV: "El Salvador", HK: "Hong Kong", TR: "Turkiye", GB: "United Kingdom", CA: "Canada",
};

export const SUBDIVISION_NAMES = { "US-LA": "Louisiana", "US-FL": "Florida", "US-DC": "District of Columbia" };

export const NEWS_PAGE_SIZE = 30;
