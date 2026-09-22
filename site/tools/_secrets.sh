# Sourced by the tools/*.sh scripts: finds and loads the TWON secrets file
# the same way deploy.sh does. Never prints a value.
SECRETS_FILE="${SECRETS_FILE:-}"
if [ -z "$SECRETS_FILE" ]; then
  for f in "$(dirname "${BASH_SOURCE[0]}")/../../secrets.env" "$HOME/.twon/secrets.env" /home/claude/.twon/secrets.env; do
    if [ -f "$f" ]; then SECRETS_FILE="$f"; break; fi
  done
fi
if [ -z "$SECRETS_FILE" ] || [ ! -f "$SECRETS_FILE" ]; then
  echo "no secrets file found (set SECRETS_FILE or create \$HOME/.twon/secrets.env)" >&2
  exit 1
fi
set -a
. "$SECRETS_FILE"
set +a
API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
KV_NAME="twon-kv"
WORKER_NAME="twon-site"
cf_get()     { curl -sS "${AUTH[@]}" "$API$1"; }
cf_put()     { curl -sS "${AUTH[@]}" -H "Content-Type: application/json" -X PUT "$API$1" -d "$2"; }
cf_put_raw() { curl -sS "${AUTH[@]}" -H "Content-Type: text/plain" -X PUT "$API$1" --data-binary "$2"; }
cf_delete()  { curl -sS "${AUTH[@]}" -X DELETE "$API$1"; }
kv_id() {
  cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces?per_page=100" | jq -r --arg n "$KV_NAME" '.result[]? | select(.title==$n) | .id' | head -n1
}
