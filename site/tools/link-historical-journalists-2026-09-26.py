#!/usr/bin/env python3
"""Create journalist records for people affected in the 2026-09-26 historical
incidents and link them (content-sources/research-v4/journalists-map.json).
Env: TWON_TOKEN_FILE_PUBLISH."""
import json, os, sys, urllib.request, urllib.error
from collections import defaultdict
B = "https://thewaronnews.com"
TOK = open(os.environ["TWON_TOKEN_FILE_PUBLISH"]).read().strip()

def call(m, p, b=None):
    r = urllib.request.Request(B + p, data=json.dumps(b).encode() if b is not None else None, method=m,
                               headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json", "User-Agent": "twon-ops"})
    try:
        x = json.load(urllib.request.urlopen(r, timeout=60)); return x.get("result", x)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{m} {p} {e.code} {e.read()[:600].decode()}")

def pub(n):
    x = json.load(urllib.request.urlopen(urllib.request.Request(f"{B}/data/json/{n}.json", headers={"User-Agent": "twon-ops"}), timeout=60))
    return x.get("rows", x) if isinstance(x, dict) else x

rows = json.load(open(sys.argv[1]))
outlets = {o["slug"] for o in pub("outlets")}
existing = {j["slug"] for j in pub("journalists")}
by_inc = defaultdict(list)
for r in rows:
    o = r.get("outlet_slug") if r.get("outlet_slug") in outlets else None
    if r["slug"] not in existing:
        body = {"name": r["name"], "role": r["role"], "reason": "historical research 2026-09-26", "batch_label": "historical-2026-09-26"}
        if o: body["outlet_slug"] = o
        call("PUT", f"/admin/records/journalist/{r['slug']}", body)
        call("POST", f"/admin/records/journalist/{r['slug']}/publish", {"reviewed_on": "2026-09-26"})
        existing.add(r["slug"])
    by_inc[r["incident_slug"]].append({"slug": r["slug"], "relation": r.get("relation", "affected"), **({"outlet_slug": o} if o else {})})
for inc, js in by_inc.items():
    call("PUT", f"/admin/incidents/{inc}/links", {"journalists": js, "reason": "link affected journalists"})
    print(inc, [j["slug"] for j in js])
