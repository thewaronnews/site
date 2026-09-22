#!/usr/bin/env bash
# P0.5 verification: exports to R2 + GitHub, the /data views, and the admin
# API. Every request to rattlesnakesbymail.com carries User-Agent
# rsbm-smoke/1.0 so this traffic never pollutes the ledger, the instrument's
# per-entity counts, or the questions table (index.js, logger.js and
# routes.js all special-case this UA prefix and skip logging it).
#
# Reads secrets.env (Cloudflare + GitHub) and admin-token.txt (never
# printed). Uses temp files for every HTTP response body/headers instead of
# embedding status codes inline, so binary-safe and free of shell-quoting
# surprises across macOS's BSD userland (grep here has no -P; that check
# below uses python3 instead).

set -uo pipefail
cd "$(dirname "$0")/../.."   # repo root (rattlesnakesbymail.com/)

SECRETS_FILE="${SECRETS_FILE:-}"
if [ -z "$SECRETS_FILE" ]; then
  for f in secrets.env "$HOME/.crank2/secrets.env" /home/claude/.crank2/secrets.env; do
    if [ -f "$f" ]; then SECRETS_FILE="$f"; break; fi
  done
fi
if [ -z "$SECRETS_FILE" ] || [ ! -f "$SECRETS_FILE" ]; then
  echo "verify-p05.sh: no secrets file found" >&2
  exit 1
fi
set -a
. "$SECRETS_FILE"
set +a

ADMIN_TOKEN_FILE="admin-token.txt"
if [ ! -f "$ADMIN_TOKEN_FILE" ]; then
  echo "verify-p05.sh: $ADMIN_TOKEN_FILE not found; run site/tools/issue-admin-token.sh first" >&2
  exit 1
fi
ADMIN_TOKEN=$(cat "$ADMIN_TOKEN_FILE")

ORIGIN="https://rattlesnakesbymail.com"
UA="rsbm-smoke/1.0"
CF_API="https://api.cloudflare.com/client/v4"
CF_AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
GH_API="https://api.github.com"
GH_AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
D1_UUID="92b99e81-233c-4c97-b787-d8eb71ef876d"
WORKER_NAME="rsbm-site"

TMPDIR_V=$(mktemp -d)
trap 'rm -rf "$TMPDIR_V"' EXIT

PASS=0
FAIL=0
note() { echo; echo "=== $* ==="; }
ok()   { PASS=$((PASS+1)); echo "PASS: $*"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $*"; }

# req METHOD URL [curl-args...]
# Sets RESP_CODE, RESP_CT, RESP_BODY (file path), RESP_HEADERS (file path).
REQ_N=0
req() {
  local method="$1"; shift
  local url="$1"; shift
  REQ_N=$((REQ_N+1))
  local bodyfile="$TMPDIR_V/body_$REQ_N"
  local headerfile="$TMPDIR_V/headers_$REQ_N"
  RESP_CODE=$(curl -sS -A "$UA" -X "$method" -D "$headerfile" -o "$bodyfile" -w '%{http_code}' "$@" "$url")
  RESP_CT=$(grep -i '^content-type:' "$headerfile" | tail -n1 | cut -d: -f2- | tr -d '\r' | sed 's/^ //')
  RESP_BODY="$bodyfile"
  RESP_HEADERS="$headerfile"
}
site_req()  { req "$1" "$2" "${@:3}"; }
admin_req() { local m="$1" u="$2"; shift 2; req "$m" "$u" -H "Authorization: Bearer $ADMIN_TOKEN" "$@"; }

d1_query() {
  curl -sS "${CF_AUTH[@]}" -H "Content-Type: application/json" -X POST \
    "$CF_API/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/$D1_UUID/query" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"sql": sys.argv[1]}))' "$1")"
}
d1_count() { d1_query "SELECT COUNT(*) c FROM $1" | jq -r '.result[0].results[0].c'; }

TODAY=$(date -u +%Y-%m-%d)

# ---------- 1. manual export, R2 + GitHub ----------
note "1. POST /admin/export (manual)"
admin_req POST "$ORIGIN/admin/export"
[ "$RESP_CODE" = "200" ] && ok "POST /admin/export returned 200" || bad "POST /admin/export returned $RESP_CODE"
jq '{id,kind,r2_key,github_commit,row_counts,note}' "$RESP_BODY"
COMMIT1_SHA=$(jq -r '.github_commit // empty' "$RESP_BODY")
KIND1=$(jq -r '.kind' "$RESP_BODY")
[ "$KIND1" = "manual" ] && ok "exports row kind = manual" || bad "exports row kind = $KIND1, expected manual"
if [ -n "$COMMIT1_SHA" ]; then ok "exports row carries a github_commit sha ($COMMIT1_SHA)"; else bad "exports row github_commit is empty on the first run"; fi

if [ -n "$COMMIT1_SHA" ]; then
  GH_COMMITS=$(curl -sS "${GH_AUTH[@]}" "$GH_API/repos/$GITHUB_ORG/$GITHUB_REPO/commits")
  if echo "$GH_COMMITS" | jq -e --arg sha "$COMMIT1_SHA" '[.[].sha] | index($sha) != null' >/dev/null; then
    ok "commit $COMMIT1_SHA appears in the GitHub commit list"
  else
    bad "commit $COMMIT1_SHA NOT found in the GitHub commit list"
  fi
  GH_TREE=$(curl -sS "${GH_AUTH[@]}" "$GH_API/repos/$GITHUB_ORG/$GITHUB_REPO/git/trees/$COMMIT1_SHA?recursive=1")
  for want in "data/$TODAY/claims.csv" "latest/claims.json" "README.md" "LICENSE" "CITATION.cff"; do
    if echo "$GH_TREE" | jq -e --arg p "$want" '.tree[] | select(.path==$p)' >/dev/null; then
      ok "repo tree contains $want"
    else
      bad "repo tree MISSING $want"
    fi
  done
fi

# ---------- 2. /data/latest views ----------
note "2. /data/latest/<table> views"
D1_CLAIMS=$(d1_count claims)

site_req GET "$ORIGIN/data/latest/claims.json"
[ "$RESP_CODE" = "200" ] && ok "/data/latest/claims.json 200" || bad "/data/latest/claims.json returned $RESP_CODE"
[[ "$RESP_CT" == application/json* ]] && ok "/data/latest/claims.json content-type $RESP_CT" || bad "/data/latest/claims.json content-type $RESP_CT"
CLAIMS_JSON_ROWS=$(jq 'length' "$RESP_BODY" 2>/dev/null || echo parse_error)
[ "$CLAIMS_JSON_ROWS" = "$D1_CLAIMS" ] && ok "/data/latest/claims.json has $CLAIMS_JSON_ROWS rows, matches D1 ($D1_CLAIMS)" || bad "/data/latest/claims.json has $CLAIMS_JSON_ROWS rows, D1 has $D1_CLAIMS"

site_req GET "$ORIGIN/data/latest/claims.csv"
[[ "$RESP_CT" == text/csv* ]] && ok "/data/latest/claims.csv content-type $RESP_CT" || bad "/data/latest/claims.csv content-type $RESP_CT"
CLAIMS_CSV_LINES=$(wc -l < "$RESP_BODY" | tr -d ' ')
EXPECT_CSV_LINES=$((D1_CLAIMS + 1))
[ "$CLAIMS_CSV_LINES" = "$EXPECT_CSV_LINES" ] && ok "/data/latest/claims.csv has $CLAIMS_CSV_LINES lines (header + $D1_CLAIMS rows)" || bad "/data/latest/claims.csv has $CLAIMS_CSV_LINES lines, expected $EXPECT_CSV_LINES"

site_req GET "$ORIGIN/data/latest.json"
if jq -e '.row_counts and .license and .date' "$RESP_BODY" >/dev/null 2>&1; then
  ok "/data/latest.json (manifest) parses with row_counts, license, date"
else
  bad "/data/latest.json does not parse as the expected manifest"
fi
MANIFEST_CLAIMS=$(jq -r '.row_counts.claims' "$RESP_BODY" 2>/dev/null)
[ "$MANIFEST_CLAIMS" = "$D1_CLAIMS" ] && ok "manifest.row_counts.claims ($MANIFEST_CLAIMS) matches D1 ($D1_CLAIMS)" || bad "manifest.row_counts.claims ($MANIFEST_CLAIMS) != D1 ($D1_CLAIMS)"

site_req GET "$ORIGIN/data/latest/notes.json"
NOTES_ROWS=$(jq 'length' "$RESP_BODY" 2>/dev/null || echo parse_error)
[ "$NOTES_ROWS" = "0" ] && ok "/data/latest/notes.json has 0 rows (no published notes)" || bad "/data/latest/notes.json has $NOTES_ROWS rows, expected 0"

site_req GET "$ORIGIN/data/latest/questions.json"
QUESTIONS_ROWS=$(jq 'length' "$RESP_BODY" 2>/dev/null || echo parse_error)
[ "$QUESTIONS_ROWS" = "0" ] && ok "/data/latest/questions.json has 0 rows (no published questions)" || bad "/data/latest/questions.json has $QUESTIONS_ROWS rows, expected 0"

# ---------- 3. /data HTML, /data.md, JSON-LD distribution ----------
note "3. /data HTML, /data.md, JSON-LD"
site_req GET "$ORIGIN/data"
grep -q "$GITHUB_ORG/$GITHUB_REPO" "$RESP_BODY" && ok "/data HTML links the repo" || bad "/data HTML missing repo link"
grep -q "claims.json" "$RESP_BODY" && ok "/data HTML lists per-table JSON links" || bad "/data HTML missing per-table JSON links"
grep -qE "export ran on [0-9]{4}-[0-9]{2}-[0-9]{2}" "$RESP_BODY" && ok "/data HTML states the latest export date" || bad "/data HTML does not state an export date"
DATA_HTML_FILE="$RESP_BODY"

site_req GET "$ORIGIN/data.md"
if grep -qE '<[a-zA-Z][^>]*>' "$RESP_BODY"; then
  bad "/data.md contains HTML tags"
else
  ok "/data.md has no HTML tags"
fi

JSONLD_CHECK=$(python3 -c "
import re, json
html = open('$DATA_HTML_FILE', encoding='utf-8').read()
m = re.search(r'<script type=\"application/ld\+json\">(.*?)</script>', html, re.S)
if not m:
    print('NO_JSONLD')
else:
    try:
        data = json.loads(m.group(1))
        dist = data.get('distribution')
        print('OK' if isinstance(dist, list) and len(dist) > 0 else 'NO_DISTRIBUTION')
    except Exception as e:
        print('PARSE_ERROR:' + str(e))
")
[ "$JSONLD_CHECK" = "OK" ] && ok "/data Dataset JSON-LD parses and has a non-empty distribution array" || bad "/data Dataset JSON-LD check: $JSONLD_CHECK"

# ---------- 4. admin auth, notes flow, disputed change, cleanup ----------
note "4. admin auth and notes moderation flow"
site_req GET "$ORIGIN/admin/notes?status=pending"
[ "$RESP_CODE" = "401" ] && ok "GET /admin/notes without token -> 401" || bad "GET /admin/notes without token -> $RESP_CODE, expected 401"

admin_req GET "$ORIGIN/admin/notes?status=pending"
PENDING_COUNT=$(jq '.count' "$RESP_BODY")
[ "$PENDING_COUNT" = "0" ] && ok "GET /admin/notes?status=pending with token -> 200, 0 pending" || bad "GET /admin/notes?status=pending -> count $PENDING_COUNT, expected 0"

admin_req GET "$ORIGIN/admin/notes?status=rejected"
REJECTED_COUNT=$(jq '.count' "$RESP_BODY")
[ "$REJECTED_COUNT" -ge 3 ] && ok "GET /admin/notes?status=rejected -> $REJECTED_COUNT rows (the 3 smoke notes from P0.4)" || bad "GET /admin/notes?status=rejected -> $REJECTED_COUNT rows, expected >= 3"

# The 3 existing rejected smoke notes all target an entity, not a claim
# (confirmed against D1 before writing this script), so testing
# classification=contradicts against one of them would create no changes
# row -- that only happens for a note whose target is a claim. This step
# inserts one throwaway note targeting claim id 1, runs the exact admin API
# flow the spec describes against it, then deletes both the note and the
# changes row it creates, leaving no residue in the public tables.
TEST_CLAIM_ID=$(d1_query "SELECT id FROM claims ORDER BY id LIMIT 1" | jq -r '.result[0].results[0].id')
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
d1_query "INSERT INTO notes (ts, target_type, target_id, body, author_claim, status) VALUES ('$NOW_ISO','claim',$TEST_CLAIM_ID,'p05-verify throwaway note','p05-verify','rejected')" >/dev/null
TEST_NOTE_ID=$(d1_query "SELECT id FROM notes WHERE author_claim='p05-verify' ORDER BY id DESC LIMIT 1" | jq -r '.result[0].results[0].id')
echo "test note id: $TEST_NOTE_ID (target claim $TEST_CLAIM_ID)"

admin_req POST "$ORIGIN/admin/notes/$TEST_NOTE_ID" -H "Content-Type: application/json" \
  -d '{"status":"hold","reviewer_note":"P0.5 verify","classification":"contradicts"}'
CHANGE_ID=$(jq -r '.change_id // empty' "$RESP_BODY")
NOTE_STATUS_AFTER_HOLD=$(jq -r '.note.status' "$RESP_BODY")
[ "$NOTE_STATUS_AFTER_HOLD" = "hold" ] && ok "POST /admin/notes/$TEST_NOTE_ID -> status hold" || bad "note status after hold: $NOTE_STATUS_AFTER_HOLD"
if [ -n "$CHANGE_ID" ]; then
  CHANGE_ROW=$(d1_query "SELECT kind FROM changes WHERE id=$CHANGE_ID")
  CHANGE_KIND=$(echo "$CHANGE_ROW" | jq -r '.result[0].results[0].kind')
  [ "$CHANGE_KIND" = "disputed" ] && ok "changes row $CHANGE_ID created with kind disputed for claim $TEST_CLAIM_ID" || bad "changes row $CHANGE_ID has kind $CHANGE_KIND, expected disputed"
else
  bad "no change_id returned from classification=contradicts"
fi

CLAIM_STATUS_AFTER=$(d1_query "SELECT status FROM claims WHERE id=$TEST_CLAIM_ID" | jq -r '.result[0].results[0].status')
[ "$CLAIM_STATUS_AFTER" = "current" ] && ok "claim $TEST_CLAIM_ID status still current (reviewer_note did not start with DISPUTE:)" || bad "claim $TEST_CLAIM_ID status is $CLAIM_STATUS_AFTER, expected current"

admin_req POST "$ORIGIN/admin/notes/$TEST_NOTE_ID" -H "Content-Type: application/json" \
  -d '{"status":"rejected","reviewer_note":"P0.5 verify reverted"}'
NOTE_STATUS_AFTER_REVERT=$(jq -r '.note.status' "$RESP_BODY")
[ "$NOTE_STATUS_AFTER_REVERT" = "rejected" ] && ok "note $TEST_NOTE_ID reverted to rejected" || bad "note $TEST_NOTE_ID status after revert: $NOTE_STATUS_AFTER_REVERT"

if [ -n "$CHANGE_ID" ]; then
  d1_query "DELETE FROM changes WHERE id=$CHANGE_ID" >/dev/null
  echo "deleted changes row id: $CHANGE_ID"
fi
d1_query "DELETE FROM notes WHERE id=$TEST_NOTE_ID" >/dev/null
echo "deleted test note id: $TEST_NOTE_ID"

D1_CHANGES=$(d1_count changes)
[ "$D1_CHANGES" = "132" ] && ok "changes table back to 132 rows after cleanup" || bad "changes table has $D1_CHANGES rows after cleanup, expected 132"

site_req GET "$ORIGIN/changes.json"
CHANGES_COUNT_LIVE=$(jq '.changes | length' "$RESP_BODY" 2>/dev/null || echo parse_error)
echo "live /changes.json currently returns $CHANGES_COUNT_LIVE rows (route caps at 200; informational only)"

# ---------- 5. /admin/health, headers, sitemap/llms exclusion ----------
note "5. /admin/health, cache headers, sitemap/llms exclusion"
admin_req GET "$ORIGIN/admin/health"
jq -e '.counts and .last_export' "$RESP_BODY" >/dev/null && ok "/admin/health returns counts and last_export" || bad "/admin/health response missing counts or last_export"
grep -qi "cache-control: no-store" "$RESP_HEADERS" && ok "/admin/health Cache-Control: no-store" || bad "/admin/health missing Cache-Control: no-store"
grep -qi "x-robots-tag: noindex" "$RESP_HEADERS" && ok "/admin/health X-Robots-Tag: noindex" || bad "/admin/health missing X-Robots-Tag: noindex"

site_req GET "$ORIGIN/sitemap.xml"
grep -q "/admin" "$RESP_BODY" && bad "/sitemap.xml contains /admin" || ok "/sitemap.xml contains no /admin"
site_req GET "$ORIGIN/llms.txt"
grep -q "/admin" "$RESP_BODY" && bad "/llms.txt contains /admin" || ok "/llms.txt contains no /admin"

# ---------- 6. idempotence: second export, same day ----------
note "6. second POST /admin/export (idempotence)"
admin_req POST "$ORIGIN/admin/export"
jq '{kind,github_commit,note}' "$RESP_BODY"
COMMIT2=$(jq -r '.github_commit' "$RESP_BODY")
NOTE2=$(jq -r '.note // empty' "$RESP_BODY")
[ "$COMMIT2" = "null" ] && ok "second export github_commit is null" || bad "second export github_commit is $COMMIT2, expected null"
echo "$NOTE2" | grep -qi "no change" && ok "second export note explains no change since last export" || bad "second export note does not mention no change: $NOTE2"

# ---------- 7. existing routes still 200 in three formats; em dash / ** grep ----------
note "7. existing routes, three formats; em dash and ** grep"
for path in "/" "/claims" "/crawlers/gptbot" "/changes" "/method"; do
  for suffix in "" ".md" ".json"; do
    site_req GET "$ORIGIN$path$suffix"
    [ "$RESP_CODE" = "200" ] && ok "$path$suffix -> 200" || bad "$path$suffix -> $RESP_CODE"
  done
done

site_req POST "$ORIGIN/mcp" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"rsbm-smoke","version":"1.0"}}}'
[ "$RESP_CODE" = "200" ] && ok "/mcp initialize -> 200" || bad "/mcp initialize -> $RESP_CODE"
jq -e '.result.serverInfo.name' "$RESP_BODY" >/dev/null 2>&1 && ok "/mcp initialize result has serverInfo.name" || bad "/mcp initialize result missing serverInfo.name"

EMDASH_HITS=0
for path in "/.md" "/claims.md" "/crawlers/gptbot.md" "/changes.md" "/method.md" "/data.md"; do
  site_req GET "$ORIGIN$path"
  HIT=$(python3 -c "
data = open('$RESP_BODY', encoding='utf-8').read()
em_dash = chr(0x2014)
print('1' if (em_dash in data or '**' in data) else '0')
")
  if [ "$HIT" = "1" ]; then
    bad "em dash or ** found in $path"
    EMDASH_HITS=$((EMDASH_HITS+1))
  fi
done
[ "$EMDASH_HITS" = "0" ] && ok "no em dashes or ** across the markdown views checked"

# ---------- 8. Cloudflare cron + secret names ----------
note "8. Cloudflare cron schedule and secret names"
SCHEDULES=$(curl -sS "${CF_AUTH[@]}" "$CF_API/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/schedules")
CRON=$(echo "$SCHEDULES" | jq -r '.result.schedules[0].cron // .result[0].cron // empty')
[ "$CRON" = "17 3 * * *" ] && ok "cron schedule is 17 3 * * *" || bad "cron schedule is '$CRON', expected '17 3 * * *'"

SECRET_NAMES=$(curl -sS "${CF_AUTH[@]}" "$CF_API/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/secrets" | jq -r '.result[].name')
echo "$SECRET_NAMES" | grep -qx "GITHUB_TOKEN" && ok "GITHUB_TOKEN present in Worker secret list" || bad "GITHUB_TOKEN NOT in Worker secret list"
echo "$SECRET_NAMES" | grep -qx "ADMIN_TOKEN" && ok "ADMIN_TOKEN present in Worker secret list" || bad "ADMIN_TOKEN NOT in Worker secret list"

# ---------- summary ----------
echo
echo "===================================="
echo "PASS: $PASS   FAIL: $FAIL"
echo "===================================="
[ "$FAIL" = "0" ]
