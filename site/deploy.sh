#!/usr/bin/env bash
# Crank #2 (rattlesnakesbymail.com) deploy script.
# Idempotent: safe to re-run. Creates rsbm-* Cloudflare resources if they do
# not already exist, applies migrations, uploads the Worker, wires bindings,
# attaches the custom domain, sets the cron schedule, and sets zone settings.
#
# Requires a secrets file with CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
# CLOUDFLARE_ZONE_ID (and GITHUB_TOKEN, GITHUB_ORG, GITHUB_REPO for the export
# phase). Looked up in this order: $SECRETS_FILE, ../secrets.env (the handoff
# folder), ~/.crank2/secrets.env. Requires curl, jq, python3.

set -euo pipefail
cd "$(dirname "$0")"

SECRETS_FILE="${SECRETS_FILE:-}"
if [ -z "$SECRETS_FILE" ]; then
  for f in ../secrets.env "$HOME/.crank2/secrets.env" /home/claude/.crank2/secrets.env; do
    if [ -f "$f" ]; then SECRETS_FILE="$f"; break; fi
  done
fi
if [ -z "$SECRETS_FILE" ] || [ ! -f "$SECRETS_FILE" ]; then
  echo "deploy.sh: no secrets file found (set SECRETS_FILE or create ../secrets.env)" >&2
  exit 1
fi
set -a
. "$SECRETS_FILE"
set +a

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
WORKER_NAME="rsbm-site"
D1_NAME="rsbm-db"
KV_NAME="rsbm-kv"
R2_NAME="rsbm-exports"
ZONE_HOST="rattlesnakesbymail.com"
ZONE_HOST_WWW="www.rattlesnakesbymail.com"

log() { echo "[deploy] $*"; }

cf_get()  { curl -sS "${AUTH[@]}" "$API$1"; }
cf_post() { curl -sS "${AUTH[@]}" -H "Content-Type: application/json" -X POST "$API$1" -d "$2"; }
cf_put()  { curl -sS "${AUTH[@]}" -H "Content-Type: application/json" -X PUT "$API$1" -d "$2"; }
cf_patch(){ curl -sS "${AUTH[@]}" -H "Content-Type: application/json" -X PATCH "$API$1" -d "$2"; }

ok() { echo "$1" | jq -e '.success == true' >/dev/null; }

# ---------- D1 ----------
log "Checking D1 database $D1_NAME"
D1_LIST=$(cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database")
D1_UUID=$(echo "$D1_LIST" | jq -r --arg n "$D1_NAME" '.result[] | select(.name==$n) | .uuid' | head -n1)
if [ -z "$D1_UUID" ] || [ "$D1_UUID" = "null" ]; then
  log "Creating D1 database $D1_NAME"
  RES=$(cf_post "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database" "{\"name\":\"$D1_NAME\"}")
  ok "$RES" || { echo "$RES"; exit 1; }
  D1_UUID=$(echo "$RES" | jq -r '.result.uuid')
fi
log "D1 uuid: $D1_UUID"

# ---------- KV ----------
log "Checking KV namespace $KV_NAME"
KV_LIST=$(cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces")
KV_ID=$(echo "$KV_LIST" | jq -r --arg n "$KV_NAME" '.result[] | select(.title==$n) | .id' | head -n1)
if [ -z "$KV_ID" ] || [ "$KV_ID" = "null" ]; then
  log "Creating KV namespace $KV_NAME"
  RES=$(cf_post "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces" "{\"title\":\"$KV_NAME\"}")
  ok "$RES" || { echo "$RES"; exit 1; }
  KV_ID=$(echo "$RES" | jq -r '.result.id')
fi
log "KV id: $KV_ID"

# ---------- R2 ----------
log "Checking R2 bucket $R2_NAME"
R2_LIST=$(cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets")
R2_EXISTS=$(echo "$R2_LIST" | jq -r --arg n "$R2_NAME" '.result.buckets[]? | select(.name==$n) | .name')
if [ -z "$R2_EXISTS" ]; then
  log "Creating R2 bucket $R2_NAME"
  RES=$(cf_post "/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets" "{\"name\":\"$R2_NAME\"}")
  ok "$RES" || { echo "$RES"; exit 1; }
fi
log "R2 bucket ready: $R2_NAME"

# ---------- migrations ----------
d1_query() {
  # $1 = sql. Uses the D1 HTTP query API (one statement per call).
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
  # Split the file into individual statements on lines that are exactly ';'
  # at end of a top-level statement. Our migration files never use ';'
  # inside a string, so a naive split on ";\n" is safe.
  python3 - "$file" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
# strip full-line comments (only lines that are pure comments; safe here
# because none of our SQL has a bare "--" inside a string)
lines = [l for l in content.split("\n") if not l.strip().startswith("--")]
content = "\n".join(lines)

# Split into statements on ";" that are outside single-quoted strings,
# respecting the SQL '' escaped-quote convention.
stmts = []
buf = []
in_string = False
i = 0
n = len(content)
while i < n:
    c = content[i]
    if in_string:
        if c == "'":
            if i + 1 < n and content[i + 1] == "'":
                buf.append("''")
                i += 2
                continue
            in_string = False
            buf.append(c)
            i += 1
            continue
        buf.append(c)
        i += 1
        continue
    else:
        if c == "'":
            in_string = True
            buf.append(c)
            i += 1
            continue
        if c == ";":
            stmt = "".join(buf).strip()
            if stmt:
                stmts.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
tail = "".join(buf).strip()
if tail:
    stmts.append(tail)

with open("/tmp/crank2_migration_stmts.txt", "w") as out:
    for s in stmts:
        out.write(s.replace("\n", " ") + "\n<<<STMT_END>>>\n")
PYEOF
  local stmt=""
  while IFS= read -r line; do
    if [ "$line" = "<<<STMT_END>>>" ]; then
      if [ -n "$stmt" ]; then
        RES=$(d1_query "$stmt")
        if ! echo "$RES" | jq -e '.success == true' >/dev/null 2>&1; then
          echo "Migration statement failed in $base:"
          echo "$stmt"
          echo "$RES"
          exit 1
        fi
      fi
      stmt=""
    else
      stmt="$line"
    fi
  done < /tmp/crank2_migration_stmts.txt
  rm -f /tmp/crank2_migration_stmts.txt
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  d1_query "INSERT INTO migrations (filename, applied_at) VALUES ('$base', '$now')" >/dev/null
  log "Applied $base"
}

for f in migrations/*.sql; do
  apply_migration_file "$f"
done

# ---------- SALT_SECRET / GITHUB_TOKEN ----------
log "Checking SALT_SECRET and GITHUB_TOKEN"
SECRETS_LIST=$(cf_get "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/secrets" 2>/dev/null || echo '{"success":false}')
HAS_SALT=$(echo "$SECRETS_LIST" | jq -r '.result[]? | select(.name=="SALT_SECRET") | .name' 2>/dev/null || echo "")
HAS_GITHUB_TOKEN=$(echo "$SECRETS_LIST" | jq -r '.result[]? | select(.name=="GITHUB_TOKEN") | .name' 2>/dev/null || echo "")
NEED_SALT_UPLOAD=0
if [ -z "$HAS_SALT" ]; then
  NEED_SALT_UPLOAD=1
fi
NEED_GITHUB_TOKEN_UPLOAD=0
if [ -z "$HAS_GITHUB_TOKEN" ]; then
  NEED_GITHUB_TOKEN_UPLOAD=1
fi

# ---------- upload worker (bindings only; module content below) ----------
log "Uploading worker script $WORKER_NAME"
METADATA=$(python3 -c "
import json
print(json.dumps({
  'main_module': 'index.js',
  'compatibility_date': '2026-09-01',
  'bindings': [
    {'type': 'd1', 'name': 'DB', 'id': '$D1_UUID'},
    {'type': 'kv_namespace', 'name': 'KV', 'namespace_id': '$KV_ID'},
    {'type': 'r2_bucket', 'name': 'EXPORTS', 'bucket_name': '$R2_NAME'},
    {'type': 'plain_text', 'name': 'SITE_ORIGIN', 'text': 'https://$ZONE_HOST'},
    {'type': 'plain_text', 'name': 'GITHUB_ORG', 'text': '$GITHUB_ORG'},
    {'type': 'plain_text', 'name': 'GITHUB_REPO', 'text': '$GITHUB_REPO'},
    {'type': 'plain_text', 'name': 'INDEXNOW_KEY', 'text': '${INDEXNOW_KEY:-}'},
    {'type': 'plain_text', 'name': 'INDEXNOW_ENDPOINT', 'text': '${INDEXNOW_ENDPOINT:-https://www.bing.com/indexnow}'},
  ],
}))
")

UPLOAD_RES=$(curl -sS "${AUTH[@]}" \
  -F "metadata=$METADATA;type=application/json" \
  -F "index.js=@src/index.js;type=application/javascript+module" \
  -F "util.js=@src/util.js;type=application/javascript+module" \
  -F "db.js=@src/db.js;type=application/javascript+module" \
  -F "render.js=@src/render.js;type=application/javascript+module" \
  -F "negotiate.js=@src/negotiate.js;type=application/javascript+module" \
  -F "logger.js=@src/logger.js;type=application/javascript+module" \
  -F "ipmatch.js=@src/ipmatch.js;type=application/javascript+module" \
  -F "cron.js=@src/cron.js;type=application/javascript+module" \
  -F "routes.js=@src/routes.js;type=application/javascript+module" \
  -F "site.js=@src/site.js;type=application/javascript+module" \
  -F "mcp.js=@src/mcp.js;type=application/javascript+module" \
  -F "export.js=@src/export.js;type=application/javascript+module" \
  -F "github.js=@src/github.js;type=application/javascript+module" \
  -F "admin.js=@src/admin.js;type=application/javascript+module" \
  -F "indexnow.js=@src/indexnow.js;type=application/javascript+module" \
  -F "discovery.js=@src/discovery.js;type=application/javascript+module" \
  -F "fields.js=@src/fields.js;type=application/javascript+module" \
  -F "compare.js=@src/compare.js;type=application/javascript+module" \
  -F "rattlesnakes-by-mail.png=@assets/rattlesnakes-by-mail.png;type=application/octet-stream" \
  -X PUT "$API/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME")

if ! echo "$UPLOAD_RES" | jq -e '.success == true' >/dev/null; then
  echo "Worker upload failed:"
  echo "$UPLOAD_RES" | jq .
  exit 1
fi
log "Worker uploaded."

if [ "$NEED_SALT_UPLOAD" = "1" ]; then
  log "Setting SALT_SECRET (generated, not printed or stored in this repo)"
  SALT_VALUE=$(openssl rand -hex 32)
  SECRET_BODY=$(python3 -c "
import json, sys
print(json.dumps({'name': 'SALT_SECRET', 'text': sys.argv[1], 'type': 'secret_text'}))
" "$SALT_VALUE")
  RES=$(cf_put "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/secrets" "$SECRET_BODY")
  unset SALT_VALUE SECRET_BODY
  if ! echo "$RES" | jq -e '.success == true' >/dev/null; then
    echo "Setting SALT_SECRET failed:"
    echo "$RES" | jq .
    exit 1
  fi
  log "SALT_SECRET set."
else
  log "SALT_SECRET already set, leaving it alone."
fi

if [ "$NEED_GITHUB_TOKEN_UPLOAD" = "1" ]; then
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "deploy.sh: GITHUB_TOKEN is not set in $SECRETS_FILE, cannot set the Worker secret" >&2
    exit 1
  fi
  log "Setting GITHUB_TOKEN Worker secret (value not printed or stored in this repo)"
  SECRET_BODY=$(python3 -c "
import json, sys
print(json.dumps({'name': 'GITHUB_TOKEN', 'text': sys.argv[1], 'type': 'secret_text'}))
" "$GITHUB_TOKEN")
  RES=$(cf_put "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/secrets" "$SECRET_BODY")
  unset SECRET_BODY
  if ! echo "$RES" | jq -e '.success == true' >/dev/null; then
    echo "Setting GITHUB_TOKEN failed:"
    echo "$RES" | jq .
    exit 1
  fi
  log "GITHUB_TOKEN set."
else
  log "GITHUB_TOKEN already set, leaving it alone."
fi

# ---------- custom domains ----------
attach_domain() {
  local hostname="$1"
  log "Attaching domain $hostname"
  RES=$(cf_put "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains" "$(python3 -c "
import json
print(json.dumps({'hostname': '$hostname', 'service': '$WORKER_NAME', 'environment': 'production', 'zone_id': '$CLOUDFLARE_ZONE_ID'}))
")")
  if echo "$RES" | jq -e '.success == true' >/dev/null; then
    log "Domain $hostname attached."
  else
    log "Domain $hostname: $(echo "$RES" | jq -c '.errors')"
  fi
}
attach_domain "$ZONE_HOST"
attach_domain "$ZONE_HOST_WWW"

# ---------- cron ----------
log "Setting cron schedule (nightly rollup at 03:17 UTC)"
RES=$(cf_put "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/schedules" '[{"cron":"17 3 * * *"}]')
if ! echo "$RES" | jq -e '.success == true' >/dev/null; then
  echo "Setting cron failed:"; echo "$RES" | jq .
  exit 1
fi
log "Cron set."

# ---------- zone settings ----------
log "Setting zone: always_use_https on"
cf_patch "/zones/$CLOUDFLARE_ZONE_ID/settings/always_use_https" '{"value":"on"}' >/dev/null
log "Setting zone: ssl full"
cf_patch "/zones/$CLOUDFLARE_ZONE_ID/settings/ssl" '{"value":"full"}' >/dev/null
log "Setting zone: browser_check off (P0.4: Browser Integrity Check 403'd generic MCP clients, e.g. python urllib, error code 1010; nothing may block a crawler or an MCP client)"
cf_patch "/zones/$CLOUDFLARE_ZONE_ID/settings/browser_check" '{"value":"off"}' >/dev/null
log "Setting zone: email_obfuscation off (P0.7: it rewrites every HTML body, which strips the ETag Cloudflare would otherwise pass through from the Worker)"
cf_patch "/zones/$CLOUDFLARE_ZONE_ID/settings/email_obfuscation" '{"value":"off"}' >/dev/null
log "Setting zone: automatic_https_rewrites off (P0.7 item 1: HTML body rewrite pass that also strips the ETag header, approved by Peter 2026-09-15)"
cf_patch "/zones/$CLOUDFLARE_ZONE_ID/settings/automatic_https_rewrites" '{"value":"off"}' >/dev/null
log "Setting zone: server_side_exclude off (P0.7 item 1: HTML body rewrite pass that also strips the ETag header, approved by Peter 2026-09-15)"
cf_patch "/zones/$CLOUDFLARE_ZONE_ID/settings/server_side_exclude" '{"value":"off"}' >/dev/null

log "Deploy complete."
log "D1 uuid=$D1_UUID  KV id=$KV_ID  R2=$R2_NAME  Worker=$WORKER_NAME"
