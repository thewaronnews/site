#!/usr/bin/env bash
# P1.1 verification: scoped admin tokens (triage/publish) and the legacy
# ADMIN_TOKEN losing POST /admin/notes/<id>, per
# claims/architect-decisions-2026-09-17.md section 1 ruling 1. Every
# request carries User-Agent rsbm-smoke/1.0. Reads secrets.env and the
# three admin-token*.txt files (never printed). Inserts one throwaway
# note directly via the D1 HTTP API (target claim 1, author_claim
# p11-verify), exercises it through the full scope matrix, and deletes it
# at the end. Re-runnable.

set -uo pipefail
cd "$(dirname "$0")/../.."   # repo root (rattlesnakesbymail.com/)

SECRETS_FILE="${SECRETS_FILE:-}"
if [ -z "$SECRETS_FILE" ]; then
  for f in secrets.env "$HOME/.crank2/secrets.env" /home/claude/.crank2/secrets.env; do
    if [ -f "$f" ]; then SECRETS_FILE="$f"; break; fi
  done
fi
if [ -z "$SECRETS_FILE" ] || [ ! -f "$SECRETS_FILE" ]; then
  echo "verify-scoped-tokens.sh: no secrets file found" >&2
  exit 1
fi
set -a
. "$SECRETS_FILE"
set +a

for f in admin-token.txt admin-token-triage.txt admin-token-publish.txt; do
  if [ ! -f "$f" ]; then
    echo "verify-scoped-tokens.sh: $f not found; run site/tools/issue-scoped-admin-tokens.sh (and issue-admin-token.sh) first" >&2
    exit 1
  fi
done
LEGACY_TOKEN=$(cat admin-token.txt)
TRIAGE_TOKEN=$(cat admin-token-triage.txt)
PUBLISH_TOKEN=$(cat admin-token-publish.txt)

ORIGIN="https://rattlesnakesbymail.com"
UA="rsbm-smoke/1.0"
CF_API="https://api.cloudflare.com/client/v4"
CF_AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
D1_UUID="92b99e81-233c-4c97-b787-d8eb71ef876d"

TMPDIR_V=$(mktemp -d)
trap 'rm -rf "$TMPDIR_V"' EXIT

PASS=0
FAIL=0
note() { echo; echo "=== $* ==="; }
ok()   { PASS=$((PASS+1)); echo "PASS: $*"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $*"; }

REQ_N=0
req() {
  # req METHOD URL [TOKEN] [curl-args...]
  # Sets RESP_CODE, RESP_BODY (file path).
  local method="$1"; local url="$2"; local token="${3:-}"; shift 3 || shift $#
  REQ_N=$((REQ_N+1))
  local bodyfile="$TMPDIR_V/body_$REQ_N"
  if [ -n "$token" ]; then
    RESP_CODE=$(curl -sS -A "$UA" -X "$method" -H "Authorization: Bearer $token" -o "$bodyfile" -w '%{http_code}' "$@" "$url")
  else
    RESP_CODE=$(curl -sS -A "$UA" -X "$method" -o "$bodyfile" -w '%{http_code}' "$@" "$url")
  fi
  RESP_BODY="$bodyfile"
}

d1_query() {
  curl -sS "${CF_AUTH[@]}" -H "Content-Type: application/json" -X POST \
    "$CF_API/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/$D1_UUID/query" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"sql": sys.argv[1]}))' "$1")"
}
d1_count() { d1_query "SELECT COUNT(*) c FROM $1" | jq -r '.result[0].results[0].c'; }

# ---------- a. no token ----------
note "a. no token"
req GET "$ORIGIN/admin/health"
[ "$RESP_CODE" = "401" ] && ok "no token -> 401" || bad "no token -> $RESP_CODE"
jq -c '.error' "$RESP_BODY" 2>/dev/null

# ---------- b. garbage token ----------
note "b. garbage token"
DENIALS_BEFORE_B=$(d1_count admin_denials)
req GET "$ORIGIN/admin/health" "not-a-real-token"
[ "$RESP_CODE" = "401" ] && ok "garbage token -> 401" || bad "garbage token -> $RESP_CODE"
DENIALS_AFTER_B=$(d1_count admin_denials)
[ "$DENIALS_AFTER_B" = "$DENIALS_BEFORE_B" ] && ok "no new admin_denials row for a 401 (still $DENIALS_AFTER_B)" || bad "admin_denials grew on a 401: $DENIALS_BEFORE_B -> $DENIALS_AFTER_B"

# ---------- c. triage: GET notes, GET health ----------
note "c. triage GET notes / health"
req GET "$ORIGIN/admin/notes?status=pending" "$TRIAGE_TOKEN"
[ "$RESP_CODE" = "200" ] && ok "triage GET /admin/notes?status=pending -> 200" || bad "triage GET notes -> $RESP_CODE"
req GET "$ORIGIN/admin/health" "$TRIAGE_TOKEN"
[ "$RESP_CODE" = "200" ] && ok "triage GET /admin/health -> 200" || bad "triage GET health -> $RESP_CODE"

# ---------- insert throwaway note (target claim 1) ----------
note "insert throwaway note"
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BODY_TEXT="verification row, removed within one minute"
d1_query "INSERT INTO notes (ts, target_type, target_id, body, author_claim, status) VALUES ('$NOW_ISO','claim',1,'$BODY_TEXT','p11-verify','pending')" >/dev/null
TEST_NOTE_ID=$(d1_query "SELECT id FROM notes WHERE author_claim='p11-verify' ORDER BY id DESC LIMIT 1" | jq -r '.result[0].results[0].id')
echo "test note id: $TEST_NOTE_ID (target claim 1)"

# ---------- d. triage POST published -> 403, logged ----------
note "d. triage POST published (forbidden)"
DENIALS_BEFORE_D=$(d1_count admin_denials)
req POST "$ORIGIN/admin/notes/$TEST_NOTE_ID" "$TRIAGE_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"published","reviewer_note":"p11-verify triage-forbidden-publish test"}'
[ "$RESP_CODE" = "403" ] && ok "triage POST published -> 403" || bad "triage POST published -> $RESP_CODE"
jq -c '.' "$RESP_BODY" 2>/dev/null
DENIALS_AFTER_D=$(d1_count admin_denials)
if [ "$DENIALS_AFTER_D" -gt "$DENIALS_BEFORE_D" ] 2>/dev/null; then
  ok "admin_denials grew ($DENIALS_BEFORE_D -> $DENIALS_AFTER_D)"
  DENIAL_D_ROW=$(d1_query "SELECT id, scope, attempted_status FROM admin_denials ORDER BY id DESC LIMIT 1")
  echo "$DENIAL_D_ROW" | jq -c '.result[0].results[0]'
  D_SCOPE=$(echo "$DENIAL_D_ROW" | jq -r '.result[0].results[0].scope')
  D_STATUS=$(echo "$DENIAL_D_ROW" | jq -r '.result[0].results[0].attempted_status')
  DENIAL_D_ID=$(echo "$DENIAL_D_ROW" | jq -r '.result[0].results[0].id')
  [ "$D_SCOPE" = "triage" ] && [ "$D_STATUS" = "published" ] && ok "denial row scope=triage attempted_status=published (id $DENIAL_D_ID)" || bad "denial row mismatch: scope=$D_SCOPE attempted_status=$D_STATUS"
else
  bad "admin_denials did not grow for case d"
fi

# ---------- e. triage POST hold then rejected -> 200, 200 ----------
note "e. triage POST hold, then rejected"
req POST "$ORIGIN/admin/notes/$TEST_NOTE_ID" "$TRIAGE_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"hold","reviewer_note":"p11-verify triage hold step"}'
[ "$RESP_CODE" = "200" ] && ok "triage POST hold -> 200" || bad "triage POST hold -> $RESP_CODE"
req POST "$ORIGIN/admin/notes/$TEST_NOTE_ID" "$TRIAGE_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"rejected","reviewer_note":"p11-verify triage rejected step"}'
[ "$RESP_CODE" = "200" ] && ok "triage POST rejected -> 200" || bad "triage POST rejected -> $RESP_CODE"

# ---------- f. publish POST published, then rejected (back to back) ----------
note "f. publish POST published, then rejected (back to back)"
req POST "$ORIGIN/admin/notes/$TEST_NOTE_ID" "$PUBLISH_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"published","reviewer_note":"p11-verify publish step"}'
F1_CODE="$RESP_CODE"
req POST "$ORIGIN/admin/notes/$TEST_NOTE_ID" "$PUBLISH_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"rejected","reviewer_note":"p11-verify publish revert step"}'
F2_CODE="$RESP_CODE"
[ "$F1_CODE" = "200" ] && ok "publish POST published -> 200" || bad "publish POST published -> $F1_CODE"
[ "$F2_CODE" = "200" ] && ok "publish POST rejected -> 200" || bad "publish POST rejected -> $F2_CODE"

# ---------- g. legacy: POST forbidden, GET notes ok, export ----------
note "g. legacy POST (forbidden), GET notes, export"
DENIALS_BEFORE_G=$(d1_count admin_denials)
req POST "$ORIGIN/admin/notes/$TEST_NOTE_ID" "$LEGACY_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"rejected","reviewer_note":"p11-verify legacy-forbidden test"}'
[ "$RESP_CODE" = "403" ] && ok "legacy POST note status -> 403" || bad "legacy POST note status -> $RESP_CODE"
jq -c '.' "$RESP_BODY" 2>/dev/null
DENIALS_AFTER_G=$(d1_count admin_denials)
if [ "$DENIALS_AFTER_G" -gt "$DENIALS_BEFORE_G" ] 2>/dev/null; then
  ok "admin_denials grew for legacy POST ($DENIALS_BEFORE_G -> $DENIALS_AFTER_G)"
  DENIAL_G_ID=$(d1_query "SELECT id FROM admin_denials ORDER BY id DESC LIMIT 1" | jq -r '.result[0].results[0].id')
  echo "denial row id: $DENIAL_G_ID"
else
  bad "admin_denials did not grow for legacy POST"
fi

req GET "$ORIGIN/admin/notes?status=rejected" "$LEGACY_TOKEN"
[ "$RESP_CODE" = "200" ] && ok "legacy GET /admin/notes -> 200" || bad "legacy GET notes -> $RESP_CODE"

req POST "$ORIGIN/admin/export" "$LEGACY_TOKEN"
[ "$RESP_CODE" = "200" ] && ok "legacy POST /admin/export -> 200" || bad "legacy POST /admin/export -> $RESP_CODE"
jq -c '{kind,github_commit,note}' "$RESP_BODY" 2>/dev/null

# ---------- h. triage POST /admin/export -> 403, logged ----------
note "h. triage POST /admin/export (forbidden)"
DENIALS_BEFORE_H=$(d1_count admin_denials)
req POST "$ORIGIN/admin/export" "$TRIAGE_TOKEN"
[ "$RESP_CODE" = "403" ] && ok "triage POST /admin/export -> 403" || bad "triage POST /admin/export -> $RESP_CODE"
jq -c '.' "$RESP_BODY" 2>/dev/null
DENIALS_AFTER_H=$(d1_count admin_denials)
if [ "$DENIALS_AFTER_H" -gt "$DENIALS_BEFORE_H" ] 2>/dev/null; then
  ok "admin_denials grew for triage export ($DENIALS_BEFORE_H -> $DENIALS_AFTER_H)"
  DENIAL_H_ID=$(d1_query "SELECT id FROM admin_denials ORDER BY id DESC LIMIT 1" | jq -r '.result[0].results[0].id')
  echo "denial row id: $DENIAL_H_ID"
else
  bad "admin_denials did not grow for triage export"
fi

# ---------- cleanup: delete the throwaway note, confirm ----------
note "cleanup"
d1_query "DELETE FROM notes WHERE id=$TEST_NOTE_ID" >/dev/null
NOTE_GONE=$(d1_query "SELECT COUNT(*) c FROM notes WHERE id=$TEST_NOTE_ID" | jq -r '.result[0].results[0].c')
[ "$NOTE_GONE" = "0" ] && ok "note $TEST_NOTE_ID deleted" || bad "note $TEST_NOTE_ID still present"

CHANGES_FOR_CLAIM1=$(d1_query "SELECT COUNT(*) c FROM changes WHERE claim_id=1 AND note LIKE '%p11-verify%'" | jq -r '.result[0].results[0].c')
[ "$CHANGES_FOR_CLAIM1" = "0" ] && ok "no changes row was created by this test" || bad "unexpected changes row(s) from this test: $CHANGES_FOR_CLAIM1"

req GET "$ORIGIN/claims/1.json"
CLAIM1_NOTE_IDS=$(jq -c '[.notes[].id]' "$RESP_BODY" 2>/dev/null)
echo "/claims/1.json note ids now: $CLAIM1_NOTE_IDS"
echo "$CLAIM1_NOTE_IDS" | grep -q '^\[9\]$' && ok "/claims/1.json shows only pre-existing note id 9" || bad "/claims/1.json notes unexpected: $CLAIM1_NOTE_IDS"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
