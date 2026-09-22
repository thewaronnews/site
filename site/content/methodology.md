# Methodology

This page explains how an entry on The War On News is made, who makes it and how it is checked.

## Sources

We rank sources in three tiers. The first is primary documents and court records: complaints, opinions, orders and dockets, executive orders, agency rules and memos, transcripts, and statements or posts published by the official or office that acted. The second is original reporting by news organizations, including an affected outlet's own account of what happened to it, which is always attributed as that outlet's account. The third is secondary reports: databases, advocacy groups' reports, analysis and reference works.

A secondary report can lead us to an incident but cannot on its own establish a fact. When sources disagree, the entry gives each account, attributed, and says which one a primary document supports, if any does.

## Claims

Every fact in an entry is stored as a claim: one dated row holding the statement, the source's address, a verbatim quotation of up to 300 characters from that source, the kind of source, the date it was checked and an archived copy. A statement may not say more than its quotation supports.

Claims are never edited in place. When a fact changes or proves wrong, a new claim supersedes the old one. Both keep their own addresses, and each entry links to its history, so anyone can see what an entry said before, what it says now and when it changed.

## Who does what

The War On News is made with AI agents. Language-model agents (Anthropic's Claude models, as of September 2026) sweep news reports and court dockets for new stories, draft News Desk notes and entries, match each claim to its source and quotation, check links and archive sources. A classifier built on an open-weight model scores each candidate story for scope and sorts incoming tips and correction requests.

Peter Benes, the editor and publisher, sets policy, including this page and the voice rules the agents write to. He reviews a daily digest of everything published, reverts anything that should not have run with a single command, and answers corrections. He does not read every note before it publishes. That is a deliberate choice, and the gates below stand where a pre-publication read would.

## The gates

A News Desk note publishes automatically only if it passes every mechanical gate. The story must score as in scope. Every factual statement must have a source and a verbatim quotation. Characterizing words, such as "censorship" or "crackdown", must appear only inside quotation marks. The text must pass the voice lint, which checks for banned phrases and em dashes. Every link must be live or have an archived copy. The note must be 60 to 120 words and link to the primary report. A note that fails any gate does not publish; it waits for the editor. Incident entries, case pages and explainers pass the same gates and a further review for neutrality and sourcing before they go live.

## Link integrity

When an entry publishes, every source it cites is saved to the Internet Archive's [Wayback Machine](https://web.archive.org/), and the archived address is stored with the claim. Every night a checker visits every external link and records one of four states: live, paywalled, blocked to automated visitors, or dead. A blocked link is retried as a browser before anything is concluded. Only a dead link changes the page: it is marked "source offline since" the date it failed, beside its archived copy. Dead links are annotated. They are never removed.

## What the dates mean

Every page shows three dates. Published is when the page first appeared. Updated is the last change to its content, such as a superseding claim or a new status line. Last reviewed is the date of the most recent full review, in which every claim was read again against its source, the status line confirmed against the docket or the latest reporting, and every link rechecked. A review that finds nothing to change moves "last reviewed" and leaves "updated" alone. The nightly link check on its own does not count as a review.

## For software and data users

Every page has Markdown and JSON versions, linked from the page and available by content negotiation. The News Desk and the incident list have RSS, Atom and JSON Feed feeds. [/data](/data) holds a nightly export of every incident, actor, case, source and claim as a Frictionless Data Package (CSV and JSON with table schemas) under CC BY 4.0, also published to GitHub. A public MCP server at /mcp lets AI assistants and other software search and fetch incidents, timelines, actors, cases and News Desk notes. Its one write tool, for suggesting corrections, files a request for review and publishes nothing.
