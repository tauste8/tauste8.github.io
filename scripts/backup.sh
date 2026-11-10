#!/usr/bin/env bash
# Copia de seguridad de PostgreSQL + fotografías. Programar con cron, p. ej. a diario a las 3:15:
#   15 3 * * * /ruta/autoreca/scripts/backup.sh /ruta/copias >> /var/log/autoreca-backup.log 2>&1
# Conserva los últimos 30 días.
set -euo pipefail
DEST="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M)"
mkdir -p "$DEST"
cd "$(dirname "$0")/.."
docker compose exec -T db pg_dump -U autoreca -d autoreca --format=custom > "$DEST/autoreca-$STAMP.dump"
docker compose run --rm -T --no-deps -v "$(realpath "$DEST")":/backup --entrypoint sh app -c "tar czf /backup/uploads-$STAMP.tgz -C /data uploads"
find "$DEST" -name 'autoreca-*.dump' -mtime +30 -delete
find "$DEST" -name 'uploads-*.tgz' -mtime +30 -delete
echo "Copia completada: $DEST/autoreca-$STAMP.dump"
# Restaurar:  docker compose exec -T db pg_restore -U autoreca -d autoreca --clean < autoreca-AAAAMMDD-HHMM.dump
