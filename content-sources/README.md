# content-sources/

Untracked research, editorial and planning material for thewaronnews.com
(Crank #3), copied into the repo so the Mac Studio and GitHub hold the same
sources as the sandbox. These are working/source files, not the live site
(the site's own content lives under `site/`) -- treat this directory as an
archive of what fed the build, and consult `twon-data-and-record-spec.md`
(in `briefs/`) as the governing spec when a source here disagrees with it.

## seed-v2/ -- canonical

**`seed-v2/` is the canonical, merged seed data.** It supersedes any earlier
seed drafts and is the version the site's data pipeline should be built
from. Contains `actors.json`, `cases.json`, `glossary.json`,
`incidents.json`, `journalists.json`, `outlets.json`, `sources.json`.

## editorial/, editorial-v2/, editorial-v3/ -- editorial policy, in order

Three successive rounds of editorial-policy and copy material. Later
directories are revisions/additions on top of earlier ones, not
replacements -- check all three for the current state of a given document.

- `editorial/` -- first pass: `about.md`, `corrections.md`,
  `editorial-policy.md`, `methodology.md`, `voice-guide.md`,
  `lint-rules.json`.
- `editorial-v2/` -- second pass: rewrites (`cases-rewrite.json`,
  `incidents-rewrite.json`), additions (`actors-add.json`,
  `sources-add.json`, `glosses.json`), new site-copy pages (`footer.md`,
  `privacy.md`, `terms-of-use.md`, `sources-and-standards.md`), updated
  `about.md`/`corrections.md`, and `lint.py`.
- `editorial-v3/` -- third pass: `context.md`, `context-home.md`,
  `context-claims.json`.

## explainers/ -- briefs, drafts, final

Long-form explainer articles, in their three production stages:
`briefs/` (assignment briefs, JSON), `drafts/` (in-progress Markdown), and
`final/` (published-ready Markdown). Same filename across the three stages
tracks one explainer through its pipeline.

## research-v2/, research-v3/ -- background research, in order

Two successive rounds of historical/background research feeding the site's
timeline and case content. `research-v3/` is the later, more targeted
round; both are kept since `research-v2/`'s broad anchors are still
referenced.

- `research-v2/` -- broad anchors: `anchors-1900-1989.json`,
  `anchors-1990-2019.json`, `granular-2020-2026.json`, `notes.md`.
- `research-v3/` -- the "ladder" research and second-sourcing pass:
  `ladder-1.json`, `ladder-2.json`, `second-sources.json`,
  `corrections-sources.json`, `notes.md`, `notes-2.md`.

## verification/ -- fact-check and setup verification

Verification logs: Perplexity fact-check passes
(`perplexity-2026-09-22.md`, `perplexity-v2-2026-09-22.md`), RSF press-
freedom ranking data (`rsf-2026-ranks.json`), and a webmaster/DNS setup
verification log (`webmaster-setup-2026-09-22.md`; no secret values are
in that file, by design).

## design/ -- concept HTML only

The three homepage design concepts as standalone HTML (`concept-A.html`,
`concept-B.html`, `concept-C.html`) plus the design `README.md` explaining
them. **The rendered PNG screenshots (`concept-*-desktop.png`,
`concept-*-phone.png`) are intentionally excluded** -- they're large
binaries regeneratable from the HTML; only the source markup is tracked.

## briefs/ -- top-level planning and spec docs

Planning and specification documents that sat at the top of the sandbox's
`crank3/` working directory, not under any of the folders above:

- `twon-data-and-record-spec.md` -- the governing data/record spec (ops
  scripts and editorial docs defer to this when they disagree).
- `proposal-thewaronnews-2026-09-22.md` -- the original site proposal.
- `decisions-2026-09-22.md` -- decisions log from the proposal round.
- `v2-brief-2026-09-22.md`, `v3-ladder-brief-2026-09-22.md` -- briefs for
  the v2 editorial pass and the v3 research-ladder pass, respectively.
- `css-design-system.md` -- the site's CSS design-system spec.

## What's not here

No PNG/image binaries and no secrets. Token files (`admin-token-*.txt`),
`secrets.env`, and other credential material never leave
`/home/claude/.twon/` or the Mac's equivalent -- they are not copied into
this repo. The only token-related files tracked in the repo are the
*token-issuing* scripts under `site/tools/` (`_secrets.sh`,
`issue-mcp-token.sh`, `issue-scoped-admin-tokens.sh`), which contain no
token values themselves.
