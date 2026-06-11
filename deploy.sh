#!/bin/bash
# LOCAL/DEV deployment only (docker-compose). The canonical production
# target is RENDER via render.yaml — Render auto-deploys from main. (W-14)
set -euo pipefail

# Required configuration — no hardcoded defaults on purpose.
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN env var is required}"
: "${WEBHOOK_URL:?WEBHOOK_URL env var is required (https://<your-host>/webhook)}"

echo "=== FxAeon local deployment (docker-compose) ==="

command -v docker >/dev/null 2>&1 || { echo "Docker required"; exit 1; }
docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1 || { echo "Docker Compose required"; exit 1; }
COMPOSE="docker compose"; docker compose version >/dev/null 2>&1 || COMPOSE="docker-compose"

echo "Building images..."
$COMPOSE build

echo "Starting services..."
$COMPOSE up -d

echo "Setting Telegram webhook..."
curl -sf -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${WEBHOOK_URL}" \
  --data-urlencode "max_connections=40" \
  --data-urlencode 'allowed_updates=["message","callback_query","inline_query"]'

echo ""
echo "=== Done ==="
echo "Webhook: ${WEBHOOK_URL}"
echo "Health check: curl http://localhost:8080/api/v1/health"
