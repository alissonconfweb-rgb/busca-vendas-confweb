#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"

backup_dir="backups"
timestamp="$(date -u +'%Y-%m-%dT%H-%M-%SZ')"
backup_name="busca-vendas-$timestamp.sqlite"

mkdir -p "$backup_dir"
docker compose exec -T app node server/backup-db.mjs "/backups/$backup_name"
gzip "$backup_dir/$backup_name"
find "$backup_dir" -type f -name 'busca-vendas-*.sqlite.gz' -mtime +14 -delete

echo "Backup criado e validado: $backup_dir/$backup_name.gz"
