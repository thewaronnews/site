#!/usr/bin/env bash
# Issues (or rotates) the two scoped admin tokens for the /admin API
# (P1.1, architect-decisions-2026-09-17 section 1 ruling 1):
#   triage  -- Betty's launchd jobs: GET /admin/notes, GET /admin/health,
#              POST /admin/notes/<id> with status in rejected|hold only.
#   publish -- the human review queue: the same, plus status=published.
# Neither scope can call /admin/export, /admin/rollup or /admin/indexnow;
# only the legacy ADMIN_TOKEN (which itself lost POST /admin/notes/<id>)
# still can.
#
# Generates 32 random bytes as hex per scope, stores only the SHA-256 hex
# of the token in the rsbm-kv KV namespace as admin-token:<hash> with a
# JSON value {"scope":..., "issued_at":..., "label":...}, and writes the
# plaintext to admin-token-<scope>.txt (mode 600) at the repo root. The
# token value is never printed to stdout or logged anywhere; only the
# file name and the first 8 characters of its hash are printed.
#
# A KV index key admin-token-index:<scope> holds the CURRENT hash for
# that scope (not the token), so --rotate can find and delete the old
# admin-token:<hash> entry without ever needing the old plaintext.
#
# Usage:
#   site/tools/issue-scoped-admin-tokens.sh                 # issue both, first time
#   site/tools/issue-scoped-admin-tokens.sh --rotate triage  # rotate one
#   site/tools/issue-scoped-admin-tokens.sh --rotate publish
#   site/tools/issue-scoped-admin-tokens.sh --rotate both
#
# Secrets are looked up the same way deploy.sh does: $SECRETS_FILE,
# ../secrets.env, ~/.crank2/secrets.env.

set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root (rattlesnakesbymail.com/)

MODE="issue"
ROTATE_SCOPE=""
if [ "${1:-}" = "--rotate" ]; then
  MODE="rotate"
  ROTATE_SCOPE="${2:-}"
  if [ "$ROTATE_SCOPE" != "triage" ] && [ "$ROTATE_SCOPE" != "publish" ] && [ "$ROTATE_SCOPE" != "both" ]; then
    echo "usage: issue-scoped-admin-tokens.sh [--rotate triage|publish|both]" >&2
    exit 1
  fi
elif [ -n "${1:-}" ]; then
  echo "usage: issue-scoped-admin-tokens.sh [--rotate triage|publish|both]" >&2
  exit 1
fi

SECRETS_FILE="${SECRETS_FILE:-}"
if [ -z "$SECRETS_FILE" ]; then
  for f in secrets.env "$HOME/.crank2/secrets.env" /home/claude/.crank2/secrets.env; do
    if [ -f "$f" ]; then SECRETS_FILE="$f"; break; fi
  done
fi
if [ -z "$SECRETS_FILE" ] || [ ! -f "$SECRETS_FILE" ]; then
  echo "issue-scoped-admin-tokens.sh: no secrets file found (set SECRETS_FILE or create secrets.env)" >&2
  exit 1
fi
set -a
. "$SECRETS_FILE"
set +a

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
KV_NAME="rsbm-kv"

cf_get()     { curl -sS "${AUTH[@]}" "$API$1"; }
cf_put_raw() { curl -sS "${AUTH[@]}" -H "Content-Type: text/plain" -X PUT "$API$1" --data-binary "$2"; }
cf_delete()  { curl -sS "${AUTH[@]}" -X DELETE "$API$1"; }

KV_LIST=$(cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces")
KV_ID=$(echo "$KV_LIST" | jq -r --arg n "$KV_NAME" '.result[] | select(.title==$n) | .id' | head -n1)
if [ -z "$KV_ID" ] || [ "$KV_ID" = "null" ]; then
  echo "issue-scoped-admin-tokens.sh: could not find KV namespace $KV_NAME" >&2
  exit 1
fi

issue_one() {
  local scope="$1"
  local old_hash=""
  old_hash=$(cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/admin-token-index:$scope" 2>/dev/null | tr -d '\r\n')
  case "$old_hash" in
    *'"success":false'*|"") old_hash="" ;;
  esac

  local token token_hash
  token=$(openssl rand -hex 32)
  token_hash=$(printf '%s' "$token" | openssl dgst -sha256 | awk '{print $NF}')
  local issued_at
  issued_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  local record
  record=$(python3 -c "
import json, sys
print(json.dumps({'scope': sys.argv[1], 'issued_at': sys.argv[2], 'label': sys.argv[3]}))
" "$scope" "$issued_at" "rsbm-admin-$scope")

  local res
  res=$(cf_put_raw "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/admin-token:$token_hash" "$record")
  if ! echo "$res" | jq -e '.success == true' >/dev/null 2>&1; then
    echo "issue-scoped-admin-tokens.sh: KV write failed for scope $scope:" >&2
    echo "$res" | jq -c '.errors // .' >&2
    unset token
    exit 1
  fi

  res=$(cf_put_raw "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/admin-token-index:$scope" "$token_hash")
  if ! echo "$res" | jq -e '.success == true' >/dev/null 2>&1; then
    echo "issue-scoped-admin-tokens.sh: KV index write failed for scope $scope:" >&2
    echo "$res" | jq -c '.errors // .' >&2
    unset token
    exit 1
  fi

  if [ -n "$old_hash" ] && [ "$old_hash" != "$token_hash" ]; then
    cf_delete "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/admin-token:$old_hash" >/dev/null
  fi

  local out_file="admin-token-$scope.txt"
  umask 177
  printf '%s\n' "$token" > "$out_file"
  chmod 600 "$out_file"
  unset token record

  echo "scope: $scope"
  echo "token_hash_prefix: ${token_hash:0:8}"
  echo "token_file: $(pwd)/$out_file (mode 600, gitignored)"
}

if [ "$MODE" = "issue" ]; then
  issue_one triage
  issue_one publish
else
  case "$ROTATE_SCOPE" in
    triage) issue_one triage ;;
    publish) issue_one publish ;;
    both) issue_one triage; issue_one publish ;;
  esac
fi
