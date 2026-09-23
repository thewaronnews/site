#!/usr/bin/env python3
"""Bring three incidents' prose back in line with dates already corrected on
2026-09-22 (tools/apply-corrections-2026-09-22.py: claims 108, 109, 110).
The later editorial-v2 rewrite reintroduced the old dates in the summary and
what_happened. Only the leading "On <date>," phrase changes; is_correction.
Idempotent. Publish-scope token; never printed."""
import json, os, sys, urllib.error, urllib.request
BASE = os.environ.get("TWON_BASE", "https://thewaronnews.com")
TOKEN = os.environ.get("TWON_TOKEN") or open(os.environ.get("TWON_TOKEN_FILE_PUBLISH", "/home/claude/.twon/admin-token-publish.txt")).read().strip()
ROWS = [
    ("2025-white-house-bars-ap-gulf-of-america", "On February 16, 2025,", "On February 11, 2025,", "the exclusion of AP began on 2025-02-11 (claim 108, VOA 2025-02-12)"),
    ("2025-pentagon-issues-new-press-credentialing-rules", "On September 21, 2025,", "On September 19, 2025,", "the rules were made public on 2025-09-19 (claim 109, NPR 2025-09-20)"),
    ("2024-louisiana-enacts-police-buffer-zone-law", "On May 28, 2024,", "On May 24, 2024,", "the governor signed HB 173 on 2024-05-24 (claim 110, Louisiana Legislature bill history)"),
]
def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Authorization": "Bearer " + TOKEN, "User-Agent": "twon-ops/1.0", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read().decode() or "{}")
out = []
for slug, old, new, why in ROWS:
    st, rec = call("GET", f"/admin/records/incident/{slug}")
    patch = {k: rec[k].replace(old, new) for k in ("summary", "what_happened") if rec.get(k) and old in rec[k]}
    if not patch:
        out.append({"slug": slug, "status": "already in line"}); continue
    st, r = call("PUT", f"/admin/records/incident/{slug}", {**patch, "reason": f"Correction: prose date brought in line with the record: {why}.", "is_correction": True, "batch_label": "corrections-v2-2026-09-22"})
    out.append({"slug": slug, "fields": list(patch), "status": st, **({"error": r} if st != 200 else {"revision": r.get("revision")})})
print(json.dumps(out, indent=1))
