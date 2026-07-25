#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"

database="data/busca-vendas.sqlite"
backup_dir="backups"
timestamp="$(date -u +'%Y-%m-%dT%H-%M-%SZ')"

if [[ ! -f "$database" ]]; then
  echo "Banco nao encontrado em $database"
  exit 1
fi

mkdir -p "$backup_dir"
cp --preserve=timestamps "$database" "$backup_dir/busca-vendas-$timestamp.sqlite"
gzip "$backup_dir/busca-vendas-$timestamp.sqlite"
find "$backup_dir" -type f -name 'busca-vendas-*.sqlite.gz' -mtime +14 -delete

echo "Backup criado: $backup_dir/busca-vendas-$timestamp.sqlite.gz"
