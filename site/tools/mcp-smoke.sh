#!/usr/bin/env bash
# MCP smoke test for thewaronnews.com/mcp (spec 5 and 11): initialize,
# tools/list (12 tools, v3: ladder and get_united_states_chapter replace compare), every read tool, and suggest_correction without a
# token (must fail). UA prefix twon-smoke/ keeps the calls out of the
# questions ledger and the request census.
# Usage: mcp-smoke.sh [base_url] [incident_slug] [actor_slug] [case_slug]
set -uo pipefail
BASE="${1:-https://thewaronnews.com}"
INC="${2:-2026-white-house-bans-cnn-msnow-politico}"
ACTOR="${3:-donald-trump}"
CASE="${4:-cnn-msnow-politico-v-trump-2026}"
UA="twon-smoke/1.0"
PASS=0; FAIL=0
rpc() { curl -sS -m 30 "$BASE/mcp" -A "$UA" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$1"; }
check() {
  # $1 label, $2 json, $3 python expression over d (the parsed response) that must be truthy
  if echo "$2" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($3) else 1)" 2>/dev/null; then
    PASS=$((PASS+1)); echo "PASS $1"
  else
    FAIL=$((FAIL+1)); echo "FAIL $1: $(echo "$2" | head -c 300)"
  fi
}
R=$(rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"twon-smoke","version":"1.0"}}}')
check "initialize" "$R" "d['result']['serverInfo']['name']=='com.thewaronnews/thewaronnews'"
R=$(rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
check "tools/list has 12 tools, ladder in, compare and latest_news out" "$R" "len(d['result']['tools'])==12 and 'ladder' in [t['name'] for t in d['result']['tools']] and 'get_united_states_chapter' in [t['name'] for t in d['result']['tools']] and not {'compare','latest_news'} & {t['name'] for t in d['result']['tools']}"
call() { rpc "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"; }
R=$(call search_incidents '{"query":"White House CNN"}');   check "search_incidents" "$R" "d['result']['structuredContent']['count']>=1"
R=$(call search_incidents '{"country":"US","tactic":"access_ban","from":"2025"}'); check "search_incidents with facets" "$R" "d['result']['structuredContent']['count']>=1 and all(i['country']=='US' and 'access_ban' in i['tactics'] for i in d['result']['structuredContent']['incidents'])"
R=$(call get_country '{"iso2":"US"}');                        check "get_country" "$R" "d['result']['structuredContent'].get('iso2')=='US' and d['result']['structuredContent']['incident_count']>=1"
R=$(call get_tactic '{"slug":"access_ban"}');                 check "get_tactic" "$R" "d['result']['structuredContent'].get('slug')=='access_ban'"
R=$(call ladder '{"tactic":"access_ban"}');                   check "ladder" "$R" "d['result']['structuredContent']['count']>=1 and d['result']['structuredContent']['stages'][0]['rungs'][0]['focal_case']==True"
R=$(call ladder '{"tactic":"detention_and_violence","stage":"eliminate"}'); check "ladder with stage" "$R" "d['result']['structuredContent']['count']>=1 and all(s['stage']=='eliminate' for s in d['result']['structuredContent']['stages'])"
R=$(call ladder '{"tactic":"nonsense"}');                     check "ladder rejects an unknown tactic" "$R" "d['result']['isError']==True"
R=$(call get_united_states_chapter '{}');                     check "get_united_states_chapter" "$R" "d['result']['structuredContent']['rsf']['rank']==64 and len(d['result']['structuredContent']['now']['incidents'])>=1 and len(d['result']['structuredContent']['tactics_in_use_now'])>=1"
R=$(call get_country '{"iso2":"RU"}');                        check "get_country carries the RSF rank" "$R" "d['result']['structuredContent']['press_freedom']['rank']>=1"
R=$(call recent_coverage '{"limit":3}');                      check "recent_coverage" "$R" "'items' in d['result']['structuredContent']"
R=$(call get_incident "{\"slug\":\"$INC\"}");               check "get_incident" "$R" "d['result']['structuredContent'].get('slug')=='$INC'"
R=$(call get_timeline '{"limit":5}');                        check "get_timeline" "$R" "len(d['result']['structuredContent']['rows'])>=1"
R=$(call get_actor "{\"slug\":\"$ACTOR\"}");                check "get_actor" "$R" "d['result']['structuredContent'].get('slug')=='$ACTOR'"
R=$(call get_case "{\"slug\":\"$CASE\"}");                  check "get_case (published case)" "$R" "d['result']['structuredContent'].get('slug')=='$CASE'"
R=$(call get_sources_for "{\"incident_slug\":\"$INC\"}");  check "get_sources_for" "$R" "len(d['result']['structuredContent']['sources'])>=1"
R=$(call suggest_correction "{\"target_type\":\"incident\",\"target_id\":\"$INC\",\"body\":\"smoke\"}"); check "suggest_correction without token fails" "$R" "d['result']['isError']==True"
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
