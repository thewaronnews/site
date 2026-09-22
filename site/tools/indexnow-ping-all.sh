#!/usr/bin/env bash
# indexnow-ping-all.sh — fetch sitemap(s), submit all <loc> URLs to the
# shared IndexNow gateway (api.indexnow.org), which fans out to Bing,
# Yandex, Naver, Seznam and Yep. Does not touch the Worker or KV.
#
# Usage:
#   site/tools/indexnow-ping-all.sh [--dry-run] [--only-new FILE]
#
#   --dry-run          Print the URL count and first 10 URLs; send nothing.
#   --only-new FILE     Submit only URLs not already listed in FILE (one
#                        URL per line), then append the newly-submitted
#                        URLs to FILE. On --dry-run, FILE is not modified.
#
# Requires: bash, curl, python3.

set -euo pipefail

HOST="rattlesnakesbymail.com"
BASE="https://${HOST}"
ENDPOINT="https://api.indexnow.org/indexnow"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
KEY_FILE="${ROOT_DIR}/indexnow-key.txt"
LOG_FILE="${ROOT_DIR}/claims/indexnow-log.md"

DRY_RUN=0
ONLY_NEW_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --only-new)
      ONLY_NEW_FILE="${2:-}"
      if [ -z "$ONLY_NEW_FILE" ]; then
        echo "error: --only-new requires a FILE argument" >&2
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      sed -n '2,17p' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ ! -f "$KEY_FILE" ]; then
  echo "error: key file not found: $KEY_FILE" >&2
  exit 1
fi
KEY="$(tr -d '[:space:]' < "$KEY_FILE")"
if [ -z "$KEY" ]; then
  echo "error: key file is empty: $KEY_FILE" >&2
  exit 1
fi
KEY_LOCATION="${BASE}/${KEY}.txt"

fetch_locs() {
  local url="$1"
  local code body
  body="$(curl -sS -w '\n%{http_code}' "$url" 2>/dev/null || true)"
  code="$(printf '%s' "$body" | tail -n1)"
  if [ "$code" != "200" ]; then
    return 1
  fi
  printf '%s' "$body" | sed '$d' | grep -o '<loc>[^<]*</loc>' | sed -e 's/<loc>//' -e 's/<\/loc>//'
}

ALL_URLS_FILE="$(mktemp)"
DEDUPED_FILE="$(mktemp)"
NEW_FILE=""
cleanup() { rm -f "$ALL_URLS_FILE" "$DEDUPED_FILE"; [ -n "$NEW_FILE" ] && rm -f "$NEW_FILE"; true; }
trap cleanup EXIT

if ! fetch_locs "${BASE}/sitemap.xml" >> "$ALL_URLS_FILE"; then
  echo "error: ${BASE}/sitemap.xml did not return 200" >&2
  exit 1
fi

# Optional second sitemap; only fetched if the main one succeeded.
if curl -sS -o /dev/null -w '%{http_code}' "${BASE}/sitemap-machine.xml" 2>/dev/null | grep -q '^200$'; then
  fetch_locs "${BASE}/sitemap-machine.xml" >> "$ALL_URLS_FILE" || true
fi

# De-duplicate, preserving order of first appearance.
awk '!seen[$0]++' "$ALL_URLS_FILE" > "$DEDUPED_FILE"

TOTAL_COUNT="$(wc -l < "$DEDUPED_FILE" | tr -d ' ')"

SUBMIT_FILE="$DEDUPED_FILE"
if [ -n "$ONLY_NEW_FILE" ]; then
  if [ -f "$ONLY_NEW_FILE" ]; then
    NEW_FILE="$(mktemp)"
    grep -vFf "$ONLY_NEW_FILE" "$DEDUPED_FILE" > "$NEW_FILE" || true
    SUBMIT_FILE="$NEW_FILE"
  fi
fi

# Cap at 10000 per IndexNow's limit.
head -n 10000 "$SUBMIT_FILE" > "${SUBMIT_FILE}.capped"
mv "${SUBMIT_FILE}.capped" "$SUBMIT_FILE"
SUBMIT_COUNT="$(wc -l < "$SUBMIT_FILE" | tr -d ' ')"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "dry-run: ${SUBMIT_COUNT} URL(s) would be submitted (of ${TOTAL_COUNT} total found)"
  head -n 10 "$SUBMIT_FILE"
  exit 0
fi

if [ "$SUBMIT_COUNT" -eq 0 ]; then
  echo "nothing to submit (0 URLs)"
  NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "$(dirname "$LOG_FILE")"
  echo "- ${NOW} count=0 status=skipped" >> "$LOG_FILE"
  exit 0
fi

PAYLOAD="$(python3 - "$HOST" "$KEY" "$KEY_LOCATION" "$SUBMIT_FILE" <<'PY'
import json, sys
host, key, key_location, urls_file = sys.argv[1:5]
with open(urls_file) as f:
    urls = [line.strip() for line in f if line.strip()]
print(json.dumps({"host": host, "key": key, "keyLocation": key_location, "urlList": urls}))
PY
)"

HTTP_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d "$PAYLOAD")"

echo "status=${HTTP_STATUS} count=${SUBMIT_COUNT}"

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$(dirname "$LOG_FILE")"
echo "- ${NOW} count=${SUBMIT_COUNT} status=${HTTP_STATUS}" >> "$LOG_FILE"

if [ -n "$ONLY_NEW_FILE" ]; then
  cat "$SUBMIT_FILE" >> "$ONLY_NEW_FILE"
  TMP_TRACK="$(mktemp)"
  awk '!seen[$0]++' "$ONLY_NEW_FILE" > "$TMP_TRACK"
  mv "$TMP_TRACK" "$ONLY_NEW_FILE"
fi
