# v3: the ladder reframe (architect, 2026-09-22)

Peter's finding: because the record is deepest for the United States, any count-based comparison shows the US as the largest violator. That is a sampling artefact and it must never be what a reader takes away.

## Rules
1. No public view ranks countries by incident count. Counts appear only inside a country's own page and always with the caveat: "The number of entries reflects the depth of this record, not the severity of a country's conduct."
2. The United States is a chapter, not a column. `/united-states` is the focal chapter: the current situation (2025 to 2026) told in full, the earlier US record (1917 to 2019) as context, and, for each tactic in use now, a link to that tactic's ladder.
3. Comparison is by tactic and by stage. For each of the 13 tactics, `/ladders/<tactic>` shows where the tactic has led elsewhere: the US instance(s) placed on the ladder beside comparator states that have taken it further. Each rung: country, date, leader, what was done, outcome, sources.
4. Every country shows its Reporters Without Borders 2026 rank (with the RSF source) wherever the country is named in a comparison. The US is 64th; most comparators are 150th to 180th.

## Escalation stages (new field `stage` on incidents; one value)
- `restrict`: limiting access or credentials for particular reporters or outlets (bans from briefings or buildings, pool changes, credential revocations, accreditation refusals).
- `pressure`: using state power short of prosecution to change coverage (regulatory threats, licence reviews, funding cuts, lawsuits by officials, official "fake news" or "foreign agent" labels, advertising pressure, tax audits).
- `punish`: legal or physical action against individual journalists or sources (subpoenas and record seizures, prosecutions, arrests, detention, expulsions, visa denials, assault where a government actor is involved).
- `silence`: removing outlets or channels from the public sphere (closures, licence withdrawals, forced sales, blocking and shutdowns, prior restraint, nationalisation).
- `eliminate`: long imprisonment, killing, disappearance or forced exile of journalists with state involvement as the sources state it.

## Comparator states to research (repressive examples, all with journalistic-quality sources)
Russia, China (including Hong Kong), Türkiye, Iran, Egypt, Belarus, Myanmar, Saudi Arabia, Venezuela, Nicaragua, Hungary, Azerbaijan, Cuba, Vietnam, Ethiopia, Eritrea, North Korea, Pakistan, Bangladesh, India, Cambodia, Tanzania, Uganda, Zimbabwe, Philippines (Duterte era), Israel (military censorship and the Al Jazeera law), Syria, Afghanistan (Taliban), Algeria, Tunisia (post-2021), Serbia, Georgia, Slovakia, Poland (2015 to 2023), El Salvador, Guatemala, Kazakhstan, Uzbekistan, Tajikistan.

## Data
- `stage` set on every incident (existing 128 backfilled by rule from tactic and the record text; researchers set it on new entries).
- Ladder view = incidents grouped by tactic then ordered by stage, then by date, with the US rows marked as the focal case.
- /compare is redirected (301) to /ladders. The MCP tool `compare` becomes `ladder(tactic, stage?, from?, to?)`.
