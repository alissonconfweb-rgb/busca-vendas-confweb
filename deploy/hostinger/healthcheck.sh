#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"
health_url="https://${APP_DOMAIN:-buscavendas.confweb.com.br}/api/health"

if curl --fail --silent --show-error --max-time 15 "$health_url" | grep -q '"ok":true'; then
  exit 0
fi

echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') healthcheck falhou; reiniciando o app"
docker compose restart app
sleep 10
curl --fail --silent --show-error --max-time 15 "$health_url" | grep -q '"ok":true'
