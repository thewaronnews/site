#!/usr/bin/env bash
# The War On News (thewaronnews.com), Crank #3, deploy script.
# Idempotent: safe to re-run. Creates twon-* Cloudflare resources if they do
# not already exist, applies migrations, generates the content/lint/css
# modules, uploads the Worker, wires bindings, attaches the custom domains,
# sets the cron schedule and sets zone settings.
#
# Never touches rsbm-* resources or any zone other than thewaronnews.com.
#
# Requires a secrets file with CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
# CLOUDFLARE_ZONE_ID, INDEXNOW_KEY, and optionally GITHUB_TOKEN, GITHUB_ORG,
# GITHUB_REPO. Looked up in this order: $SECRETS_FILE, ../secrets.env,
# $HOME/.twon/secrets.env, /home/claude/.twon/secrets.env.
# Requires curl, jq, python3, openssl.

set -euo pipefail
cd "$(dirname "$0")"

SECRETS_FILE="${SECRETS_FILE:-}"
if [ -z "$SECRETS_FILE" ]; then
  for f in ../secrets.env "$HOME/.twon/secrets.env" /home/claude/.twon/secrets.env; do
    if [ -f "$f" ]; then SECRETS_FILE="$f"; break; fi
  done
fi
if [ -z "$SECRETS_FILE" ] || [ ! -f "$SECRETS_FILE" ]; then
  echo "deploy.sh: no secrets file found (set SECRETS_FILE or create \$HOME/.twon/secrets.env)" >&2
  exit 1
fi
set -a
. "$SECRETS_FILE"
set +a

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
WORKER_NAME="twon-site"
D1_NAME="twon-db"
KV_NAME="twon-kv"
R2_NAME="twon-exports"
ZONE_HOST="thewaronnews.com"
ZONE_HOST_WWW="www.thewaronnews.com"
CRON="17 7 * * *"
GA4_MEASUREMENT_ID="${GA4_MEASUREMENT_ID:-}"
DATA_REPO="${DATA_REPO:-https://github.com/${GITHUB_ORG:-thewaronnews}/${GITHUB_REPO:-data}}"

case "$WORKER_NAME$D1_NAME$KV_NAME$R2_NAME" in
  *rsbm*) echo "deploy.sh: refusing to touch an rsbm-* resource" >&2; exit 1 ;;
esac

log() { echo "[deploy] $*"; }

cf_get()  { curl -sS "${AUTH[@]}" "$API$1"; }
cf_post() { curl -sS "${AUTH[@]}" -H "Content-Type: application/json" -X POST "$API$1" -d "$2"; }
cf_put()  { curl -sS "${AUTH[@]}" -H "Content-Type: application/json" -X PUT "$API$1" -d "$2"; }
cf_patch(){ curl -sS "${AUTH[@]}" -H "Content-Type: application/json" -X PATCH "$API$1" -d "$2"; }

ok() { echo "$1" | jq -e '.success == true' >/dev/null 2>&1; }

# ---------- zone sanity ----------
ZONE_NAME=$(cf_get "/zones/$CLOUDFLARE_ZONE_ID" | jq -r '.result.name // empty')
if [ "$ZONE_NAME" != "$ZONE_HOST" ]; then
  echo "deploy.sh: zone $CLOUDFLARE_ZONE_ID is '$ZONE_NAME', expected $ZONE_HOST; stopping" >&2
  exit 1
fi

# ---------- D1 ----------
log "Checking D1 database $D1_NAME"
D1_LIST=$(cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database?name=$D1_NAME")
D1_UUID=$(echo "$D1_LIST" | jq -r --arg n "$D1_NAME" '.result[]? | select(.name==$n) | .uuid' | head -n1)
if [ -z "$D1_UUID" ] || [ "$D1_UUID" = "null" ]; then
  log "Creating D1 database $D1_NAME"
  RES=$(cf_post "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database" "{\"name\":\"$D1_NAME\"}")
  ok "$RES" || { echo "$RES" | jq -c '.errors'; exit 1; }
  D1_UUID=$(echo "$RES" | jq -r '.result.uuid')
fi
log "D1 uuid: $D1_UUID"

# ---------- KV ----------
log "Checking KV namespace $KV_NAME"
KV_LIST=$(cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces?per_page=100")
KV_ID=$(echo "$KV_LIST" | jq -r --arg n "$KV_NAME" '.result[]? | select(.title==$n) | .id' | head -n1)
if [ -z "$KV_ID" ] || [ "$KV_ID" = "null" ]; then
  log "Creating KV namespace $KV_NAME"
  RES=$(cf_post "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces" "{\"title\":\"$KV_NAME\"}")
  ok "$RES" || { echo "$RES" | jq -c '.errors'; exit 1; }
  KV_ID=$(echo "$RES" | jq -r '.result.id')
fi
log "KV id: $KV_ID"

# ---------- R2 ----------
log "Checking R2 bucket $R2_NAME"
R2_GET=$(cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$R2_NAME")
if ! ok "$R2_GET"; then
  log "Creating R2 bucket $R2_NAME"
  RES=$(cf_post "/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets" "{\"name\":\"$R2_NAME\"}")
  ok "$RES" || { echo "$RES" | jq -c '.errors'; exit 1; }
fi
log "R2 bucket ready: $R2_NAME"

# ---------- migrations ----------
d1_query() {
  # $1 = sql. D1 HTTP query API, one statement per call.
  cf_post "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/$D1_UUID/query" \
    "$(python3 -c 'import json,sys; print(json.dumps({"sql": sys.argv[1]}))' "$1")"
}

apply_migration_file() {
  local file="$1"
  local base
  base=$(basename "$file")
  local applied
  applied=$(d1_query "SELECT filename FROM migrations WHERE filename = '$base'" | jq -r '.result[0].results[0].filename // empty' 2>/dev/null || echo "")
  if [ "$applied" = "$base" ]; then
    log "Migration $base already applied, skipping"
    return 0
  fi
  log "Applying migration $base"
  # tools/split-sql.py keeps CREATE TRIGGER ... BEGIN ... END; blocks whole
  # and strips -- and /* */ comments (spec section 2.1).
  local stmts_json count idx stmt RES
  stmts_json=$(python3 tools/split-sql.py "$file")
  count=$(echo "$stmts_json" | jq 'length')
  idx=0
  while [ "$idx" -lt "$count" ]; do
    stmt=$(echo "$stmts_json" | jq -r ".[$idx]")
    RES=$(d1_query "$stmt")
    if ! ok "$RES"; then
      # Re-running after a partial apply: an object that already exists is
      # not an error for an idempotent deploy.
      if echo "$RES" | jq -r '.errors[]?.message' | grep -qiE 'already exists'; then
        log "  statement $idx: object already exists, continuing"
      else
        echo "Migration statement failed in $base (statement $idx):"
        echo "$stmt" | cut -c1-300
        echo "$RES" | jq -c '.errors'
        exit 1
      fi
    fi
    idx=$((idx + 1))
  done
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  d1_query "INSERT INTO migrations (filename, applied_at) VALUES ('$base', '$now')" >/dev/null
  log "Applied $base ($count statements)"
}

for f in migrations/*.sql; do
  apply_migration_file "$f"
done

# ---------- generated modules ----------
log "Generating src/content.js, src/lint.js, src/css.js"
python3 tools/gen-modules.py

# ---------- secrets present? ----------
log "Checking Worker secrets"
SECRETS_LIST=$(cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/secrets" 2>/dev/null || echo '{"success":false}')
has_secret() { echo "$SECRETS_LIST" | jq -r --arg n "$1" '.result[]? | select(.name==$n) | .name' 2>/dev/null; }
HAS_SALT=$(has_secret SALT_SECRET)
HAS_GITHUB_TOKEN=$(has_secret GITHUB_TOKEN)

# ---------- upload worker ----------
log "Uploading worker script $WORKER_NAME"
METADATA=$(python3 -c "
import json, sys
print(json.dumps({
  'main_module': 'index.js',
  'compatibility_date': '2026-09-01',
  'keep_bindings': ['secret_text'],
  'bindings': [
    {'type': 'd1', 'name': 'DB', 'id': sys.argv[1]},
    {'type': 'kv_namespace', 'name': 'KV', 'namespace_id': sys.argv[2]},
    {'type': 'r2_bucket', 'name': 'EXPORTS', 'bucket_name': sys.argv[3]},
    {'type': 'plain_text', 'name': 'SITE_ORIGIN', 'text': 'https://' + sys.argv[4]},
    {'type': 'plain_text', 'name': 'GITHUB_ORG', 'text': sys.argv[5]},
    {'type': 'plain_text', 'name': 'GITHUB_REPO', 'text': sys.argv[6]},
    {'type': 'plain_text', 'name': 'DATA_REPO', 'text': sys.argv[7]},
    {'type': 'plain_text', 'name': 'INDEXNOW_KEY', 'text': sys.argv[8]},
    {'type': 'plain_text', 'name': 'GA4_MEASUREMENT_ID', 'text': sys.argv[9]},
  ],
}))
" "$D1_UUID" "$KV_ID" "$R2_NAME" "$ZONE_HOST" "${GITHUB_ORG:-}" "${GITHUB_REPO:-}" "$DATA_REPO" "${INDEXNOW_KEY:-}" "$GA4_MEASUREMENT_ID")

FORM_ARGS=(-F "metadata=$METADATA;type=application/json")
for f in src/*.js; do
  FORM_ARGS+=(-F "$(basename "$f")=@$f;type=application/javascript+module")
done

UPLOAD_RES=$(curl -sS "${AUTH[@]}" "${FORM_ARGS[@]}" \
  -X PUT "$API/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME")

if ! ok "$UPLOAD_RES"; then
  echo "Worker upload failed:"
  echo "$UPLOAD_RES" | jq -c '.errors'
  exit 1
fi
log "Worker uploaded ($(ls src/*.js | wc -l) modules)."

put_secret() {
  # $1 = name, $2 = value. Value never printed.
  local body res
  body=$(python3 -c "
import json, sys
print(json.dumps({'name': sys.argv[1], 'text': sys.argv[2], 'type': 'secret_text'}))
" "$1" "$2")
  res=$(cf_put "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/secrets" "$body")
  unset body
  if ! ok "$res"; then
    echo "Setting $1 failed:"; echo "$res" | jq -c '.errors'; exit 1
  fi
}

if [ -z "$HAS_SALT" ]; then
  log "Setting SALT_SECRET (generated, never printed or stored)"
  SALT_VALUE=$(openssl rand -hex 32)
  put_secret SALT_SECRET "$SALT_VALUE"
  unset SALT_VALUE
  log "SALT_SECRET set."
else
  log "SALT_SECRET already set, leaving it alone."
fi

if [ -z "$HAS_GITHUB_TOKEN" ]; then
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    log "Setting GITHUB_TOKEN Worker secret (value not printed)"
    put_secret GITHUB_TOKEN "$GITHUB_TOKEN"
    log "GITHUB_TOKEN set."
  else
    log "GITHUB_TOKEN is empty in the secrets file; the export skips GitHub until it is set and deploy.sh re-runs."
  fi
else
  log "GITHUB_TOKEN already set, leaving it alone."
fi
# ADMIN_TOKEN (operator scope) is issued by tools/issue-scoped-admin-tokens.sh.

# ---------- custom domains ----------
attach_domain() {
  local hostname="$1"
  log "Attaching domain $hostname"
  RES=$(cf_put "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains" "$(python3 -c "
import json, sys
print(json.dumps({'hostname': sys.argv[1], 'service': sys.argv[2], 'environment': 'production', 'zone_id': sys.argv[3]}))
" "$hostname" "$WORKER_NAME" "$CLOUDFLARE_ZONE_ID")")
  if ok "$RES"; then
    log "Domain $hostname attached."
  else
    log "Domain $hostname: $(echo "$RES" | jq -c '.errors')"
  fi
}
attach_domain "$ZONE_HOST"
attach_domain "$ZONE_HOST_WWW"

# ---------- cron ----------
log "Setting cron schedule ($CRON UTC)"
RES=$(cf_put "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/schedules" "[{\"cron\":\"$CRON\"}]")
if ! ok "$RES"; then
  echo "Setting cron failed:"; echo "$RES" | jq -c '.errors'
  exit 1
fi
log "Cron set."

# ---------- zone settings (thewaronnews.com only) ----------
zone_setting() {
  local res
  res=$(cf_patch "/zones/$CLOUDFLARE_ZONE_ID/settings/$1" "{\"value\":\"$2\"}")
  if ok "$res"; then log "Zone: $1 = $2"; else log "Zone: $1 not set: $(echo "$res" | jq -c '.errors')"; fi
}
zone_setting always_use_https on
zone_setting ssl full
zone_setting browser_check off
zone_setting email_obfuscation off
zone_setting automatic_https_rewrites off
zone_setting server_side_exclude off

log "Deploy complete."
log "D1 uuid=$D1_UUID  KV id=$KV_ID  R2=$R2_NAME  Worker=$WORKER_NAME"
