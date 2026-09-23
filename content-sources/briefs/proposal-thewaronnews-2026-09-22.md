# Crank #3: The War On News (thewaronnews.com), launch proposal

Prepared 2026-09-22 for Peter Benes. Status: awaiting approval.

## Summary

The War On News is a documentary reference to how politicians and governments limit journalists' ability to report, US-first with global context. The record holds dated, sourced incidents, the actors, the outlets affected, court cases and generated timelines. The News Desk adds short notes on current stories, linking out to the primary reporting. The trigger is live: Trump announced the CNN, MS NOW and Politico ban on 2026-09-18 ([NPR](https://www.npr.org/2026/09/19/nx-s1-5974854/trump-cnn-msnow-politico-ban)), the outlets sued on 2026-09-21 ([Axios](https://www.axios.com/2026/09/21/trump-cnn-msnow-politico-suit)), and a hearing is reported for 2026-09-23 ([CNBC](https://www.cnbc.com/2026/09/21/trump-lawsuit-white-house-ban-ms-now-cnn-politico.html)). Incident databases ([U.S. Press Freedom Tracker](https://pressfreedomtracker.us/all-incidents/), [CPJ](https://cpj.org/data/)) give rows without context, advocacy groups give context in an advocacy voice, and trade press explains each story once. No one runs a neutral, cross-linked reference connecting today's ban to [Sherrill v. Knight](https://firstamendment.mtsu.edu/article/sherrill-v-knight-d-c-cir/), the 2018 Acosta case and [AP v. Budowich](https://en.wikipedia.org/wiki/Associated_Press_v._Budowich). We build it on Crank #2's proven architecture and add two things no competitor offers: a machine-readable record with a public MCP server, and link integrity (every source checked nightly and archived at publish). The plan is a five-day P1 launch (about 22 incidents, 5 explainers), 30 Surfer articles by week 4, then a daily News Desk. Targets are sober: Crank #2 scored 0 citations at day 0, and Crank #1 had 7% of its pages indexed at day 11.

## Decisions needed from Peter

1. **Publisher identity and AI disclosure.** Whose name goes on the About page (you, or a publisher entity), and in which jurisdiction? I recommend that the methodology page says plainly that AI agents produce the site under human editorial control. Journalists are the audience. They will find out anyway, and a site about accurate reporting cannot be caught hiding how it is made.
2. **News Desk publishing authority.** Choose one: (a) you approve every note, which is safe but slow; (b) notes auto-publish once they pass mechanical gates, and you review a daily digest with one-command revert (recommended); (c) full autonomy (not recommended).
3. **Nameservers today.** Point thewaronnews.com at Cloudflare at whc.ca, either yourself (about 10 minutes) or by handing an agent the whc.ca login. DNS propagation is the critical path.
4. **Illustration style.** Approve Style B, "Etched Record" (section 7), then approve the six-image master set before anything goes into production.
5. **Surfer capacity.** Confirm the number of Content Editor credits. The Usage page would not render during research, and the 30-article plan depends on it.

## 1. Stack

We copy Crank #2: one Cloudflare Worker in plain TypeScript, D1 for records, KV for sessions and rate limits, R2 for export snapshots, Cron Triggers for nightly jobs, and `wrangler` deploys with a one-zone scoped token. No CMS: L-133 says "do not put a new machine-first site on a human-first CMS again," because a CMS withholds content negotiation, request logging, an MCP endpoint and append-only claims. We reuse the existing tools (`deploy.sh`, `verify-all.sh`, `mcp-smoke.sh`, `publish-claims.py`, `revert-batch.py`) and treat `data-and-record-spec.md` as the schema template.

The day-0 checklist, taken from what went wrong on Crank #1 and #2:

- Confirm the http to https 301 on day 0; Workers do not force it, and that gap cost Crank #1 its crawl priority (L-117).
- Turn off Bot Fight Mode and Browser Integrity Check, because they return 403 to the MCP clients we serve.
- Set AI Crawl Control to Allow for all tracked crawlers and switch Managed robots.txt off. Cloudflare's mixed-purpose AI-bot default flipped to Block on 2026-09-15, so this has to be checked by hand.
- Submit sitemaps to GSC and Bing by absolute URL, and to Bing separately, because the GSC import does not carry the sitemap across.
- Lock the rank and citation panels before launch, with aibubblequestion.com as the named control.
- Give every build and verification script its own User-Agent so our own traffic is never counted as human.

One change of placement: IndexNow pings and the link checker run on Betty's Mac, not on the Worker. The reason for IndexNow is known: Cloudflare's shared egress gets 429 from both IndexNow endpoints (L-139, L-142). The link checker has the same problem, because news sites block datacenter IPs aggressively.

## 2. GitHub organization

A new org, `thewaronnews`, holds `thewaronnews/data`: a nightly CC BY 4.0 export of every incident, actor, case and source, plus MCP documentation. Org structure has no effect on rankings ([GitHub community discussion](https://github.com/orgs/community/discussions/81370)), so the argument is product and trust: journalists can star, fork and cite the dataset. **One correction to the brief:** Crank #2's export does not sit under a retailer's account but in `crank-box`, the program org. That is the real problem, because "crank-box" tells every journalist who opens the repo that this is an SEO experiment and invites the question of whether the dataset is a prop. Cloudflare stays on the Betty account.

On "open knowledge format": Crank #2 never produced a separate OKF spec; its schema doubled as one. I recommend publishing the export as a Frictionless Data Package (`datapackage.json` with table schemas), the Open Knowledge Foundation's own standard, so "OKF" becomes literally true and newsroom data teams can validate it with tools they already use.

## 3. Content model

Every entity has an HTML page with `.md` and `.json` twins, served by content negotiation and advertised with `<link rel="alternate">`. ClaudeBot's three ordered passes over HTML, JSON and Markdown on Crank #2 show that crawlers follow those tags.

| Entity | What it holds | P1 count |
|---|---|---|
| Incidents | What happened, who did it, the stated justification (quoted), the effect on reporting, status and what has changed since, sources | 20 to 25 |
| Actors | Officials, agencies, legislatures, with their incidents | about 15 |
| Outlets and journalists | Who was affected, linked to incidents | about 20 |
| Cases | Court, docket, holding, status, links to opinions | 4 |
| Explainers | Surfer articles | 5 |
| Glossary | Terms (hard pass, pool, prior restraint) | about 15 |
| Timelines | Views generated by year, actor, type and country | automatic |
| News Desk | Current stories, each with a 60 to 120-word note linking out | from day 1 |

Incident facts are claims rows (verbatim quote of 300 characters or less, source URL, method, `verified_at`, confidence), superseded rather than edited, both versions addressable. That answers the question journalists will ask first: "what did you say before, and when did it change?"

**Scope discipline.** The U.S. Press Freedom Tracker already publishes 2,719 incidents under CC BY with an API ([data page](https://pressfreedomtracker.us/data/)). We should not copy it. Our incidents are actions by officials, governments and legislatures: bans, credential revocations, subpoena policy, funding levers, access rules. Assaults and arrests at protests remain the Tracker's territory, and we link to its records by ID. This is the narrower-but-deeper niche the competitor audit identified.

The P1 seed comes from the research timeline: the three 2026 CNN, MS NOW and Politico events and their case; the AP ban, lawsuit, [April 2025 injunction](https://www.npr.org/2025/04/08/nx-s1-5342369/ap-white-house-court-ruling-oval-office-gulf-of-mexico-america) and [D.C. Circuit partial stay](https://www.courtlistener.com/opinion/10600096/associated-press-v-taylor-budowich/); the [VOA shutdown suit](https://www.npr.org/2025/03/21/nx-s1-5336351/voice-of-america-trump-lawsuit-kari-lake-voa); the [Pentagon credential rules](https://www.axios.com/2025/10/14/pentagon-press-restrictions-trump-journalists-news-outlets) and the [mass forfeiture that followed](https://en.wikipedia.org/wiki/2025_Pentagon_press_pass_forfeiture); the [DOJ media-guidelines rescission](https://www.rcfp.org/doj-rescinds-news-media-guidelines-analysis/); [FCC pressure in the Kimmel episode](https://www.npr.org/2025/09/19/nx-s1-5546764/fcc-brendan-carr-kimmel-trump-free-speech); [CPB funding cuts](https://www.aclu.org/news/free-speech/trumps-attacks-on-press-freedom-escalate-npr-pbs-funding-cuts-explained); the [Louisiana buffer law and its injunction](https://www.niemanlab.org/2024/08/a-new-louisiana-law-limits-the-right-of-journalists-and-everyone-else-to-film-police-abuse/); [Acosta 2018](https://freedom.press/issues/judge-reinstates-acosta-press-pass/); [Nixon's enemies list](https://en.wikipedia.org/wiki/Nixon's_Enemies_List); and the [Obama-era Espionage Act leak cases](https://cpj.org/reports/2013/10/obama-and-the-press-us-leaks-surveillance-post-911/). The record spans administrations, and that is the strongest proof of neutrality we can offer.

## 4. Machine-first layer

We ship llms.txt and llms-full.txt, JSON-LD (Article, BreadcrumbList, Dataset on `/data`, NewsArticle on News Desk notes), RSS, Atom and JSON Feed for the News Desk and Incidents, CSV and JSON downloads, split sitemaps (human and machine) with real `lastmod`, IndexNow from Betty, and a public MCP server at `/mcp`. The MCP server has read tools `search_incidents`, `get_incident`, `get_timeline`, `get_actor`, `get_case` and `latest_news`, and one write tool, `suggest_correction`, which carries a per-client token and is off by default. It will be listed on the Official MCP Registry (domain verified by DNS TXT), Smithery and Glama.

The competitor audit frames the absence of llms.txt at all ten incumbents as a first-mover chance. Our data says otherwise: zero of 756 crawler requests on Crank #2 fetched it, and the one controlled JSON-LD test showed no citation lift (L-204). Both are cheap, so we ship them without counting on them. What drove fast, deep crawling on Crank #2 was the format twins, the claims system and the MCP server. External evidence agrees: AI engines select passages, rewarding direct-answer leads, H2/H3 structure and visible "last updated" dates ([Search Engine Land](https://searchengineland.com/mastering-generative-engine-optimization-in-2026-full-guide-469142)), and fresh pages drew about 6 citations against 3.6 for stale ones ([Subscribe PR](https://subscribepr.com/blog/how-to-get-indexed-on-bing/)). Every template follows this. Bing gets first-class treatment as the retrieval layer behind ChatGPT Search and Copilot, and its AI Performance report gives us a direct citation measure ([Subscribe PR](https://subscribepr.com/blog/how-to-get-indexed-on-bing/)).

## 5. Link integrity

Every external link uses `target="_blank" rel="noopener noreferrer"`. At publish, each source is submitted to the Wayback Machine's Save Page Now API, and the snapshot URL is stored with the claim. A nightly checker on Betty's Mac records each source's status in a `source_checks` table. A dead source is never removed. It is marked "source offline since {date}" next to its archived copy.

One refinement: the checker needs four states, not two: *live*, *paywalled*, *bot-blocked* (403/429 to non-browser clients, common on major news sites) and *dead* (404/410, DNS failure, redirect to a homepage). Only *dead* triggers the annotation, and bot-blocked results get a browser-UA retry first. Otherwise we would mark live CNN stories dead, which is worse than no checker. None of the ten competitors audited offers anything like this.

## 6. Editorial system

**Voice.** Crank #1's voice guide method (gold-standard pages, numbered principles, banned phrases, before-and-after examples) is adapted to the documentary register. The title carries the point of view and the entries do not. Entries use verbs of record (announced, revoked, ruled, filed) and never characterize motive. Justifications are quoted, never paraphrased. The site has no em dashes and never publishes its verification method. A "What we don't know" line appears where it applies, for example: "The White House has not said which reporting prompted the ban."

**Trust pages (E-E-A-T).** Editorial policy, corrections policy (claims are superseded publicly with timestamps), methodology (including the AI disclosure), sourcing standards, about and contact. Every page shows "published" and "last reviewed" dates.

**Fact-check pipeline** (Crank #1's pattern): itemizer agents extract every assertion, Sonnet agents verify each against its primary source and store the quote, an Opus pass checks neutrality and defamation exposure, and a QA pass catches process language. **A caveat on the research base:** Chrome's multi-browser conflict blocked Perplexity this session, so everything came from WebSearch and WebFetch. The case number "296754" was PACER's internal case ID, not the docket number; the D.D.C. docket is **1:26-cv-03287**, *Cable News Network, Inc. v. Trump*, filed 2026-09-21, assigned to Judge Timothy J. Kelly (confirmed via CourtListener). The TV-pool protest is described differently in [CNN Business](https://www.cnn.com/2026/09/20/media/cnn-trump-white-house-pool-ban) and [Axios](https://www.axios.com/2026/09/21/trump-white-house-pool-tv-ban-audio); the Poynter piece was never read in full. P1 starts with a Perplexity verification pass.

**Daily cadence. This is the main departure from the brief.** The brief has "the Betty site agent" sweep, draft and publish. The playbook rules that out: Betty's site agent is local Qwen with tool use deliberately disabled, and exactly one human-only call site can publish ("Betty never decides what publishes"). Instead, a scheduled Claude agent (Sonnet) on the Mac Studio sweeps (Perplexity plus WebSearch), drafts notes, runs the link check and Wayback save, and publishes under decision 2. Betty keeps what she was built for: triaging `suggest_correction` submissions, IndexNow pings and the census. Weekly, the same agent runs both panels in a clean browser session; the shared betty@ persona account contaminated Crank #2's day-0 panel.

## 7. Illustration

The research offered three directions ([section 6 sources](https://www.niemanlab.org/reading/why-editorial-illustrations-look-so-similar-these-days/)):

- **A. Monochrome with one accent**, modelled on [ICIJ's rebrand](https://brandfetch.com/blog/icij-new-logo-and-brand). Urgent and institutional. It works for status markers but on its own is a colour system, not an illustration style.
- **B. Etched or engraved line work**, textured and hand-drawn, with courtroom-sketch and press-credential motifs, and deliberately not the flat "Corporate Memphis" look that [Nieman Lab](https://www.niemanlab.org/reading/why-editorial-illustrations-look-so-similar-these-days/) calls generic.
- **C. Documentary photography with graphic overlays**, as [ProPublica](https://www.propublica.org/article/inside-propublicas-article-layout-framework) does it.

The research recommended an A+C hybrid built on photography. **Your brief rules out photos, so C is out.** I recommend **B with A's single-accent discipline**, named "Etched Record." Engraving is the visual language of the record (currency, old newsprint, legal documents), so it reads as documentation, not commentary; it depicts objects and places, not people, which removes the likeness problem; and no competitor uses it. I also drop ICIJ's red: in US politics red and blue are party colours, and a red accent on a site with this name reads as partisan.

**Specification, which is also the master prompt core and stays well under Firefly's 1,024-character cap:**

- Palette: ink `#1B1B1B`, paper `#F3EFE6`, graphite `#6E6A63`, wash `#D8D2C4`, and one accent, amber `#C98A1B`. The accent covers no more than 10% of the image and appears only on the subject object.
- Line: fine engraving hatching and cross-hatching, contour lines at roughly 0.15% of image width, hatching at half that. No gradients, no soft airbrush. A faint laid-paper grain.
- Composition: one object or architectural fragment, set off-centre on a thirds line, with generous negative space. The master is 1600×900 (16:9, which meets Discover's 1200px minimum per [Google](https://developers.google.com/search/docs/appearance/google-discover)) and has a centre-safe zone for 1:1 and 1.91:1 crops.
- Recurring motifs: the press credential and lanyard, a locked gate or iron fence, an empty briefing-room chair, clustered microphones, a notebook and pen, stacked newsprint, redaction bars, courthouse columns, docket papers.
- Avoid: real faces and likenesses of any person (people only as anonymous figures from behind or at small scale), outlet logos, official seals, flags as a dominant element, red or blue accents, text inside the image, violence or weapons, and flat vector style.

Workflow: ChatGPT produces a six-image master set covering Incident, Case, Actor (architecture only), Explainer, Global and News Desk. You approve it. Firefly then reproduces the style using the masters as style references. Crank #1's lesson applies: study real reference photographs of the actual place (the North Lawn gate, the briefing room) before writing any scene brief.

## 8. Launch phases

| Phase | When | Agents deliver | Peter does |
|---|---|---|---|
| P0 | Today | This proposal; panels drafted | Decisions 1 to 5; nameservers at whc.ca |
| P1a | Day 1 to 2 | Day-0 checklist, Worker, D1 schema (vocabulary settled before population, L-136), CNN/MS NOW/Politico incident and case page, press pool explainer, feeds, GSC and Bing | Byline and About approval |
| P1b | Day 3 to 5 | 20 to 25 incidents, 4 cases, 5 explainers, timelines, MCP and registry listings, policies, master illustrations, GitHub org and first export, Betty YAML | Approve illustration set; spot-check 5 pages |
| P2 | Weeks 2 to 4 | Remaining explainers at a Surfer score of 75 or more (target 25, stretch 50), one illustration each, outreach list (about 60 journalists, press-freedom orgs, J-school media law faculty) | Approve the outreach message; one review session per week |
| P3 | Ongoing | Daily News Desk, nightly links and export, weekly panels, monthly census and review | Daily digest (about 10 minutes); monthly review (1 hour) |

P1 is split so the anchor dossier and case page go live while the hearing is news; crawlers found Crank #2 within 35 hours through certificate transparency alone.

**Surfer plan adjustments.** "Can the president ban a news outlet" and "Is it legal to ban reporters from the White House" merge into one page, since near-identical answers would cannibalize each other. "Twitter Files" is replaced by "The Obama administration and the Espionage Act": the former concerns platform moderation, not politicians limiting journalists, and is the most partisan-coded topic in the plan; the latter is in scope, well sourced ([FPF](https://freedom.press/issues/obama-used-espionage-act-put-record-number-reporters-sources-jail-and-trump-could-be-even-worse/), [POGO](https://www.pogo.org/analyses/six-americans-obama-and-holder-charged-under-espionage-act-and-one-bonus-whistleblower)), and shows the record spans administrations. When pushing toward 75 would mean keyword stuffing, the voice guide wins. Scores between 70 and 74 are logged as exceptions, not forced up. The first 5 explainers are the press pool, the merged legality page, the hard pass, Sherrill v. Knight, and the AP's Gulf of America fight.

## 9. Success metrics

**Fixed rank panel** (Surfer, US; locked at launch and never edited). Surfer's Rank Tracker is an inactive add-on, so we measure with GSC and Bing position data plus manual checks.

| # | Keyword | MSV | KD | # | Keyword | MSV | KD |
|---|---|---|---|---|---|---|---|
| 1 | press freedom | 46,400 | 43 | 14 | cnn banned from white house | ~2,000 est. | n/a |
| 2 | white house press pool (cluster) | 5,000 to 8,000 | 40 to 76 | 15 | associated press banned from white house | 6,000 to 42,000 | 64 to 84 |
| 3 | press corps white house | 3,510 | 59 | 16 | pentagon press corps credential revocation | 1,960 | 62 |
| 4 | press credentials / hard pass | 1,080 | 42 | 17 | pbs npr funding cuts | 55,500 | 68 |
| 5 | prior restraint | 17,300 | 41 | 18 | reporters without borders | 13,400 | 46 |
| 6 | first amendment text | 5,500 | 63 | 19 | freedom of press index | 9,730 | 46 |
| 7 | committee to protect journalists | 4,320 | 17 | 20 | freedom house index | 2,910 | 49 |
| 8 | freedom of the press foundation | 35,500 | 29 | 21 | media blackout | ~500 est. | n/a |
| 9 | reporters committee for freedom of the press | 2,260 | 29 | 22 | can the president ban a news outlet | low | n/a |
| 10 | press freedom organizations | 110 | 19 | 23 | is it legal to ban reporters from the white house | low | n/a |
| 11 | journalists in jail | 290 | 33 | 24 | trump press restrictions timeline | low | n/a |
| 12 | why is freedom of the press important | 2,660 | 32 | 25 | war on the press | not isolated | n/a |
| 13 | freedom of press court case | 1,400 | 42 | | | | |

**AI citation panel:** 5 engines (ChatGPT, Perplexity, Claude, Gemini, Copilot) × 20 fixed prompts, each run twice. The categories are current events (4, e.g. "why was CNN banned from the White House"), legality and precedent (4), history (3), lists and data (4, e.g. "every outlet banned from the White House"), global comparison (3), and definitions (2). Clean sessions only. Copilot's daily quota and Gemini's Pro limit cut Crank #2's run short, so the runs are spread over two days.

**Organic session assumptions (from the Surfer file):** a standard CTR curve; a new domain with no backlinks; KD under 35 reaches positions 5 to 10 in 4 to 6 months; KD 35 to 55 reaches page 2 to 3 by month 6 and page 1 by month 12; the five head terms (KD 60 or above, or dominated by Wikipedia) stay outside the top 20 all year. Realistic addressable volume is about 129,000 searches a month, not the raw 350,000.

| Metric | Type | Day 30 target / floor | Day 90 | Day 180 | Day 365 |
|---|---|---|---|---|---|
| Indexation (% of sitemap URLs) | Leading | 60% / 30% | 85% / 60% | 90% / 75% | 95% / 85% |
| Rank panel | Lagging | impressions on 6 / 3 | 5 top-20 / 2 | 8 top-20 and 3 top-10 / 4 top-20 | 10 top-10 / 5 top-10 |
| AI citations (of 100 prompt-engine pairs) | Lagging | 3 / 1 | 10 / 4 | 20 / 10 | 30 / 15 |
| Organic sessions per month | Lagging | 20 / any | 50 to 150 / 30 | 400 to 900 / 200 | 3,000 to 6,000 / 1,500 |
| Referring domains | Lagging | 5 / 2 | 20 / 8 | 50 / 20 | 120 / 50 |
| Named citations by journalists or orgs | Lagging | 1 / 0 | 5 / 1 | 15 / 5 | 40 / 15 |
| Feed subscribers (Feedly count plus unique feed-reader UAs) | Leading | 25 / 10 | 100 / 40 | 250 / 100 | 600 / 250 |
| Dataset downloads / repo stars | Leading | 20 / 5 and 10 / 3 | 100 / 30 and 30 / 10 | 300 / 100 and 75 / 25 | 1,000 / 300 and 150 / 50 |
| External MCP calls (excluding our own UAs) | Leading | 50 / 10 | 300 / 75 | 1,000 / 250 | 3,000 / 800 |
| News Desk freshness (median hours from story to note) | Leading | 12h / 24h | 12h / 24h | 8h / 24h | 8h / 24h |
| Link integrity (% of sources live or archived) | Leading | 99% / 97% | 99% / 97% | 99% / 97% | 99% / 97% |

Leading metrics show whether the machine is running. Lagging metrics show whether it is working. A day-30 reading of zero on citations and sessions would be expected and would not count as failure. Crank #2 recorded 0 of 87 prompts at day 0, and Crank #1 had 7% indexation at day 11. The failure signal at day 30 is indexation below 30% while the content is sound, and the fix is the one we already know: http 301, then GSC "Request indexing" on 10 priority URLs a day.

## 10. Risks and mitigations

**Defamation and neutrality** (the largest risk, since we name officials and journalists): a stored verbatim quote behind every claim, no characterization of motive, allegations attributed ("the complaint alleges"), Opus review on every incident, public timestamped corrections, and a settled publisher identity (decision 1). A one-time media-law review of the policies would be cheap insurance.

**The pointed brand.** The name sets an expectation of advocacy. The counterweight is structural: a plain subtitle ("A dated record of government actions that limit reporting"), incidents across administrations, every actor's justification quoted, and no adjectives in entries.

**AI citation cold start.** Earned mentions outweigh on-site work for AI engines ([SEL](https://searchengineland.com/mastering-generative-engine-optimization-in-2026-full-guide-469142)), and 54.5% of AI Overview citations come from pages that already rank ([BrightEdge](https://www.brightedge.com/resources/weekly-ai-search-insights/rank-overlap-after-16-months-of-aio)). The P2 outreach and the dataset exist to earn those mentions.

**Google News.** The brief treats inclusion as not automatic; the research says eligibility now *is* automatic, with no manual submission left ([Google Publisher Center](https://support.google.com/news/publisher-center/answer/15898024?hl=en)). The real risk is being eligible but unseen for months while prominence builds. The answer is clean policy pages and steady output, not an application.

**Link rot and false positives.** Covered by the four-state checker and the Wayback snapshot saved at publish (section 5).

**Surfer credits.** Unconfirmed, and SERP Analyzer is not on the plan. If credits run out, articles 26 to 50 wait for the renewal and do not ship unscored.

**Chrome.** Browsers on the machine collide: the multi-browser conflict blocked Perplexity this session. Every browser agent calls `select_browser` first, and no two browser agents ever run at once (L-137).

**Scope creep to global.** Global items appear as comparison pages and as context lines on US incidents. We do not keep a global incident log until the US record is complete and current.

**Stale news spikes.** The CNN story will fade. Dossiers are written to outlast it, and the case page updates with each ruling.

## 11. Budget and effort

| Phase | Agent time | Model mix | Peter time |
|---|---|---|---|
| P1 (5 days) | 40 to 55 agent-hours | Haiku: twins, link checks, sitemaps. Sonnet: verification, incident drafting. Opus: explainers, policies, neutrality review | 2 to 3 hours |
| P2 (weeks 2 to 4) | 70 to 100 agent-hours (25 articles at about 3 hours each, plus illustrations and outreach) | Opus writes explainers, Sonnet checks facts, Haiku formats | 3 to 4 hours |
| P3 (monthly) | about 1 hour a day plus 4 hours a week of measurement | Sonnet for the News Desk, Haiku for nightly jobs, Opus for the monthly review; Betty (local, free) for triage and pings | about 10 minutes a day plus 1 hour a month |

Cash cost is close to zero on top of existing subscriptions (Surfer Pro, ChatGPT, Firefly, Perplexity). If the Betty Cloudflare account is not already on Workers Paid, add $5 a month for D1 and Cron headroom. The domain is already paid for.

## Approval

"Approved" (with any amendments noted) triggers:

1. Nameserver change at whc.ca (by you, or by an agent with the login), followed by the Cloudflare zone and the full day-0 checklist.
2. Creation of the `thewaronnews` GitHub org and the `thewaronnews/data` repo, plus a scoped Cloudflare token and a fine-grained GitHub PAT.
3. A Perplexity verification pass over every fact in the research files, starting with the case docket number.
4. Locking the rank panel, citation panel and control site in the project docs, and running the day-0 panel before launch.
5. P1a within 48 hours, then P1b by day 5, following the "done means" checklist from Crank #2's launch plan.
6. A Betty YAML for thewaronnews.com (triage, IndexNow, census) and the scheduled Claude News Desk agent, running under whichever publishing authority you chose in decision 2.
7. The ChatGPT master illustration set, sent to you for approval before any Firefly production.
8. A worklog and a publish log in `sites/crank3/` in the Crank project from the first commit onward.
