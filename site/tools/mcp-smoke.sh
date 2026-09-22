#!/usr/bin/env bash
# P0.4 /mcp verification against the live site. Real requests only.
# Requires curl, jq, python3, openssl. Loads secrets the same way deploy.sh
# does (for the D1 REST checks); never prints secrets.env or token contents.

set -uo pipefail
cd "$(dirname "$0")/../.."   # repo root

SCRATCH="$(mktemp -d "$HOME/rsbm-mcp-smoke.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

BASE="https://rattlesnakesbymail.com"
PASS=0
FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

SECRETS_FILE="${SECRETS_FILE:-}"
if [ -z "$SECRETS_FILE" ]; then
  for f in secrets.env "$HOME/.crank2/secrets.env"; do
    if [ -f "$f" ]; then SECRETS_FILE="$f"; break; fi
  done
fi
if [ -n "$SECRETS_FILE" ] && [ -f "$SECRETS_FILE" ]; then
  set -a
  . "$SECRETS_FILE"
  set +a
else
  echo "warning: no secrets file found, D1-backed checks (6,7,8) will be skipped" >&2
fi

D1_UUID="92b99e81-233c-4c97-b787-d8eb71ef876d"
d1_query() {
  # $1 = sql
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then echo '{"success":false,"skipped":true}'; return; fi
  curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
    -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/$D1_UUID/query" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"sql": sys.argv[1]}))' "$1")"
}

rpc_body() {
  # $1=id(number or "null") $2=method $3=params-json (or "null")
  jq -n --argjson id "$1" --arg method "$2" --argjson params "$3" '{jsonrpc:"2.0", id:$id, method:$method, params:$params}'
}

echo "=== 1. initialize / notifications/initialized / ping ==="
INIT_BODY=$(rpc_body 1 "initialize" '{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke-test","version":"0.1"}}')
INIT_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -D $SCRATCH/mcp_init_headers.txt -X POST "$BASE/mcp" -H "Content-Type: application/json" -d "$INIT_BODY")
SESSION_ID=$(grep -i '^mcp-session-id:' $SCRATCH/mcp_init_headers.txt | awk '{print $2}' | tr -d '\r')
SERVER_NAME=$(echo "$INIT_RESP" | jq -r '.result.serverInfo.name // empty')
PROTO_VER=$(echo "$INIT_RESP" | jq -r '.result.protocolVersion // empty')
if [ "$SERVER_NAME" = "Rattlesnakes By Mail" ] && [ -n "$PROTO_VER" ] && [ -n "$SESSION_ID" ]; then
  pass "initialize -> serverInfo.name=$SERVER_NAME protocolVersion=$PROTO_VER Mcp-Session-Id present"
else
  fail "initialize (serverInfo.name=$SERVER_NAME protocolVersion=$PROTO_VER session=$SESSION_ID)"
fi

NOTIF_BODY='{"jsonrpc":"2.0","method":"notifications/initialized"}'
NOTIF_STATUS=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -o /dev/null -w '%{http_code}' -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$NOTIF_BODY")
[ "$NOTIF_STATUS" = "202" ] && pass "notifications/initialized -> 202" || fail "notifications/initialized -> $NOTIF_STATUS (expected 202)"

PING_BODY=$(rpc_body 2 "ping" '{}')
PING_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$PING_BODY")
PING_RESULT=$(echo "$PING_RESP" | jq -c '.result // empty')
[ "$PING_RESULT" = "{}" ] && pass "ping -> {}" || fail "ping -> $PING_RESULT"

echo "=== 2. tools/list ==="
LIST_BODY=$(rpc_body 3 "tools/list" '{}')
LIST_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$LIST_BODY")
TOOL_COUNT=$(echo "$LIST_RESP" | jq '.result.tools | length')
SCHEMA_COUNT=$(echo "$LIST_RESP" | jq '[.result.tools[] | select(.inputSchema != null)] | length')
if [ "$TOOL_COUNT" = "5" ] && [ "$SCHEMA_COUNT" = "5" ]; then
  pass "tools/list -> 5 tools, all with inputSchema"
else
  fail "tools/list -> $TOOL_COUNT tools, $SCHEMA_COUNT with inputSchema"
fi
echo "$LIST_RESP" | jq -r '.result.tools[].name'

echo "=== 3. lookup_crawler ==="
CALL_BODY=$(rpc_body 4 "tools/call" '{"name":"lookup_crawler","arguments":{"name_or_ua":"GPTBot"}}')
CALL_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$CALL_BODY")
GPT_CLAIMS=$(echo "$CALL_RESP" | jq '.result.structuredContent.claims | length')
GPT_MATCHED=$(echo "$CALL_RESP" | jq -r '.result.structuredContent.matched')
if [ "$GPT_MATCHED" = "true" ] && [ "$GPT_CLAIMS" -ge 5 ] 2>/dev/null; then
  pass "lookup_crawler GPTBot -> matched, $GPT_CLAIMS claims"
else
  fail "lookup_crawler GPTBot -> matched=$GPT_MATCHED claims=$GPT_CLAIMS"
fi

CB_UA="Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +https://claude.com/crawling)"
CALL_BODY=$(rpc_body 5 "tools/call" "$(jq -n --arg ua "$CB_UA" '{name:"lookup_crawler",arguments:{name_or_ua:$ua}}')")
CALL_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$CALL_BODY")
CB_SLUG=$(echo "$CALL_RESP" | jq -r '.result.structuredContent.entity.slug // empty')
[ "$CB_SLUG" = "claudebot" ] && pass "lookup_crawler ClaudeBot UA string -> resolves to claudebot" || fail "lookup_crawler ClaudeBot UA -> slug=$CB_SLUG"

CALL_BODY=$(rpc_body 6 "tools/call" '{"name":"lookup_crawler","arguments":{"name_or_ua":"TotallyMadeUpBotXYZ"}}')
CALL_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$CALL_BODY")
UNK_ISERROR=$(echo "$CALL_RESP" | jq -r '.result.isError')
UNK_HASERR=$(echo "$CALL_RESP" | jq 'has("error")')
if [ "$UNK_ISERROR" = "false" ] && [ "$UNK_HASERR" = "false" ]; then
  pass "lookup_crawler unknown name -> isError:false, no JSON-RPC error"
else
  fail "lookup_crawler unknown name -> isError=$UNK_ISERROR has_error=$UNK_HASERR"
fi

echo "=== 4. identify_user_agent ==="
GBOT_UA="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
CALL_BODY=$(rpc_body 7 "tools/call" "$(jq -n --arg ua "$GBOT_UA" '{name:"identify_user_agent",arguments:{user_agent:$ua}}')")
CALL_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$CALL_BODY")
G_SLUG=$(echo "$CALL_RESP" | jq -r '.result.structuredContent.slug // empty')
G_RDNS=$(echo "$CALL_RESP" | jq -r '.result.structuredContent.verifiable_by_rdns // empty')
if [ "$G_SLUG" = "googlebot" ] && [ "$G_RDNS" = "yes" ]; then
  pass "identify_user_agent Googlebot UA -> googlebot, verifiable_by_rdns=yes"
else
  fail "identify_user_agent Googlebot UA -> slug=$G_SLUG rdns=$G_RDNS"
fi

CALL_BODY=$(rpc_body 8 "tools/call" '{"name":"identify_user_agent","arguments":{"user_agent":"curl/8.4.0 not-a-crawler"}}')
CALL_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$CALL_BODY")
RAND_MATCHED=$(echo "$CALL_RESP" | jq -r '.result.structuredContent.matched')
[ "$RAND_MATCHED" = "false" ] && pass "identify_user_agent random string -> matched:false" || fail "identify_user_agent random string -> matched=$RAND_MATCHED"

echo "=== 5. list_changes ==="
CALL_BODY=$(rpc_body 9 "tools/call" '{"name":"list_changes","arguments":{"since":"2026-09-14"}}')
CALL_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$CALL_BODY")
SINCE_COUNT=$(echo "$CALL_RESP" | jq '.result.structuredContent.changes | length')
echo "list_changes since=2026-09-14 -> $SINCE_COUNT rows"
[ "$SINCE_COUNT" -gt 0 ] 2>/dev/null && pass "list_changes since=2026-09-14 -> $SINCE_COUNT rows" || fail "list_changes since=2026-09-14 -> $SINCE_COUNT rows"

CALL_BODY=$(rpc_body 10 "tools/call" '{"name":"list_changes","arguments":{}}')
CALL_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$CALL_BODY")
ALL_COUNT=$(echo "$CALL_RESP" | jq '.result.structuredContent.changes | length')
echo "list_changes (no since) -> $ALL_COUNT rows"
[ "$ALL_COUNT" -gt 0 ] 2>/dev/null && pass "list_changes no filter -> $ALL_COUNT rows" || fail "list_changes no filter -> $ALL_COUNT rows"

echo "=== 6. ask ==="
CALL_BODY=$(rpc_body 11 "tools/call" '{"name":"ask","arguments":{"question":"does GPTBot respect robots.txt"}}')
CALL_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$CALL_BODY")
ASK_CLAIMS=$(echo "$CALL_RESP" | jq '.result.structuredContent.claims | length')
echo "ask -> $ASK_CLAIMS matching claims"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  Q_COUNT=$(d1_query "SELECT COUNT(*) AS n FROM questions WHERE text_raw = 'does GPTBot respect robots.txt'" | jq -r '.result[0].results[0].n // 0')
  echo "questions rows for this exact text (should be 0, this script sends rsbm-smoke/1.0): $Q_COUNT"
  [ "$Q_COUNT" = "0" ] && pass "ask -> $ASK_CLAIMS claims, wrote no questions row (smoke UA bypass)" || fail "ask -> smoke UA still wrote a questions row ($Q_COUNT)"
else
  echo "SKIP: no CLOUDFLARE_API_TOKEN, cannot confirm questions row"
fi

echo "=== 7. submit_note ==="
CALL_BODY=$(rpc_body 12 "tools/call" '{"name":"submit_note","arguments":{"target_type":"entity","target_id":"gptbot","body":"P0.4 smoke test note, no token.","token":"not-a-real-token"}}')
CALL_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$CALL_BODY")
NOTOKEN_ISERROR=$(echo "$CALL_RESP" | jq -r '.result.isError')
[ "$NOTOKEN_ISERROR" = "true" ] && pass "submit_note without a valid token -> isError:true" || fail "submit_note without a valid token -> isError=$NOTOKEN_ISERROR"

TOKEN_FILE="mcp-token-peter-claude-desktop.txt"
if [ -f "$TOKEN_FILE" ]; then
  TOKEN=$(cat "$TOKEN_FILE")
  CALL_BODY=$(jq -n --arg tok "$TOKEN" '{jsonrpc:"2.0", id:13, method:"tools/call", params:{name:"submit_note",arguments:{target_type:"entity",target_id:"gptbot",body:"P0.4 smoke test note, should not be written (smoke UA).",token:$tok}}}')
  CALL_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -H "Mcp-Session-Id: $SESSION_ID" -d "$CALL_BODY")
  unset TOKEN CALL_BODY
  WITHTOKEN_ISERROR=$(echo "$CALL_RESP" | jq -r '.result.isError')
  NOTE_STATUS_FIELD=$(echo "$CALL_RESP" | jq -r '.result.structuredContent.status // empty')
  if [ "$WITHTOKEN_ISERROR" = "false" ] && [ "$NOTE_STATUS_FIELD" = "skipped_test_traffic" ]; then
    pass "submit_note with issued token + smoke UA -> isError:false, status=skipped_test_traffic, no note written"
    if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
      SKIP_COUNT=$(d1_query "SELECT COUNT(*) AS n FROM notes WHERE body = 'P0.4 smoke test note, should not be written (smoke UA).'" | jq -r '.result[0].results[0].n // 0')
      [ "$SKIP_COUNT" = "0" ] && pass "confirmed via D1: no notes row was written for the smoke-UA submit_note call" || fail "smoke-UA submit_note wrote $SKIP_COUNT notes row(s), expected 0"
    else
      echo "SKIP: no CLOUDFLARE_API_TOKEN, cannot confirm no notes row was written"
    fi
  else
    fail "submit_note with issued token + smoke UA -> isError=$WITHTOKEN_ISERROR status=$NOTE_STATUS_FIELD (expected isError:false, status:skipped_test_traffic)"
  fi
else
  echo "SKIP: token file $TOKEN_FILE not found"
fi

echo "=== 8. mcp_calls logging ==="
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  CALLS_TODAY=$(d1_query "SELECT COUNT(*) AS n FROM mcp_calls WHERE ts LIKE '$(date -u +%Y-%m-%d)%'" | jq -r '.result[0].results[0].n // 0')
  LATENCY_SET=$(d1_query "SELECT COUNT(*) AS n FROM mcp_calls WHERE ts LIKE '$(date -u +%Y-%m-%d)%' AND latency_ms IS NOT NULL" | jq -r '.result[0].results[0].n // 0')
  SMOKE_LABELED=$(d1_query "SELECT COUNT(*) AS n FROM mcp_calls WHERE ts LIKE '$(date -u +%Y-%m-%d)%' AND client_name = 'smoke-test'" | jq -r '.result[0].results[0].n // 0')
  echo "mcp_calls rows today: $CALLS_TODAY, with latency_ms set: $LATENCY_SET, with client_name=smoke-test: $SMOKE_LABELED"
  [ "$CALLS_TODAY" -gt 0 ] 2>/dev/null && pass "mcp_calls has $CALLS_TODAY rows today, $LATENCY_SET with latency_ms" || fail "mcp_calls has 0 rows today"
  [ "$SMOKE_LABELED" -gt 0 ] 2>/dev/null && pass "mcp_calls has $SMOKE_LABELED rows labeled client_name=smoke-test" || fail "mcp_calls has 0 rows labeled client_name=smoke-test"
  # P1.1: the site has been live and accumulating real search/MCP traffic
  # since this assertion was written against a freshly-seeded database, so
  # asserting the count is 0 is stale. This smoke UA's own calls never
  # write a questions row (asserted above for the ask/submit_note calls
  # specifically); here we only assert the table has a sane shape, not
  # that it is empty.
  QUESTIONS_TOTAL=$(d1_query "SELECT COUNT(*) AS n FROM questions" | jq -r '.result[0].results[0].n // 0')
  case "$QUESTIONS_TOTAL" in
    ''|*[!0-9]*) fail "questions table count is not a plain integer: $QUESTIONS_TOTAL" ;;
    *) pass "questions table has $QUESTIONS_TOTAL rows (sane shape; not asserted empty, see comment)" ;;
  esac
else
  echo "SKIP: no CLOUDFLARE_API_TOKEN, cannot query mcp_calls"
fi

echo "=== 9. protocol errors ==="
GET_STATUS_HEADERS=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -D - -o $SCRATCH/mcp_get_body.txt -X GET "$BASE/mcp")
GET_CODE=$(echo "$GET_STATUS_HEADERS" | head -1 | awk '{print $2}')
GET_ALLOW=$(echo "$GET_STATUS_HEADERS" | grep -i '^allow:' | tr -d '\r')
if [ "$GET_CODE" = "405" ] && echo "$GET_ALLOW" | grep -qi "POST"; then
  pass "GET /mcp -> 405, $GET_ALLOW"
else
  fail "GET /mcp -> $GET_CODE, $GET_ALLOW"
fi

BAD_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -d '{not valid json')
BAD_CODE=$(echo "$BAD_RESP" | jq -r '.error.code // empty')
[ "$BAD_CODE" = "-32700" ] && pass "invalid JSON -> error.code -32700" || fail "invalid JSON -> $BAD_RESP"

UNKM_BODY=$(rpc_body 14 "not/a/real/method" '{}')
UNKM_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -X POST "$BASE/mcp" -H "Content-Type: application/json" -d "$UNKM_BODY")
UNKM_CODE=$(echo "$UNKM_RESP" | jq -r '.error.code // empty')
[ "$UNKM_CODE" = "-32601" ] && pass "unknown method -> error.code -32601" || fail "unknown method -> $UNKM_RESP"

echo "=== 10. /.well-known/mcp/server.json ==="
WK_RESP=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -D $SCRATCH/mcp_wk_headers.txt -o $SCRATCH/mcp_wk_body.json "$BASE/.well-known/mcp/server.json" -w '%{http_code}')
WK_CTYPE=$(grep -i '^content-type:' $SCRATCH/mcp_wk_headers.txt | tr -d '\r')
if [ "$WK_RESP" = "200" ] && echo "$WK_CTYPE" | grep -qi "application/json" && jq -e . $SCRATCH/mcp_wk_body.json >/dev/null 2>&1; then
  pass "/.well-known/mcp/server.json -> 200, application/json, parses"
else
  fail "/.well-known/mcp/server.json -> status=$WK_RESP ctype=$WK_CTYPE"
fi

echo "=== 11. WebMCP script presence ==="
HOME_HTML=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" "$BASE/")
NON_LDJSON_SCRIPTS=$(echo "$HOME_HTML" | grep -o '<script[^>]*>' | grep -vc 'application/ld+json')
HAS_MODELCONTEXT=$(echo "$HOME_HTML" | grep -c 'document.modelContext')
if [ "$NON_LDJSON_SCRIPTS" = "1" ] && [ "$HAS_MODELCONTEXT" -ge 1 ]; then
  pass "/ has exactly one non-ld+json <script>, contains document.modelContext"
else
  fail "/ non-ldjson-script-count=$NON_LDJSON_SCRIPTS modelcontext-count=$HAS_MODELCONTEXT"
fi

MD_SCRIPTCOUNT=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" "$BASE/.md" | grep -c '<script' || true)
JSON_SCRIPTCOUNT=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" "$BASE/.json" | grep -c '<script' || true)
if [ "$MD_SCRIPTCOUNT" = "0" ] && [ "$JSON_SCRIPTCOUNT" = "0" ]; then
  pass "/.md and /.json contain no <script>"
else
  fail "/.md script-count=$MD_SCRIPTCOUNT /.json script-count=$JSON_SCRIPTCOUNT"
fi

echo "=== 12. existing routes still work, negotiation intact, no em dashes / ** ==="
ROUTES_OK=1
for p in "/" "/claims" "/crawlers/gptbot" "/changes" "/data" "/method"; do
  for suffix in "" ".md" ".json"; do
    code=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -o /dev/null -w '%{http_code}' "$BASE$p$suffix")
    if [ "$code" != "200" ]; then
      echo "  route $p$suffix -> $code"
      ROUTES_OK=0
    fi
  done
done
[ "$ROUTES_OK" = "1" ] && pass "spot-checked routes return 200 in html/md/json" || fail "one or more spot-checked routes did not return 200"

NEG_CTYPE=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" -D - -o /dev/null "$BASE/crawlers/gptbot" -H "Accept: application/json" | grep -i '^content-type:' | tr -d '\r')
echo "$NEG_CTYPE" | grep -qi "application/json" && pass "Accept: application/json on /crawlers/gptbot -> $NEG_CTYPE" || fail "Accept negotiation broken -> $NEG_CTYPE"

EMDASH_HITS=0
STARSTAR_HITS=0
for p in "/.md" "/claims.md" "/crawlers/gptbot.md" "/changes.md" "/data.md" "/method.md"; do
  body=$(curl -sS -H "User-Agent: rsbm-smoke/1.0" "$BASE$p")
  if echo "$body" | grep -q $'\xe2\x80\x94'; then EMDASH_HITS=$((EMDASH_HITS+1)); fi
  if echo "$body" | grep -q '\*\*'; then STARSTAR_HITS=$((STARSTAR_HITS+1)); fi
done
if [ "$EMDASH_HITS" = "0" ] && [ "$STARSTAR_HITS" = "0" ]; then
  pass "no em dashes or ** in spot-checked markdown pages"
else
  fail "em dash hits=$EMDASH_HITS, ** hits=$STARSTAR_HITS"
fi

echo ""
echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
[ "$FAIL" = "0" ]
