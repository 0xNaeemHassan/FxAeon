#!/bin/bash
# LOCAL/DEV deployment only (docker-compose). The canonical production
# target is RENDER via render.yaml — Render auto-deploys from main. (W-14)
set -euo pipefail

# Required configuration — no hardcoded defaults on purpose.
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN env var is required}"
: "${WEBHOOK_URL:?WEBHOOK_URL env var is required (public origin, e.g. https://bot.example.com)}"
: "${TELEGRAM_WEBHOOK_SECRET:?TELEGRAM_WEBHOOK_SECRET env var is required}"

WEBHOOK_ORIGIN="${WEBHOOK_URL%/}"
case "$WEBHOOK_ORIGIN" in
  https://*/*) echo "WEBHOOK_URL must be an origin without a path; /webhook is added automatically" >&2; exit 1 ;;
  https://*) ;;
  *) echo "WEBHOOK_URL must be a public HTTPS origin" >&2; exit 1 ;;
esac
WEBHOOK_ENDPOINT="${WEBHOOK_ORIGIN}/webhook"

TELEGRAM_API_BASE_URL="${TELEGRAM_API_BASE_URL:-https://api.telegram.org}"
HEALTH_URL="${HEALTH_URL:-http://localhost/health}"

echo "=== FxAeon local deployment (docker-compose) ==="

command -v docker >/dev/null 2>&1 || { echo "Docker required"; exit 1; }
docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1 || { echo "Docker Compose required"; exit 1; }
COMPOSE="docker compose"; docker compose version >/dev/null 2>&1 || COMPOSE="docker-compose"

echo "Building images..."
$COMPOSE build

echo "Starting services..."
$COMPOSE up -d

echo "Setting Telegram webhook..."
curl -sf -X POST "${TELEGRAM_API_BASE_URL%/}/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${WEBHOOK_ENDPOINT}" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode "max_connections=40" \
  --data-urlencode 'allowed_updates=["message","callback_query","inline_query"]'

echo ""
echo "=== Done ==="
echo "Webhook: ${WEBHOOK_ENDPOINT}"
echo "Health check: curl ${HEALTH_URL}"
