#!/usr/bin/env bash
# Nightly: Postgres dump plus the private memory repositories. Keeps 14 days.
set -euo pipefail
cd "$(dirname "$0")"
STAMP="$(date -u +%Y%m%dT%H%MZ)"
OUT="${DIRA_BACKUP_DIR:-$HOME/backups}"
install -d -m 700 "$OUT"
docker compose --env-file dira.env exec -T postgres pg_dump -U postgres -Fc dira > "$OUT/dira-$STAMP.dump"
docker compose --env-file dira.env exec -T orchestrator tar -C /var/lib/dira -czf - memory > "$OUT/memory-$STAMP.tgz"
chmod 600 "$OUT"/*-"$STAMP".*
find "$OUT" -name 'dira-*.dump' -mtime +14 -delete
find "$OUT" -name 'memory-*.tgz' -mtime +14 -delete
echo "backup $STAMP complete"
