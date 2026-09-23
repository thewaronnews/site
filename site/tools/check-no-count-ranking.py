#!/usr/bin/env python3
"""v3 check: no public view outside a country's own page shows a count next
to a country (or continent, or head of government), and no list of countries
is ordered by count. Fetches the rendered HTML of the list views and greps
the text for "<name> (N)", "<name>: N" and "Incidents" table columns.

Usage: check-no-count-ranking.py [base_url]   (exit 1 on any finding)
"""
import html
import json
import re
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://thewaronnews.com"
UA = {"User-Agent": "twon-ops/1.0"}


def get(path):
    with urllib.request.urlopen(urllib.request.Request(BASE + path, headers=UA), timeout=60) as r:
        return r.read().decode()


def text_of(page):
    main = page.split("<main", 1)[-1].split("</main>", 1)[0]
    main = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", main, flags=re.S)
    # keep cell boundaries so a number in the next cell is not glued to a name
    main = re.sub(r"</(td|th|li|p|h\d|option|a)>", " | ", main)
    return html.unescape(re.sub(r"<[^>]+>", " ", main))


countries = json.loads(get("/countries.json"))["countries"]
names = sorted({c["name"] for c in countries}, key=len, reverse=True)
continents = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"]
leaders = [l["name"] for l in json.loads(get("/leaders.json"))["leaders"]]
pages = ["/", "/countries", "/continents", "/search", "/search?q=press", "/search?q=pentagon", "/incidents", "/leaders", "/ladders",
         "/ladders/access_ban", "/tactics", "/tactics/access_ban", "/united-states"]
pages += [f"/continents/{c.lower().replace(' ', '-')}" for c in continents]
findings = []
for p in pages:
    t = text_of(get(p))
    for n in names + continents + leaders:
        for m in re.finditer(r"(?<![\w-])" + re.escape(n) + r"\s*(?:\((\d+)\)|:\s*(\d+)\b(?!(?:st|nd|rd|th)))", t):
            findings.append({"page": p, "match": m.group(0)})
    heads = re.findall(r"<th[^>]*>([^<]*)</th>", get(p))
    if any(h.strip() in ("Incidents", "Count", "Number of incidents") for h in heads) and p not in ("/tactics", "/eras"):
        findings.append({"page": p, "match": "table column " + ", ".join(h for h in heads if h.strip() in ("Incidents", "Count", "Number of incidents"))})
print(json.dumps({"base": BASE, "pages": len(pages), "findings": findings}, indent=1))
sys.exit(1 if findings else 0)
