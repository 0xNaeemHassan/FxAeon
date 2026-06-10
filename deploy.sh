#!/bin/bash
set -e

echo "=== fxBot Deployment Script ==="
echo "Bot: @FxAeonBot"
echo ""

# Check prerequisites
echo "Checking prerequisites..."
command -v docker >/dev/null 2>&1 || { echo "Docker required"; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo "Docker Compose required"; exit 1; }

# Build and deploy
echo "Building images..."
docker-compose build

echo "Starting services..."
docker-compose up -d

# Set Telegram webhook
echo "Setting Telegram webhook..."
WEBHOOK_URL="${WEBHOOK_URL:-https://your-domain.com/webhook}"
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN env var is required}"
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${WEBHOOK_URL}" \
  -d "max_connections=40" \
  -d "allowed_updates=["message","callback_query","inline_query"]"

echo ""
echo "=== Deployment Complete ==="
echo "Bot: @FxAeonBot"
echo "Webhook: ${WEBHOOK_URL}"
echo "Mini App: https://fxbot-mini-app.pages.dev"
echo ""
echo "Health check: curl http://localhost:8080/api/v1/health"
