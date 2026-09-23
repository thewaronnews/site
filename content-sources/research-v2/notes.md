# Notes: granular-2020-2026.json

Research slice: granular incidents 2020-2026, worldwide, United States as focal
point, comparators from every continent. 45 new incidents, none duplicating
`seed/incidents.json`.

## Counts by year
- 2020: 7
- 2021: 5
- 2022: 1
- 2023: 7
- 2024: 7
- 2025: 16
- 2026: 2

## Counts by continent
- North America: 24 (21 United States, 1 Canada, 1 Guatemala, 1 Nicaragua)
- Asia: 8 (Myanmar, India x2, Hong Kong, Pakistan, Bangladesh, Turkiye, China)
- Europe: 6 (Hungary, Belarus, Russia, Slovakia, Georgia, Serbia)
- Africa: 4 (Ethiopia, Tunisia, Tanzania, Zimbabwe)
- South America: 2 (Argentina, Venezuela)
- Oceania: 1 (Australia)

## US vs. comparators
- United States: 21 incidents
- International (comparators): 24 incidents, spanning all six inhabited
  continents

## Sources, actors, outlets
- 72 sources, all ids prefixed `g_`, all checked with curl (browser
  user agent, 15s timeout, via `$HTTPS_PROXY`)
  - 56 resolved live to curl
  - 16 returned a non-200 status to curl (403/406, automated-request
    blocking) but were independently confirmed readable and were fetched
    successfully via WebFetch; recorded as `link_state: "bot_blocked"`,
    consistent with the seed data's own convention (see seed source
    `s005`). None were dropped as dead; every one was verified to carry
    the content it is cited for.
- 75 actors (heads of government and enforcing officials/bodies for every
  jurisdiction covered)
- 24 outlets, 15 named journalists

## Claims and evidence
- 155 claims total across the 45 incidents (at least 3 per incident)
- 155 of 155 claims carry a verbatim `evidence_quote` copied from a source
  actually fetched via WebFetch (100%)

## Outcome distribution
- sustained: 18
- ongoing: 10
- reversed: 9
- unknown: 7
- upheld: 1

Seven incidents carry `outcome: "unknown"` because the sources reviewed did
not establish a clear resolution as of the research date (2020 HHS/CDC
guidance interference, the 2025 Tomasi rubber-bullet shooting in Los
Angeles, Homan's stated but undated ICE ride-along policy, the O'Keefe/FBI
phone-seizure case, the later fate of Hungary's 2020 pandemic
false-information provision, the BBC India tax-raid aftermath, and the
Tanzania election-day shutdown). Each of these has a sourced
`outcome_note` explaining what is and is not established, and a
`what_we_dont_know` field where relevant.

## Sourcing gaps and limitations
- All 45 incidents met the required evidentiary bar: a clear government
  actor, a quoted stated justification, and at least 3 claims with
  verbatim quotes from journalistic-quality or primary sources (AP,
  Reuters, AFP, BBC, NYT, WaPo, Guardian, NPR, PBS, CBC, court/case
  records, CPJ, RSF, Human Rights Watch, U.S. Press Freedom Tracker,
  and comparable outlets: no blogs, social posts, or advocacy statements
  were used as evidentiary sources).
- A handful of paywalled or blocked outlets were dropped in favor of
  alternate established outlets covering the same facts (e.g. Deadline on
  Bill Owens/60 Minutes was paywalled and replaced with NPR; CNN's initial
  Minneapolis CNN-crew story and Kansas Reflector's Marion County Record
  follow-up were blocked to automated fetching at times and supplemented
  with Poynter, Reason, and additional AP/CNN coverage).
- The WebSearch tool's session budget (200 calls) was exhausted partway
  through research. All remaining source-verification and quote-gap work
  after that point was completed using WebFetch alone, against URLs
  already surfaced by earlier searches; every incident still reached 3+
  genuine verbatim quotes this way.
- An editorial lint pass against `editorial/lint-rules.json` found 58
  instances of banned phrases or quotation-only words used outside
  quotation marks in the site's own prose (summaries, what_happened,
  effect_on_reporting, issue_of_the_day, outcome_note, and claim
  statements). All 58 were corrected by rewording to neutral language or,
  where the word was a genuine quote from an official, by placing it in
  quotation marks. A follow-up lint pass found zero remaining violations.
  Verbatim `evidence_quote` fields were left untouched throughout, since
  quoted text is exempt from linting by the rules' own terms; a small
  number of em dashes and en dashes that appear only inside
  `evidence_quote` fields (verbatim copies of sources' own text) were left
  as-is for the same reason.
- No em dashes, horizontal bars, or other forbidden dash patterns appear
  in the site's own words anywhere in the file.
