#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env.production ]]; then
  echo "Arquivo .env.production ausente. Copie .env.production.example e configure os segredos."
  exit 1
fi

mkdir -p data backups
chown -R 1000:1000 data
chmod 700 data backups
chmod 600 .env.production

docker compose build --pull
docker compose up -d --remove-orphans

echo "Aguardando a aplicacao ficar saudavel..."
for attempt in {1..40}; do
  container_id="$(docker compose ps -q app)"
  status="$(docker inspect --format='{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    docker compose ps
    echo "Busca Vendas publicado com sucesso."
    exit 0
  fi
  sleep 3
done

docker compose ps
docker compose logs --tail=120 app
echo "A aplicacao nao ficou saudavel no tempo esperado."
exit 1
