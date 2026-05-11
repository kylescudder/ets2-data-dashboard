#!/usr/bin/env bash
# Bootstrap a new self-hosted Supabase project on this box.
#
# Usage:
#   sudo ./new-project.sh <project-name> <base-port> <api-domain> [<site-domain>]
#
# Example:
#   sudo ./new-project.sh ets2 8001 api.ets2.kylescudder.co.uk ets2.kylescudder.co.uk
#
# Args:
#   project-name  lowercase slug, e.g. ets2
#   base-port     Kong HTTP host port (8001, 8011, …)
#   api-domain    the Supabase API hostname Caddy fronts (no scheme)
#   site-domain   (optional) your user-facing app URL — set this if the app
#                 lives somewhere other than the API. If omitted, SITE_URL
#                 defaults to api-domain and the script warns.
#
# What it does:
#   1. Clones (or updates) supabase/supabase into /opt/supabase/_cache/
#   2. Copies its docker/ template into /opt/supabase/<project-name>/
#   3. Generates fresh secrets via generate-secrets.ts (requires bun on PATH)
#   4. Patches .env with project-specific ports + domains + secrets
#   5. Drops in the dark-themed magic-link email template + a compose override
#      that wires GoTrue to use it
#   6. Chowns the project dir back to the invoking user so .env edits don't
#      need sudo
#   7. Brings the stack up via `docker compose up -d`
#   8. Prints the keys you need to wire into your app's env vars
#
# Re-run safely: if /opt/supabase/<project-name> already exists the script
# refuses to clobber it.

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: $0 <project-name> <base-port> <api-domain> [<site-domain>]" >&2
  echo "  project-name: lowercase slug, e.g. ets2"                          >&2
  echo "  base-port:    8001, 8011, … (Kong HTTP)"                          >&2
  echo "  api-domain:   e.g. api.ets2.kylescudder.co.uk (no scheme)"         >&2
  echo "  site-domain:  optional user-facing app URL (no scheme)"            >&2
  exit 1
fi

PROJECT="$1"
BASE_PORT="$2"
DOMAIN="$3"
SITE_DOMAIN="${4:-}"

if [[ ! "$PROJECT" =~ ^[a-z][a-z0-9-]{0,30}[a-z0-9]$ ]]; then
  echo "project-name must be lowercase, hyphen-separated, 2-32 chars" >&2
  exit 1
fi

ROOT=/opt/supabase
CACHE="$ROOT/_cache/supabase"
DEST="$ROOT/$PROJECT"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

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

# Per-project ports. Studio is served via Kong (not its own host port) on the
# modern Supabase compose, so we only expose Kong + Postgres + the pooler.
KONG_HTTP=$BASE_PORT
KONG_HTTPS=$((BASE_PORT + 100))
PG_EXTERNAL=$((BASE_PORT + 2))
POOLER_TRANSACTION=$((BASE_PORT + 3))
POOLER_SESSION=$((BASE_PORT + 4))

set_env KONG_HTTP_PORT       "$KONG_HTTP"
set_env KONG_HTTPS_PORT      "$KONG_HTTPS"
set_env POSTGRES_PORT        "5432"
set_env POSTGRES_HOST        "db"
set_env POSTGRES_DB          "postgres"
set_env POOLER_PROXY_PORT_TRANSACTION "$POOLER_TRANSACTION"
set_env POOLER_PROXY_PORT_SESSION     "$POOLER_SESSION"
set_env POOLER_TENANT_ID     "$PROJECT"

# Public URLs. SITE_URL is the user-facing app (where magic-link emails
# redirect back to); the other two are the Supabase API host that Caddy
# TLS-terminates and proxies to Kong on $KONG_HTTP.
if [[ -z "$SITE_DOMAIN" ]]; then
  echo "==> WARNING: no site-domain given; SITE_URL falls back to api-domain ($DOMAIN)" >&2
  echo "    Update SITE_URL in $DEST/.env to your user-facing URL before going live."   >&2
  SITE_DOMAIN="$DOMAIN"
fi
set_env SITE_URL             "https://$SITE_DOMAIN"
set_env API_EXTERNAL_URL     "https://$DOMAIN"
set_env SUPABASE_PUBLIC_URL  "https://$DOMAIN"
set_env STUDIO_DEFAULT_ORGANIZATION "$PROJECT"
set_env STUDIO_DEFAULT_PROJECT      "$PROJECT"

# Email-sender placeholder. Pick a noreply on the apex domain so it works once
# SPF/DKIM on the apex are verified in your transactional-email provider.
APEX="${DOMAIN#api.}"
set_env SMTP_ADMIN_EMAIL "noreply@$APEX"

# Sensible defaults. Override in $DEST/.env if your app needs different.
set_env DISABLE_SIGNUP                 "false"
set_env ENABLE_EMAIL_SIGNUP            "true"
set_env ENABLE_EMAIL_AUTOCONFIRM       "false"
set_env ENABLE_PHONE_SIGNUP            "false"
set_env ENABLE_PHONE_AUTOCONFIRM       "false"
set_env ENABLE_ANONYMOUS_USERS         "false"
set_env JWT_EXPIRY                     "3600"
set_env FUNCTIONS_VERIFY_JWT           "false"

# 5. drop in the dark email template + a compose override that points GoTrue
# at the Caddy-served HTTPS URLs. GoTrue's template loader requires HTTP(S)
# URLs (file paths get treated as URL paths and rewritten against SITE_URL,
# which fetches the wrong content). Caddy serves the files from
# volumes/auth/templates/ at https://$DOMAIN/auth-templates/<name>.html —
# add the matching `handle /auth-templates/*` block to your Caddyfile (see
# deploy/Caddyfile.example).
echo "==> installing dark-themed email templates"
mkdir -p "$DEST/volumes/auth/templates"
for t in magic_link confirmation recovery invite email_change; do
  cp "$REPO_ROOT/deploy/templates/magic_link.html" "$DEST/volumes/auth/templates/$t.html"
done
chmod -R a+rX "$DEST/volumes/auth/templates"

# Compose override — never edit the upstream docker-compose.yml so Supabase
# upgrades don't clobber our customisation.
cat > "$DEST/docker-compose.override.yml" <<YML
services:
  auth:
    environment:
      GOTRUE_MAILER_TEMPLATES_MAGIC_LINK:   https://$DOMAIN/auth-templates/magic_link.html
      GOTRUE_MAILER_TEMPLATES_CONFIRMATION: https://$DOMAIN/auth-templates/confirmation.html
      GOTRUE_MAILER_TEMPLATES_RECOVERY:     https://$DOMAIN/auth-templates/recovery.html
      GOTRUE_MAILER_TEMPLATES_INVITE:       https://$DOMAIN/auth-templates/invite.html
      GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE: https://$DOMAIN/auth-templates/email_change.html
YML

# 6. chown the project dir back to the invoking user. Done BEFORE the stack
# starts so volumes/db/data (created by Postgres as UID 999) stays untouched.
INVOKER="${SUDO_USER:-$USER}"
if [[ "$INVOKER" != "root" ]] && id "$INVOKER" >/dev/null 2>&1; then
  echo "==> chown'ing $DEST to $INVOKER (so .env edits don't need sudo)"
  chown -R "$INVOKER:$INVOKER" "$DEST"
fi

# 7. bring it up
echo "==> starting stack"
cd "$DEST"
docker compose pull
docker compose up -d

# 8. summary for the user
ANON_KEY=$(grep '^ANON_KEY=' "$DEST/.env" | cut -d= -f2-)
SERVICE_KEY=$(grep '^SERVICE_ROLE_KEY=' "$DEST/.env" | cut -d= -f2-)

cat <<EOF

=====================================================================
  $PROJECT is up.
=====================================================================
  Kong (proxy target for Caddy):  http://127.0.0.1:$KONG_HTTP
                                  (Studio is served by Kong at /, too)
  Postgres (external port):       127.0.0.1:$PG_EXTERNAL
  Supavisor pooler:               127.0.0.1:$POOLER_TRANSACTION

  App env vars (drop into Netlify / Xcode / wherever):
    NEXT_PUBLIC_SUPABASE_URL      = https://$DOMAIN
    NEXT_PUBLIC_SUPABASE_ANON_KEY = $ANON_KEY
    NEXT_PUBLIC_INGEST_URL        = https://$DOMAIN/functions/v1/ingest

  Server-side / migration tooling only:
    SUPABASE_SERVICE_ROLE_KEY = $SERVICE_KEY

  Next steps:
    1. Add Caddy stanzas for $DOMAIN and studio.<project>.<your-domain>.
       The api.* stanza MUST include the /auth-templates/* file_server
       block pointing at $DEST/volumes/auth/templates — GoTrue fetches the
       email templates from that URL. See deploy/Caddyfile.example.
       Then:  sudo caddy validate --config /etc/caddy/Caddyfile
              sudo systemctl reload caddy
    2. Configure SMTP in $DEST/.env (SMTP_HOST, SMTP_USER, SMTP_PASS,
       SMTP_SENDER_NAME). SMTP_ADMIN_EMAIL is pre-filled with
       noreply@$APEX — change it if you'd prefer something else. After any
       .env edit, recreate the container (NOT restart):
         cd $DEST && docker compose up -d auth
    3. Customise the email branding by editing the header text (.hd cell)
       in $DEST/volumes/auth/templates/magic_link.html (and copy across to
       the other *.html siblings for the other auth flows). No restart
       needed — Caddy serves them straight off disk.
    4. Apply your app's migrations:
         cd /opt/<your-repo>
         for f in supabase/migrations/*.sql; do
           docker exec -i supabase-db psql -U postgres -d postgres < "\$f"
         done
=====================================================================
EOF
