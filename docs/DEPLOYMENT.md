# fxBot Deployment Guide (Production-Ready)

## Credentials Summary

| Service | Value | Status |
|---|---|---|
| **Telegram Bot** | @FxAeonBot | Ready |
| **Privy App ID** | `cmq6a73jc002k0cl5vgleejt2` | Ready |
| **Alchemy RPC** | `https://eth-mainnet.g.alchemy.com/v2/<key>` (from Alchemy dashboard) | Ready |
| **Supabase DB** | `gadzbgakqipnvkfozcfa.supabase.co` | Ready |
| **Upstash Redis** | `allowed-honeybee-114181.upstash.io` | Ready |

## Quick Deploy (Docker)

```bash
# 1. Clone and enter
cd fxbot

# 2. Copy .env.example to .env and fill in real values (never commit .env)

# 3. Build and start
docker-compose up -d

# 4. Set webhook (replace with your domain)
export WEBHOOK_URL=https://your-domain.com/webhook
./deploy.sh
```

## Manual Deploy (Fly.io)

```bash
# Install flyctl
brew install flyctl

# Login
flyctl auth login

# Create app
flyctl apps create fxaeon-bot

# Set secrets
flyctl secrets set \
  TELEGRAM_BOT_TOKEN=<from BotFather> \
  PRIVY_APP_ID=<from Privy dashboard> \
  PRIVY_APP_SECRET=<from Privy dashboard> \
  DATABASE_URL=<from Supabase: Settings -> Database -> Connection string> \
  REDIS_URL=<from Upstash: REST URL> \
  REDIS_TOKEN=<from Upstash: REST token> \
  ALCHEMY_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key> \
  ENCRYPTION_KEY=<openssl rand -hex 32> \
  MINI_APP_URL=https://fxbot-mini-app.pages.dev

# Deploy
flyctl deploy

# Set webhook
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://fxaeon-bot.fly.dev/webhook"
```

## Mini App Deploy (Cloudflare Pages)

```bash
cd apps/mini-app

# Build
pnpm install
pnpm build

# Deploy to Cloudflare Pages
# Upload dist/ folder via dashboard or wrangler
```

## Verification Checklist

- [ ] `/start` in Telegram opens Mini App
- [ ] Wallet connects via Privy
- [ ] `/portfolio` shows positions
- [ ] `/deposit` shows QR code
- [ ] `/settings` works
- [ ] `/help` lists all commands
- [ ] Health endpoint responds: `curl https://your-domain/api/v1/health`

## Security Notes

1. **Rotate ENCRYPTION_KEY** — Generate a new 32-char key via `openssl rand -hex 32`
2. **Enable 2FA** on Supabase, Upstash, Alchemy, Privy dashboards
3. **Set IP allowlists** on Supabase and Upstash
4. **Monitor Alchemy usage** to stay within free tier limits
5. **Review Privy audit logs** weekly

## Support

- Bot: @FxAeonBot
- Issues: GitHub issues
- Emergency: Check ops/runbooks/
