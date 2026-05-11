#!/usr/bin/env bash
# Dump every running Supabase Postgres container, gzip, ship to Backblaze B2
# via rclone. Designed to be run from cron, e.g.:
#
#   0 4 * * * /opt/supabase/_scripts/backup.sh >> /var/log/supabase-backup.log 2>&1
#
# Prereqs on the box:
#   * `rclone` installed and a remote named `b2` configured
#       (`rclone config` → New remote → Backblaze B2)
#   * The bucket exists, lifecycle rule trims older than 30 days (configurable
#       in the B2 UI; cheaper than handling pruning here)
#
# Env vars you may override:
#   BACKUP_DIR        local staging directory                (default /var/backups/supabase)
#   BACKUP_REMOTE     rclone target                           (default b2:supabase-backups)
#   BACKUP_KEEP_DAYS  also keep this many days on local disk  (default 7)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/supabase}"
BACKUP_REMOTE="${BACKUP_REMOTE:-b2:supabase-backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"

mkdir -p "$BACKUP_DIR"

stamp=$(date -u +%Y%m%dT%H%M%SZ)

# Find every running container that looks like a Supabase Postgres (the
# official compose names them supabase-db-<project>). Adjust the pattern if you
# rename projects.
mapfile -t containers < <(docker ps --format '{{.Names}}' | grep -E '^supabase-db-' || true)

if [[ ${#containers[@]} -eq 0 ]]; then
  echo "[$stamp] no supabase-db-* containers running; nothing to back up"
  exit 0
fi

for c in "${containers[@]}"; do
  project="${c#supabase-db-}"
  out="$BACKUP_DIR/${project}-${stamp}.sql.gz"
  echo "[$stamp] dumping $c -> $out"
  docker exec "$c" pg_dumpall -U postgres | gzip -9 > "$out"
done

echo "[$stamp] syncing to $BACKUP_REMOTE"
rclone copy --quiet "$BACKUP_DIR" "$BACKUP_REMOTE"

echo "[$stamp] pruning local copies older than $BACKUP_KEEP_DAYS days"
find "$BACKUP_DIR" -type f -name '*.sql.gz' -mtime "+$BACKUP_KEEP_DAYS" -delete

echo "[$stamp] done"
