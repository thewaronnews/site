#!/usr/bin/env bash
# Uploads site/assets/{img,fonts}/* to the R2 bucket twon-exports under the
# same key (assets/img/<file>, assets/fonts/<file>); the Worker serves them
# at /assets/... with a one-year immutable cache. Idempotent: re-running
# overwrites. Values from the secrets file are never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
. tools/_secrets.sh
R2_NAME="twon-exports"
ctype() { case "$1" in *.webp) echo image/webp;; *.jpg) echo image/jpeg;; *.png) echo image/png;; *.svg) echo image/svg+xml;; *.woff2) echo font/woff2;; *.txt) echo "text/plain; charset=utf-8";; *) echo application/octet-stream;; esac; }
n=0; fail=0
for f in assets/img/* assets/fonts/*; do
  [ -f "$f" ] || continue
  res=$(curl -sS "${AUTH[@]}" -X PUT -H "Content-Type: $(ctype "$f")" --data-binary "@$f" \
    "$API/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$R2_NAME/objects/$f")
  if echo "$res" | jq -e '.success == true' >/dev/null 2>&1; then n=$((n+1)); else fail=$((fail+1)); echo "FAIL $f: $(echo "$res" | jq -c '.errors' 2>/dev/null || echo "$res" | head -c 200)"; fi
done
echo "uploaded $n files, $fail failures"
[ "$fail" -eq 0 ]
