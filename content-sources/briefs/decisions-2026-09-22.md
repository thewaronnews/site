# Crank #3 — The War On News: approved decisions (2026-09-22)

Proposal: `sites/crank3/proposal-2026-09-22.md`. Peter answered the open decisions one by one; these are binding for the build.

| # | Decision | Peter's answer |
|---|----------|----------------|
| 1 | Scope | US-first, global context |
| 2 | Register | Documentary reference: neutral, sourced, dated; the title carries the point of view, entries do not |
| 3 | Domain | thewaronnews.com registered at whc.ca; nameservers moved to Cloudflare by Peter on 2026-09-22. Zone: Cloudflare account `d5e354491bbe47fa55bc0e5806d877e8` (Betty account) |
| 4 | Publisher | Peter Benes, Prince Edward County, Ontario, as editor and publisher; full disclosure on the methodology page that AI agents research, draft and check the site under his editorial control |
| 5 | News Desk authority | Auto-publish behind mechanical gates (in-scope score, every link live or archived, quote-only characterizations, voice lint); daily digest by email to peter@benesthemenace.com; one-command revert |
| 6 | Illustration | Peter chooses from three novel renderings of the same subject in three different styles (Etched Record recommended); then approves the six-image master set before Firefly production |
| 7 | Surfer | 157 Content Editor credits available. Use only as many as are useful; hard cap 30 |
| 8 | Jev | Add simple-jev.featherless.ai as the cheap classifier layer (in-scope/category/actor-type scoring for News Desk candidates, tip and correction triage, link-status classification) ahead of Sonnet |
| 9 | Chrome logins on Betty's Mac Studio | Perplexity Pro, ChatGPT (image generation), Adobe Firefly, GitHub (Betty account, can create orgs) all signed in |
| 10 | Control site | Same control site as Crank #2 |
| 11 | Inbound mail | Google Workspace: domain added to betty@benesthemenace.com's account; tips@, corrections@ and hello@thewaronnews.com forward to betty@benesthemenace.com. Cloudflare zone must carry Google MX + SPF records |
| 12 | Webmaster accounts | Search Console and Bing Webmaster Tools / IndexNow under betty@benesthemenace.com; DNS TXT verification |
| 13 | Licence | CC BY 4.0 for the dataset export and site text |
| 14 | Rank panel | 25-keyword panel from `sites/crank3/research/keywords-surfer-2026-09-22.md` locked as-is before launch |
| 15 | GitHub | New organization `thewaronnews`; repos `site` (Worker code) and `data` (nightly CC BY export as a Frictionless Data Package) |
| 16 | Stack | Crank #2 architecture: Cloudflare Worker + D1 + KV + R2, wrangler deploy with a zone-scoped token; HTML/MD/JSON twins, OKF, llms.txt, JSON-LD, RSS/Atom/JSON Feed, sitemaps, IndexNow, public MCP server with read tools + moderated `suggest_correction` |

Standing rules: every external link opens in a new window (`target="_blank" rel="noopener noreferrer"`), is checked nightly, and is archived to the Wayback Machine at publish time. Nothing characterizes an actor beyond the sourced record.
