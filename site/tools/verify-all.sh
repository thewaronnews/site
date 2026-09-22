#!/usr/bin/env bash
# Live verification (spec 11, L-134): real requests with UA twon-verify/1.0,
# recording status, content type and byte size for every page in HTML, .md
# and .json, the discovery files, feeds, sitemaps, the stylesheet, and the
# http->https and www->apex redirects.
# Usage: verify-all.sh [base] [incident_slug]
set -uo pipefail
BASE="${1:-https://thewaronnews.com}"
INC="${2:-2026-white-house-bans-cnn-msnow-politico}"
UA="twon-verify/1.0"
FAILS=0
row() { printf '%-4s %-48s %-40s %8s\n' "$1" "$2" "$3" "$4"; }
get() {
  local path="$1" want="${2:-200}" out
  out=$(curl -sS -m 30 -A "$UA" -o /tmp/twon-verify.$$ -w '%{http_code} %{content_type} %{size_download}' "$BASE$path")
  set -- $out
  row "$1" "$path" "$2" "$3"
  [ "$1" = "$want" ] || FAILS=$((FAILS+1))
}
PAGES="/ /incidents /incidents/$INC /actors /actors/donald-trump /outlets /outlets/cnn /journalists /cases /timeline /timeline/2025 /timeline/actor/donald-trump /timeline/type/access_ban /timeline/country/us /news /glossary /glossary/hard-pass /claims/1 /sources/1 /changes /corrections /corrections/log /about /methodology /editorial-policy /data /feeds /mcp /search"
echo "== pages in three formats =="
for p in $PAGES; do
  if [ "$p" = "/" ]; then get /; get /index.md; get /index.json; continue; fi
  get "$p"; get "$p.md"; get "$p.json"
done
echo "== discovery, feeds, sitemaps, assets =="
for p in /robots.txt /llms.txt /llms-full.txt /sitemap.xml /sitemaps/pages.xml /sitemaps/incidents.xml /sitemaps/news.xml /sitemaps/news-google.xml /sitemaps/machine.xml /assets/site.css /changes.xml /news/feed.xml /news/atom.xml /news/feed.json /incidents/feed.xml /incidents/atom.xml /incidents/feed.json /data/datapackage.json /data/data/incidents.csv /data/json/incidents.json /.well-known/mcp/server.json /.well-known/agent.json; do get "$p"; done
[ -n "${INDEXNOW_KEY:-}" ] && get "/$INDEXNOW_KEY.txt"
echo "== negotiation =="
for a in "text/markdown" "application/json"; do
  row "$(curl -sS -m 30 -A "$UA" -H "Accept: $a" -o /dev/null -w '%{http_code}' "$BASE/incidents/$INC")" "Accept: $a" "$(curl -sS -m 30 -A "$UA" -H "Accept: $a" -o /dev/null -w '%{content_type}' "$BASE/incidents/$INC")" ""
done
echo "== Link header on incident page =="
curl -sSI -m 30 -A "$UA" "$BASE/incidents/$INC" | grep -i '^link:' | head -2
echo "== redirects =="
row "$(curl -sS -m 30 -A "$UA" -o /dev/null -w '%{http_code}' "https://www.${BASE#https://}/about")" "https://www -> $(curl -sS -m 30 -A "$UA" -o /dev/null -w '%{redirect_url}' "https://www.${BASE#https://}/about")" "" ""
H=$(curl -sS -m 20 -A "$UA" -o /dev/null -w '%{http_code} %{redirect_url}' "http://${BASE#https://}/" 2>&1) || true
row "${H%% *}" "http:// -> ${H#* }" "" ""
echo "== 404 and 405 =="
get /nope 404; get /nope.json 404
rm -f /tmp/twon-verify.$$
echo "failures: $FAILS"
[ "$FAILS" -eq 0 ]
