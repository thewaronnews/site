# Perplexity Pro Fact Verification — Crank #3 (thewaronnews.com)
Date: 2026-09-22
Method: One precise question per incident/case asked to Perplexity Pro (perplexity.ai, signed in as "Peter Benes" in the connected Chrome — note: task brief said betty@, but the account actually signed into Perplexity in this Chrome profile is Peter Benes). Answers and cited source domains read via get_page_text. Seed files read (not edited): `/home/claude/crank3/seed/incidents.json`, `/home/claude/crank3/seed/cases.json`.

**Tally: 22 confirmed / 4 contradicted / 1 unresolved** (23 incidents + 4 cases = 27 items)

Contradicted items: `white-house-bars-ap-gulf-of-america` (AP ban start date), `pentagon-issues-new-press-credentialing-rules` (rules-issued date), `louisiana-enacts-police-buffer-zone-law` (enactment date), `hong-kong-convicts-jimmy-lai-under-national-security-law` (conviction/sentencing dates off by one day).

## Incidents (23)

| # | Slug | Verdict | Notes |
|---|------|---------|-------|
| 1 | white-house-bans-cnn-msnow-politico | **Confirmed** | Announced Fri 2026-09-18, enforced Sat 2026-09-19. Trump's stated reason ("FICTION and LIES" / "FAKE NEWS", "cumulative stories") matches. |
| 2 | white-house-bars-ap-gulf-of-america | **Contradicted** | Seed says ban began 2025-02-16. AP's own complaint, Wikipedia, and Reuters all say the White House first excluded AP from the Oval Office on **2025-02-11** (made indefinite 2025-02-14). D.C. Circuit partial stay date (2025-06-06) is confirmed correct. |
| 3 | pentagon-issues-new-press-credentialing-rules | **Contradicted** | Seed says rules issued 2025-09-21. NYT ("Pentagon Expands Its Restrictions on Reporter Access") and other coverage date the memo to **Friday, 2025-09-19**. See also "additional finding" below re: a March 2026 First Amendment ruling against these rules. |
| 4 | pentagon-press-corps-forfeits-badges | **Confirmed** | Sources split between "Wed 10/15" (Reuters) and "10/16" (Wikipedia) for the vacate date — within the seed's "beginning around October 15" hedge. ~30 outlets forfeited badges; deadline matches. |
| 5 | whca-loses-control-of-press-pool | **Confirmed** | 2025-02-25, Karoline Leavitt announcement. WHCA quote matches seed verbatim. |
| 6 | fcc-pressure-precedes-kimmel-suspension | **Confirmed** | Carr remarks/ABC suspension 2025-09-17; Kimmel reinstated 2025-09-23. |
| 7 | paramount-cbs-settle-60-minutes-suit | **Confirmed** | Settlement announced late Tue 2025-07-01, $16 million, no apology, funds to Trump library. |
| 8 | trump-order-ends-cpb-funding-npr-pbs | **Confirmed** | EO 14290 signed 2025-05-01. **Additional finding (CPB clawback date, not in seed):** House passed the Rescissions Act of 2025 (P.L. 119-28), including the $1.07B CPB rescission, 214–212 on **2025-06-12**; full/final rescission enacted **2025-07-24**. Source: congress.gov CRS report, NPR. |
| 9 | usagm-moves-to-shut-down-voice-of-america | **Confirmed** | Trump EO 2025-03-14; VOA staff placed on leave ~2025-03-15; Judge Royce Lamberth ordered VOA restored (preliminary injunction 2025-04-22, after an earlier March TRO requiring return to work by 3/23, consistent with seed's "~March 22" order). |
| 10 | doj-rescinds-media-subpoena-guidelines | **Confirmed** | Bondi memo rescinding Biden-era guidelines dated 2025-04-25. |
| 11 | white-house-revokes-acosta-press-pass | **Confirmed** | Revoked 2018-11-07; TRO 2018-11-16 (Judge Timothy J. Kelly); pass restored 2018-11-19. |
| 12 | louisiana-enacts-police-buffer-zone-law | **Contradicted** | Seed says enacted 2024-05-29. RCFP's own federal court filing and the Louisiana Legislature site (legis.la) state Gov. Jeff Landry **signed HB173 on 2024-05-24**; effective date was 2024-08-01. No source found for 05-29. |
| 13 | federal-judge-blocks-louisiana-buffer-law | **Confirmed** | Judge John deGravelles blocked enforcement; "Friday" ruling is consistent with 2025-01-31 (a Friday). Ruling grounded in vagueness/14th Amendment per some sources, First Amendment chilling effect per others — not a factual contradiction. |
| 14 | florida-halo-law-takes-effect | **Confirmed** | Took effect 2025-01-01. No successful court strike-down found (ongoing constitutional challenges, e.g. Jacksonville arrests, but law still in effect) — matches seed. |
| 15 | nixon-white-house-compiles-enemies-list | **Confirmed** | Colson's office (via George T. Bell) sent the first "enemies list" memo to John Dean on 1971-09-09 (Wikipedia, Nixon Library exhibits). |
| 16 | obama-doj-charges-eight-under-espionage-act | **Unresolved** | Confirmed CPJ published "The Obama Administration and the Press" special report and that it documents aggressive Espionage-Act leak prosecutions (Guardian: "most aggressive since Nixon"), but did not independently re-pin the exact 2013-10-10 publish date this session — no contradicting date found either. |
| 17 | hungary-sovereignty-protection-act | **Confirmed** | Abolition date confirmed exactly: Hungarian parliament voted 135-44-6 to abolish the Sovereignty Protection Office on **2026-06-30** (HRW, Xinhua/china.org, EU Commission country chapter). 2023-12-20 enactment date not re-confirmed independently but not contradicted. |
| 18 | india-journalist-sentenced-adani-defamation | **Confirmed** | Ravi Nair sentenced 2026-02-10 (CPJ report dated 2026-02-11); 1 year + ₹5,000 fine. |
| 19 | israel-maintains-ban-on-foreign-press-access-to-gaza | **Confirmed** | CPJ's report "129 killed in 2025, Israel responsible for ~2/3" published 2026-02-25 (Reuters, CPJ, Al Jazeera all confirm). |
| 20 | russia-new-law-targets-exiled-journalists-assets | **Confirmed** | Putin signed the law on **2026-08-04** (Moscow Times). |
| 21 | el-salvador-freezes-el-faro-shareholder-assets | **Confirmed** | CPJ report published 2026-05-08; freeze occurred Feb–April 2026 — matches seed exactly. |
| 22 | hong-kong-convicts-jimmy-lai-under-national-security-law | **Contradicted** | Seed: convicted 2025-12-14, sentenced 2026-02-08. Sources (BBC, HRW, Wikipedia, CNN, China Daily HK) consistently give **convicted 2025-12-15** and **sentenced 2026-02-09**. Both off by exactly one day — likely a Hong Kong-local-date-vs-US-wire-date artifact, but as stated the seed dates don't match any source found. |
| 23 | turkiye-crackdown-on-journalists-covering-protests | **Confirmed** | Mark Lowen (BBC) detained in Istanbul and deported after being accused of "posing a threat to public order"; consistent with seed's 2025-03-27 date (detained Wed 3/26, deported shortly after). |

## Cases (4)

| Slug | Verdict | Notes |
|------|---------|-------|
| sherrill-v-knight-1977 | **Confirmed** | 569 F.2d 124 (D.C. Cir. 1977). Holding text matches seed almost verbatim (compelling-reasons/due-process standard). Source: law.justia.com, RCFP filings. |
| cnn-v-trump-2018 | **Confirmed** | Docket **1:18-cv-02610 (TJK)**, TRO **2018-11-16**, judge **Timothy J. Kelly**, pass restored **2018-11-19**, dismissed by agreement. Source: Wikipedia "CNN v. Trump", court transcript (upload.wikimedia.org PDF). |
| ap-v-budowich-2025 | **Confirmed** | Docket **1:25-cv-00532-TNM** (D.D.C.) / No. 25-5109 (D.C. Cir.); filed 2025-02-21; preliminary injunction 2025-04-08; D.C. Circuit partial stay **2025-06-06** (panel: Pillard, Katsas, Rao). Matches seed exactly. Note: underlying AP exclusion itself began 2025-02-11, not 2025-02-16 — see incident #2 above. |
| cnn-msnow-politico-v-trump-2026 | **Confirmed** | **Docket 1:26-cv-03287 (TJK)** — Perplexity explicitly confirmed presiding judge is Timothy J. Kelly ("TJK"). Filed 2026-09-21 in U.S. District Court for D.C. This directly confirms the two specific facts the task flagged as unverified in the seed's case notes. |

## Specifically-requested confirmations (per task brief)

- **CNN 2026 case docket 1:26-cv-03287 and Judge Timothy J. Kelly** — **CONFIRMED.** Multiple sources (Reuters/court reporting) give the case as "1:26-cv-03287 (TJK)"; TJK = Timothy J. Kelly, the same judge who handled the 2018 Acosta case.
- **Pentagon credential rules date** — **CONTRADICTED.** Seed: 2025-09-21. Actual: 2025-09-19 (Friday memo, per NYT).
- **CPB clawback vote date** — **not in seed as a dated field; now documented.** House passed the Rescissions Act of 2025 (containing the CPB clawback) 214–212 on 2025-06-12; enacted 2025-07-24.
- **MS NOW rename date** — **not in seed; now documented.** MSNBC rebranded to **MS NOW on 2025-11-15** (Wikipedia, LA Times, Versant/MSNBC press release, MSN).
- **AP v. Budowich D.C. Circuit date (2025-06-06)** — **CONFIRMED.** Matches seed exactly.
- **RSF 2026 US rank** — **not in seed; now documented.** United States ranked **64th** in the RSF 2026 World Press Freedom Index (down 7 places from the prior year), per Democracy Now, IBTimes, Ahram Online, all citing RSF's 2026 report.

## Corrections to apply (exact field / old value / new value / source)

1. `incidents.json` → `white-house-bars-ap-gulf-of-america.occurred_on`: old **"2025-02-16"** → new **"2025-02-11"**. Source: AP's complaint as filed (courthousenews.com, Case 1:25-cv-00532-TNM Document 1), en.wikipedia.org/wiki/Associated_Press_v._Budowich.
2. `incidents.json` → `pentagon-issues-new-press-credentialing-rules.occurred_on`: old **"2025-09-21"** → new **"2025-09-19"**. Source: nytimes.com ("Pentagon Expands Its Restrictions on Reporter Access").
3. `incidents.json` → `louisiana-enacts-police-buffer-zone-law.occurred_on`: old **"2024-05-29"** → new **"2024-05-24"** (signed by Gov. Landry; effective 2024-08-01). Source: legis.la (official LA Legislature bill history for HB173/Act 259), RCFP federal court filing (rcfp.org).
4. `incidents.json` → `hong-kong-convicts-jimmy-lai-under-national-security-law.occurred_on`: old **"2025-12-14"** → new **"2025-12-15"**. Source: bbc.com, hrw.org, en.wikipedia.org/wiki/Jimmy_Lai.
5. `incidents.json` → `hong-kong-convicts-jimmy-lai-under-national-security-law` sentencing date in `what_happened`/`status`: old **"2026-02-08"** → new **"2026-02-09"**. Source: hrw.org ("Hong Kong: Publisher Jimmy Lai Sentenced to 20 Years"), chinadailyhk.com, cnn.com.
6. Optional addition — `cases.json` → `cnn-msnow-politico-v-trump-2026.status`: the hedge language ("docket number and presiding judge... were not independently re-confirmed against CourtListener this session") can be removed; both are now independently confirmed (docket 1:26-cv-03287, Judge Timothy J. Kelly / "TJK").
7. Optional addition — `incidents.json` → `pentagon-issues-new-press-credentialing-rules.status`: consider updating "Rules remain in force" — a Perplexity source card (firstamendment.mtsu.edu, "New York Times v. Department of Defense (2026, U.S. District Court, D.C.)") indicates a federal judge ruled in March 2026 that the Pentagon's regulations violated the First Amendment. **This was not independently verified with a dedicated query this session (repeated Perplexity submission failures) — flagged as unresolved/needs a follow-up check before editing.**

## Process note

Perplexity's web UI was unreliable in this session: roughly half of all query submissions silently failed (text typed into the box but the send action did not register, or the browser extension connection dropped), requiring retries. This is noted in case it explains gaps — every item above reflects an answer actually returned by Perplexity, not a guess.
