// HTML-only views for the Atlas design (Concept B, approved 2026-09-22):
// the home page, the incident page, ladder lanes and rung cards, search
// chrome and the coverage list. Everything here feeds doc.htmlBody or a
// block's viewHtml, which renderMarkdown and doc.data never read, so the
// .md and .json twins are unchanged by the design.

import { a, aHtml, escapeHtml, extLink, proseDate, mdToPlain, truncate } from "./util.js";
import { blockToHtml, footnotesHtml, metaHtml, crumbsHtml, artImg, cardHtml } from "./render.js";
import { SITE_NAME, CONTINENTS, OUTCOME_LABELS, STAGE_ORDER, STAGE_LABELS, INCIDENT_STATUS_LABELS } from "./site.js";

// ---------- small pieces ----------

export function ccBadge(iso2) {
  return iso2 ? `<span class="cc" aria-hidden="true">${escapeHtml(String(iso2).toUpperCase())}</span>` : "";
}

export function rsfChip(rsf) {
  if (!rsf || !rsf.label) return `<span class="rsf-chip">RSF rank: not recorded</span>`;
  return rsf.source_url ? a(rsf.source_url, rsf.label, { class: "rsf-chip" }) : `<span class="rsf-chip">${escapeHtml(rsf.label)}</span>`;
}

export function outcomeBadge(outcome, on = null) {
  const label = OUTCOME_LABELS[outcome] || "Unknown";
  return `<span class="outcome${outcome === "ongoing" ? " outcome--ongoing" : ""}">${escapeHtml(label)}${on ? ` ${escapeHtml(proseDate(on))}` : ""}</span>`;
}

// Strip the "Country: " lead and a trailing ", Month YYYY" from a record title.
export function shortTitle(title, max = 80) {
  let t = String(title || "").replace(/^[^:]{2,40}:\s+/, "");
  t = t.replace(/,\s+(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+)?\d{4}(?:\s+to\s+\d{4})?$/, "");
  return truncate(t.charAt(0).toUpperCase() + t.slice(1), max);
}

// ---------- world tile map ----------
// One square per country, placed roughly by geography (column, row). Shaded
// by one thing only: whether the record holds an entry for the country.
const TILES = {
  CA: [2, 1], US: [2, 2], MX: [1, 3], CU: [3, 3], HT: [4, 3], GT: [1, 4], SV: [2, 4], HN: [3, 4], NI: [3, 5],
  CO: [3, 6], VE: [4, 6], EC: [2, 7], PE: [3, 7], BR: [4, 7], BO: [3, 8], PY: [4, 8], CL: [2, 9], AR: [3, 9], UY: [4, 9],
  IS: [7, 0], NO: [9, 0], SE: [10, 0], FI: [11, 0],
  IE: [7, 1], GB: [8, 1], NL: [9, 1], DE: [10, 1], PL: [11, 1], BY: [12, 1], RU: [13, 1],
  FR: [8, 2], CH: [9, 2], CZ: [10, 2], SK: [11, 2], UA: [12, 2], KZ: [14, 2], MN: [17, 2], KP: [19, 2],
  PT: [7, 3], ES: [8, 3], IT: [9, 3], AT: [10, 3], HU: [11, 3], GE: [13, 3], AZ: [14, 3], CN: [17, 3], KR: [19, 3], JP: [20, 3],
  MT: [9, 4], RS: [10, 4], GR: [11, 4], TR: [12, 4], AF: [15, 4], PK: [16, 4], HK: [18, 4], TW: [19, 4],
  MA: [7, 5], DZ: [8, 5], TN: [9, 5], LY: [10, 5], EG: [11, 5], IL: [12, 5], SY: [13, 5], IQ: [14, 5], IR: [15, 5], IN: [16, 5], BD: [17, 5], MM: [18, 5], PH: [21, 5],
  SN: [6, 6], ML: [7, 6], NE: [8, 6], TD: [9, 6], SD: [10, 6], ER: [11, 6], SA: [12, 6], YE: [13, 6], TH: [18, 6], KH: [19, 6], VN: [20, 6],
  NG: [8, 7], CM: [9, 7], SS: [10, 7], ET: [11, 7], MY: [19, 7],
  CD: [9, 8], UG: [10, 8], KE: [11, 8], ID: [20, 8], PG: [21, 8],
  AO: [9, 9], RW: [10, 9], TZ: [11, 9], FJ: [23, 9],
  ZW: [10, 10], MZ: [11, 10], AU: [20, 10],
  ZA: [9, 11], NZ: [22, 11],
};
const CONT_LABELS = [["AMERICAS", 0, 11.3], ["EUROPE", 14.3, 0.55], ["AFRICA", 5.9, 10.2], ["ASIA", 15.6, 1.55], ["OCEANIA", 20.3, 11.55]];

export function tileMapSvg(inRecord, names, focal = "US") {
  const P = 46;
  const S = 40;
  const tiles = [];
  const extra = [...inRecord].filter((c) => !TILES[c]).sort();
  // A country in the record without a placed tile goes on the spare bottom row.
  extra.forEach((c, i) => { TILES[c] = TILES[c] || [13 + i, 11]; });
  for (const [cc, [col, row]] of Object.entries(TILES)) {
    const on = inRecord.has(cc);
    const x = col * P;
    const y = row * P;
    const name = names.get(cc) || cc;
    const cls = cc === focal ? "tile on focal" : on ? "tile on" : "tile";
    const g = `<g class="${cls}"><title>${escapeHtml(name)}${on ? (cc === focal ? ": in the record, focal case" : ": in the record") : ": no entry yet"}</title><rect x="${x}" y="${y}" width="${S}" height="${S}" rx="3"/><text x="${x + S / 2}" y="${y + 25}">${cc}</text></g>`;
    tiles.push(on ? `<a href="/countries/${cc.toLowerCase()}">${g}</a>` : g);
  }
  const labels = CONT_LABELS.map(([t, c, r]) => `<text class="cont" x="${(c * P).toFixed(0)}" y="${(r * P).toFixed(0)}">${t}</text>`).join("");
  return `<svg class="tilemap" viewBox="-4 -4 1112 560" role="img" aria-labelledby="map-t map-d"><title id="map-t">Countries in the record</title><desc id="map-d">A world map with one square per country, placed roughly by geography. Dark squares are countries the record holds at least one entry for; the shading shows only whether a country is in the record, not how many entries it has. The United States, the focal case, is outlined.</desc>${tiles.join("")}${labels}</svg>`;
}

// ---------- home ----------

export function homeHtml(v) {
  const names = v.countryNames;
  const quick = [
    ["/search?tactic=access_ban", "Tactic", "access bans"],
    ["/search?stage=eliminate", "Stage", "eliminate"],
    ["/search?outcome=reversed", "Outcome", "reversed"],
    ["/search?has_case=1", "With a court case", ""],
    ["/search?from=1900&to=1949", "Years", "1900 to 1949"],
    ["/search?from=2020", "Years", "since 2020"],
  ];
  const hero = `<section class="home-hero" aria-labelledby="home-h">
<div>
<p class="eyebrow">A sourced record, 1900 to ${escapeHtml(v.year)}</p>
<h1 id="home-h">How governments have limited journalists, <em>placed on one map</em></h1>
<p class="lede">Choose a country, a tactic or a decade to see what governments did to journalism and fact-based reporting, who led them at the time, and how each case ended. Every entry is dated and every fact cites its source.</p>
</div>
<form class="home-search" action="/search" method="get" role="search">
<label for="home-q">Search incidents, laws, outlets and leaders</label>
<div class="field"><input id="home-q" name="q" type="search" placeholder="Try &quot;licence&quot;, &quot;espionage&quot; or &quot;1975&quot;" maxlength="200"><button type="submit">Search</button></div>
<ul class="chips" aria-label="Start from a filter">${quick.map(([h, k, val]) => `<li>${aHtml(h, `${escapeHtml(k)}${val ? ` <b>${escapeHtml(val)}</b>` : ""}`, { class: "chip" })}</li>`).join("")}</ul>
</form>
</section>
<section class="panel mapcard" aria-labelledby="map-h">
<div class="mapcard__head"><h2 id="map-h">By place: every country in the record</h2><p>One square per country, arranged roughly by geography. Select a country to open its page.</p></div>
${tileMapSvg(v.inRecord, names)}
<ul class="legend" aria-label="Legend"><li><i style="background:var(--t3)"></i>In the record</li><li><i style="background:var(--t0);box-shadow:inset 0 0 0 1px var(--line-strong)"></i>No entry yet</li><li><i style="background:var(--t4);box-shadow:inset 0 0 0 3px var(--accent)"></i>Focal case: the United States</li></ul>
<p class="counts-caveat" style="margin-top:.8rem">${escapeHtml(v.caveat)}</p>
<ul class="continents" aria-label="Continents">${v.continents.map(([slug, name, n]) => `<li><a href="/continents/${slug}">${escapeHtml(name)}<span>${n} ${n === 1 ? "country" : "countries"} in the record</span></a></li>`).join("")}</ul>
</section>`;

  const f = v.focal;
  let focal = "";
  if (f) {
    const today = v.today;
    const events = f.events.map((e) => `<li${e.occurred_on > today ? ' class="is-next"' : ""}><time datetime="${escapeHtml(e.occurred_on)}">${escapeHtml(proseDate(e.occurred_on, e.occurred_on_precision))}${e.occurred_on > today ? " (scheduled)" : ""}</time>${escapeHtml(e.label)}</li>`).join("");
    focal = `<section class="block" aria-labelledby="focal-h">
<div class="bhead"><h2 id="focal-h">The current chapter</h2>${a("/united-states", "The United States chapter")}</div>
<div class="panel focal">
<div>
<span class="chip chip--accent">Focal case</span>
<h3>${a(`/incidents/${f.slug}`, f.title)}</h3>
<p class="where">${ccBadge(f.country)}<span>${escapeHtml(f.country_name)} · ${escapeHtml(CONTINENTS[f.continent] || "")}</span><time datetime="${escapeHtml(f.occurred_on)}">${escapeHtml(proseDate(f.occurred_on, f.occurred_on_precision))}</time>${rsfChip(f.rsf)}</p>
${f.summaryParas.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
<p class="links-row">${a(`/incidents/${f.slug}`, "Full entry, with claims and sources")}${a("/united-states", "The United States chapter")}${a(`/ladders/${f.tactic_primary}`, "Where this tactic has led elsewhere")}</p>
</div>
<div class="focal__side">
<dl class="facts"><div><dt>Tactic</dt><dd>${f.tactics.map((t) => a(`/tactics/${t.slug}`, t.name)).join(", ")}</dd></div><div><dt>Stage</dt><dd>${a(`/ladders/${f.tactic_primary}#stage-${f.stage}`, STAGE_LABELS[f.stage] || "Not set")}</dd></div>${f.leader_name ? `<div><dt>Head of government</dt><dd>${a(`/leaders/${f.leader_slug}`, f.leader_name)}</dd></div>` : ""}<div><dt>Status</dt><dd><span class="status">${escapeHtml(INCIDENT_STATUS_LABELS[f.status] || f.status || "")}</span></dd></div></dl>
${events ? `<h4 class="events-h">Events</h4><ol class="events">${events}</ol>` : ""}
</div>
</div>
</section>`;
  }

  const ways = `<section class="block" aria-labelledby="ways-h">
<div class="bhead"><h2 id="ways-h">Three ways in</h2><p>Every view has its own address, with CSV, JSON and Markdown.</p></div>
<div class="ways">
<div class="panel way"><a class="way__art" href="/countries" tabindex="-1" aria-hidden="true">${artImg("country", { sizes: "(min-width: 1000px) 30vw, 100vw", alt: "" })}</a><div class="way__body"><h3>${a("/countries", "By place")}</h3><p class="sub">Continent, then country, each with its Reporters Without Borders (RSF) press-freedom rank.</p>
<ul class="chips">${v.continents.map(([slug, name]) => `<li>${a(`/continents/${slug}`, name, { class: "chip" })}</li>`).join("")}</ul>
${a("/countries", "All countries in the record", { class: "more" })}</div></div>
<div class="panel way"><a class="way__art" href="/tactics" tabindex="-1" aria-hidden="true">${artImg("tactic", { sizes: "(min-width: 1000px) 30vw, 100vw", alt: "" })}</a><div class="way__body"><h3>${a("/tactics", "By tactic")}</h3><p class="sub">Thirteen tactics, each defined; every incident has one main tactic.</p>
<ul class="chips">${v.tactics.map((t) => `<li>${a(`/tactics/${t.slug}`, t.name, { class: "chip chip--tactic" })}</li>`).join("")}</ul>
${a("/ladders", "Follow each tactic's ladder", { class: "more" })}</div></div>
<div class="panel way"><a class="way__art" href="/eras" tabindex="-1" aria-hidden="true">${artImg("era-timeline", { sizes: "(min-width: 1000px) 30vw, 100vw", alt: "" })}</a><div class="way__body"><h3>${a("/eras", "By time")}</h3><p class="sub">Anchor entries for each decade from 1900; from 2020, every well-sourced incident.</p>
<ul class="chips">${v.decades.filter((d) => d.anchor).map((d) => `<li>${a(`/eras/${d.decade}`, d.decade, { class: "chip" })}</li>`).join("")}</ul>
${a("/timeline", "Open the timeline", { class: "more" })}</div></div>
</div>
</section>`;

  const L = v.ladder;
  const ladder = L ? `<section class="block" aria-labelledby="ladder-h">
<div class="bhead"><h2 id="ladder-h">One tactic, five stages</h2>${a(`/ladders/${L.slug}`, `The full ladder for ${L.name.toLowerCase()}`)}</div>
<div class="panel">
<p class="muted" style="margin-top:0">A ladder takes one tactic, here ${escapeHtml(L.name.toLowerCase())}, and sets out what governments have done with it, stage by stage. The United States rows are marked as the focal case.</p>
<ol class="ladder-teaser">${STAGE_ORDER.map((st) => {
    const r = L.byStage[st];
    return `<li class="lt-step${r && r.focal ? " is-focal" : ""}${r ? "" : " is-empty"}"><h3>${escapeHtml(STAGE_LABELS[st])}</h3><p class="def">${escapeHtml(v.stageDefs[st] || "")}</p>${r ? `<p class="r">${ccBadge(r.country)} ${a(`/incidents/${r.slug}`, `${r.country_name}, ${r.year}`)}<small>${escapeHtml(r.what)}</small>${r.focal ? '<small><strong class="focal-case">Focal case</strong></small>' : ""}</p>` : `<p class="r">No rung at this stage for this tactic yet. ${a("/ladders", "Other ladders")}</p>`}</li>`;
  }).join("")}</ol>
</div>
</section>` : "";

  const strip = `<section class="block" aria-labelledby="era-h">
<div class="bhead"><h2 id="era-h">1900 to ${escapeHtml(v.year)}</h2>${a("/eras", "Every decade")}</div>
<div class="panel"><ol class="strip" style="--n:${v.decades.length}" aria-label="Decades">${v.decades.map((d, i) => `<li class="${d.anchor ? "" : "none"}${i === v.decades.length - 1 ? " now" : ""}">${aHtml(d.anchor ? `/eras/${d.decade}` : "/eras", `<span class="dec">${escapeHtml(d.decade)}</span><span class="dot"></span><span class="anc">${d.anchor ? `${escapeHtml(d.anchor.year)} · ${escapeHtml(d.anchor.country)} · ${escapeHtml(d.anchor.what)}` : "No entry yet"}</span>`)}</li>`).join("")}</ol></div>
</section>`;

  const cov = v.coverage.length ? `<ul class="coverage-list">${v.coverage.map((i) => `<li class="coverage-item">${i.country ? ccBadge(i.country) : '<span class="cc-none" aria-hidden="true"></span>'}${extLink({ url: i.url, title: i.title, link_state: "live" })}<span class="coverage-item__meta"><b>${escapeHtml(i.publisher || "")}</b>${i.published_at ? ` · <time datetime="${escapeHtml(i.published_at)}">${escapeHtml(proseDate(i.published_at.slice(0, 10)))}</time>` : ""}${i.country ? ` · ${escapeHtml(names.get(i.country) || i.country)}` : ""}</span></li>`).join("")}</ul>` : `<p>${a("/coverage", "Recent coverage")} from news organisations worldwide, collected hourly.</p>`;
  const duo = `<section class="block duo">
<div><div class="bhead"><h2 id="cov-h">Recent coverage</h2>${a("/coverage", "All recent coverage")}</div>${cov}</div>
<div><div class="panel about-record" aria-labelledby="about-h"><h2 id="about-h">What this record is about</h2>
<p>Journalism, as this record uses the word, means reporting that is verified and based on facts: work that says where its information comes from, can be checked, and is corrected when it is wrong. ${escapeHtml(SITE_NAME)} records actions by governments, officials, regulators, courts and legislatures that limited people's ability to gather or publish such reporting.</p>
<p>Each entry gives the date and place, who acted, the reason the officials gave in their own words, the outcome, and the sources it rests on. The record states what happened; it does not rate countries.</p>
<p class="links-row">${a("/context", "Why this record exists")}${a("/sources-and-standards", "Sources and standards")}${a("/about", "About")}</p>
</div>
<div class="panel" style="margin-top:1rem"><h2 style="margin:0 0 .4rem;font-size:var(--step-1)">Data and tools</h2><p class="muted" style="margin:0">${escapeHtml(v.dataLine)}</p><p class="toolrow">${v.tools.map((t) => a(t.href, t.label, { class: "feed-badge" })).join("")}</p></div>
</div>
</section>`;
  return hero + focal + ways + ladder + strip + duo;
}

// ---------- incident ----------

export function incidentHtml(v, fn) {
  const head = `<div class="record-head">
<p class="eyebrow">Incident</p>
<h1>${escapeHtml(v.title)}</h1>
<p class="record-where"><time datetime="${escapeHtml(v.date)}">${escapeHtml(v.dateText)}</time>${ccBadge(v.country)}${a(`/countries/${v.country.toLowerCase()}`, v.countryName)}${rsfChip(v.rsf)}</p>
<ul class="chips" aria-label="Tactic and stage">${v.tactics.map((t, i) => `<li>${a(`/tactics/${t.slug}`, i === 0 && v.tactics.length > 1 ? `${t.name} (main tactic)` : t.name, { class: "chip chip--tactic" })}</li>`).join("")}${v.stage ? `<li>${aHtml(`/ladders/${v.ladderTactic}#stage-${v.stage}`, `Stage <b>${escapeHtml(STAGE_LABELS[v.stage] || v.stage)}</b>`, { class: "chip chip--stage" })}</li>` : ""}<li>${outcomeBadge(v.outcome)}</li></ul>
</div>`;
  const main = [];
  main.push(`<div class="lede">${blockToHtml(v.summary, fn)}</div>`);
  for (const b of v.rest) {
    if (b === v.justification) main.push(`<blockquote class="justification"><span class="justification__label">Stated justification</span>${blockToHtml(b, fn)}</blockquote>`);
    else main.push(blockToHtml(b, fn));
  }
  const aside = `<aside class="record-aside" aria-label="Facts">
<div class="status-box">${metaHtml(v.meta)}</div>
${blockToHtml(v.facts, fn)}
${v.unknowns ? `<div class="unknowns"><h2>What we don't know</h2><p>${escapeHtml(v.unknowns)}</p></div>` : ""}
</aside>`;
  return `<article class="page record">
${crumbsHtml(v.breadcrumbs)}
<div class="record-hero">${head}${artImg("incident", { sizes: "(min-width: 1000px) 45vw, 100vw", eager: true })}</div>
<div class="record-body">
<div class="record-main">
${main.join("\n")}
${fn ? footnotesHtml(fn) : ""}
</div>
${aside}
</div>
</article>`;
}

// ---------- ladder ----------

export function stageBarHtml(present, query = "") {
  return `<ol class="stagebar" aria-label="Stages, from restrict to eliminate">${STAGE_ORDER.map((st) => `<li>${present.has(st) ? a(`#stage-${st}`, STAGE_LABELS[st]) : `<span title="No rung at this stage">${escapeHtml(STAGE_LABELS[st])}</span>`}</li>`).join("")}</ol>`;
}

export function laneOpenHtml(st, name, definition) {
  const n = STAGE_ORDER.indexOf(st) + 1;
  return `<section class="lane" id="${st ? `stage-${st}` : "stage-unset"}" aria-labelledby="lane-${st || "unset"}"><div class="lane__head"><h2 id="lane-${st || "unset"}">${n ? `<span class="lane__num">${n}</span>` : ""}${escapeHtml(name)}</h2>${definition ? `<p>${escapeHtml(definition)}</p>` : ""}</div>`;
}

export function rungCardsHtml(rungs) {
  return `<div class="cards">${rungs.map((r) => `<article class="card rung${r.focal ? " rung--focal" : ""}">
<p class="card__meta">${r.focal ? '<strong class="focal-case">Focal case</strong>' : ""}${ccBadge(r.country)}${a(`/countries/${r.country.toLowerCase()}`, r.country_name)}${rsfChip(r.rsf)}</p>
<p class="card__meta"><time datetime="${escapeHtml(r.occurred_on)}">${escapeHtml(proseDate(r.occurred_on, r.occurred_on_precision))}</time>${r.leader_name ? `<span>${r.leader_slug ? a(`/leaders/${r.leader_slug}`, r.leader_name) : escapeHtml(r.leader_name)}</span>` : ""}</p>
<h3 class="card__title">${a(`/incidents/${r.slug}`, r.what)}</h3>
${r.note ? `<p class="ladder-note"><em>Note: ${escapeHtml(r.note)}</em></p>` : ""}
<p class="card__foot">${outcomeBadge(r.outcome, r.outcome_on)} · ${r.sources} ${r.sources === 1 ? "source" : "sources"} · ${a(`/incidents/${r.slug}`, "Full entry")}</p>
</article>`).join("")}</div></section>`;
}

// ---------- search and lists ----------

export function viewBarHtml(countText, toggle, fmt) {
  return `<div class="viewbar"><p class="result-count">${escapeHtml(countText)}</p><div class="links-row">${toggle ? `<span class="toggle" role="group" aria-label="Show as">${toggle.map((t) => a(t.href, t.label, t.current ? { "aria-current": "true" } : {})).join("")}</span>` : ""}<span class="fmt">${fmt.map((l) => a(l.href, l.label)).join("")}</span></div></div>`;
}

export function incidentCardItem(r) {
  return {
    href: `/incidents/${r.slug}`,
    title: r.title,
    topHtml: `<time datetime="${escapeHtml(r.occurred_on)}">${escapeHtml(proseDate(r.occurred_on, r.occurred_on_precision))}</time>${ccBadge(r.country)}<span>${escapeHtml(r.country_name)}</span>${rsfChip(r.rsf)}`,
    body: truncate(mdToPlain(r.summary), 240),
    metaHtml: `${r.tactic_primary ? a(`/tactics/${r.tactic_primary}`, r.tactic_name || r.tactic_primary) : ""}${r.stage ? ` · Stage ${escapeHtml(STAGE_LABELS[r.stage] || r.stage)}` : ""}${r.leader_name ? ` · Head of government ${escapeHtml(r.leader_name)}` : ""} · ${outcomeBadge(r.outcome)}`,
  };
}

export function incidentCardsHtml(rows, empty) {
  return rows.length ? `<div class="cards">${rows.map((r) => cardHtml(incidentCardItem(r))).join("")}</div>` : `<p>${escapeHtml(empty)}</p>`;
}
