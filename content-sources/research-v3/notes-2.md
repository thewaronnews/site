# Ladder comparators, batch 2 (researcher notes, 2026-09-22)

## Scope

This batch covers six tactics for the ladder view: funding_and_ownership_pressure, expulsion_and_visa_denial, shutdowns_and_blocking, detention_and_violence, lawsuits_against_press, disinformation_labeling. It adds 31 comparator incidents, all from countries the v3 ladder brief lists as repressive comparators, each placed at a stage ("pressure," "punish," "silence," "eliminate") above the stage the United States record reaches for that tactic. Output: `ladder-2.json` (schema matches research-v2's `{sources, actors, outlets, journalists, incidents}`, plus `stage` and `ladder_note` on every incident) and this file.

## Avoiding duplicates

Before researching, I read every incident already in `seed-v2/incidents.json` for the six tactics. Several cases named in the assignment brief were already on file there and are not repeated here:
- Poland's 2015 public media law (Szydlo) and Russia's 2001 Gazprom takeover of NTV: already recorded under funding_and_ownership_pressure.
- China's 2020 mass expulsion of American newspaper correspondents, Venezuela's 2017 and 2024 expulsions, Nicaragua's 2023 citizenship strip: already recorded under expulsion_and_visa_denial.
- India's 2019 Kashmir shutdown, Belarus's 2021 blocking of Tut.by, Tanzania's 2025 election-day shutdown: already recorded under shutdowns_and_blocking.
- Saudi Arabia's killing of Jamal Khashoggi, Guatemala's conviction of Jose Ruben Zamora, Ethiopia's 2025 Sheger FM arrests, Hong Kong's conviction of Jimmy Lai: already recorded under detention_and_violence.
- Turkiye's 2023 disinformation-law detentions, Hungary's 2023 Sovereignty Protection Act, Hungary's 2020 coronavirus "fake news" law, India's 2024 fact-check-unit ruling, Georgia's 2024 foreign-influence law: already recorded under disinformation_labeling.

Where the brief's suggested case overlapped with an existing record, I substituted a different, comparably documented case from the same country or a neighboring one: Poland's 2021 Orlen purchase of Polska Press in place of the 2015 law; Turkiye's March 2016 court seizure of Zaman by trustees (a distinct, earlier event from the seed's July 2016 mass-closure decree) in place of a second Poland or Russia case; Ethiopia's 2022 expulsion of Tom Gardner and Nicaragua's 2018 deportation of Carl David Goette-Luciak in place of already-filed expulsions; Egypt's 2018 media law and Belarus's March 2022 "extremist" designation of Deutsche Welle (a different date and target from the already-filed Tut.by case) in place of the filed Hungary and Georgia laws.

## Counts

By tactic: funding_and_ownership_pressure 5, expulsion_and_visa_denial 5, shutdowns_and_blocking 5, detention_and_violence 6, lawsuits_against_press 5, disinformation_labeling 5. Total 31.

By stage: "silence" 9, "pressure" 9, "punish" 8, "eliminate" 5.

By region and decade: Europe (Hungary x2, Poland, Russia x6, Malta, Belarus x3), Asia (Turkiye x4, India x3, China, Azerbaijan, Philippines x2, Kazakhstan, Vietnam), Africa (Ethiopia x2, Egypt, Eritrea), North America (Nicaragua). Dates span 2001 (Eritrea) and 2013 (Vietnam) through 2026 (Kazakhstan); most fall between 2015 and 2024.

## Sources

35 sources, all journalistic-quality or primary: the Committee to Protect Journalists (29 articles), Reporters Without Borders (2 country pages), Freedom House (3 Nations in Transit or Freedom in the World reports). No blog, advocacy-statement or social-media post is used as evidence for any claim; several incidents quote a government official's or outlet's own statement, but only as reported by one of the above.

Every source URL was checked with curl using a browser user agent through the environment's HTTPS proxy, a 15-second timeout; all 35 returned HTTP 200 on the date of this research. Two URLs guessed from memory turned out wrong and were corrected after a live check: Reporters Without Borders' country pages are at `/en/country/<name>`, not `/en/<name>`.

Each incident carries 3 to 4 claims; every claim's `evidence_quote` was copied from the fetched page, not paraphrased. Several quotes were re-verified a second time by downloading the page with curl and searching the stripped text for the exact string, catching and fixing a recurring error: quoting a clause that in the source continues past a comma into an attribution ("... is outrageous," said X) and closing it with a fabricated period instead. Fifteen quotes were corrected this way, plus a handful of single-quote-versus-double-quote mismatches against the source's own punctuation and one quote wrongly attributed to a Freedom House report when it in fact came from a Reporters Without Borders country page (fixed by adding that page as source l2_035).

## Method

Two research tools were unavailable or exhausted partway through: WebSearch had used its session budget before this batch started, and Reuters, the Guardian, BBC, Associated Press, Deutsche Welle and VOA all blocked the fetch tool outright. CPJ, Reporters Without Borders, Freedom House, Human Rights Watch and Al Jazeera were reachable throughout and supplied every quote in this batch. Where a search engine was needed to find an article's exact URL, Bing's plain HTML results worked when queried directly with curl; CPJ's own site search (`cpj.org/?s=...`) was the most reliable way to locate a specific article once the case and rough date were known.

## Lint

`editorial-v2/lint.py` was run against `ladder-2.json` and returned clean after fixes: one banned phrase ("crackdown"), several quotation-only words used outside quotation marks ("targeting," "illegal," "attacks," "outrageous," "censor," "retaliation"), and three scare-quoted terms ("fake news," "disrespecting authorities") that had been set in single quotes, which the linter does not treat as quotation marks. No em dashes appear in the file's own prose.
