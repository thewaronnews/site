#!/usr/bin/env bash
# Issues a client token for the /mcp submit_note tool (spec section 8, P0.4).
#
# Generates 32 random bytes as hex, computes its SHA-256, writes
# mcp_token:<hash> -> <client_name> into the rsbm-kv KV namespace via the
# Cloudflare REST API, and writes the plaintext token to
# mcp-token-<client_name>.txt (mode 600) next to this repo. The token itself
# is never printed to stdout or logged anywhere; only the client name, the
# first 8 characters of its hash, and the output file path are printed.
#
# Usage: site/tools/issue-mcp-token.sh <client_name>
#
# Secrets are looked up the same way deploy.sh does: $SECRETS_FILE,
# ../secrets.env, ~/.crank2/secrets.env.

set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root (rattlesnakesbymail.com/)

CLIENT_NAME="${1:-}"
if [ -z "$CLIENT_NAME" ]; then
  echo "usage: issue-mcp-token.sh <client_name>" >&2
  exit 1
fi
if ! [[ "$CLIENT_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "client_name must match [a-zA-Z0-9_-]+" >&2
  exit 1
fi

SECRETS_FILE="${SECRETS_FILE:-}"
if [ -z "$SECRETS_FILE" ]; then
  for f in secrets.env "$HOME/.crank2/secrets.env" /home/claude/.crank2/secrets.env; do
    if [ -f "$f" ]; then SECRETS_FILE="$f"; break; fi
  done
fi
if [ -z "$SECRETS_FILE" ] || [ ! -f "$SECRETS_FILE" ]; then
  echo "issue-mcp-token.sh: no secrets file found (set SECRETS_FILE or create secrets.env)" >&2
  exit 1
fi
set -a
. "$SECRETS_FILE"
set +a

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
KV_NAME="rsbm-kv"

cf_get()  { curl -sS "${AUTH[@]}" "$API$1"; }
cf_put_raw() { curl -sS "${AUTH[@]}" -H "Content-Type: text/plain" -X PUT "$API$1" --data-binary "$2"; }

KV_LIST=$(cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces")
KV_ID=$(echo "$KV_LIST" | jq -r --arg n "$KV_NAME" '.result[] | select(.title==$n) | .id' | head -n1)
if [ -z "$KV_ID" ] || [ "$KV_ID" = "null" ]; then
  echo "issue-mcp-token.sh: could not find KV namespace $KV_NAME" >&2
  exit 1
fi

TOKEN=$(openssl rand -hex 32)
TOKEN_HASH=$(printf '%s' "$TOKEN" | openssl dgst -sha256 | awk '{print $NF}')

OUT_FILE="mcp-token-$CLIENT_NAME.txt"
umask 177
printf '%s\n' "$TOKEN" > "$OUT_FILE"
chmod 600 "$OUT_FILE"

RES=$(cf_put_raw "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/mcp_token:$TOKEN_HASH" "$CLIENT_NAME")
unset TOKEN
if ! echo "$RES" | jq -e '.success == true' >/dev/null 2>&1; then
  echo "issue-mcp-token.sh: KV write failed:" >&2
  echo "$RES" | jq -c '.errors // .' >&2
  exit 1
fi

echo "client_name: $CLIENT_NAME"
echo "token_hash_prefix: ${TOKEN_HASH:0:8}"
echo "token_file: $(pwd)/$OUT_FILE"
