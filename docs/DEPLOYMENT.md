# fxBot Deployment Guide (Production-Ready)

## Credentials Summary

| Service | Value | Status |
|---|---|---|
| **Telegram Bot** | @FxAeonBot | Ready |
| **Privy App ID** | `cmq6a73jc002k0cl5vgleejt2` | Ready |
| **Alchemy RPC** | `https://eth-mainnet.g.alchemy.com/v2/JIxO3Kr6uIQpBImDQEebV` | Ready |
| **Supabase DB** | `gadzbgakqipnvkfozcfa.supabase.co` | Ready |
| **Upstash Redis** | `allowed-honeybee-114181.upstash.io` | Ready |

## Quick Deploy (Docker)

```bash
# 1. Clone and enter
cd fxbot

# 2. Environment is already configured in .env

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
  TELEGRAM_BOT_TOKEN=8829006529:AAEedRLv8KKXx7DWBFbAfzBrFmtfj52S3so \
  PRIVY_APP_ID=cmq6a73jc002k0cl5vgleejt2 \
  PRIVY_APP_SECRET=privy_app_secret_4VcKWY4GKjpfQ4NwKqSjPgt2YMhXZSKdGtW7hoSAVCSdnGurbCj1g1WEwBriJneZpdej76feaErUPTHAu1sGfzR2 \
  DATABASE_URL=postgresql://postgres:vL5mMcXne1CLOm4z@db.gadzbgakqipnvkfozcfa.supabase.co:5432/postgres \
  REDIS_URL=https://allowed-honeybee-114181.upstash.io \
  REDIS_TOKEN=gQAAAAAAAb4FAAIgcDI0ZjczYzM4YmQwZDE0NjFlYWVmYmVhNTZmMTFlYzcxMw \
  ALCHEMY_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/JIxO3Kr6uIQpBImDQEebV \
  ENCRYPTION_KEY=your_32_char_key_here \
  MINI_APP_URL=https://fxbot-mini-app.pages.dev

# Deploy
flyctl deploy

# Set webhook
curl -X POST "https://api.telegram.org/bot8829006529:AAEedRLv8KKXx7DWBFbAfzBrFmtfj52S3so/setWebhook" \
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
