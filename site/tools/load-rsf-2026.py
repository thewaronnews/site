#!/usr/bin/env python3
"""Load RSF World Press Freedom Index 2026 ranks into countries (v3 step 2).

Input: tools/data/rsf-2026-ranks.json (43 countries, copied from
verification/rsf-2026-ranks.json; read from rsf.org/en/index on 2026-09-22),
plus EXTRA below: countries in the record that the verification file does
not cover, read from RSF's own country pages on 2026-09-22 ("Index 2026",
rank n / 180). Each source is registered with POST /admin/sources first so
the country row carries press_freedom_source_id. Idempotent.
"""
import json, os, sys, time, urllib.error, urllib.request

BASE = os.environ.get("TWON_BASE", "https://thewaronnews.com")
TOKEN = os.environ.get("TWON_TOKEN") or open(os.environ.get("TWON_TOKEN_FILE_PUBLISH", "/home/claude/.twon/admin-token-publish.txt")).read().strip()
HERE = os.path.dirname(os.path.abspath(__file__))
PUBLISHER = "Reporters Without Borders (RSF)"
SOURCES = {
    "https://rsf.org/en/index": "World Press Freedom Index 2026",
    "https://rsf.org/en/country/el-salvador": "El Salvador: World Press Freedom Index 2026",
    "https://rsf.org/en/country-czechia": "Czechia: World Press Freedom Index 2026",
}
EXTRA = [
    {"iso2": "SV", "rank": 143, "year": 2026, "source_url": "https://rsf.org/en/country/el-salvador"},
    {"iso2": "CZ", "rank": 11, "year": 2026, "source_url": "https://rsf.org/en/country-czechia"},
]


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN, "User-Agent": "twon-ops/1.0", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def main():
    rows = json.load(open(os.path.join(HERE, "data", "rsf-2026-ranks.json"))) + EXTRA
    ids = {}
    for url, title in SOURCES.items():
        st, r = call("POST", "/admin/sources", {"url": url, "title": title, "publisher": PUBLISHER, "source_kind": "dataset", "batch_label": "rsf-2026"})
        if st != 200:
            print(json.dumps({"source": url, "error": [st, r]})); return 1
        ids[url] = r["id"]
    out = []
    for row in rows:
        st, r = call("POST", f"/admin/countries/{row['iso2']}/press-freedom", {"rank": row["rank"], "year": row["year"], "source_url": row["source_url"], "source_id": ids.get(row["source_url"])})
        out.append({"iso2": row["iso2"], "rank": row["rank"], "status": st, **({"error": r} if st != 200 else {})})
        time.sleep(float(os.environ.get("TWON_SLEEP", "0.6")))
    print(json.dumps({"sources": ids, "loaded": sum(1 for o in out if o["status"] == 200), "rows": out}, indent=1))


if __name__ == "__main__":
    sys.exit(main())
