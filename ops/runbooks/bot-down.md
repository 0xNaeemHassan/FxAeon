# Runbook: Bot Down

## Symptoms
- Bot not responding to commands
- Health check endpoint returning errors
- Telegram webhook failing

## Steps
1. Check Fly.io status: `fly status --app fxbot`
2. Check logs: `fly logs --app fxbot`
3. Verify Redis connection: `redis-cli -u $REDIS_URL ping`
4. Check database: `psql $DATABASE_URL -c "SELECT 1"`
5. Restart if needed: `fly deploy --app fxbot`
6. Verify webhook: `curl https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo`

## Escalation
- If issue persists > 15 min, page on-call engineer
- Document incident in #incidents channel
