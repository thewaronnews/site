// Feeds (spec 4.4): News Desk and Incidents as RSS 2.0, Atom and JSON Feed
// 1.1 (latest 50 items), plus /changes.xml (Atom). Reverted notes leave the
// feeds. Incident items carry the latest revision reason.

import { escapeXml, mdToPlain, isoNow } from "./util.js";
import { all, first, listChanges, recordPathFor, getSourcesByIds } from "./db.js";
import { SITE_NAME, SITE_ORIGIN, SITE_SUBTITLE, PUBLISHER_NAME, LICENSE_URL } from "./site.js";

const LIMIT = 50;

async function newsItems(env) {
  const notes = await all(env, "SELECT id, slug, title, note, primary_source_id, published_at, story_date FROM news_desk_notes WHERE state = 'published' ORDER BY published_at DESC LIMIT ?", LIMIT);
  const sources = await getSourcesByIds(env, notes.map((n) => n.primary_source_id));
  const byId = new Map(sources.map((s) => [s.id, s]));
  return notes.map((n) => {
    const s = byId.get(n.primary_source_id);
    const text = `${n.note}${s ? `\n\nSource: ${s.publisher}, "${s.title}", ${s.url}` : ""}`;
    return {
      id: `${SITE_ORIGIN}/news/${n.slug}`,
      url: `${SITE_ORIGIN}/news/${n.slug}`,
      title: n.title,
      text,
      html: `<p>${escapeXml(n.note)}</p>${s ? `<p>Source: <a href="${escapeXml(s.url)}">${escapeXml(s.publisher)}: ${escapeXml(s.title)}</a></p>` : ""}`,
      published: n.published_at,
      updated: n.published_at,
      external_url: s ? s.url : null,
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
  news: { title: `${SITE_NAME}: News Desk`, path: "/news", description: `Dated notes on government actions that limit reporting, each linking to the original reporting. ${SITE_SUBTITLE}` },
  incidents: { title: `${SITE_NAME}: Incidents`, path: "/incidents", description: `New and revised incident entries. ${SITE_SUBTITLE}` },
};

// Returns {body, contentType} or null. kind: news|incidents; fmt: rss|atom|json
export async function renderFeed(env, kind, fmt) {
  const meta = FEED_META[kind];
  if (!meta) return null;
  const items = kind === "news" ? await newsItems(env) : await incidentItems(env);
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
  return atom(items, { title: `${SITE_NAME}: changes`, path: "/changes", selfPath: "/changes.xml", subtitle: "Every new, superseded, disputed and retired claim, publication, revision, withdrawal and reverted note." });
}

export const FEED_LIST = [
  { label: "News Desk (RSS)", href: "/news/feed.xml" },
  { label: "News Desk (Atom)", href: "/news/atom.xml" },
  { label: "News Desk (JSON Feed)", href: "/news/feed.json" },
  { label: "Incidents (RSS)", href: "/incidents/feed.xml" },
  { label: "Incidents (Atom)", href: "/incidents/atom.xml" },
  { label: "Incidents (JSON Feed)", href: "/incidents/feed.json" },
  { label: "Changes (Atom)", href: "/changes.xml" },
];
