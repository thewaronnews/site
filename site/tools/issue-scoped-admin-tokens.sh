#!/usr/bin/env bash
# Issues (or rotates) the admin API tokens for The War On News (spec 8):
#   triage   Betty's jobs, link checker: queues, submissions to rejected or
#            hold, link checks and snapshots.
#   desk     News Desk agent: triage rights plus sources and notes, pause.
#   publish  build agents and Peter: all content writes, resume.
#   operator the ADMIN_TOKEN Worker secret: export, rollup, health,
#            changed-urls, indexnow; no content writes.
#
# Scoped tokens: 32 random bytes as hex; only SHA-256(token) is stored, in
# twon-kv as admin-token:<hash> = {"scope","issued_at","label"}, with
# admin-token-index:<scope> holding the current hash so a rotation can delete
# the old entry. The operator token is set as the Worker secret ADMIN_TOKEN.
# Plaintext goes only to admin-token-<scope>.txt (mode 600) in $OUT_DIR
# (default ~/.twon) and, when it exists or can be created, a copy in
# $COPY_DIR (default /mnt/user-data/outputs/twon-tokens). Token values are
# never printed; only file names and the first 8 characters of each hash.
#
# Usage: issue-scoped-admin-tokens.sh [triage|desk|publish|operator|all]  (default all)

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_secrets.sh"

OUT_DIR="${OUT_DIR:-$HOME/.twon}"
COPY_DIR="${COPY_DIR:-/mnt/user-data/outputs/twon-tokens}"
WHAT="${1:-all}"
case "$WHAT" in triage|desk|publish|operator|all) ;; *) echo "usage: $0 [triage|desk|publish|operator|all]" >&2; exit 1 ;; esac

mkdir -p "$OUT_DIR"; chmod 700 "$OUT_DIR"
mkdir -p "$COPY_DIR" 2>/dev/null || COPY_DIR=""
[ -n "$COPY_DIR" ] && chmod 700 "$COPY_DIR" 2>/dev/null || true

KV_ID=$(kv_id)
if [ -z "$KV_ID" ] || [ "$KV_ID" = "null" ]; then echo "KV namespace $KV_NAME not found (run deploy.sh first)" >&2; exit 1; fi

write_token_file() {
  # $1 scope, $2 token
  umask 177
  printf '%s\n' "$2" > "$OUT_DIR/admin-token-$1.txt"; chmod 600 "$OUT_DIR/admin-token-$1.txt"
  if [ -n "$COPY_DIR" ]; then printf '%s\n' "$2" > "$COPY_DIR/admin-token-$1.txt"; chmod 600 "$COPY_DIR/admin-token-$1.txt"; fi
}

issue_scoped() {
  local scope="$1" old_hash token token_hash issued_at record res
  old_hash=$(cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/admin-token-index:$scope" 2>/dev/null | tr -d '\r\n')
  case "$old_hash" in *'"success":false'*|*'errors'*|"") old_hash="" ;; esac
  token=$(openssl rand -hex 32)
  token_hash=$(printf '%s' "$token" | openssl dgst -sha256 | awk '{print $NF}')
  issued_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  record=$(python3 -c 'import json,sys; print(json.dumps({"scope": sys.argv[1], "issued_at": sys.argv[2], "label": "twon-admin-" + sys.argv[1]}))' "$scope" "$issued_at")
  res=$(cf_put_raw "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/admin-token:$token_hash" "$record")
  echo "$res" | jq -e '.success == true' >/dev/null || { echo "KV write failed for $scope: $(echo "$res" | jq -c '.errors')" >&2; exit 1; }
  res=$(cf_put_raw "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/admin-token-index:$scope" "$token_hash")
  echo "$res" | jq -e '.success == true' >/dev/null || { echo "KV index write failed for $scope" >&2; exit 1; }
  if [ -n "$old_hash" ] && [ "$old_hash" != "$token_hash" ]; then
    cf_delete "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/admin-token:$old_hash" >/dev/null
  fi
  write_token_file "$scope" "$token"
  unset token record
  echo "scope: $scope  hash_prefix: ${token_hash:0:8}  file: $OUT_DIR/admin-token-$scope.txt${COPY_DIR:+ (copy in $COPY_DIR)}"
}

issue_operator() {
  local token body res
  token=$(openssl rand -hex 32)
  body=$(python3 -c 'import json,sys; print(json.dumps({"name": "ADMIN_TOKEN", "text": sys.argv[1], "type": "secret_text"}))' "$token")
  res=$(cf_put "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/secrets" "$body")
  unset body
  echo "$res" | jq -e '.success == true' >/dev/null || { echo "setting ADMIN_TOKEN failed: $(echo "$res" | jq -c '.errors')" >&2; exit 1; }
  write_token_file operator "$token"
  echo "scope: operator  hash_prefix: $(printf '%s' "$token" | openssl dgst -sha256 | awk '{print substr($NF,1,8)}')  file: $OUT_DIR/admin-token-operator.txt${COPY_DIR:+ (copy in $COPY_DIR)}"
  unset token
}

case "$WHAT" in
  all) issue_scoped triage; issue_scoped desk; issue_scoped publish; issue_operator ;;
  operator) issue_operator ;;
  *) issue_scoped "$WHAT" ;;
esac
