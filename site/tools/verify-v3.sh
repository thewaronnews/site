#!/usr/bin/env bash
# v3 live verification (ladder brief 2026-09-22): the ladder views, the
# United States chapter and the country pages in HTML, .md, .json and CSV;
# the /compare redirects; RSF ranks on the pages; the counts caveat; the MCP
# ladder tool; and no count-ranked list (tools/check-no-count-ranking.py).
# Usage: verify-v3.sh [base_url]
set -uo pipefail
BASE="${1:-https://thewaronnews.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"
UA="twon-verify/1.0"
FAIL=0
row() { printf "%-4s %-64s %-34s %s\n" "$1" "$2" "$3" "$4"; }
check() { # path expected_status
  read -r code ctype size <<<"$(curl -s -A "$UA" -o /dev/null -w "%{http_code} %{content_type} %{size_download}" "$BASE$1")"
  row "$code" "$1" "$ctype" "$size"
  [ "$code" = "${2:-200}" ] || FAIL=$((FAIL+1))
}
has() { # path needle label
  body=$(curl -s -A "$UA" "$BASE$1")
  if grep -qF -- "$2" <<<"$body"; then echo "PASS $3"; else echo "FAIL $3 ($1 lacks: $2)"; FAIL=$((FAIL+1)); fi
}
loc() { # path expected_location
  l=$(curl -s -A "$UA" -o /dev/null -w "%{http_code} %{redirect_url}" "$BASE$1")
  if [ "$l" = "301 $BASE$2" ]; then echo "PASS 301 $1 -> $2"; else echo "FAIL $1: $l (want 301 $BASE$2)"; FAIL=$((FAIL+1)); fi
}
echo "== v3 pages in three formats =="
for p in /ladders /ladders/access_ban /ladders/detention_and_violence /united-states /countries/us /countries/ru /countries /continents /continents/asia /search /leaders; do
  check "$p"; check "$p.md"; check "$p.json"
done
for q in "/ladders/detention_and_violence?stage=eliminate" "/ladders/detention_and_violence.md?stage=eliminate" "/ladders/detention_and_violence.json?stage=eliminate" \
  "/ladders/access_ban?continent=north-america&from=2025&to=2026" "/incidents?stage=silence" "/search?q=pentagon"; do check "$q"; done
echo "== CSV =="
for q in "/ladders/access_ban?format=csv" "/ladders/detention_and_violence?stage=eliminate&format=csv" "/incidents?stage=punish&format=csv" /incidents.csv; do check "$q"; done
echo "== redirects =="
loc /compare /ladders; loc "/compare?tactic=access_ban" /ladders/access_ban; loc "/compare?tactic=access_ban&from=2025&country=US" "/ladders/access_ban?from=2025"
loc "/compare?continent=europe" "/ladders?continent=europe"; loc /compare.json /ladders.json; loc /ladders/access-ban /ladders/access_ban
echo "== content =="
CAVEAT="The number of entries reflects the depth of this record, not the severity of a country"
has /ladders "$CAVEAT" "caveat on /ladders"; has /countries/us "$CAVEAT" "caveat on /countries/us"; has /countries/ru "$CAVEAT" "caveat on /countries/ru"
has /continents "$CAVEAT" "caveat on /continents"; has /continents/europe "$CAVEAT" "caveat on /continents/europe"; has "/search?q=press" "$CAVEAT" "caveat on /search"
has /countries/us "RSF 2026 rank: 64th of 180" "US RSF rank"; has /countries/ru "RSF 2026 rank: 172nd of 180" "Russia RSF rank"; has /countries/ru "https://rsf.org/en/index" "RSF source link"
has /ladders/access_ban "Focal case" "focal case marked"; has /ladders/access_ban "RSF 2026 rank" "RSF rank on ladder rows"; has "/search?q=pentagon" "RSF 2026 rank" "RSF rank in search results"
has /countries/us 'href="/united-states"' "/countries/us links the chapter"; has / 'href="/ladders"' "home links /ladders"; has / 'href="/united-states"' "home links the chapter"
has /united-states 'id="now"' "chapter: Now"; has /united-states 'id="how-it-got-here"' "chapter: How it got here"; has /united-states 'id="tactics-in-use-now"' "chapter: Tactics in use now"
has /united-states 'id="the-law"' "chapter: The law"; has /united-states 'id="sources"' "chapter: Sources"
has /united-states "White House hard-pass deactivations" "chapter: CNN case"; has /united-states "Hearing" "chapter: CNN events" || true
has /llms.txt "/ladders" "llms.txt lists ladders"; has /sitemaps/pages.xml "/ladders" "sitemap lists ladders"; has /sitemaps/incidents.xml "/ladders/access_ban" "sitemap lists each ladder"
for p in /ladders /ladders/access_ban /united-states /countries /continents /; do
  n=$(curl -s -A "$UA" "$BASE$p" | grep -ci "href=\"/compare" || true); [ "$n" -eq 0 ] && echo "PASS no 'compare' on $p" || { echo "FAIL 'compare' on $p ($n)"; FAIL=$((FAIL+1)); }
done
echo "== ladder order: focal case first within each stage =="
curl -s -A "$UA" "$BASE/ladders/access_ban.json" | python3 -c "
import json,sys
d=json.load(sys.stdin); bad=0
for st in d['stages']:
    f=[r['focal_case'] for r in st['rungs']]
    if f != sorted(f, reverse=True): bad+=1
print(('PASS' if not bad else 'FAIL'), 'focal-first order in', len(d['stages']), 'stages')
sys.exit(1 if bad else 0)" || FAIL=$((FAIL+1))
echo "== MCP =="
bash "$HERE/mcp-smoke.sh" "$BASE" | tail -1 | grep -q "failed=0" && echo "PASS mcp-smoke" || { echo "FAIL mcp-smoke"; FAIL=$((FAIL+1)); }
echo "== no count-ranked list =="
python3 "$HERE/check-no-count-ranking.py" "$BASE" >/tmp/twon-v3-count-check.json && echo "PASS no count ranking" || { echo "FAIL count ranking: $(head -c 600 /tmp/twon-v3-count-check.json)"; FAIL=$((FAIL+1)); }
echo "failures: $FAIL"
[ "$FAIL" -eq 0 ]
