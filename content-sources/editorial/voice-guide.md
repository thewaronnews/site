# The War On News: voice and style guide (2026-09-22)

*This guide governs all thewaronnews.com copy from launch onward: incident entries, case pages, actor and outlet pages, explainers, News Desk notes, status lines, claim statements, glossary entries and the trust pages. Every drafting, checking and publishing agent follows it. The machine-checkable parts live in `lint-rules.json` beside this file; where the two differ, this guide wins and the JSON is fixed.*

Examples below show patterns only. Their facts come from the research files of 2026-09-22 and are not publishable as they stand: every fact on the site comes from a claims row, never from this guide.

## Who is talking, and to whom

The record speaks. Entries are written in the third person and never refer to the site, the page, the editor or "we". The trust pages (About, Methodology, Corrections, Editorial policy) speak as "we", meaning the publication, and name Peter Benes as editor and publisher.

The reader is a journalist, editor, lawyer, law student, researcher or teacher who needs to know what happened, when, on whose authority, what reason was given, and where it stands now. Some readers are software: search engines, AI assistants and agents that read the Markdown and JSON twins or call the MCP server and lift single passages. Both kinds of reader need the same thing, which is a sentence that is correct on its own.

## Gold standard

No entries are published yet. Until the editor names published gold-standard pages after the P1 review, the News Desk example and the "after" versions in this guide are the model. The anchor entry (the September 2026 White House hard-pass deactivations for CNN, MS NOW and Politico reporters) will be the first named gold page once it passes review.

## Voice principles

1. **The title carries the point of view; the entries do not.** The site's name and subtitle set the subject. Every sentence inside an entry should read the same on a site called "White House Press Access Records". *On September 19, 2026, reporters from CNN, MS NOW and Politico were denied entry at the White House gates.*
2. **Every statement about an actor is a sourced fact or a quotation.** If a sentence about a person, office, outlet or government is neither, cut it. The test: can you point to the claims row that supports it?
3. **Date everything.** Every event sentence carries its date the first time it appears in a paragraph. Every status line carries "as of" and a date. Never use words that rot: recently, currently, yesterday, last week, this week, earlier this month.
4. **Past tense for events, present tense for status and for what documents say.** *The outlets sued on September 21, 2026. The case is pending. The complaint alleges violations of the First and Fifth Amendments.*
5. **Name the office and the person.** First reference gives the office held at the time of the action and the full name: *President Donald Trump*, *FCC Chairman Brendan Carr*, *U.S. District Judge Trevor N. McFadden*. Later references use the surname. Name the specific office that acted (the White House Press Office, the Secret Service, the Department of Defense) rather than "the administration", and use "the Trump administration" or "the Obama administration" only when the source attributes the action to the administration as a whole.
6. **Use the source's verb, never a stronger one.** Deactivated is not revoked. Denied entry is not banned. Restricted is not barred. Proposed is not enacted. Threatened is not did. If the primary document says "suspended", the entry says "suspended". The verbs of record are: announced, said, wrote, posted, testified, signed, issued, ordered, deactivated, suspended, revoked, denied, barred, restricted, cut, rescinded, subpoenaed, charged, detained, arrested, expelled, filed, sued, alleged, ruled, held, granted, stayed, vacated, dismissed, settled.
7. **No adjectives or adverbs of judgment.** Size, speed and rarity are stated with numbers, dates and attributed comparisons. Not "a sweeping new policy" but *a [number]-page policy covering [what it covers]*. Not "abruptly" but *[time] after the announcement*. Not "unprecedented" but *the first [action] since [year], according to [named source]*.
8. **No motive attribution.** Never write why an actor acted unless the actor said why, and then quote it. "In retaliation for", "to punish", "angered by", "in response to critical coverage" and "in an effort to silence" are forbidden in the site's own voice. A complaint may allege retaliation; the entry then says so, attributed and quoted.
9. **Quote the action's stated justification and the response, verbatim.** The order in an entry is action, stated justification, response. The justification gets at least the prominence of the objection to it.
10. **Say what is not known, in terms of the record.** Name who has not said what, and as of when. *The White House has not said whether the reporters may apply for day passes (as of 2026-09-22).* Never "it is unclear", never "we could not verify". The site's method lives on the Methodology page, not in entries.
11. **Write every paragraph to stand alone.** Paragraphs are lifted into feeds, MCP responses and AI answers one at a time. Repeat the full name, the outlet and the date rather than "this move", "the above", "the ban" with nothing before it.
12. **Plain words, short sentences, one idea per paragraph.** Two to five sentences per paragraph. Canadian spelling in the site's own copy (licence, colour, defence, centre, judgment, with -ize endings); proper names keep their owners' spelling (Department of Defense, Reporters Committee for Freedom of the Press); quotations keep the speaker's spelling.

## Names, titles and style points

The site's own name is always written **The War On News**, capital T and capital O, even mid-sentence. The subtitle is "A dated record of government actions that limit reporting."

Outlets are named as they were named at the time of the event, with the later name and the date of the change in parentheses where it has changed: *MSNBC (renamed MS NOW in [month year])*. All-capital wordmarks are set in title case (Politico), initialisms stay as they are (CNN, MS NOW, NPR, AP on second reference after "the Associated Press").

Judges are identified by court and title. Do not mention which president appointed a judge unless the source makes the appointment itself the subject; if it is mentioned for one judge in an entry, it is mentioned for every judge in that entry.

Cases are cited by caption, court, docket number and filing date the first time: *Cable News Network, Inc. v. Trump, No. 1:26-cv-03287 (D.D.C., filed September 21, 2026)*. Later references may use the short caption.

Dates in prose are written out in full: *September 19, 2026*, never "Sept. 19" or "9/19". Status lines, claims rows, timestamps and data use ISO 8601: *2026-09-19*. Ranges in prose use "to": *2017 to 2021*.

## Entry structure

Incident entries use these H2s, in this order, and omit any that have nothing sourced to hold: What happened; Stated reason; Response; Effect on reporting; Status; Legal context; What is not known; Sources. Headings are plain labels. They never characterize ("The fallout", "A chilling message") and never mention verification.

Entry titles are noun phrases with a date, not headlines with a verb: *White House hard-pass deactivations for CNN, MS NOW and Politico reporters, September 2026*. Case page titles are the case caption and year.

## Sentence patterns for incident summaries

The summary is the first paragraph of an entry and the text served as its description in feeds and JSON. It has three to four sentences and uses these patterns.

**Action:** On [date], [office] [full name] [verb of record] [object], [according to source, where the source is not a primary document].
*On September 18, 2026, President Donald Trump announced on Truth Social that CNN, MS NOW and Politico would be barred from the White House.*

**Stated reason:** [Name]'s [statement/post/memo] [said/cited] "[verbatim justification]."
*The post cited "FICTION and LIES" and did not name a specific story, according to NPR.*

**Effect on reporting:** [Who] [can no longer / must now] [concrete change in access, credential, funding, legal standing or physical ability], as of [date].
*The reporters no longer hold the hard passes that let credentialed journalists enter the White House grounds without applying for daily access.*

**Status:** [Current state], as of [date]. [Case caption, docket, pending/decided].
*The case, Cable News Network, Inc. v. Trump (D.D.C. No. 1:26-cv-03287), is pending as of 2026-09-22.*

## News Desk notes

A News Desk note is 60 to 120 words and covers, in this order: what happened, who did it (office and name), the stated reason quoted verbatim, what changed for reporting, and a link to the primary report. It adds a status sentence when a case or rule is involved, and ends with the link. It has no headline adjectives, no opinion and no conclusion. Its title follows the entry-title pattern.

*Example (99 words):*

> On September 18, 2026, President Donald Trump announced on Truth Social that CNN, MS NOW and Politico would be barred from the White House. The post cited "FICTION and LIES" and did not name a specific story, according to NPR. On September 19, reporters from the three outlets were denied entry at the White House gates; MS NOW's Akayla Gardner was told her badge was "disabled." The reporters no longer hold hard passes, which let credentialed journalists enter the grounds without daily clearance. The outlets sued on September 21 (D.D.C. No. 1:26-cv-03287). The case is pending. [Read NPR's report](https://www.npr.org/2026/09/19/nx-s1-5974854/trump-cnn-msnow-politico-ban).

The link goes to the primary report: the outlet that reported the event first-hand, or the document itself. It is never an aggregator, an advocacy summary or another note on this site.

## Status lines

A status line is one line, present tense, with a date. Format: `Status as of YYYY-MM-DD: [state]. [Detail].`

*Status as of 2026-09-22: In effect. Challenged in Cable News Network, Inc. v. Trump, D.D.C. No. 1:26-cv-03287 (pending; hearing scheduled for 2026-09-23).*

Incident states are a fixed vocabulary: In effect; Partly in effect; Suspended by court order; Rescinded; Expired; Ended (access or funding restored); Not publicly stated. Case states are: Pending; Decided (appeal period open); On appeal; Final; Dismissed; Settled. A new status line supersedes the old one, and the old one stays in the entry's history.

## Claim statements

A claim statement is one fact, in one sentence, supported entirely by its verbatim quotation (300 characters or fewer) from one source. A reader holding only the quotation should agree the statement is true.

Pattern: *[On date,] [actor with office] [verb of record] [object][, according to source].*

Rules. One fact per claim: do not join two facts from different sources with "and". The statement may not be stronger than the quotation: if the source says "deactivated", the claim says "deactivated". When the source is not a primary document, the statement carries the attribution (*according to ABC News*). Claim statements are served alone by the JSON twins and the MCP server, so each has full names, offices and dates and no pronouns that point outside it.

*On 2026-09-19, MS NOW reporter Akayla Gardner was denied entry at the White House and told her badge was "disabled," according to ABC News.*

## Saying what is not known

Where a reader would expect a fact and the record does not hold it, say so in one sentence under "What is not known", naming the party who has not said and the date. Patterns:

*[Actor] has not said [X] (as of [date]).*
*No court has ruled on [X] (as of [date]).*
*[Outlet] reported [X]; [actor] has not confirmed it (as of [date]).*

Never publish an unsourced report in order to say it is unconfirmed. If a rumour fails the inclusion threshold, it does not appear at all.

## Quoting officials and outlets fairly

Quote the action and the stated justification, both verbatim. If an official gave a reason, the reason is quoted in the entry, in the words used, at the length needed to carry it (up to the 300-character claim limit), with the medium and date: *in a post on Truth Social on September 18, 2026*. Do not paraphrase a justification, and do not choose the least flattering fragment when a full sentence is available.

If no reason was given, say so with a date: *The White House did not give a reason in its announcement.* Only write this when the announcement itself is the source.

Quote the response of the affected outlet or journalist the same way, after the justification. Outlet statements are the outlet's account and are attributed as such.

Keep the speaker's capitals, spelling and grammar. Never add "[sic]" to a public official's or outlet's words; it reads as a comment.

The site never rebuts a justification in its own voice. If a court or a named fact-checker has addressed it, that finding is a separate claim, attributed: *PolitiFact rated the claim "Mostly False" on September 21, 2026.*

When an official characterizes the press ("dishonest", "fake news", "enemy of the people"), the words appear only in quotation marks, attributed and dated, exactly as when an outlet characterizes an official ("censorship", "retaliation"). The rule is the same in both directions.

## The site's own name

"The War On News" is a title, the way a book's title is a title. It is never an argument inside the copy.

Do not use the name, or "war on" in any form, as a description of events: not "another front in the war on news", not "the latest salvo", not "the war on the press escalated". Do not use military metaphors anywhere in the site's voice (front, battle, fight, salvo, siege, crosshairs, weaponize, under fire, escalation). A lawsuit is a lawsuit, not a legal battle.

The name appears in running copy only as the publication's name: on the trust pages, in the licence credit line, in feed and data metadata. Entries never mention it. Lint exempts the exact string "The War On News" and nothing else.

## Global cases without false equivalence

Each jurisdiction is described on its own legal terms: its constitution or charter, its statute (original-language title first, then an English translation, with the translation's source), its regulator, its courts and its procedure. The First Amendment is a U.S. provision and is never used to measure another country. Canada has section 2(b) of the Charter of Rights and Freedoms; the United Kingdom has Article 10 of the European Convention on Human Rights through the Human Rights Act 1998; Hungary has its own Fundamental Law and media statutes.

Comparisons are made by setting facts side by side, each dated and sourced, never by likeness words ("like", "echoes", "mirrors", "the same playbook", "following in the footsteps of"). Do not rank countries in the site's voice. Rankings by others, such as RSF's World Press Freedom Index, are attributed with their year and method.

## Punctuation: no em dashes, anywhere

The site's copy contains no em dashes (U+2014), no horizontal bars (U+2015), no double hyphens used as dashes and no spaced hyphens used as dashes. This applies to every page, title, note, status line, alt text, feed item and data description. Replacements:

A full stop, when the dash joined two statements. This is the most common fix: *The passes were deactivated on September 19, 2026. The outlets sued two days later.*

A colon, when the dash introduced an explanation or a list: *One thing changed at the gate: the badges no longer worked.*

Parentheses, when the dash set off a reference or a short aside: *The case (D.D.C. No. 1:26-cv-03287) is assigned to Judge Timothy J. Kelly.*

A pair of commas, when the aside is short and has no commas of its own: *The hearing, scheduled for September 23, 2026, is the first in the case.*

The word "to", for ranges: *2017 to 2021*, *pages 4 to 9*. En dashes are not used in prose either.

Quotations: the stored claim keeps the source's exact text, dashes included, because it is data. In copy, quote the part of the sentence before or after the dash, or split it into two quoted fragments. Never type a dash into a quotation and never change a word.

## Banned phrases (outside quotation marks)

Every lint rule applies only to the site's own words. Text inside quotation marks and blockquotes is verbatim and is never changed. The full list with replacements is in `lint-rules.json`; the groups are:

**Characterizing frames**, replaced by the specific verb of record: "attack on" (action affecting), "assault on" (action affecting), "crackdown" (restrictions), "cracked down on" (restricted), "war on" (except the site's name), "legal battle" and "legal fight" (lawsuit), "showdown" and "feud" (dispute), "press freedom violation" (incident), "regime" (government or administration).

**Loaded verbs of speech**, replaced by "said", "wrote" or "posted": slammed, blasted, lashed out, railed against, claimed, admitted, conceded, insisted, touted, doubled down.

**Vague sourcing**, replaced by a named source: "reportedly", "sources say", "critics say", "observers note", "many believe", "it is widely reported".

**Relative time**, replaced by a date: recently, currently, yesterday, last week, this week, earlier this month.

**Process talk and uncertainty fillers**, replaced by a record statement or cut: "we could not verify", "we couldn't confirm", "it is unclear", "remains to be seen", "time will tell", "only time will tell".

**AI tells and filler**, cut: genuinely, honestly, straightforward, "to be honest", "it's worth noting", "notably", "importantly", "crucially", "in a move that", "sent shockwaves", "sparked outrage", "raises questions", "underscores", "a stark reminder", "delve".

## Quotation-only words

These words characterize an actor or an action. They may appear on the site only inside quotation marks, attributed to a named speaker or document with a date. There is no neutral replacement: quote the source that used the word, or cut it and state the fact.

attack, attacks, assault, assaults (as a description of policy; a charge or allegation of physical assault is quoted from the charging document or report), censorship, censor, censored, muzzle, muzzled, gag order, silence, silencing, intimidate, intimidation, harass, harassment, punish, punishment, punitive, retaliation, retaliatory, retaliate, persecution, targeted, singled out, weaponize, weaponized, authoritarian, autocrat, autocratic, dictator, tyranny, fascist, propaganda, fake news, enemy of the people, dishonest, lies, liar, biased, corrupt, unconstitutional, illegal, unlawful, lawless, chilling, chilling effect, draconian, sweeping, unprecedented, extraordinary, controversial, landmark, brazen, blatant, egregious, shocking, stunning, alarming, troubling, disturbing, outrageous, hostile, aggressive, abrupt, abruptly, baseless, falsely, false claim, erosion, eroding, backsliding.

A banned phrase that contains one of these words ("attack on", "assault on") is reported once, as a banned phrase with its replacement. "Gag order" is quoted from the court document that uses it. "Unconstitutional", "unlawful" and "illegal" are facts only when a court holds them, and then they are quoted from the opinion: *the court held the policy "unconstitutional"*. "Retaliation" in a lawsuit is quoted from the complaint: *the complaint alleges "First Amendment retaliation"*.

## Before and after

Each "after" keeps the fact in the "before" and removes the argument. Exact days come from the claims row; where an example gives only a month, the entry gives the day.

**1. The announcement**

Before: *In a brazen attack on the free press, Trump banned CNN, MS NOW and Politico from the White House.*

After: *On September 18, 2026, President Donald Trump announced on Truth Social that CNN, MS NOW and Politico would be barred from the White House. The post cited "FICTION and LIES," according to NPR.*

**2. At the gate**

Before: *The next day the White House cracked down, stripping reporters of their passes without explanation.*

After: *On September 19, 2026, reporters from CNN, MS NOW and Politico were denied entry at the White House gates. CNN's Betsy Klein found her badge deactivated, and no reason was given at the gate, according to ABC News.*

**3. The lawsuit**

Before: *The outlets are fighting back in court against the unconstitutional ban.*

After: *On September 21, 2026, CNN, MS NOW and Politico sued President Trump and the White House in the U.S. District Court for the District of Columbia (Cable News Network, Inc. v. Trump, No. 1:26-cv-03287). The complaint alleges violations of the First and Fifth Amendments. The case is pending.*

**4. Motive**

Before: *Angered by critical coverage, Trump punished three outlets that had reported unfavourably on him.*

After: *Trump's post cited "FICTION and LIES." It did not name a specific story, and the White House has not said which reporting prompted the decision (as of 2026-09-22).*

**5. A ruling**

Before: *A judge slapped down the White House's illegal AP ban, but a divided appeals court let most of it stand.*

After: *On April 8, 2025, U.S. District Judge Trevor N. McFadden granted the Associated Press a preliminary injunction, holding that the government "cannot then shut those doors to other journalists because of their viewpoints." On June 6, 2025, a D.C. Circuit panel stayed the injunction in part, 2 to 1, as to the Oval Office and Air Force One, and left it in place for the East Room.*

**6. A walkout**

Before: *Nearly the entire Pentagon press corps walked out rather than sign Hegseth's draconian gag order.*

After: *In September 2025, the Department of Defense issued credentialing rules that required reporters to acknowledge limits on soliciting and reporting unreleased information. In October 2025, most credentialed news organizations declined to sign and turned in their credentials, according to [source].*

**7. A global comparison**

Before: *Like Orbán's Hungary, America is sliding toward authoritarian control of the press.*

After: *Hungary's 2010 media laws created the Media Council of the National Media and Infocommunications Authority, whose members are elected by the National Assembly. In the United States, White House press credentials are issued by the White House under rules it sets, within the limits the D.C. Circuit described in Sherrill v. Knight (1977).*

**8. What is not known**

Before: *It is unclear whether the ban will ever be lifted, and we could not verify reports that more outlets are next.*

After: *The White House has not said whether the restriction has an end date (as of 2026-09-22). A hearing is scheduled for September 23, 2026, in D.D.C. No. 1:26-cv-03287.* (The unverified report about other outlets is cut. It does not meet the inclusion threshold, so it does not appear.)

## Checklist before a draft leaves the agent

Every sentence about an actor maps to a claims row or a quotation. Every event has a date. Every status line has "as of". The stated justification is quoted, or its absence is dated. Office and name on first reference. The verb matches the source. No banned phrase or quotation-only word outside quotation marks. No em dashes. "What is not known" names who has not said what. The primary report is linked. The site's name appears nowhere in the entry.
