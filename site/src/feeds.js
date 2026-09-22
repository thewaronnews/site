// Feeds (spec 4.4, v2): Incidents and Recent coverage as RSS 2.0, Atom and
// JSON Feed 1.1 (latest 50 items), plus /changes.xml (Atom). Incident items
// carry the latest revision reason; coverage items link to the publisher.

import { escapeXml, mdToPlain, isoNow } from "./util.js";
import { all, first, listChanges, recordPathFor } from "./db.js";
import { SITE_NAME, SITE_ORIGIN, SITE_SUBTITLE, PUBLISHER_NAME, LICENSE_URL } from "./site.js";

const LIMIT = 50;

async function coverageItems(env) {
  const rows = await all(env, "SELECT id, url, title, publisher, published_at, summary, fetched_at FROM coverage_items WHERE state = 'shown' ORDER BY COALESCE(published_at, fetched_at) DESC, id DESC LIMIT ?", LIMIT);
  return rows.map((c) => {
    const text = `${c.publisher ? `${c.publisher}. ` : ""}${c.summary || ""}`.trim();
    return {
      id: `${SITE_ORIGIN}/coverage#item-${c.id}`,
      url: c.url,
      title: c.title,
      text: text || c.title,
      html: `<p>${escapeXml(c.publisher || "")}${c.summary ? `: ${escapeXml(c.summary)}` : ""}</p><p><a href="${escapeXml(c.url)}">${escapeXml(c.title)}</a></p>`,
      published: c.published_at || c.fetched_at,
      updated: c.published_at || c.fetched_at,
      external_url: c.url,
    };
  });
}

async function incidentItems(env) {
  const rows = await all(env, "SELECT id, slug, title, summary, occurred_on, published_at, updated_at, revision FROM incidents WHERE pub_state = 'published' ORDER BY updated_at DESC LIMIT ?", LIMIT);
  const out = [];
  for (const r of rows) {
    const rev = await first(env, "SELECT reason, is_correction FROM revisions WHERE record_type = 'incident' AND record_id = ? ORDER BY revision DESC LIMIT 1", r.id);
    const summary = mdToPlain(r.summary);
    const revised = r.revision > 1 && r.updated_at !== r.published_at && rev;
    const note = revised ? `${rev.is_correction ? "Correction" : "Revised"}: ${rev.reason}.` : "New entry.";
    out.push({
      id: `${SITE_ORIGIN}/incidents/${r.slug}#r${r.revision}`,
      url: `${SITE_ORIGIN}/incidents/${r.slug}`,
      title: r.title,
      text: `${summary}\n\n${note}`,
      html: `<p>${escapeXml(summary)}</p><p>${escapeXml(note)}</p>`,
      published: r.published_at,
      updated: r.updated_at,
    });
  }
  return out;
}

function rss(items, { title, path, description }) {
  const rfc = (d) => (d ? new Date(d).toUTCString() : new Date().toUTCString());
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(title)}</title>
<link>${SITE_ORIGIN}${path}</link>
<description>${escapeXml(description)}</description>
<language>en-ca</language>
<copyright>${escapeXml(`${SITE_NAME}, CC BY 4.0`)}</copyright>
<atom:link href="${SITE_ORIGIN}${path}/feed.xml" rel="self" type="application/rss+xml"/>
<lastBuildDate>${rfc(items[0] && items[0].updated)}</lastBuildDate>
${items.map((i) => `<item>
<title>${escapeXml(i.title)}</title>
<link>${escapeXml(i.url)}</link>
<guid isPermaLink="false">${escapeXml(i.id)}</guid>
<pubDate>${rfc(i.updated || i.published)}</pubDate>
<description>${escapeXml(i.text)}</description>
</item>`).join("\n")}
</channel>
</rss>
`;
}

function atom(items, { title, path, selfPath, subtitle }) {
  const updated = (items[0] && (items[0].updated || items[0].published)) || isoNow();
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>${escapeXml(title)}</title>
<subtitle>${escapeXml(subtitle)}</subtitle>
<id>${SITE_ORIGIN}${selfPath}</id>
<link rel="self" type="application/atom+xml" href="${SITE_ORIGIN}${selfPath}"/>
<link rel="alternate" type="text/html" href="${SITE_ORIGIN}${path}"/>
<updated>${escapeXml(updated)}</updated>
<author><name>${escapeXml(PUBLISHER_NAME)}</name></author>
<rights>CC BY 4.0 ${escapeXml(LICENSE_URL)}</rights>
${items.map((i) => `<entry>
<title>${escapeXml(i.title)}</title>
<id>${escapeXml(i.id)}</id>
<link rel="alternate" type="text/html" href="${escapeXml(i.url)}"/>
${i.external_url ? `<link rel="related" href="${escapeXml(i.external_url)}"/>\n` : ""}<published>${escapeXml(i.published || i.updated)}</published>
<updated>${escapeXml(i.updated || i.published)}</updated>
<content type="html">${escapeXml(i.html)}</content>
</entry>`).join("\n")}
</feed>
`;
}

function jsonFeed(items, { title, path, description, selfPath }) {
  return JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title,
    home_page_url: `${SITE_ORIGIN}${path}`,
    feed_url: `${SITE_ORIGIN}${selfPath}`,
    description,
    language: "en-CA",
    authors: [{ name: PUBLISHER_NAME, url: `${SITE_ORIGIN}/about` }],
    items: items.map((i) => ({
      id: i.id, url: i.url, title: i.title, content_text: i.text,
      date_published: i.published || i.updated, date_modified: i.updated || i.published,
      ...(i.external_url ? { external_url: i.external_url } : {}),
    })),
  }, null, 2);
}

const FEED_META = {
  coverage: { title: `${SITE_NAME}: Recent coverage`, path: "/coverage", description: `Recent reporting on government actions against journalists worldwide, linked to the publishers. ${SITE_SUBTITLE}` },
  incidents: { title: `${SITE_NAME}: Incidents`, path: "/incidents", description: `New and revised incident entries. ${SITE_SUBTITLE}` },
};

// Returns {body, contentType} or null. kind: coverage|incidents; fmt: rss|atom|json
export async function renderFeed(env, kind, fmt) {
  const meta = FEED_META[kind];
  if (!meta) return null;
  const items = kind === "coverage" ? await coverageItems(env) : await incidentItems(env);
  if (fmt === "rss") return { body: rss(items, meta), contentType: "application/rss+xml; charset=utf-8" };
  if (fmt === "atom") return { body: atom(items, { ...meta, selfPath: `${meta.path}/atom.xml`, subtitle: meta.description }), contentType: "application/atom+xml; charset=utf-8" };
  if (fmt === "json") return { body: jsonFeed(items, { ...meta, selfPath: `${meta.path}/feed.json` }), contentType: "application/feed+json; charset=utf-8" };
  return null;
}

export async function changesAtom(env) {
  const rows = await listChanges(env, { limit: 100 });
  const items = [];
  for (const c of rows) {
    const path = c.claim_id ? `/claims/${c.claim_id}` : (await recordPathFor(env, c.record_type, c.record_id)) || "/changes";
    const label = c.kind.replace(/_/g, " ");
    const text = [label, c.record_type ? `${c.record_type} ${c.record_id || ""}`.trim() : "", c.reason ? `Reason: ${c.reason}` : "", c.is_correction ? "Correction." : ""].filter(Boolean).join(". ");
    items.push({ id: `${SITE_ORIGIN}/changes#change-${c.id}`, url: `${SITE_ORIGIN}${path}`, title: `${c.changed_at.slice(0, 10)}: ${label}`, text, html: `<p>${escapeXml(text)}</p>`, published: c.changed_at, updated: c.changed_at });
  }
  return atom(items, { title: `${SITE_NAME}: changes`, path: "/changes", selfPath: "/changes.xml", subtitle: "Every new, superseded, disputed and retired claim, publication, revision and withdrawal." });
}

export const FEED_LIST = [
  { label: "Recent coverage (RSS)", href: "/coverage/feed.xml" },
  { label: "Recent coverage (Atom)", href: "/coverage/atom.xml" },
  { label: "Recent coverage (JSON Feed)", href: "/coverage/feed.json" },
  { label: "Incidents (RSS)", href: "/incidents/feed.xml" },
  { label: "Incidents (Atom)", href: "/incidents/atom.xml" },
  { label: "Incidents (JSON Feed)", href: "/incidents/feed.json" },
  { label: "Changes (Atom)", href: "/changes.xml" },
];
