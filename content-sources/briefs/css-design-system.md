# CSS design system for The War On News

Date: 2026-09-22. Scope: appearance layer only, for a Cloudflare Worker site with no build step (HTML from JS template strings, every page also served as Markdown/JSON). Audience: journalists, researchers, the public, AI crawlers.

## 1. Research summary

### 1a. What "CSS frameworks for AI sites" means in 2025–2026

Three distinct things get called this, and they point in different directions:

**Utility-first (AI-generates-it-well) frameworks.** Tailwind CSS v4 (stable Jan 2025) rewrote its engine in native CSS, uses `@theme` tokens instead of a JS config file, and ships an official CDN `<script>` build for zero-build use — but the CDN build compiles utilities at runtime in the browser via a bundled JIT engine, which is real JS execution weight on every page load, not just markup. AI coding agents produce Tailwind fluently because its utility classes are high-frequency tokens in training data, but the payoff (fast iteration, consistent spacing) is a build-tooling benefit this project doesn't need, and the utility-class markup is exactly the "div/class soup" that works against clean Markdown/JSON parallel rendering. ([Tailwind v4 blog](https://tailwindcss.com/blog/tailwindcss-v4); [LogRocket, 2026](https://blog.logrocket.com/tailwind-css-guide/))

**Classless / semantic frameworks.** Pico CSS (current v2.1.1, MIT + CC-BY-SA docs, no build step, drop-in `<link>`, ~14.8k GitHub stars, 12.6M monthly jsDelivr requests) styles bare HTML elements with under 10 opt-in classes. Water.css (MIT, kognise/water.css) and Simple.css (MIT, kevquirk/simple.css) are smaller single-file classless sheets in the same family; MVP.css (andybrewer/mvp, MIT) is the smallest of the four, aimed at prototypes/docs. All four: no build step, single `<link>` tag, style semantic elements directly (`article`, `table`, `nav`, `blockquote`), and are explicitly recommended in 2025–2026 write-ups as the fit for "minimal markup, LLM-parseable" sites. ([Pico CSS](https://picocss.com/); [LogRocket classless comparison, 2026](https://blog.logrocket.com/comparing-classless-css-frameworks/); [awesome-css-frameworks, 2026](https://github.com/troxler/awesome-css-frameworks))

**Token-based primitives.** Open Props (argyleink/open-props, MIT) ships ~1000 CSS custom properties (color ramps, type scale, easing, shadows) as importable CSS files or an npm/CDN bundle — token vocabulary, not a UI layer, so it composes with hand-written CSS rather than replacing it. Every Layout / CUBE CSS (Andy Bell & Heydon Pickering) is not a framework at all but a documented set of layout *primitives* (stack, cluster, sidebar, switcher) implemented as a handful of CSS custom-property-driven classes — widely cited in 2026 "modern CSS architecture" pieces as the alternative to utility-class layout. ([Open Props](https://open-props.style/); [Every Layout](https://every-layout.dev/layouts/); [Domain India, "Modern CSS in 2026 — Tailwind v4, Open Props, CUBE"](https://domainindia.com/support/kb/modern-css-tailwind-v4-open-props-cube-architecture))

**"AI-native" design-token tooling.** The W3C Design Tokens Community Group's Design Tokens Format Module reached its **first stable release, 2025.10, on 28 Oct 2025** — a vendor-neutral JSON format for color (incl. OKLCH/Display P3), typography, spacing, with theming/alias support. Figma, Penpot, Sketch, Framer, Style Dictionary and Tokens Studio already implement it; Adobe, Google, Microsoft, Salesforce, Shopify, Meta participated. Radix Colors (12-step accessible color ramps) and shadcn/ui's CSS-variable token convention are the two most-copied *conventions* for token naming, but both assume a component library on top; this project only needs the token *format* discipline (plain CSS custom properties, one semantic layer over one primitive layer), not the tooling chain. ([W3C DTCG stable release announcement](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/); [designtokens.org spec](https://www.designtokens.org/tr/drafts/format/))

**Crawler-parseability.** 2025–2026 GEO/AI-crawler guidance converges on: real semantic HTML5 elements (`article`, `section`, `h1`–`h6`, `dl`, `table`) over generic `div`+class soup; content present in the initial server-rendered HTML (this Worker already does that); self-contained paragraphs; and structured data (JSON-LD) alongside — all of which argue against a CSS-in-JS runtime or a utility framework's div-heavy markup, and for the classless/semantic-class approach. ([Front-End Checklist, LLM parsability rule](https://frontendchecklist.io/rules/seo/llm-parsability); [dev.to 2026 LLM.txt guide](https://dev.to/creative_santu/the-2026-guide-to-llmtxt-optimization-structuring-websites-for-ai-crawler-ingestion-15b3))

**Candidate table (8 covered in depth):**

| Candidate | Version (2026-09) | Size | Licence | Build step | Editorial/reference use |
|---|---|---|---|---|---|
| Tailwind CSS v4 | 4.x (Jan 2025 rewrite) | CDN JIT bundle, tens of KB + runtime compile | MIT | No (CDN) / Yes (recommended) | Common on marketing/app sites; rare on classic editorial/reference sites |
| Pico CSS | v2.1.1 | ~free CDN file, no official min/gz figure published on site | MIT (code), CC-BY-SA (docs) | No | Docs sites, prototypes; not seen on major newsrooms |
| Water.css | stable, MIT | single-file, a few KB | MIT | No | Personal sites, docs |
| Simple.css | stable, MIT | single-file, small | MIT | No | Blogs, docs |
| MVP.css | stable, MIT | smallest of the four, single file | MIT | No | Prototypes, internal tools |
| Open Props | active (npm `open-props`) | token files, import only what's used | MIT | No for use (CDN/`@import`); Yes only if bundling custom builds | Used inside custom-built design systems, not as a finished look |
| Every Layout / CUBE CSS | ongoing (book + site) | a few small mixins/classes, hand-copied | Public methodology, code snippets free to copy | No | Cited as the layout approach behind many hand-rolled editorial builds |
| W3C Design Tokens Format 2025.10 | 2025.10 (stable, 28 Oct 2025) | N/A — a JSON format, not a stylesheet | W3C community spec | N/A | Adopted by design tools (Figma, Penpot); relevant to *how we author tokens*, not to runtime CSS |

None of the classless frameworks (Pico/Water/Simple/MVP) is documented in active use on a major documentary/investigative newsroom; those sites (below) hand-roll their CSS instead, which is the strongest single signal for this project.

### 1b. Modern CSS that removes the need for a heavy framework

All of the following are Baseline-safe for a 2026 launch (per [buildmvpfast's Baseline 2026 roundup](https://www.buildmvpfast.com/blog/web-platform-baseline-2026-new-features-browser-support) and [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap)):

- **Cascade layers (`@layer`)** — Baseline widely available since 2022, in every evergreen browser. Lets us order reset → tokens → base → layout → components → utilities → print without specificity fights, with zero runtime cost.
- **Container queries (`@container`)** — Baseline widely available since early 2023. Used for incident/case/actor cards that must adapt inside a sidebar, a full column, or a timeline slot, independent of viewport.
- **`:has()`** — Baseline since late 2023. Used for state styling (`.source:has([data-state="dead"])` row treatments) without extra JS-toggled classes.
- **CSS nesting** — Baseline since 2023 (native, no preprocessor).
- **`color-mix()`** — Baseline since 2023. Used to derive hover/focus/tint variants from the five brand colors instead of hand-picking extra hex values.
- **`light-dark()`** — Baseline (newly available) since May 2024. Lets one token declaration serve both color schemes when paired with `color-scheme` and `@media (prefers-color-scheme: dark)`; this is the mechanism the brief asks for.
- **`text-wrap: balance` / `text-wrap: pretty`** — Baseline (newly available) since October 2024. `balance` for headlines/pull-quotes, `pretty` for body paragraphs to avoid orphans.
- **Subgrid** — Baseline since 2023. Used for the timeline's year-column/entry-column alignment and table-like glossary layout.
- **View Transitions (same-document)** — only reached Baseline in **October 2025** (Firefox 144 was the last holdout). Newest feature in this list; used only as a progressive enhancement (page-to-page fade), never load-bearing.

Net: a hand-written sheet built on these features gets utility-framework ergonomics (responsive, themeable, stateful) with **no runtime JS, no build step, and no third-party file weight** — which is exactly the constraint this Worker already operates under.

### 1c. Typography / reading-experience references

- **GOV.UK Design System** — publishes an explicit type scale and measure guidance in its Styles section; the 2018 and 2022 GOV.UK Design Notes posts on typography/spacing describe moving to a restrained, accessible scale keyed to a ~"65 characters" measure for body copy. ([GOV.UK Design System, Styles](https://design-system.service.gov.uk/styles/); [Design Notes, 2018](https://designnotes.blog.gov.uk/2018/02/19/developing-new-typography-and-spacing-for-gov-uk-frontend/); [Design Notes, 2022, accessible scale](https://designnotes.blog.gov.uk/2022/12/12/making-the-gov-uk-frontend-typography-scale-more-accessible))
- **U.S. Web Design System (USWDS)** — its Typography component page documents a token-based type scale and an explicit "measure" utility for controlling line length independent of container width — the same pattern this project's `--measure` token uses. ([USWDS Typography](https://designsystem.digital.gov/components/typography/); CMS design system's [measure utility](https://design.cms.gov/utilities/text/measure) is the same idea, exposed as a utility class)
- **Wikipedia Vector 2022** — the redesign (rolled out through 2022–2023, still current) introduced a maximum content width for article text specifically to shorten line length on wide screens — reference documented on [Wikipedia:Vector 2022](https://en.wikipedia.org/wiki/Wikipedia:Vector_2022) and covered in [ITBrew's retrospective](https://www.itbrew.com/stories/2023/05/19/wikipedia-s-2022-redesign-is-the-first-in-a-decade-here-s-why); the core lesson ported here: an unconstrained encyclopedia-style page is a11y-legible but readability-poor at wide viewports, fixed by a measure cap, not a framework.
- **Common thread across GOV.UK/USWDS/Wikipedia**: none uses a third-party CSS framework; each hand-rolled a small token-driven system with an explicit measure constraint, a restrained type scale (5–7 steps), and heavy use of native `<table>`, `<dl>`, and footnote/citation conventions rather than JS-driven tooltips. This directly supports the "single hand-written stylesheet" recommendation below.

### 1d. Accessibility and performance constraints

**Contrast — validated with the Python script in §5.** Two failures found in the raw palette as given, both fixed with derived tokens (not by abandoning the palette):
1. Amber `#C98A1B` on paper `#F3EFE6` = **2.56:1**, and on wash `#D8D2C4` = **1.95:1** — fails WCAG 2.2 AA (needs 4.5:1 for text, 3:1 even for large text/UI). Amber as given cannot carry text or thin strokes on the light backgrounds.
2. Wash `#D8D2C4` used as a border/divider directly on paper = **1.31:1** — fails the 3:1 minimum WCAG 1.4.11 requires for UI component boundaries (both themes: dark-theme equivalent also failed at 1.12:1).

Fixes are in §5/§6 (a darkened `--color-amber-ink` for accent text/links, and dedicated `--color-line` border tokens for both themes) — the decorative amber and the palette itself are otherwise kept intact.

**Core Web Vitals.** A zero-JS, no-build CSS file avoids render-blocking JS entirely; LCP is governed only by the stylesheet's own size/priority and by web-font loading (this system specifies system-font stacks by default, no font download, to keep LCP and CLS low) and INP has effectively nothing to regress since there's no framework runtime. Google's current (2025–2026) page-experience guidance continues to score on LCP/INP/CLS as ranking-adjacent signals, and a hand-written sub-30KB stylesheet with no JS dependency is close to the best-case profile for all three. ([Google Search Central, Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals); [Core Web Vitals 2026 threshold overview](https://www.rivuletiq.com/core-web-vitals-2026-whats-changed-and-how-to-pass/))

## 2. Recommendation

**Primary: no framework.** A single hand-written stylesheet (`site.css`, ≈16 KB raw / well under the 30 KB budget), built on `@layer` cascade layers, a flat set of design-token custom properties, and semantic classes (`.incident`, `.timeline`, `.claim`, `.source[data-state="dead"]`) matching the site's existing semantic HTML. Seeded conceptually from Open Props' scale conventions (a `clamp()`-based fluid type scale, an 8-step spacing scale) but with no Open Props import — the whole point is zero external dependency for a Worker with no build step and no npm.

**Three strongest reasons:**
1. **No framework in this category is used by the reference class this site belongs to.** GOV.UK, USWDS, Wikipedia, and (by strong convention) investigative-journalism reference sites all hand-roll a small token-driven CSS system rather than adopt Pico/Water/Simple/Tailwind — the classless frameworks target prototypes and blogs, not documentary-reference properties with citation apparatus, timelines, and dual HTML/Markdown/JSON output.
2. **Zero-dependency matches the architecture, not just the aesthetic.** The Worker has no build step and no npm; every third-party framework here (even a "no-build" one like Pico via CDN) is still an external `<link>` on the critical path and a versioning/licensing surface to track. A single owned file has no such surface, loads with the HTML, and never risks the div-soup that fights the site's parallel Markdown/JSON rendering and AI-crawler legibility goals.
3. **Modern CSS now natively provides what a framework used to be needed for.** Cascade layers, container queries, `:has()`, nesting, `color-mix()`, and `light-dark()` are all Baseline-safe today, so "theming, responsive components, and state styling without a framework" is no longer a compromise — it's the 2026-standard way to do it, per every one of the CSS-in-2026 roundups above.

**Fallback:** if hand-authoring proves too slow to hit launch velocity, adopt **Pico CSS v2.1.1** (classless, MIT, no build, CDN `<link>`) as a base layer underneath the same custom-property tokens and semantic component classes — it styles bare elements sensibly out of the box and every custom class in this doc still applies on top of it unmodified, so the fallback is additive, not a rewrite. Do not fall back to Tailwind or any utility-class framework: it would require restructuring the markup shared with the Markdown/JSON renderers.

## 3. Contrast validation

Script: `/tmp/claude-0/-home-claude/8dc93e65-f789-5a43-87d8-db43352812d5/scratchpad/contrast.py` (WCAG relative-luminance formula, sRGB→linear, standard contrast-ratio formula). Full run below.

```
=== LIGHT THEME (background = paper #F3EFE6, and secondary bg = wash #D8D2C4) ===
ink       (#1B1B1B) on paper     (#F3EFE6): ratio=15.01  AA-normal=PASS  AA-large=PASS  AAA-normal=PASS
graphite  (#6E6A63) on paper     (#F3EFE6): ratio=4.69   AA-normal=PASS  AA-large=PASS  AAA-normal=FAIL
amber     (#C98A1B) on paper     (#F3EFE6): ratio=2.56   AA-normal=FAIL  AA-large=FAIL  AAA-normal=FAIL   <-- FAIL
ink       (#1B1B1B) on wash      (#D8D2C4): ratio=11.43  AA-normal=PASS  AA-large=PASS  AAA-normal=PASS
graphite  (#6E6A63) on wash      (#D8D2C4): ratio=3.57   AA-normal=FAIL  AA-large=PASS  AAA-normal=FAIL
amber     (#C98A1B) on wash      (#D8D2C4): ratio=1.95   AA-normal=FAIL  AA-large=FAIL  AAA-normal=FAIL   <-- FAIL

=== Non-text UI component contrast (WCAG 1.4.11, needs >=3.0) ===
wash as border/divider directly on paper (light): 1.31   FAIL
wash-dark as border/divider directly on paper-dark (dark): 1.12   FAIL

=== FIXES APPLIED — final token set ===
graphite    (#5D5A54) on paper (light) = 5.99   PASS AA
graphite    (#5D5A54) on wash  (light) = 4.56   PASS AA
amber-ink   (#785210) on paper (light) = 6.07   PASS AA  (accent text/link color, replaces raw amber for text use)
amber-ink   (#785210) on wash  (light) = 4.63   PASS AA
line        (#858279) on paper (light) = 3.35   PASS (UI component minimum)
ink on amber fill (badge/chip, light)  = 5.85   PASS AA  (amber safe as a FILL under dark text, just not as text/stroke)

graphite    (#A39C8E) on paper (dark)  = 6.74   PASS AA
graphite    (#A39C8E) on wash  (dark)  = 5.99   PASS AA
amber       (#C98A1B) on paper (dark)  = 6.24   PASS AA  (unlightened amber already safe as text on the dark background)
line        (#68635D) on paper (dark)  = 3.09   PASS (UI component minimum)
```

**What changed and why:**
- The raw palette's `graphite` (`#6E6A63`) and `amber` (`#C98A1B`) are **kept unchanged as decorative/illustration/fill colors** (engraving-line tint, icon fill, badge background under dark text — `ink` on raw amber fill = 5.85:1, passes).
- A new **`--color-graphite`** token is set to a slightly darkened `#5D5A54` for any *text* use, so the same variable is safe as meta/caption/timestamp text on both the paper and wash backgrounds (one token, not two, to keep the sheet simple).
- A new **`--color-amber-ink`** token (`#785210`) is added specifically for accent text — links, citation markers, "last reviewed" stamps, pull-quote attributions — anywhere amber conveys meaning in running text. Raw `--color-amber` stays reserved for fills, borders-on-dark-text, and illustration accents where it's never the foreground text color.
- A new **`--color-line`** token (`#858279` light / `#68635D` dark) replaces `wash`/`wash-dark` for any border, divider, or table rule; `wash`/`wash-dark` remain as background-only surface colors.
- The dark theme's raw amber already cleared AA for text (6.24:1); no substitution was required there, though a brighter optional `--color-amber-bright` (`#E0A73E`, 8.54:1, clears AAA) is included for anyone who wants extra margin on dark mode headlines.

## 4. Layout rules

- **Measure:** body copy constrained to `--measure: 68ch` (range 60–75ch per brief), applied via `max-inline-size` on `.prose`/article containers, independent of the grid column width.
- **Breakpoints:** container-query–driven for components (`--bp-card-sm: 28rem`, `--bp-card-md: 42rem`), plus three page-level viewport breakpoints for the shell: `30rem` (phone → wide phone), `48rem` (tablet), `75rem` (desktop reading width cap).
- **Gutters:** `16px` fixed side gutter on phone (`--gutter: clamp(1rem, 4vw, 2.5rem)`, floors at 16px), widening fluidly toward desktop.
- **Grid:** page shell is a single-column flow up to `48rem`; from `48rem` a two-column `masthead + nav` / `content + rail` grid using `subgrid` so the timeline's year markers and the glossary's term column stay aligned across nested rows.
- **Cards** (incident, case, actor): `@container` queries switch from stacked (mobile/narrow rail) to a label-beside-body layout once the card's own inline size passes `28rem`, regardless of viewport — so the same `<article class="incident">` markup works in a full-width feed or a narrow sidebar.

## 5. Component inventory

Full implementation in `site.css` §Components (cascade layer `components`). Each is a semantic class on existing HTML elements, no markup restructuring required:

`.masthead`, `.nav` (+ `.nav[aria-current]`), `.incident` (incident card), `.timeline` + `.timeline-year` + `.timeline-entry` (vertical, dated, grouped by year via subgrid), `.claim` (+ `.claim-quote`, `.claim-source`, `.claim-archived`), `.desk-note` (News Desk editorial note), `.sources` + `.source[data-state="live"|"archived"|"dead"]` (link-state badges), `.case-card`, `.actor-card`, `.glossary dl` (term/definition), `.data-download`, `.reviewed-stamp` ("last reviewed"), `.footnotes` + `sup.fn-ref` (footnote-style citations), `table` (base element styling, sortable-ready), `.pagination`, `.feed-badges` (RSS/JSON/MCP endpoint badges), and a dedicated `@media print` block.

## 6. Token set

See `--color-*`, `--font-size-*` (fluid `clamp()` scale), `--space-*` (8-step scale), `--radius-*`, `--border-*`, `--shadow-*` (kept to two, both minimal — no drop-shadow-heavy "card" look, matches the engraved/flat-print aesthetic), and `--duration-*`/`--ease-*` motion tokens defined in full at the top of `site.css`, using `light-dark()` for every color token so a single declaration serves `prefers-color-scheme: light` and `dark`.

## 7. Files

- `/home/claude/crank3/css-design-system.md` — this document.
- `/home/claude/crank3/site.css` — the stylesheet: tokens, base, layout, components, print. No build step, no external `@import`, under 30 KB, semantic-class-based.
