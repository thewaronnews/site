#!/usr/bin/env bash
# verify-all.sh — operator smoke test: fetch every sitemap URL's HTML, .md
# and .json views plus a fixed list of key routes, and flag non-200s and
# machine-unfriendly content (markdown bold leaking into text, em dashes,
# "[object Object]", "undefined"). Read-only; makes no changes.
#
# Usage: site/tools/verify-all.sh
#
# Requires: bash, curl, xargs, python3.

set -uo pipefail

HOST="rattlesnakesbymail.com"
BASE="https://${HOST}"
UA="rsbm-verify/1.0 (operator smoke test)"
PARALLEL=8

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

FIXED_ROUTES=(
  "/robots.txt"
  "/sitemap.xml"
  "/sitemap-machine.xml"
  "/sitemap-index.xml"
  "/.well-known/agent.json"
  "/llms.txt"
  "/changes.xml"
  "/compare"
  "/fields"
  "/recipes"
  "/.well-known/mcp/server.json"
)

# --- gather URLs from the sitemap -------------------------------------
SITEMAP_BODY="$(curl -sS -A "$UA" "${BASE}/sitemap.xml")"
if [ -z "$SITEMAP_BODY" ]; then
  echo "FATAL: could not fetch ${BASE}/sitemap.xml"
  exit 1
fi
printf '%s' "$SITEMAP_BODY" | grep -o '<loc>[^<]*</loc>' | sed -e 's/<loc>//' -e 's/<\/loc>//' > "$WORK_DIR/sitemap_urls.txt"

# --- build the full list of view URLs to check ------------------------
VIEWS_FILE="$WORK_DIR/views.txt"
: > "$VIEWS_FILE"
while IFS= read -r loc; do
  [ -z "$loc" ] && continue
  path="${loc#${BASE}}"
  if [ "$path" = "/" ] || [ -z "$path" ]; then
    echo "${BASE}/" >> "$VIEWS_FILE"
    echo "${BASE}/.md" >> "$VIEWS_FILE"
    echo "${BASE}/.json" >> "$VIEWS_FILE"
  else
    echo "${loc}" >> "$VIEWS_FILE"
    echo "${loc}.md" >> "$VIEWS_FILE"
    echo "${loc}.json" >> "$VIEWS_FILE"
  fi
done < "$WORK_DIR/sitemap_urls.txt"

: > "$WORK_DIR/fixed.txt"
for r in "${FIXED_ROUTES[@]}"; do
  echo "${BASE}${r}" >> "$WORK_DIR/fixed.txt"
done

TOTAL_VIEWS="$(wc -l < "$VIEWS_FILE" | tr -d ' ')"
TOTAL_FIXED="$(wc -l < "$WORK_DIR/fixed.txt" | tr -d ' ')"

# --- checker function, run in parallel via xargs -----------------------
check_one() {
  local url="$1"
  local ua="$2"
  local out
  out="$(curl -sS -A "$ua" -w '\nHTTPSTATUS:%{http_code}' --max-time 15 "$url" 2>/dev/null)"
  local status body
  status="$(printf '%s' "$out" | grep -o 'HTTPSTATUS:[0-9]*$' | sed 's/HTTPSTATUS://')"
  body="$(printf '%s' "$out" | sed '$d')"
  local flags=""
  [ "$status" != "200" ] && flags="${flags}NON200;"
  case "$body" in
    *'**'*) flags="${flags}BOLD;" ;;
  esac
  if printf '%s' "$body" | grep -q $'\xe2\x80\x94'; then
    flags="${flags}EMDASH;"
  fi
  case "$body" in
    *'[object Object]'*) flags="${flags}OBJOBJ;" ;;
  esac
  if printf '%s' "$body" | grep -qw 'undefined'; then
    flags="${flags}UNDEFINED;"
  fi
  printf '%s\t%s\t%s\n' "$url" "$status" "$flags"
}
export -f check_one

RESULTS_FILE="$WORK_DIR/results.tsv"
cat "$VIEWS_FILE" "$WORK_DIR/fixed.txt" | xargs -P "$PARALLEL" -I{} bash -c 'check_one "$1" "$2"' _ {} "$UA" > "$RESULTS_FILE"

# --- summarize -----------------------------------------------------------
NON200_LINES="$(awk -F'\t' '$3 ~ /NON200/' "$RESULTS_FILE")"
BOLD_LINES="$(awk -F'\t' '$3 ~ /BOLD/' "$RESULTS_FILE")"
EMDASH_LINES="$(awk -F'\t' '$3 ~ /EMDASH/' "$RESULTS_FILE")"
OBJOBJ_LINES="$(awk -F'\t' '$3 ~ /OBJOBJ/' "$RESULTS_FILE")"
UNDEFINED_LINES="$(awk -F'\t' '$3 ~ /UNDEFINED/' "$RESULTS_FILE")"

NON200_COUNT="$(printf '%s\n' "$NON200_LINES" | grep -c . || true)"
BOLD_COUNT="$(printf '%s\n' "$BOLD_LINES" | grep -c . || true)"
EMDASH_COUNT="$(printf '%s\n' "$EMDASH_LINES" | grep -c . || true)"
OBJOBJ_COUNT="$(printf '%s\n' "$OBJOBJ_LINES" | grep -c . || true)"
UNDEFINED_COUNT="$(printf '%s\n' "$UNDEFINED_LINES" | grep -c . || true)"

TOTAL_CHECKED="$(wc -l < "$RESULTS_FILE" | tr -d ' ')"

echo "verify-all: ${TOTAL_CHECKED} URLs checked (${TOTAL_VIEWS} sitemap views + ${TOTAL_FIXED} fixed routes)"
echo "non-200: ${NON200_COUNT}"
echo "bold-markdown (**): ${BOLD_COUNT}"
echo "em-dash: ${EMDASH_COUNT}"
echo "[object Object]: ${OBJOBJ_COUNT}"
echo "undefined: ${UNDEFINED_COUNT}"

if [ "$NON200_COUNT" -gt 0 ]; then
  echo "-- non-200 (up to 10) --"
  printf '%s\n' "$NON200_LINES" | head -10 | awk -F'\t' '{print $2, $1}'
fi
if [ "$BOLD_COUNT" -gt 0 ]; then
  echo "-- bold-markdown (up to 5) --"
  printf '%s\n' "$BOLD_LINES" | head -5 | awk -F'\t' '{print $1}'
fi
if [ "$EMDASH_COUNT" -gt 0 ]; then
  echo "-- em-dash (up to 5) --"
  printf '%s\n' "$EMDASH_LINES" | head -5 | awk -F'\t' '{print $1}'
fi
if [ "$OBJOBJ_COUNT" -gt 0 ]; then
  echo "-- [object Object] (up to 5) --"
  printf '%s\n' "$OBJOBJ_LINES" | head -5 | awk -F'\t' '{print $1}'
fi
if [ "$UNDEFINED_COUNT" -gt 0 ]; then
  echo "-- undefined (up to 5) --"
  printf '%s\n' "$UNDEFINED_LINES" | head -5 | awk -F'\t' '{print $1}'
fi

FAIL=0
[ "$NON200_COUNT" -gt 0 ] && FAIL=1
[ "$BOLD_COUNT" -gt 0 ] && FAIL=1
[ "$EMDASH_COUNT" -gt 0 ] && FAIL=1
[ "$OBJOBJ_COUNT" -gt 0 ] && FAIL=1
[ "$UNDEFINED_COUNT" -gt 0 ] && FAIL=1

exit $FAIL
