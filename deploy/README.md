# Self-hosting Supabase

Runs N Supabase stacks on one Linux box. Each project is fully isolated:
its own Postgres, own auth realm, own JWT secret, own Kong port.

## What this costs

| Item | Cost | Notes |
|---|---|---|
| Hetzner CPX32 | €16.79/mo | 4 vCPU shared, 8 GB RAM, 160 GB NVMe; tight for 3 stacks |
| Hetzner CPX42 | €30.59/mo | 8 vCPU, 16 GB RAM, 320 GB; comfortable headroom for 3–5 |
| Hetzner CCX13 | €13.10/mo | 2 dedicated vCPU, 8 GB; fine for 2 stacks if you trust the noisy-neighbour score on CCX |
| Backblaze B2 | ~£1/mo | Backup target |
| Brevo / Resend | £0 | Free tiers cover thousands of magic-link emails/mo |
| Domain | ~£10/yr | Or subdomain of one you own |

## What's in this folder

```
deploy/
├── README.md                this file
├── Caddyfile.example        reverse-proxy template — one stanza pair per project
├── templates/
│   └── magic_link.html      dark/amber email template, auto-installed per project
└── scripts/
    ├── generate-secrets.ts  bun script: emits JWT secret + anon/service keys
    ├── new-project.sh       bootstraps /opt/supabase/<name> from upstream
    └── backup.sh            pg_dump → gzip → rclone to B2
```

The actual Supabase docker-compose comes from the upstream repo at run time;
we don't fork it. `new-project.sh` clones `supabase/supabase`, copies its
`docker/` folder per project, generates secrets, drops a
`docker-compose.override.yml` that wires our email template into GoTrue, and
brings the stack up. Upgrades are then a matter of re-pulling the clone.

## First-time box setup

Provision the VPS on Hetzner Cloud — Ubuntu 24.04 LTS, your SSH key added at
create time. Point an A record (`api.<project>.<your-domain>` and
`studio.<project>.<your-domain>`) at the public IP for every project you'll
host.

### Network firewall

Two layers, both deny-by-default:

1. **Hetzner Cloud Firewall** (created in the web console, attached to the
   server). Inbound rules:
   - TCP 22 from `100.64.0.0/10` (Tailscale CGNAT range)
   - TCP 80 + 443 from `0.0.0.0/0`, `::/0`
   - All other inbound: deny. Outbound: allow-all.
2. **UFW on the box** (covered in the host setup below). Mirrors the Hetzner
   rules so a misconfigured cloud firewall doesn't leave the host exposed.

### Host setup

SSH in as root and run through the blocks. Each ends with a verify step.

```bash
# 1. patch the OS
apt update && apt upgrade -y

# 2. security baseline
apt install -y ufw fail2ban unattended-upgrades

ufw default deny incoming
ufw default allow outgoing
ufw allow from 100.64.0.0/10 to any port 22 proto tcp comment 'SSH from tailnet only'
ufw allow 80,443/tcp comment 'Caddy public'
ufw --force enable

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# 3. non-root user (substitute your name everywhere)
adduser kyle
usermod -aG sudo kyle
mkdir -p /home/kyle/.ssh
cp ~/.ssh/authorized_keys /home/kyle/.ssh/
chmod 700 /home/kyle/.ssh
chmod 600 /home/kyle/.ssh/authorized_keys
chown -R kyle:kyle /home/kyle/.ssh

# 4. Tailscale (private SSH layer)
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up         # follow the URL, sign in

# 5. open a second terminal, confirm `ssh kyle@<tailscale-ip>` works,
#    THEN disable public/password SSH:
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

From here on, all commands run as `kyle` over Tailscale.

```bash
# 6. docker + compose plugin
sudo apt install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
# (long single line — paste in one piece)
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker   # pick up the group without re-login

# 7. caddy (reverse proxy + auto-TLS). The Ubuntu-repo version is fine for
#    our needs; skip the cloudsmith repo to avoid GPG faff.
sudo apt install -y caddy

# 8. bun (installed globally so `sudo new-project.sh` finds it). The install
#    creates ~/.bun/bin/bun + ~/.bun/bin/bunx (a symlink to bun). After we
#    move the dir, the bunx symlink dangles — recreate it explicitly.
sudo apt install -y unzip
curl -fsSL https://bun.sh/install | bash
sudo mv ~/.bun /usr/local/bun
sudo rm -f /usr/local/bun/bin/bunx
sudo ln -s /usr/local/bun/bin/bun /usr/local/bun/bin/bunx
sudo ln -s /usr/local/bun/bin/bun /usr/local/bin/bun
sudo ln -s /usr/local/bun/bin/bunx /usr/local/bin/bunx

# 9. rclone (for backups)
sudo apt install -y rclone
```

Verify:

```bash
docker run --rm hello-world
caddy version
bun --version
bunx --version
rclone --version | head -1
```

Clone this repo onto the box so the scripts are available:

```bash
sudo mkdir -p /opt/supabase
sudo chown $USER:$USER /opt/supabase
cd /opt
sudo git clone https://github.com/kylescudder/ets2-data-dashboard.git
sudo chown -R $USER:$USER ets2-data-dashboard
sudo ln -s /opt/ets2-data-dashboard/deploy/scripts /opt/supabase/_scripts
```

## Bring up your first stack

```bash
sudo /opt/supabase/_scripts/new-project.sh \
  ets2 \
  8001 \
  api.ets2.kylescudder.co.uk \
  ets2.kylescudder.co.uk
```

Args: `<project> <base-port> <api-domain> <site-domain>`. The 4th is the
user-facing URL where magic-link emails redirect (your Netlify domain), and
is optional — if omitted, SITE_URL defaults to the API domain and the
script warns. You'll want to set it correctly here.

The script:
- clones `supabase/supabase` into `/opt/supabase/_cache/`
- copies `docker/` to `/opt/supabase/ets2/`
- generates fresh secrets, allocates Kong (8001), pooler (8004/8005),
  Postgres external (8003)
- installs the dark/amber `magic_link.html` template from `deploy/templates/`
  and writes a `docker-compose.override.yml` that mounts it into GoTrue
- chowns `/opt/supabase/ets2/` to you so future `.env` edits don't need sudo
- `docker compose up -d`
- prints the anon/service keys

### Wire up SMTP

GoTrue won't send magic-link emails until SMTP creds are set. Easiest free
option is [Brevo](https://brevo.com) — 300 emails/day, allows multiple
verified sending domains on the free tier.

1. Sign up at Brevo, verify your domain (`kylescudder.co.uk`) by adding the
   SPF/DKIM/DMARC TXT records they show you.
2. Brevo → SMTP & API → SMTP → grab the host/port/user and create an SMTP
   key. Whitelist your box's public IP in Brevo's "Authorized IPs" panel.
3. Edit `/opt/supabase/ets2/.env`:
   ```
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_USER=<your-brevo-smtp-user>
   SMTP_PASS=<your-brevo-smtp-key>
   SMTP_SENDER_NAME=ETS2 Tracker
   SMTP_ADMIN_EMAIL=noreply@kylescudder.co.uk
   ```
4. **Recreate** the auth container so it picks up the new env vars
   (`docker compose restart` won't — it keeps the old captured env):
   ```bash
   cd /opt/supabase/ets2
   docker compose up -d auth
   ```

### Wire up Caddy

Edit `/etc/caddy/Caddyfile` from `deploy/Caddyfile.example` — one stanza
per project for the API hostname, one for the Studio hostname (both point
at the same Kong port).

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo journalctl -u caddy -f      # watch certs land, Ctrl+C when done
```

### Smoke test

```bash
ANON=$(grep '^ANON_KEY=' /opt/supabase/ets2/.env | cut -d= -f2-)
curl -i https://api.ets2.kylescudder.co.uk/auth/v1/health -H "apikey: $ANON"
# expect HTTP/2 200, JSON with name:"GoTrue"
```

Studio: visit `https://studio.ets2.kylescudder.co.uk` and log in with
`supabase` / `DASHBOARD_PASSWORD` from `.env`.

## Adding more stacks

```bash
sudo /opt/supabase/_scripts/new-project.sh deadwax 8011 api.deadwaxclub.app deadwaxclub.app
sudo /opt/supabase/_scripts/new-project.sh dashboard 8021 api.dashboard.kylescudder.co.uk dashboard.kylescudder.co.uk
```

Each gets its own Kong port spaced 10 apart. Add Caddy stanzas (api + studio
per project) and reload.

## Backups

One-time setup:

```bash
rclone config
# → New remote → name: b2 → Backblaze B2 → paste application key
```

Wire the script into cron:

```bash
crontab -e
# add:
0 4 * * * /opt/supabase/_scripts/backup.sh >> /var/log/supabase-backup.log 2>&1
```

Verify by running it once by hand and checking the B2 bucket. Set a B2
lifecycle rule to delete files older than 30 days (cheaper than pruning in
the script).

To **restore** a project:

```bash
gunzip -c ets2-20260601T040000Z.sql.gz \
  | docker exec -i supabase-db-ets2 psql -U postgres
```

## Ongoing ops

- **OS patches**: handled by `unattended-upgrades`. Check
  `/var/log/unattended-upgrades/` monthly. Reboot quarterly to apply kernel
  updates.
- **Supabase upgrades**: roughly bi-monthly. Pull the latest upstream and
  re-apply per project:
  ```bash
  cd /opt/supabase/_cache/supabase && git pull
  cd /opt/supabase/ets2
  # copy any new keys from /opt/supabase/_cache/supabase/docker/.env.example
  # to your .env *without* overwriting your secrets
  docker compose pull
  docker compose up -d
  ```
  Read the release notes before bumping; auth and realtime occasionally
  rename env vars.
- **After any `.env` edit**: `docker compose up -d <service>`, **not**
  `restart`. `restart` reuses the previously-captured env; `up -d` recreates
  the container so it picks up the new values.
- **Disk usage**: `docker system df` and `du -sh /opt/supabase/*/volumes/*`.
  WAL can grow; logflare/vector indexes can grow.
- **A container is unhealthy**: `docker compose ps`, then
  `docker compose logs --tail=200 <service>`. `docker compose up -d <service>`
  recreates it.

## Pointing an app at the stack

After `new-project.sh` is done and Caddy is serving the API hostname:

### 1. Apply your app's migrations

Supabase's CLI (`bunx supabase db push`) doesn't play nicely with self-host
— it forces TLS on the connection and supavisor doesn't serve TLS on
localhost. Just feed the SQL files to `psql` inside the Postgres container:

```bash
cd /opt/ets2-data-dashboard      # or wherever your app's repo lives
for f in supabase/migrations/*.sql; do
  echo "==> applying $(basename "$f")"
  docker exec -i supabase-db psql -U postgres -d postgres < "$f"
done
```

Trade-off vs `supabase db push`: this doesn't write to the
`supabase_migrations.schema_migrations` tracking table. For self-host where
you manage migrations manually, that's fine.

### 2. Deploy edge functions

```bash
# Copy from the repo into the project's functions volume.
sudo cp -r /opt/ets2-data-dashboard/supabase/functions/ingest \
  /opt/supabase/ets2/volumes/functions/
sudo chmod -R a+rX /opt/supabase/ets2/volumes/functions/ingest
cd /opt/supabase/ets2
docker compose restart functions
```

Smoke-test:

```bash
ANON=$(grep '^ANON_KEY=' .env | cut -d= -f2-)
curl -i -X OPTIONS https://api.ets2.kylescudder.co.uk/functions/v1/ingest \
  -H "apikey: $ANON"
# expect HTTP/2 200 with CORS headers
```

### 3. Wire Netlify env vars

```
NEXT_PUBLIC_SUPABASE_URL      = https://api.ets2.kylescudder.co.uk
NEXT_PUBLIC_SUPABASE_ANON_KEY = <ANON_KEY from .env>
NEXT_PUBLIC_INGEST_URL        = https://api.ets2.kylescudder.co.uk/functions/v1/ingest
```

Trigger a build with "Clear cache and deploy" so Next.js picks up the new
`NEXT_PUBLIC_*` values.

### 4. Auth redirect URLs

Self-hosted Studio doesn't expose the URL-config UI; set the values via
`.env` instead:

```
SITE_URL=https://ets2.kylescudder.co.uk
ADDITIONAL_REDIRECT_URLS=https://ets2.kylescudder.co.uk/auth/callback,https://<your>.netlify.app/auth/callback
```

Then `docker compose up -d auth`.

### 5. Sign in

Magic-link sign in on the Netlify URL. The DB trigger creates a row in
`public.users` with a fresh `api_key`, and the app's `/profile` page
surfaces it for the telemetry agent.

## Things to know (gotchas)

- **Don't commit `.env` files.** `deploy/projects/` is gitignored. The
  actual `/opt/supabase/<project>/.env` lives only on the box.
- **`docker compose restart` doesn't pick up `.env` changes.** Use
  `docker compose up -d <service>` after any `.env` edit.
- **Rotating `POSTGRES_PASSWORD` after first boot is destructive.** Internal
  Postgres roles (`supabase_admin`, `authenticator`, etc.) get their
  passwords hashed into `pg_authid` at first init; subsequent boots compare
  the new `.env` value against the old hash and fail. If you must rotate
  post-bootstrap, do it via `ALTER USER ... WITH PASSWORD` inside Postgres
  itself, not by editing `.env`. Doing rotation **before** any real data
  exists is free: `docker compose down -v && sudo rm -rf volumes/db/data &&
  docker compose up -d`.
- **JWT_SECRET is the master key.** Rotating it forces fresh
  ANON_KEY/SERVICE_ROLE_KEY (also generated by `generate-secrets.ts`) and
  invalidates every issued user session.
- **PITR is not included.** Daily backups recover to 04:00 UTC, not to an
  arbitrary timestamp. If that matters, add pgBackRest later.
- **`SITE_URL` ≠ `API_EXTERNAL_URL`.** `SITE_URL` is the user-facing app
  (Netlify); the API URL is the Supabase host Caddy fronts. The fourth arg
  to `new-project.sh` distinguishes them.
- **Email template branding** lives in
  `/opt/supabase/<project>/volumes/auth/templates/magic_link.html`. Edit
  the header text, then `docker compose up -d auth`.
