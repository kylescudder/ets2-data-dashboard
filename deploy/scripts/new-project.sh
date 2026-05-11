#!/usr/bin/env bash
# Bootstrap a new self-hosted Supabase project on this box.
#
# Usage:
#   sudo ./new-project.sh <project-name> <base-port> <domain>
#
# Example:
#   sudo ./new-project.sh ets2 8001 api.ets2.kyle.dev
#
# What it does:
#   1. Clones (or updates) supabase/supabase into /opt/supabase/_cache/
#   2. Copies its docker/ template into /opt/supabase/<project-name>/
#   3. Generates fresh secrets via generate-secrets.ts (requires bun on PATH)
#   4. Patches .env with project-specific ports + domain + secrets
#   5. Brings the stack up via `docker compose up -d`
#   6. Prints the keys you need to wire into your app's env vars
#
# Re-run safely: if /opt/supabase/<project-name> already exists the script
# refuses to clobber it.

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: $0 <project-name> <base-port> <domain>" >&2
  echo "  project-name: lowercase slug, e.g. ets2"                >&2
  echo "  base-port:    8001, 8002, … (Kong HTTP)"                >&2
  echo "  domain:       e.g. api.ets2.kyle.dev (no scheme)"        >&2
  exit 1
fi

PROJECT="$1"
BASE_PORT="$2"
DOMAIN="$3"

if [[ ! "$PROJECT" =~ ^[a-z][a-z0-9-]{0,30}[a-z0-9]$ ]]; then
  echo "project-name must be lowercase, hyphen-separated, 2-32 chars" >&2
  exit 1
fi

ROOT=/opt/supabase
CACHE="$ROOT/_cache/supabase"
DEST="$ROOT/$PROJECT"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -d "$DEST" ]]; then
  echo "$DEST already exists — refusing to clobber." >&2
  echo "Remove it manually if you really want to recreate this project." >&2
  exit 1
fi

mkdir -p "$ROOT"

# 1. cache the upstream repo (shallow clone, then pull on subsequent runs)
if [[ ! -d "$CACHE/.git" ]]; then
  echo "==> cloning supabase/supabase (shallow)…"
  git clone --depth 1 https://github.com/supabase/supabase.git "$CACHE"
else
  echo "==> refreshing cached supabase/supabase…"
  git -C "$CACHE" fetch --depth 1 origin master
  git -C "$CACHE" reset --hard origin/master
fi

# 2. copy docker/ template into the project dir
echo "==> creating $DEST from upstream docker/ template"
cp -r "$CACHE/docker" "$DEST"
cp "$CACHE/docker/.env.example" "$DEST/.env"

# 3. generate secrets
echo "==> generating secrets"
SECRETS="$(bun "$SCRIPT_DIR/generate-secrets.ts")"

# 4. patch .env. Each `set_env KEY VALUE` replaces or appends KEY in $DEST/.env.
set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$DEST/.env"; then
    # Escape & and / for sed; pipe sed delimiter avoids most path issues.
    local esc
    esc="$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')"
    sed -i "s|^${key}=.*|${key}=${esc}|" "$DEST/.env"
  else
    echo "${key}=${value}" >> "$DEST/.env"
  fi
}

# Pull each generated secret into a variable then set_env it.
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  set_env "$key" "$value"
done <<< "$SECRETS"

# Per-project ports. Kong = base, Studio = base+1, Postgres external = base+2,
# Supavisor pooler = base+3. Adjust the spread if you have more than ~20 projects.
KONG_HTTP=$BASE_PORT
KONG_HTTPS=$((BASE_PORT + 100))
STUDIO_PORT=$((BASE_PORT + 1))
PG_EXTERNAL=$((BASE_PORT + 2))
POOLER_TRANSACTION=$((BASE_PORT + 3))
POOLER_SESSION=$((BASE_PORT + 4))

set_env KONG_HTTP_PORT       "$KONG_HTTP"
set_env KONG_HTTPS_PORT      "$KONG_HTTPS"
set_env STUDIO_PORT          "$STUDIO_PORT"
set_env POSTGRES_PORT        "5432"
set_env POSTGRES_HOST        "db"
set_env POSTGRES_DB          "postgres"
set_env POOLER_PROXY_PORT_TRANSACTION "$POOLER_TRANSACTION"
set_env POOLER_PROXY_PORT_SESSION     "$POOLER_SESSION"
set_env POOLER_TENANT_ID     "$PROJECT"

# Public URLs — Caddy will TLS-terminate at $DOMAIN and proxy to $KONG_HTTP.
set_env SITE_URL             "https://$DOMAIN"
set_env API_EXTERNAL_URL     "https://$DOMAIN"
set_env SUPABASE_PUBLIC_URL  "https://$DOMAIN"
set_env STUDIO_DEFAULT_ORGANIZATION "$PROJECT"
set_env STUDIO_DEFAULT_PROJECT      "$PROJECT"

# Sensible defaults. Override in $DEST/.env if your app needs different.
set_env DISABLE_SIGNUP                 "false"
set_env ENABLE_EMAIL_SIGNUP            "true"
set_env ENABLE_EMAIL_AUTOCONFIRM       "false"
set_env ENABLE_PHONE_SIGNUP            "false"
set_env ENABLE_PHONE_AUTOCONFIRM       "false"
set_env ENABLE_ANONYMOUS_USERS         "false"
set_env JWT_EXPIRY                     "3600"
set_env FUNCTIONS_VERIFY_JWT           "false"

# 5. bring it up
echo "==> starting stack"
cd "$DEST"
docker compose pull
docker compose up -d

# 6. summary for the user
ANON_KEY=$(grep '^ANON_KEY=' "$DEST/.env" | cut -d= -f2-)
SERVICE_KEY=$(grep '^SERVICE_ROLE_KEY=' "$DEST/.env" | cut -d= -f2-)

cat <<EOF

=====================================================================
  $PROJECT is up.
=====================================================================
  Kong (proxy target for Caddy):  http://127.0.0.1:$KONG_HTTP
  Studio (admin UI):              http://127.0.0.1:$STUDIO_PORT
  Postgres (external port):       127.0.0.1:$PG_EXTERNAL

  App env vars (drop into Netlify / Xcode / wherever):
    NEXT_PUBLIC_SUPABASE_URL = https://$DOMAIN
    NEXT_PUBLIC_SUPABASE_ANON_KEY = $ANON_KEY

  Server-side / migration tooling only:
    SUPABASE_SERVICE_ROLE_KEY = $SERVICE_KEY

  Next steps:
    1. Add a Caddy stanza pointing $DOMAIN at 127.0.0.1:$KONG_HTTP
       (see deploy/Caddyfile.example) and reload Caddy.
    2. Configure SMTP in $DEST/.env (SMTP_HOST, SMTP_USER, SMTP_PASS,
       SMTP_SENDER_NAME, SMTP_ADMIN_EMAIL), then:
         docker compose --env-file $DEST/.env -p $PROJECT \
           -f $DEST/docker-compose.yml restart auth
    3. To register OAuth providers, set GOTRUE_EXTERNAL_<NAME>_* vars
       in .env and restart the auth container.
=====================================================================
EOF
