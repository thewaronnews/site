# Ladder research batch 1: notes (2026-09-22)

Scope: comparator incidents for seven tactics (access_ban, credential_control,
outlet_licensing, prior_restraint, secrets_and_espionage_laws,
insult_and_defamation_laws, surveillance_and_subpoenas), placing rungs above
the United States on the ladder ("pressure" / "punish" / "silence" / "eliminate").
Output: `ladder-1.json` (31 incidents, 38 sources, 32 actors, 38 outlets, 34
journalists, 103 claims).

## Counts per tactic

| Tactic | Count | Stages |
|---|---|---|
| access_ban | 5 | pressure 1, "punish" 4 |
| credential_control | 4 | pressure 1, "punish" 3 |
| outlet_licensing | 6 | "silence" 6 |
| prior_restraint | 3 | pressure 2, "silence" 1 |
| secrets_and_espionage_laws | 5 | eliminate 5 |
| insult_and_defamation_laws | 4 | "punish" 1, eliminate 3 |
| surveillance_and_subpoenas | 4 | "punish" 4 |
| **Total** | **31** | |

## Counts per stage

- pressure: 4
- "punish": 12
- "silence": 7
- eliminate: 8

Total: 31 (target was 32; see gap note below on prior_restraint).

## Countries and regions covered

Hungary, Russia, China (incl. Hong Kong), Belarus, Philippines, Turkiye,
Zimbabwe, Kazakhstan, Venezuela, Cambodia, Israel, Egypt, Vietnam, Iran,
North Korea, Thailand, Morocco, Saudi Arabia, Mexico: 19 countries across
Europe, Asia, Africa, South America and North America. Dates run from 2003
(Zimbabwe) to 2026 (Hungary, Belarus release), with the bulk in 2017 to 2024.

## Sourcing

Every source is the Committee to Protect Journalists (CPJ). This is a
deliberate fallback, not a preference, forced by access constraints in this
environment:
- reuters.com returned 401 to the fetch tools; apnews.com returned 403.
- WebFetch returned `SITE_BLOCKED` for bbc.com and similar outlet domains.
- rsf.org's search path 404s through the proxy; its site is otherwise reachable.
- Google, Bing and DuckDuckGo's HTML search endpoints are all blocked or
  return JS-only/anti-bot pages through the proxy, so URLs could not be
  discovered by web search.
- The session's WebSearch tool had already exhausted its call budget (200/200)
  before this task started, for reasons unrelated to this task.
- CPJ's own `?s=` search endpoint on cpj.org (200 via curl) is what
  the URLs, quotes and dates in this file were actually found and verified
  through: it functioned as the substitute for the blocked general search
  engines. CPJ counts as a press-freedom organisation source under the
  standing "Sources and standards" hierarchy (the granular-2020-2026.json
  file already uses `press_freedom_org` as a `kind` value for the U.S. Press
  Freedom Tracker), but a second editorial pass should re-source a portion of
  these to primary wire copy (Reuters, AP, AFP) or court records once those
  domains are reachable, for source diversity.

All 38 source URLs were link-checked with curl (browser user agent, 15s
timeout, via `$HTTPS_PROXY`) immediately before the file was written: all 38
returned HTTP 200. None needed replacement.

## Duplicate avoidance

Checked candidate slugs against all 128 existing entries in
`seed-v2/incidents.json`. Three planned incidents turned out to duplicate
existing entries and were swapped for different, comparably well-sourced
cases before drafting:
- Myanmar (Reuters journalists Wa Lone / Kyaw Soe Oo, Official Secrets Act)
  already exists as `2018-myanmar-reuters-journalists-official-secrets-act`
  → replaced with Vietnam's Pham Doan Trang (nine-year sentence, Article 117).
- Hong Kong Stand News sedition conviction already exists as
  `2024-hong-kong-stand-news-editors-convicted-sedition` → replaced with
  Cambodia's Voice of Democracy license revocation (February 2023).
- China's March 2020 mass expulsion of NYT/WSJ/WaPo journalists already
  exists as `2020-china-expels-us-newspaper-journalists` → replaced with
  China's earlier, distinct February 2020 expulsion of three named Wall
  Street Journal correspondents over an opinion headline.

## Gaps against the 4 to 6 target

- **prior_restraint has 3, not 4 to 6.** Israel (military review / "Prisoner X"
  "gag order"), Turkiye (RTUK earthquake-coverage fines and forward broadcast
  suspensions) and Egypt (Supreme Council for Media Regulation licensing as a
  precondition to publish) are solidly sourced. A fourth classic case: Iran's
  Ministry of Culture and Islamic Guidance permit system, Pakistan's PEMRA
  ordering delayed or blocked live coverage, or Vietnam's pre-publication
  review: could not be pinned to a specific, dated, quotable incident through
  CPJ's search within the access constraints above (searches for "Iran
  newspaper permit revoked," "PEMRA bans live broadcast Imran Khan," and
  similar returned no matching CPJ article). Flagging for a follow-up pass
  once RSF, Reuters or AP access is available, rather than forcing a weak or
  under-sourced entry to hit the count.
- Two tactics (outlet_licensing at 6, access_ban at 5) run at the high end of
  the range to keep the overall total near 32 given the prior_restraint
  shortfall; both are supported by fully independent incidents, not padding.

## Other choices worth flagging for review

- **Leader_slug for monarchies/collective leaderships**: Saudi Arabia's 2018
  incident is attributed to King Salman (formal head of state and government
  at the time), not Mohammed bin Salman, since MbS did not hold the Prime
  Minister title until 2022. Morocco's incidents are attributed to the
  sitting Prime Minister (Saadeddine Othmani) rather than King Mohammed VI,
  for consistency with "head of government" as defined, though Morocco's
  monarchy holds the greater share of executive power in practice: worth a
  site-wide policy decision rather than a per-record judgment call.
- **North Korea sentence length**: CPJ's own 2009 annual report states Laura
  Ling and Euna Lee were sentenced to "20 years of 'reform through hard
  labor,'" which is used verbatim here even though other, non-journalistic
  outlets more commonly cite 12 years. The verbatim CPJ source is preferred
  per the sourcing rule; a note should be added to the public record if a
  primary court document surfaces a different figure.
- **Andrzej Poczobut, Belarus**: sourced as "inciting hatred and calling for
  sanctions," not "insulting the president" as the assignment brief's example
  framing suggested: CPJ's sentencing report does not name an insult charge,
  so the record follows the source rather than the brief's shorthand.
- **Omar Radi, Morocco**: the surveillance incident (2020) and his eventual
  2024 pardon are on a separate, later charge ("sexual assault") rather than
  directly on the spyware finding itself; the record keeps that distinction
  explicit rather than implying the pardon exonerated the surveillance.

## Claims and quotes

103 verbatim claims across 31 incidents (3 to 5 each), every `evidence_quote`
copied from the CPJ page actually fetched via WebFetch in this session, each
under 300 characters. Source ids are prefixed `l1_001` through `l1_038`.
