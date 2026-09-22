#!/usr/bin/env bash
# Issues the single ADMIN_TOKEN for the /admin API (spec section 7 / P0.5).
#
# Generates 32 random bytes as hex, sets it as the Worker secret ADMIN_TOKEN
# via the Cloudflare secrets endpoint, and writes the plaintext to
# admin-token.txt (mode 600) at the repo root, next to secrets.env.
# admin-token.txt is in .gitignore and must never be committed. The token
# value is never printed to stdout or logged anywhere; only confirmation
# that it was set, and the output file path, are printed.
#
# Usage: site/tools/issue-admin-token.sh
# Re-running this script rotates the token: a new value is generated and
# uploaded, and the old value in admin-token.txt is overwritten. Anything
# holding the old token (Betty's config, this file's earlier copy) stops
# working until it reads the new value.
#
# Secrets are looked up the same way deploy.sh does: $SECRETS_FILE,
# ../secrets.env, ~/.crank2/secrets.env.

set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root (rattlesnakesbymail.com/)

SECRETS_FILE="${SECRETS_FILE:-}"
if [ -z "$SECRETS_FILE" ]; then
  for f in secrets.env "$HOME/.crank2/secrets.env" /home/claude/.crank2/secrets.env; do
    if [ -f "$f" ]; then SECRETS_FILE="$f"; break; fi
  done
fi
if [ -z "$SECRETS_FILE" ] || [ ! -f "$SECRETS_FILE" ]; then
  echo "issue-admin-token.sh: no secrets file found (set SECRETS_FILE or create secrets.env)" >&2
  exit 1
fi
set -a
. "$SECRETS_FILE"
set +a

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
WORKER_NAME="rsbm-site"

cf_put() { curl -sS "${AUTH[@]}" -H "Content-Type: application/json" -X PUT "$API$1" -d "$2"; }

TOKEN=$(openssl rand -hex 32)

OUT_FILE="admin-token.txt"
umask 177
printf '%s\n' "$TOKEN" > "$OUT_FILE"
chmod 600 "$OUT_FILE"

SECRET_BODY=$(python3 -c "
import json, sys
print(json.dumps({'name': 'ADMIN_TOKEN', 'text': sys.argv[1], 'type': 'secret_text'}))
" "$TOKEN")
RES=$(cf_put "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/secrets" "$SECRET_BODY")
unset TOKEN SECRET_BODY
if ! echo "$RES" | jq -e '.success == true' >/dev/null 2>&1; then
  echo "issue-admin-token.sh: setting ADMIN_TOKEN failed:" >&2
  echo "$RES" | jq -c '.errors // .' >&2
  exit 1
fi

echo "ADMIN_TOKEN set."
echo "token_file: $(pwd)/$OUT_FILE (mode 600, gitignored)"
