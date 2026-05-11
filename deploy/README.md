# Self-hosting Supabase

Runs N Supabase stacks on one Linux box. Each project is fully isolated:
its own Postgres, own auth realm, own JWT secret, own Kong port.

## What this costs

| Item | Cost | Notes |
|---|---|---|
| Hetzner CCX13 | €13.10/mo | 2 vCPU dedicated, 8 GB RAM, 80 GB NVMe; fits ~3 stacks idling |
| Hetzner CCX23 | €25.49/mo | 4 vCPU, 16 GB RAM; comfortable for 5–6 stacks |
| Backblaze B2 | ~£1/mo | Backup target |
| Resend | £0 | 3 000 magic-link emails/mo on free tier |
| Domain | ~£10/yr | Or subdomain of one you own |

## What's in this folder

```
deploy/
├── README.md                this file
├── Caddyfile.example        reverse-proxy template — one stanza per project
└── scripts/
    ├── generate-secrets.ts  bun script: emits JWT secret + anon/service keys
    ├── new-project.sh       bootstraps /opt/supabase/<name> from upstream
    └── backup.sh            pg_dump → gzip → rclone to B2
```

The actual Supabase docker-compose comes from the upstream repo at run time;
we don't fork it. `new-project.sh` clones `supabase/supabase`, copies its
`docker/` folder per project, and patches the `.env`. Upgrades are then a
matter of re-running the clone step against a newer tag.

## First-time box setup

Provision a CCX13 (or CCX23) on Hetzner Cloud — Ubuntu 24.04 LTS, your SSH key
added at create time. Point an A record (`api.<project>.<your-domain>`) at the
public IP for every project you'll host.

```bash
ssh root@<public-ip>

# 1. hardening basics
apt update && apt upgrade -y
apt install -y ufw fail2ban unattended-upgrades
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw enable
dpkg-reconfigure -plow unattended-upgrades

# 2. non-root user
adduser kyle
usermod -aG sudo kyle
mkdir -p /home/kyle/.ssh
cp ~/.ssh/authorized_keys /home/kyle/.ssh/
chown -R kyle:kyle /home/kyle/.ssh
# disable root SSH after confirming kyle can log in:
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# 3. docker + compose plugin
apt install -y ca-certificates curl gnupg git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker kyle

# 4. caddy (reverse proxy + auto-TLS)
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy

# 5. bun + rclone (for our scripts + backups)
curl -fsSL https://bun.sh/install | bash
mv ~/.bun /usr/local/bun
ln -s /usr/local/bun/bin/bun /usr/local/bin/bun
apt install -y rclone
```

Clone this repo onto the box so the scripts are available:

```bash
sudo mkdir -p /opt/supabase
sudo chown kyle:kyle /opt/supabase
cd /opt
sudo git clone https://github.com/kylescudder/ets2-data-dashboard.git
sudo ln -s /opt/ets2-data-dashboard/deploy/scripts /opt/supabase/_scripts
```

## Bring up your first stack

```bash
sudo /opt/supabase/_scripts/new-project.sh ets2 8001 api.ets2.kylescudder.co.uk
```

That:
- clones `supabase/supabase` into `/opt/supabase/_cache/`
- copies `docker/` to `/opt/supabase/ets2/`
- generates fresh secrets, picks ports (Kong=8001, Studio=8002, Postgres
  external=8003), writes them into `.env`
- `docker compose up -d`
- prints the anon/service keys you need for the app

Configure SMTP in `/opt/supabase/ets2/.env` (set `SMTP_HOST`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_SENDER_NAME`, `SMTP_ADMIN_EMAIL`) — get an API key from
https://resend.com. Restart the auth container after editing:

```bash
cd /opt/supabase/ets2
docker compose restart auth
```

Edit `/etc/caddy/Caddyfile` from the template in `deploy/Caddyfile.example`,
then:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo caddy reload --config /etc/caddy/Caddyfile
```

Smoke test:

```bash
curl https://api.ets2.kylescudder.co.uk/auth/v1/health
# {"date":"...","description":"GoTrue is a user registration ...","name":"GoTrue","version":"..."}
```

## Adding more stacks

```bash
sudo /opt/supabase/_scripts/new-project.sh deadwax 8011 api.deadwaxclub.app
sudo /opt/supabase/_scripts/new-project.sh dashboard 8021 api.dashboard.kylescudder.co.uk
```

Each gets its own Kong port spaced 10 apart, leaving room for the per-project
sub-ports (Studio = base+1, Postgres = base+2, etc.). Add Caddy stanzas and
reload.

## Backups

One-time setup:

```bash
rclone config
# → New remote → name: b2 → Backblaze B2 → paste application key
```

Wire the script into cron (as the unprivileged user since the script uses
`docker exec`, which is already permitted via the `docker` group):

```bash
crontab -e
# add:
0 4 * * * /opt/supabase/_scripts/backup.sh >> /var/log/supabase-backup.log 2>&1
```

Verify by running it once by hand and checking the B2 bucket. Set a B2
lifecycle rule to delete files older than 30 days (cheaper than handling
pruning in the script).

To **restore** a project:

```bash
gunzip -c ets2-20260601T040000Z.sql.gz \
  | docker exec -i supabase-db-ets2 psql -U postgres
```

## Ongoing ops

- **OS patches**: handled by `unattended-upgrades`. Check `/var/log/unattended-upgrades/`
  monthly. Reboot quarterly to apply kernel updates.
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
- **Disk usage**: `docker system df` and `du -sh /opt/supabase/*/volumes/*`.
  WAL can grow; logflare/vector indexes can grow.
- **A container is unhealthy**: `docker compose ps`, then
  `docker compose logs --tail=200 <service>`. Restart with
  `docker compose restart <service>`.

## Pointing this app (ETS2 tracker) at it

After `new-project.sh ets2 8001 api.ets2.kylescudder.co.uk` and Caddy is serving:

1. `bunx supabase link --project-ref` doesn't apply — link by URL instead.
   From your dev machine:
   ```bash
   bunx supabase db push --db-url 'postgresql://postgres:<POSTGRES_PASSWORD>@api.ets2.kylescudder.co.uk:5432/postgres'
   bunx supabase functions deploy ingest \
     --project-ref ets2 \
     --api-url https://api.ets2.kylescudder.co.uk \
     --no-verify-jwt
   ```
   (If you don't expose Postgres externally, run `supabase db push` from the
   box itself against `127.0.0.1:<external-port>` over an SSH tunnel.)
2. In Netlify (or `apps/web/.env.local` for local dev), set:
   ```
   NEXT_PUBLIC_SUPABASE_URL = https://api.ets2.kylescudder.co.uk
   NEXT_PUBLIC_SUPABASE_ANON_KEY = <ANON_KEY printed by new-project.sh>
   NEXT_PUBLIC_INGEST_URL = https://api.ets2.kylescudder.co.uk/functions/v1/ingest
   ```
3. In Supabase Studio (`https://studio.kylescudder.co.uk/ets2/`), open Authentication
   → URL Configuration and add your Netlify URL(s) to "Redirect URLs".
4. Magic-link sign in once on the Netlify URL; the DB trigger will create
   your `public.users` row with an `api_key`, and `/profile` will surface it
   for the telemetry agent.

## Things to know

- **Don't commit `.env` files.** `deploy/projects/` is gitignored. The actual
  `/opt/supabase/<project>/.env` lives only on the box.
- **JWT_SECRET is the master key.** Rotating it invalidates every anon and
  service_role key, plus every issued user session.
- **PITR is not included.** Daily backups recover to 04:00 UTC, not to an
  arbitrary timestamp. If that matters, add pgBackRest later — it's not
  hard, just more setup.
- **One bad migration crashes the project.** Test against the local Supabase
  stack first (`bun run sb:start`) before pushing to prod.
