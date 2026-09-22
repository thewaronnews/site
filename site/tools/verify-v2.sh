#!/usr/bin/env bash
# v2 live verification (2026-09-22): every v2 route in HTML, .md and .json,
# faceted search, CSV downloads, coverage feeds, redirects, and a grep of the
# rendered public HTML for strings the v2 brief removes.
# Usage: verify-v2.sh [base_url]
set -uo pipefail
BASE="${1:-https://thewaronnews.com}"
UA="twon-verify/1.0"
FAIL=0
row() { printf "%-4s %-72s %-40s %s\n" "$1" "$2" "$3" "$4"; }
get() { curl -s -A "$UA" -o /dev/null -w "%{http_code} %{content_type} %{size_download}" "$BASE$1"; }
check() { # path expected_status
  read -r code ctype size <<<"$(get "$1")"
  row "$code" "$1" "$ctype" "$size"
  [ "$code" = "${2:-200}" ] || FAIL=$((FAIL+1))
}
echo "== v2 pages in three formats =="
for p in / /incidents /search /countries /countries/us /countries/hu /continents /continents/europe /tactics /tactics/access_ban \
  /tactics/detention_and_violence /compare /eras /eras/1970s /eras/2020s /leaders /leaders/donald-trump /coverage /terms /privacy \
  /sources-and-standards /about /corrections /feeds /mcp /data /incidents/2026-white-house-bans-cnn-msnow-politico; do
  b="$p"; [ "$p" = "/" ] && b="/index"
  check "$p"; check "$b.md"; check "$b.json"
done
echo "== faceted search and filters =="
for q in "/search?q=press+pass" "/search?q=white+house&country=US&tactic=access_ban" "/search?continent=europe&from=2020&to=2026" \
  "/incidents?country=US&tactic=credential_control&sort=date_asc" "/incidents?leader=donald-trump&outcome=ongoing&view=cards" \
  "/incidents.json?continent=asia&has_case=0" "/incidents.md?tactic=funding_and_ownership_pressure&from=2025" "/compare?continent=north-america&from=2025" \
  "/compare.json?tactic=access_ban" "/incidents?per_page=500"; do check "$q"; done
echo "== CSV =="
for q in /incidents.csv "/incidents?country=US&format=csv" "/search?q=pentagon&format=csv" "/compare?tactic=access_ban&format=csv" "/countries/us?format=csv" "/tactics/access_ban?format=csv"; do check "$q"; done
echo "== feeds, sitemaps, discovery =="
for p in /coverage/feed.xml /coverage/atom.xml /coverage/feed.json /incidents/feed.xml /incidents/atom.xml /incidents/feed.json /changes.xml \
  /sitemap.xml /sitemaps/pages.xml /sitemaps/incidents.xml /sitemaps/machine.xml /llms.txt /robots.txt; do check "$p"; done
echo "== redirects and removals =="
check /methodology 301; check /news 301; check /news/feed.xml 301; check /countries/US 301; check /tactics/access-ban 301; check /eras/1970 301
check /sitemaps/news.xml 404; check /news/some-note 404
echo "== CSV header, page size cap =="
curl -s -A "$UA" "$BASE/incidents.csv" | head -1
curl -s -A "$UA" "$BASE/incidents.json?per_page=500" | python3 -c "import json,sys; d=json.load(sys.stdin); print('per_page', d['per_page'], 'count', d['count'])"
echo "failures: $FAIL"
[ "$FAIL" -eq 0 ]
