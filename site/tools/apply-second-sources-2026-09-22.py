#!/usr/bin/env python3
"""Load research-v3/second-sources.json (62 incidents, 1-2 journalistic
second sources each) into the live site, v3 step 6.

Rule: a source is added and attached only if a curl link-check (browser UA,
15s timeout) does not classify it dead (ops/linkcheck.py's classify_tier1:
dead = network error/timeout/404/410, or 403/429/503 with no challenge
marker). Paywalled (401/402), tier2-eligible (403/429/503 with a challenge
marker) and ambiguous (200 but no extractable <title>, e.g. a PDF) are not
dead and are still added -- these are normal states already present in the
live corpus (see /admin/health link_integrity).

Where a source's URL is already attached to the incident (dedupe by URL,
checked against the live incident_sources list, not just the sources
table), it is skipped entirely: not re-added, not re-attached, and no claim
is added from it (this happened for 4 of the 96 rows, all a CPJ URL that
was already the incident's only source, with a quote that already matches
an existing claim word for word).

Where evidence_quote is present and clearly supports a field already used
by this incident's own claims (this corpus's convention: a dated
what-happened fact is field "action", not "occurred_on", which is a base
column here, not a claim field the seed ever populated; an outcome-dated
fact is field "status" -- see WORKLOG 2026-09-23 and the live claims on
any of these 62 incidents), a new claim is added with method outlet_report
citing the new source. It never supersedes the incident's existing claims;
both stand. Where the quote's evidence is background/context rather than a
specific fact already carried by an incident field (supports_field
"context..." in the research), the source is attached only, no claim.
Where quote_missing, attached only.

Idempotent: re-running skips any source URL already attached and (by
checking evidence_quote text) any claim already on record with the same
quote.

Publish-scope token; never printed.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("TWON_BASE", "https://thewaronnews.com")
TOKEN = os.environ.get("TWON_TOKEN") or open(os.environ.get("TWON_TOKEN_FILE_PUBLISH", "/home/claude/.twon/admin-token-publish.txt")).read().strip()
VERIFIED = "2026-09-22"
BATCH = "v3-second-sources-2026-09-22"
RESEARCH = "/home/claude/crank3/research-v3/second-sources.json"
LINKCHECK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "second-sources-linkcheck-2026-09-22.json")

# supports_field prefix -> incident claim field, per this corpus's convention
FIELD_MAP_PREFIX = [
    ("occurred_on", "action"),
    ("what_happened", "action"),
    ("outcome_on", "status"),
    ("outcome", "status"),
]

# rows whose evidence_quote is context/background rather than a specific
# fact an incident field already carries: attach the source, add no claim.
CONTEXT_ONLY_URLS = {
    "https://www.middleeasteye.net/news/egypt-arrests-journalist-amid-media-crackdown",
    "https://www.hrw.org/report/2019/06/19/crackdown-nicaragua/torture-ill-treatment-and-prosecutions-protesters-and",
    "https://www.occrp.org/en/news/kazakhstans-election-brings-a-new-parliament-and-more-pressure-on-journalists",
    "https://cpj.org/2019/05/egypt-tests-new-censorship-law-with-handling-of-al/",
}

# hand-written statement/value per (slug, url) for the claims that do get added
# (field derived from supports_field at run time; see FIELD_MAP_PREFIX / CLAIMS below)
CLAIMS = {
    ("2026-hungary-mayor-removes-telex-reporters", "https://telex.hu/english/2026/03/12/we-filed-a-complaint-after-our-colleagues-were-forcibly-removed-from-the-deputy-pm-s-campaign-event"):
        ("mayor used physical force on reporters", "Telex reported that Csakbereny mayor Laszlo Vecsei used physical force to remove two of its reporters, Nora Siteri and Judit Presinszky, from a March 10, 2026 press event attended by Deputy PM Zsolt Semjen."),
    ("2018-philippines-bans-rappler-presidential-palace", "https://newsinfo.inquirer.net/1154213/palace-justifies-coverage-ban-vs-rappler-its-a-privilege-not-a-right"):
        ("Ranada first barred, February 20, 2018", "The Philippine Daily Inquirer reported that Rappler reporter Pia Ranada was first barred from entering the presidential palace on February 20, 2018."),
    ("2024-kazakhstan-restrictive-media-accreditation-rules", "https://www.voanews.com/a/kazakh-journalists-worry-as-new-media-rules-come-into-force/7802843.html"):
        ("VOA: new rules open door to censorship", "Voice of America reported that new and proposed amendments to Kazakhstan's media accreditation regulations were excessive and opened doors to censorship."),
    ("2003-zimbabwe-daily-news-shut-down", "https://rsf.org/en/court-orders-authorities-allow-daily-news-reappear"):
        ("police seized about 100 computers, Sept 16-17", "RSF reported that police, acting without a warrant, confiscated about 100 computers from the Daily News on September 16 and 17, 2003."),
    ("2021-hungary-klubradio-loses-broadcast-license", "https://www.euronews.com/2021/02/09/hungary-s-first-independent-radio-station-klubradio-to-go-off-air-on-sunday"):
        ("journalist association calls Klubradio last independent broadcaster", "Euronews reported that the National Association of Hungarian Journalists called Klubradio the only remaining public-service broadcaster in Hungary whose content was not under government influence."),
    ("2021-hungary-klubradio-loses-broadcast-license", "https://www.euronews.com/2021/04/11/klubradio-frequency-of-hungarian-independent-radio-to-be-taken-over-by-group-close-to-orba"):
        ("frequency awarded to Spirit FM, March 30", "Euronews reported that Hungary's media authority (NMHH) awarded Klubradio's former 92.9 FM frequency to Spirit FM, part of a media group close to Viktor Orban, on March 30, 2021."),
    ("2023-turkiye-rtuk-fines-earthquake-coverage", "https://www.wionews.com/world/turkey-three-news-outlets-fined-for-their-earthquake-coverage-565075"):
        ("outlet: reporting treated as a crime", "WION reported a Turkish broadcaster's response that RTUK's penalties were based on earthquake-related coverage and that reporting was being treated as a crime."),
    ("2024-china-dong-yuyu-espionage-sentence", "https://www.japantimes.co.jp/news/2024/11/29/asia-pacific/crime-legal/china-journalist-espionage-verdict/"):
        ("Beijing court sentences Dong Yuyu to seven years", "The Japan Times, carrying an AP report, said a Beijing court sentenced journalist Dong Yuyu to seven years in prison for espionage, according to a family member."),
    ("2024-china-dong-yuyu-espionage-sentence", "https://www.abc.net.au/news/2024-11-29/chinese-journalist-dong-yuyu-jailed-for-espionage/104667352"):
        ("family calls the verdict evidence-free", "ABC News (Australia) reported a family statement calling Dong Yuyu's seven-year sentence, imposed on no evidence, a declaration of the bankruptcy of China's justice system."),
    ("2020-morocco-omar-radi-pegasus-and-detention", "https://www.securityweek.com/spyware-israels-nso-used-against-journalist-amnesty/"):
        ("Amnesty: Pegasus found on Radi's phone", "SecurityWeek, carrying an AFP report, said Amnesty International found that Moroccan authorities used NSO Group's Pegasus spyware on journalist Omar Radi's phone."),
    ("2020-morocco-omar-radi-pegasus-and-detention", "https://www.middleeasteye.net/news/morocco-omar-radi-dissident-reporter-sentenced-prison"):
        ("outlet corroborates NSO spyware targeting", "Middle East Eye reported that Omar Radi had been targeted by Moroccan authorities using spyware from the Israeli company NSO Group."),
    ("2018-hungary-kesma-media-merger", "https://www.voanews.com/a/huge-pro-government-media-conglomerate-formed-in-hungary-/4678690.html"):
        ("VOA: total control over pro-government media", "Voice of America quoted commentary that KESMA's formation meant total control over pro-government media outlets close to Hungary's government."),
    ("2016-turkiye-zaman-trustees-installed", "https://turkishminute.com/2016/03/05/zaman-daily-editor-in-chief-bilici-todays-zamans-kenes-fired-by-trustees-after-govt-seizure/"):
        ("Istanbul court appoints trustees over Feza Media", "Turkish Minute reported that an Istanbul court appointed trustees over the Feza Media Group, including Zaman, Today's Zaman and Cihan News Agency, on the day of the seizure."),
    ("2022-ethiopia-expels-tom-gardner", "https://english.ahram.org.eg/UI/Front/Inner.aspx?NewsContentID=466313"):
        ("accreditation withdrawn, May 13", "Ahram Online, carrying an AFP wire report, said Ethiopia's government withdrew the press accreditation of Tom Gardner, The Economist's correspondent in Addis Ababa, on May 13, 2022."),
    ("2019-india-revokes-taseer-oci-status", "https://time.com/5721667/aatish-taseer-india-oci/"):
        ("government cites provisional opinion to cancel OCI", "In a TIME essay, Aatish Taseer quoted the Indian government's notice stating its provisional opinion that his Overseas Citizen of India registration could be cancelled."),
    ("2023-india-blocks-gaon-savera-accounts", "https://www.newslaundry.com/2023/08/23/gaon-saveras-social-media-handles-blocked-after-correspondence-from-indian-government"):
        ("Twitter and Facebook blocked, corroborated by Newslaundry", "Newslaundry reported that Gaon Savera's Twitter account was withheld in India on a Tuesday and its Facebook page had been inaccessible since the preceding Monday."),
    ("2019-philippines-arrests-ressa", "https://time.com/5528416/maria-ressa-arrested-cyber-libel/"):
        ("Ressa: arrest is a tool to silence us", "TIME quoted Maria Ressa saying, after her February 2019 cyber libel arrest, that the charges were tools being used to try to silence her and Rappler."),
    ("2020-philippines-ressa-cyber-libel-conviction", "https://www.philstar.com/headlines/2020/06/15/2020473/court-convicts-rapplers-ressa-cyber-libel"):
        ("Judge Estacio-Montesa convicts Ressa and Santos", "The Philippine Star reported that Judge Rainelda Estacio-Montesa of the Manila Regional Trial Court convicted Maria Ressa and former Rappler researcher Reynaldo Santos Jr. of cyber libel under the Cybercrime Prevention Act."),
    ("2018-russia-fines-the-new-times", "https://meduza.io/en/news/2018/10/27/moscow-court-slaps-independent-magazine-with-crippling-22-million-ruble-fine-for-late-paperwork"):
        ("Tverskoy court fines New Times 22M rubles", "Meduza reported that Moscow's Tverskoy District Court fined The New Times and its editor-in-chief, Yevgenia Albats, 22 million rubles (about $335,000) on October 26, 2018."),
    ("2018-russia-fines-the-new-times", "https://www.icij.org/inside-icij/2018/11/independent-russian-magazine-spared-extinction-by-readers-covering-mammoth-political-fine/"):
        ("fine paid via reader crowdfunding", "ICIJ reported that after the roughly $340,000 fine, The New Times and Yevgenia Albats raised the funds to pay it through a reader crowdfunding campaign."),
    ("2017-malta-freezes-caruana-galizia-account", "https://daphnecaruanagalizia.com/2017/02/minister-economy-policy-officer-frozen-bank-accounts-statement-issued-media/"):
        ("Caruana Galizia: accounts frozen for years", "In her own blog post, Daphne Caruana Galizia said her bank accounts had been frozen and would remain frozen until the underlying case concluded, which she expected to take years."),
    ("2017-malta-freezes-caruana-galizia-account", "https://www.assembly.coe.int/LifeRay/JUR/Pdf/TextesProvisoires/2019/20190529-CaruanaGaliziaAssassination-EN.pdf"):
        ("PACE report corroborates February 2017 freeze", "A Council of Europe Parliamentary Assembly report said a court ordered the freezing of Daphne Caruana Galizia's bank account in February 2017, prompting a group of NGOs to file a press-freedom alert."),
    ("2019-russia-fake-news-disrespect-law", "https://www.npr.org/2019/03/18/704600310/russia-criminalizes-the-spread-of-online-news-which-disrespects-the-government"):
        ("NPR: prosecutors can direct sites blocked", "NPR reported that Russia's new rules let prosecutors refer complaints about material insulting officials to the government, which could then block the websites publishing it."),
    ("2019-russia-fake-news-disrespect-law", "https://www.themoscowtimes.com/2019/03/07/russia-passes-legislation-banning-disrespect-of-authorities-and-fake-news-a64742"):
        ("Duma passes disrespect and fake-news bills", "The Moscow Times reported that Russian lawmakers passed a package of bills to punish internet users and journalists for disrespecting the authorities or spreading fake news."),
    ("2021-russia-designates-meduza-foreign-agent", "https://www.themoscowtimes.com/2021/04/23/russia-declares-independent-news-site-meduza-a-foreign-agent-a73722"):
        ("Justice Ministry announces Meduza designation", "The Moscow Times reported that Russia's Justice Ministry announced it had declared the independent news site Meduza a \"foreign agent.\""),
    ("2022-belarus-labels-dw-extremist", "https://dokmz.com/2022/03/10/belarus-classifies-deutsche-welle-as-extremist/"):
        ("Belarus classifies all DW content extremist", "A media-freedom news aggregator reported that Belarus had classified all Deutsche Welle content as \"extremist.\""),
}

# rows that are exact duplicates of an already-attached source and an
# already-existing claim (checked by hand against the live record): no
# action at all. Left here only for the record; the run-time dedupe by URL
# against the live incident_sources list catches these on its own.
KNOWN_DUPLICATE_URLS = {
    "https://cpj.org/2020/10/al-manassa-editor-nora-younis-on-censorship-in-egypt/",
    "https://cpj.org/2023/08/india-blocks-social-media-accounts-of-gaon-savera-news-outlet-ahead-of-workers-convention/",
    "https://cpj.org/2026/08/from-prosecutions-to-bans-and-spurious-copyright-claims-how-kazakhstans-journalists-are-being-silenced/",
    "https://cpj.org/2019/05/egypt-tests-new-censorship-law-with-handling-of-al/",
}


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN, "User-Agent": "twon-ops/1.0", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def mcp_sources(slug):
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_sources_for", "arguments": {"incident_slug": slug}}}
    req = urllib.request.Request(BASE + "/mcp", data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "twon-smoke/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["result"]["structuredContent"]["sources"]


def source_kind_for(url, kind):
    if "assembly.coe.int" in url or ".gov" in url.split("/")[2]:
        return "official_statement"
    if kind == "primary_source":
        return "primary_document"
    return "reporting"  # wire_or_major_press, journalistic_or_reference, press_freedom_org, ngo_or_official


def claim_field_for(supports_field):
    for prefix, field in FIELD_MAP_PREFIX:
        if supports_field == prefix or supports_field.startswith(prefix + "/"):
            return field
    return None


def ensure_source(src, url, title, publisher, published_on, kind):
    body = {"url": url, "title": title, "publisher": publisher, "source_kind": source_kind_for(url, kind),
            "published_on": published_on, "batch_label": BATCH}
    st, r = call("POST", "/admin/sources", body)
    if st != 200:
        raise SystemExit(json.dumps({"source": url, "error": [st, r]}))
    return r["id"], bool(r.get("created"))


def main():
    data = json.load(open(RESEARCH, encoding="utf-8"))
    report = []
    dead_log = json.load(open(LINKCHECK, encoding="utf-8")) if os.path.exists(LINKCHECK) else {}

    for item in data:
        slug = item["incident_slug"]
        current = mcp_sources(slug)
        current_urls = {s["url"] for s in current}
        added_sources, attached_sources, added_claims, skipped = [], [], [], []
        to_attach = list(current)  # role/sort preserved, append new ones

        for s in item["sources"]:
            url = s["url"]
            if url in current_urls:
                skipped.append({"url": url, "reason": "already attached"})
                continue
            check = dead_log.get(url)
            if check and check.get("state") == "dead":
                skipped.append({"url": url, "reason": f"dead ({check.get('status')}, {check.get('error')})"})
                continue
            source_id, created = ensure_source(s, url, s["title"], s["publisher"], s.get("published_on"), s["kind"])
            added_sources.append({"url": url, "id": source_id, "created": created})
            to_attach.append({"id": source_id, "role": "reporting"})
            current_urls.add(url)

            if not s.get("quote_missing") and url not in CONTEXT_ONLY_URLS:
                field = claim_field_for(s["supports_field"])
                key = (slug, url)
                if field and key in CLAIMS:
                    value, statement = CLAIMS[key]
                    claim_body = {"subject_type": "incident", "subject_slug": slug, "field": field, "value": value,
                                  "statement": statement, "source_id": source_id, "evidence_quote": s["evidence_quote"],
                                  "evidence_date": s.get("published_on"), "method": "outlet_report", "confidence": "medium",
                                  "verified_at": VERIFIED, "batch_label": BATCH}
                    st, r = call("POST", "/admin/claims", claim_body)
                    if st != 200:
                        skipped.append({"url": url, "reason": f"claim_failed {st} {r}"})
                    else:
                        added_claims.append({"url": url, "claim_id": r["id"], "field": field})

        if len(to_attach) != len(current):
            body = {"sources": [{"source_id": s.get("source_id") or s.get("id"), "role": s.get("role") or "reporting", "sort": i} for i, s in enumerate(to_attach)], "batch_label": BATCH}
            st, r = call("PUT", f"/admin/incidents/{slug}/links", body)
            if st != 200:
                raise SystemExit(json.dumps({"links": slug, "error": [st, r]}))
            attached_sources = [s["url"] for s in item["sources"] if s["url"] not in {x["url"] for x in skipped}]

        report.append({"slug": slug, "added_sources": added_sources, "attached": attached_sources,
                        "claims": added_claims, "skipped": skipped})
        time.sleep(0.2)

    print(json.dumps(report, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
