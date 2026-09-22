// JSON-LD builders (spec 4.2). BreadcrumbList on every page. JSON-LD is
// for readability, not a citation lever (L-204). Actors carry no
// description by design.

import { partialIso } from "./util.js";
import {
  SITE_NAME, SITE_ORIGIN, SITE_SUBTITLE, PUBLISHER_NAME, PUBLISHER_URL, LICENSE_URL, HOME_DEFINITION,
  COUNTRY_NAMES, SUBDIVISION_NAMES,
} from "./site.js";

const CTX = "https://schema.org";

export function publisherLd() {
  return { "@type": "Person", name: PUBLISHER_NAME, url: PUBLISHER_URL };
}

export function breadcrumbLd(crumbs, path, title) {
  const list = [{ name: SITE_NAME, path: "/" }, ...(crumbs || [])];
  if (path && path !== "/" && !list.find((c) => c.path === path)) list.push({ name: title, path });
  return {
    "@context": CTX,
    "@type": "BreadcrumbList",
    itemListElement: list.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${SITE_ORIGIN}${c.path}` })),
  };
}

export function websiteLd() {
  return {
    "@context": CTX,
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: "thewaronnews.com",
    description: `${SITE_SUBTITLE} ${HOME_DEFINITION}`,
    url: `${SITE_ORIGIN}/`,
    inLanguage: "en-CA",
    license: LICENSE_URL,
    publisher: publisherLd(),
    potentialAction: { "@type": "SearchAction", target: `${SITE_ORIGIN}/search?q={search_term_string}`, "query-input": "required name=search_term_string" },
  };
}

function placeName(jurisdiction, country) {
  const j = String(jurisdiction || "");
  if (SUBDIVISION_NAMES[j.split(":")[0]]) return `${SUBDIVISION_NAMES[j.split(":")[0]]}, United States`;
  return COUNTRY_NAMES[country] || COUNTRY_NAMES[j] || j || country;
}

function actorRef(a) {
  const node = { "@type": a.kind === "person" ? "Person" : "GovernmentOrganization", name: a.name, url: `${SITE_ORIGIN}/actors/${a.slug}` };
  if (a.kind === "person" && (a.role_at_time || a.actor_role)) node.jobTitle = a.role_at_time || a.actor_role;
  return node;
}

export function incidentLd(full) {
  const r = full.row;
  const url = `${SITE_ORIGIN}/incidents/${r.slug}`;
  const event = {
    "@type": "Event",
    name: r.title,
    startDate: partialIso(r.occurred_on, r.occurred_on_precision),
    location: { "@type": "AdministrativeArea", name: placeName(r.jurisdiction, r.country) },
  };
  if (r.ended_on) event.endDate = r.ended_on;
  const organizers = (full.actors || []).filter((a) => a.role === "ordered" || a.role === "announced").map(actorRef);
  if (organizers.length) event.organizer = organizers;
  const about = [event];
  if (r.type === "legislation") {
    const legislature = (full.actors || []).find((a) => a.body_type === "legislature" || a.role === "legislated");
    const leg = {
      "@type": "Legislation",
      name: r.title,
      legislationDate: r.occurred_on,
      legislationJurisdiction: placeName(r.jurisdiction, r.country),
      legislationLegalForce: r.status === "in_effect" ? "InForce" : r.status === "enjoined" || r.status === "reversed" || r.status === "expired" ? "NotInForce" : "PartiallyInForce",
    };
    if (legislature) leg.legislationPassedBy = actorRef(legislature);
    about.push(leg);
  }
  return {
    "@context": CTX,
    "@type": "Article",
    headline: r.title.slice(0, 110),
    url,
    mainEntityOfPage: url,
    datePublished: r.published_at,
    dateModified: r.updated_at,
    inLanguage: "en-CA",
    author: publisherLd(),
    publisher: publisherLd(),
    license: LICENSE_URL,
    about,
    citation: (full.sources || []).map((s) => ({ "@type": "CreativeWork", name: s.title, url: s.url, publisher: s.publisher })),
    isPartOf: { "@type": "Dataset", name: SITE_NAME, url: `${SITE_ORIGIN}/data` },
  };
}

export function noteLd(n, src, incident) {
  const url = `${SITE_ORIGIN}/news/${n.slug}`;
  const ld = {
    "@context": CTX,
    "@type": "NewsArticle",
    headline: n.title,
    url,
    mainEntityOfPage: url,
    datePublished: n.published_at,
    dateModified: n.published_at,
    author: publisherLd(),
    publisher: publisherLd(),
    license: LICENSE_URL,
    articleBody: n.note,
  };
  if (src.primary) ld.isBasedOn = { "@type": "NewsArticle", name: src.primary.title, url: src.primary.url, publisher: { "@type": "Organization", name: src.primary.publisher } };
  if (src.secondary && src.secondary.length) ld.citation = src.secondary.map((s) => ({ "@type": "CreativeWork", name: s.title, url: s.url }));
  if (incident) ld.about = { "@type": "Article", name: incident.title, url: `${SITE_ORIGIN}/incidents/${incident.slug}` };
  return ld;
}

export function actorLd(row) {
  const sameAs = [];
  if (row.wikidata_qid) sameAs.push(`https://www.wikidata.org/wiki/${row.wikidata_qid}`);
  if (row.official_url) sameAs.push(row.official_url);
  const ld = {
    "@context": CTX,
    "@type": row.kind === "person" ? "Person" : "GovernmentOrganization",
    name: row.name,
    url: `${SITE_ORIGIN}/actors/${row.slug}`,
  };
  if (row.kind === "person") ld.jobTitle = row.office || row.role;
  if (sameAs.length) ld.sameAs = sameAs;
  return ld;
}

export function outletLd(row) {
  const ld = { "@context": CTX, "@type": "NewsMediaOrganization", name: row.name, url: `${SITE_ORIGIN}/outlets/${row.slug}` };
  const sameAs = [];
  if (row.homepage_url) sameAs.push(row.homepage_url);
  if (row.wikidata_qid) sameAs.push(`https://www.wikidata.org/wiki/${row.wikidata_qid}`);
  if (sameAs.length) ld.sameAs = sameAs;
  return ld;
}

export function journalistLd(row) {
  const ld = { "@context": CTX, "@type": "Person", name: row.name, jobTitle: row.role, url: `${SITE_ORIGIN}/journalists/${row.slug}` };
  if (row.outlet_name) ld.worksFor = { "@type": "NewsMediaOrganization", name: row.outlet_name, url: `${SITE_ORIGIN}/outlets/${row.outlet_slug}` };
  if (row.profile_url) ld.sameAs = [row.profile_url];
  return ld;
}

export function caseLd(row) {
  const ld = {
    "@context": CTX,
    "@type": "CreativeWork",
    additionalType: "http://www.wikidata.org/entity/Q2334719",
    name: row.caption,
    alternateName: row.short_name,
    url: `${SITE_ORIGIN}/cases/${row.slug}`,
    sourceOrganization: { "@type": "GovernmentOrganization", name: row.court },
  };
  if (row.docket) ld.identifier = { "@type": "PropertyValue", propertyID: "docket", value: row.docket };
  if (row.filed_on) ld.dateCreated = row.filed_on;
  if (row.courtlistener_url) ld.sameAs = [row.courtlistener_url];
  return ld;
}

export function articleLd({ title, path, published, modified, citations = [] }) {
  return {
    "@context": CTX,
    "@type": "Article",
    headline: title.slice(0, 110),
    url: `${SITE_ORIGIN}${path}`,
    datePublished: published || undefined,
    dateModified: modified || undefined,
    author: publisherLd(),
    publisher: publisherLd(),
    license: LICENSE_URL,
    citation: citations.map((s) => ({ "@type": "CreativeWork", name: s.title, url: s.url })),
  };
}

export function definedTermLd(row) {
  return {
    "@context": CTX,
    "@type": "DefinedTerm",
    name: row.term,
    description: row.definition,
    url: `${SITE_ORIGIN}/glossary/${row.slug}`,
    inDefinedTermSet: { "@type": "DefinedTermSet", name: `${SITE_NAME} glossary`, url: `${SITE_ORIGIN}/glossary` },
  };
}

export function definedTermSetLd(terms) {
  return {
    "@context": CTX,
    "@type": "DefinedTermSet",
    name: `${SITE_NAME} glossary`,
    url: `${SITE_ORIGIN}/glossary`,
    hasDefinedTerm: terms.map((t) => ({ "@type": "DefinedTerm", name: t.term, url: `${SITE_ORIGIN}/glossary/${t.slug}` })),
  };
}

export function datasetLd(lastExport) {
  return {
    "@context": CTX,
    "@type": "Dataset",
    name: SITE_NAME,
    description: `${SITE_SUBTITLE} Incidents, events, actors, outlets, journalists, cases, sources, claims, tactics and countries, exported nightly as a Frictionless Data Package.`,
    url: `${SITE_ORIGIN}/data`,
    license: LICENSE_URL,
    isAccessibleForFree: true,
    creator: publisherLd(),
    publisher: publisherLd(),
    dateModified: lastExport ? lastExport.ts : undefined,
    version: lastExport ? lastExport.datapackage_version : undefined,
    keywords: ["press freedom", "journalism", "government", "First Amendment"],
    distribution: [
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE_ORIGIN}/data/datapackage.json`, name: "datapackage.json" },
      { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE_ORIGIN}/data/data/incidents.csv`, name: "incidents.csv" },
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE_ORIGIN}/data/json/incidents.json`, name: "incidents.json" },
      { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE_ORIGIN}/data/data/claims.csv`, name: "claims.csv" },
    ],
  };
}
