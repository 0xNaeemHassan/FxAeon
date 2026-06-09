# fxBot Deployment Guide

## Prerequisites

- Node.js 22+
- pnpm 9+
- Fly.io CLI
- Cloudflare account
- Supabase account
- Privy app (free tier)
- Telegram BotFather account
- Alchemy API key (free tier)
- Surplus Intelligence API key

## Environment Variables

Create `.env` files:

### Bot (.env)
```
TELEGRAM_BOT_TOKEN=<from BotFather>
PRIVY_APP_ID=<from Privy dashboard>
PRIVY_APP_SECRET=<from Privy dashboard>
PRIVY_AUTHORIZATION_KEY=<generate with openssl>
DATABASE_URL=<from Supabase>
REDIS_URL=<from Upstash>
ALCHEMY_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key>
SURPLUS_API_KEY=<from Surplus dashboard>
KMS_MASTER_KEY=<32-byte hex, generate with openssl rand -hex 32>
MINI_APP_URL=https://fxbot-mini-app.pages.dev
NODE_ENV=production
```

### Mini App (.env.local)
```
NEXT_PUBLIC_PRIVY_APP_ID=<same as bot>
```

## Deployment Steps

### 1. Database
```bash
cd packages/db
pnpm db:generate
pnpm db:deploy
```

### 2. Bot (Fly.io)
```bash
cd apps/bot
flyctl apps create fxbot
flyctl secrets set TELEGRAM_BOT_TOKEN=... PRIVY_APP_ID=... ...
flyctl deploy
```

Set webhook:
```bash
curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook   -d url=https://fxbot.fly.dev/webhook
```

### 3. Mini App (Cloudflare Pages)
```bash
cd apps/mini-app
pnpm build
# Deploy dist/ folder to Cloudflare Pages
```

### 4. Monitoring
- UptimeRobot: Add monitors for bot health, Mini App, RPC
- Sentry: Configure DSN in Fly.io secrets
- PostHog: Add project API key

### 5. Backups
- Cloudflare R2 bucket: `fxbot-backups`
- Lifecycle rule: 30-day retention
- GitHub Actions: Backup workflow runs daily at 03:00 UTC

## Verification

1. `/start` in Telegram → Mini App opens
2. Connect wallet → Address shown
3. `/portfolio` → Shows positions (or "No positions")
4. `/settings` → Can change language, slippage, MEV
5. `/security` → Shows audits, policies
6. `/deposit` → Shows QR code
7. `/help` → Shows all commands

## Rollback

```bash
flyctl deploy --image <previous-image>
```

Database rollback via R2 backup:
```bash
gunzip -c s3://fxbot-backups/20260608.sql.gz | psql $DATABASE_URL
```


## Docker Deployment

### Build and Run with Docker

```bash
# Build the bot image
docker build -t fxbot:latest -f apps/bot/Dockerfile .

# Build the mini-app image
docker build -t fxbot-mini-app:latest -f apps/mini-app/Dockerfile .

# Run with docker-compose
docker-compose up -d
```

### Docker Compose Configuration

```yaml
version: '3.8'
services:
  bot:
    build: ./apps/bot
    env_file: .env
    depends_on:
      - postgres
      - redis
  mini-app:
    build: ./apps/mini-app
    ports:
      - "3000:3000"
    env_file: .env
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: fxbot
      POSTGRES_USER: fxbot
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```
