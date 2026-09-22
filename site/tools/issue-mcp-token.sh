#!/usr/bin/env bash
# Issues a client token for the MCP suggest_correction tool (spec 5):
# mcp_token:<sha256> -> <client_name> in twon-kv. The plaintext goes only to
# mcp-token-<client_name>.txt (mode 600) in $OUT_DIR (default ~/.twon).
# Usage: issue-mcp-token.sh <client_name>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_secrets.sh"
CLIENT_NAME="${1:-}"
[[ "$CLIENT_NAME" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "usage: issue-mcp-token.sh <client_name> ([a-zA-Z0-9_-]+)" >&2; exit 1; }
OUT_DIR="${OUT_DIR:-$HOME/.twon}"
mkdir -p "$OUT_DIR"; chmod 700 "$OUT_DIR"
KV_ID=$(kv_id)
[ -n "$KV_ID" ] || { echo "KV namespace $KV_NAME not found" >&2; exit 1; }
TOKEN=$(openssl rand -hex 32)
HASH=$(printf '%s' "$TOKEN" | openssl dgst -sha256 | awk '{print $NF}')
RES=$(cf_put_raw "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/mcp_token:$HASH" "$CLIENT_NAME")
echo "$RES" | jq -e '.success == true' >/dev/null || { echo "KV write failed" >&2; exit 1; }
umask 177
printf '%s\n' "$TOKEN" > "$OUT_DIR/mcp-token-$CLIENT_NAME.txt"; chmod 600 "$OUT_DIR/mcp-token-$CLIENT_NAME.txt"
unset TOKEN
echo "client: $CLIENT_NAME  hash_prefix: ${HASH:0:8}  file: $OUT_DIR/mcp-token-$CLIENT_NAME.txt"
