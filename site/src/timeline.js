// /timeline views (spec 3.1): generated from published events plus each
// published incident's occurred_on. Filters: year, actor, type, country.

import { timelineRows, first, all } from "./db.js";
import { INCIDENT_TYPE_LABELS, COUNTRY_NAMES } from "./site.js";
import { ENUMS } from "./records.js";
import { a } from "./util.js";

export async function timelineDoc(env, filter = {}) {
  let title = "Timeline";
  let path = "/timeline";
  let subtitle = "Every recorded incident and dated development, oldest first.";
  const q = {};
  if (filter.year) {
    if (!/^\d{4}$/.test(filter.year)) return null;
    q.year = filter.year;
    title = `Timeline: ${filter.year}`;
    path = `/timeline/${filter.year}`;
    subtitle = `Recorded incidents and developments dated ${filter.year}, oldest first.`;
  } else if (filter.actor) {
    const actor = await first(env, "SELECT slug, name, pub_state FROM actors WHERE slug = ?", filter.actor);
    if (!actor || actor.pub_state !== "published") return null;
    q.actorSlug = actor.slug;
    title = `Timeline: ${actor.name}`;
    path = `/timeline/actor/${actor.slug}`;
    subtitle = `Recorded incidents in which ${actor.name} is named, oldest first.`;
  } else if (filter.type) {
    if (!ENUMS.incident_type.includes(filter.type)) return null;
    q.type = filter.type;
    title = `Timeline: ${INCIDENT_TYPE_LABELS[filter.type]}`;
    path = `/timeline/type/${filter.type}`;
    subtitle = `Recorded incidents of type ${INCIDENT_TYPE_LABELS[filter.type].toLowerCase()}, oldest first.`;
  } else if (filter.country) {
    const cc = String(filter.country).toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return null;
    q.country = cc;
    title = `Timeline: ${COUNTRY_NAMES[cc] || cc}`;
    path = `/timeline/country/${filter.country.toLowerCase()}`;
    subtitle = `Recorded incidents in ${COUNTRY_NAMES[cc] || cc}, oldest first.`;
  }
  const rows = await timelineRows(env, q);
  const years = await all(env, "SELECT DISTINCT substr(occurred_on, 1, 4) AS y FROM incidents WHERE pub_state = 'published' ORDER BY y");
  const types = await all(env, "SELECT DISTINCT type FROM incidents WHERE pub_state = 'published' ORDER BY type");
  const countries = await all(env, "SELECT DISTINCT country FROM incidents WHERE pub_state = 'published' ORDER BY country");
  const blocks = [
    { k: "p", text: subtitle },
    {
      k: "html",
      html: `<p class="filters">Years: ${years.map((y) => a(`/timeline/${y.y}`, y.y)).join(" ")}<br>Types: ${types.map((t) => a(`/timeline/type/${t.type}`, INCIDENT_TYPE_LABELS[t.type] || t.type)).join(" ")}<br>Countries: ${countries.map((c) => a(`/timeline/country/${c.country.toLowerCase()}`, COUNTRY_NAMES[c.country] || c.country)).join(" ")}</p>`,
      text: "",
    },
    { k: "timeline", rows },
  ];
  return {
    path,
    title,
    subtitle: null,
    metaDescription: subtitle,
    breadcrumbs: path === "/timeline" ? [] : [{ name: "Timeline", path: "/timeline" }],
    blocks,
    data: { filter: { year: q.year || null, actor: q.actorSlug || null, type: q.type || null, country: q.country || null }, count: rows.length, rows },
  };
}

