# FxAeon Setup Guide

Complete setup guide to get your FxAeon Telegram DeFi bot running.

## Required Accounts & APIs

### 1. Telegram Bot (FREE)
- **What**: Your bot on Telegram
- **How**: Message [@BotFather](https://t.me/BotFather), send `/newbot`, follow prompts
- **What you get**: Bot token (looks like `123456:ABC-DEF1234ghI-klmn567890`)
- **Cost**: Free
- **Setup time**: 2 minutes

### 2. Privy (FREE tier)
- **What**: MPC wallet infrastructure for your users
- **How**: Sign up at [dashboard.privy.io](https://dashboard.privy.io)
- **What you get**: App ID (looks like `cmq...`), App Secret, JWKS endpoint
- **Cost**: Free up to 1,000 MAU, then $0.01/user
- **Setup time**: 5 minutes

### 3. Alchemy (FREE tier)
- **What**: Ethereum RPC node access
- **How**: Sign up at [dashboard.alchemy.com](https://dashboard.alchemy.com)
- **What you get**: API key (looks like `JIxO3...`)
- **Cost**: Free up to 300M compute units/month
- **Setup time**: 3 minutes

### 4. PostgreSQL (FREE tier available)
- **What**: PostgreSQL 17 database (production runs Postgres 17)
- **How**: Render Postgres (pairs with the bot's Render service), Supabase, or Neon — any managed Postgres works
- **What you get**: Database URL (`postgresql://user:pass@host:5432/db`)
- **Cost**: Free tiers available on all three
- **Setup time**: 5 minutes

### 5. Upstash Redis (FREE tier)
- **What**: Redis cache for rate limiting, sessions, queues
- **How**: Sign up at [console.upstash.com](https://console.upstash.com), create Redis database
- **What you get**: REST URL and token
- **Cost**: Free up to 10,000 requests/day
- **Setup time**: 3 minutes

### 6. Cloudflare Pages (FREE)
- **What**: Host your Mini App
- **How**: Sign up at [dash.cloudflare.com](https://dash.cloudflare.com), go to Pages
- **What you get**: `*.pages.dev` URL
- **Cost**: Free unlimited requests
- **Setup time**: 5 minutes

### 7. Render (bot hosting — canonical)
- **What**: Hosts the bot as a Docker web service (`render.yaml` blueprint, auto-deploys `main`)
- **How**: Sign up at [render.com](https://render.com), create a Blueprint from this repo
- **Cost**: Starter plan ~$7/month (free tier sleeps, which breaks webhooks)
- **Setup time**: 10 minutes

---

## Optional but Recommended

### 8. Sentry (FREE tier)
- **What**: Error tracking and monitoring
- **How**: Sign up at [sentry.io](https://sentry.io)
- **What you get**: DSN URL for error reporting
- **Cost**: Free up to 5,000 errors/month

### 9. UptimeRobot (FREE tier)
- **What**: Uptime monitoring for your bot
- **How**: Sign up at [uptimerobot.com](https://uptimerobot.com)
- **What you get**: Monitor URLs, get alerts when down
- **Cost**: Free up to 50 monitors

---

## Step-by-Step Setup

### Step 1: Clone the Repo

```bash
git clone https://github.com/0xNaeemHassan/FxAeon.git
cd FxAeon
```

Or if using the bundle:
```bash
git clone fxaeon-final.bundle FxAeon
cd FxAeon
git remote add origin https://github.com/0xNaeemHassan/FxAeon.git
git push -u origin main
```

### Step 2: Install Dependencies

```bash
# Install pnpm if you don't have it
npm install -g pnpm

# Install all dependencies
pnpm install
```

### Step 3: Configure Environment Variables

Copy the example files and fill in your values:

```bash
cp .env.example .env
cp apps/bot/.env.example apps/bot/.env.production
cp apps/mini-app/.env.example apps/mini-app/.env.local
```

Edit each file with your actual credentials:

**`.env` (root - for Docker Compose):**
```
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret
DATABASE_URL=your_supabase_connection_string
REDIS_URL=your_upstash_redis_url
ALCHEMY_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ENCRYPTION_KEY=openssl_rand_hex_32_output
```

**`apps/bot/.env.production`:**
```
TELEGRAM_BOT_TOKEN=your_bot_token
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret
PRIVY_JWKS_ENDPOINT=https://auth.privy.io/api/v1/apps/YOUR_APP_ID/jwks.json
DATABASE_URL=your_supabase_url
REDIS_URL=your_upstash_url
REDIS_TOKEN=your_upstash_token
ALCHEMY_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ENCRYPTION_KEY=your_32_char_hex_key
MINI_APP_URL=https://your-mini-app.pages.dev
NODE_ENV=production
PORT=8080
```

**`apps/mini-app/.env.local`:**
```
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=YourBotUsername
NEXT_PUBLIC_MINI_APP_URL=https://your-mini-app.pages.dev
NEXT_PUBLIC_ALCHEMY_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
```

### Step 4: Generate Encryption Key

```bash
openssl rand -hex 32
```

Copy the output into `ENCRYPTION_KEY` in your `.env` files.

### Step 5: Set Up Database

```bash
cd packages/db
pnpm db:generate  # Generate Prisma client
pnpm db:deploy    # Apply migrations to your Postgres
```

### Step 6: Build Everything

```bash
# From project root
pnpm run build
```

### Step 7: Deploy Mini App to Cloudflare Pages

```bash
cd apps/mini-app
pnpm build

# Deploy using Wrangler
npx wrangler pages deploy dist --project-name=fxaeon-mini-app
```

Or connect your GitHub repo to Cloudflare Pages for auto-deployment.

### Step 8: Deploy Bot

**Option A: Render (canonical — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md))**
```text
1. Render dashboard -> New -> Blueprint -> select this repo (picks up render.yaml)
2. Set all `sync: false` env vars in the service's Environment tab
3. Every push to main auto-deploys; /health gates the deploy
```

**Option B: Docker (local / self-hosting)**
```bash
# From project root
docker-compose up -d
```

**Option C: VPS / Server**
```bash
# Build
pnpm run build

# Start bot
cd apps/bot
pnpm start

# Or use PM2 for process management
pm2 start dist/main.js --name fxaeon-bot
```

### Step 9: Set Telegram Webhook

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook"   -d "url=https://your-bot-domain.com/webhook"   -d "max_connections=40"
```

Replace `your-bot-domain.com` with your actual domain (Render URL, VPS IP, etc.). On Render this happens automatically at boot using `RENDER_EXTERNAL_URL` + `TELEGRAM_WEBHOOK_SECRET`.

### Step 10: Verify Everything Works

```bash
# Run health check
./health-check.sh https://your-bot-domain.com

# Post-deploy smoke test (same one CI runs)
BOT_URL=https://your-bot-domain.com TELEGRAM_TOKEN=... node smoke-test.js
```

You should see all checks passing.

---

## Quick Start Checklist

- [ ] Created Telegram bot via @BotFather
- [ ] Signed up for Privy and got App ID + Secret
- [ ] Signed up for Alchemy and got API key
- [ ] Provisioned Postgres 17 and got database URL
- [ ] Created Upstash Redis and got URL + token
- [ ] Cloned the repo
- [ ] Installed dependencies (`pnpm install`)
- [ ] Copied and filled in all `.env` files
- [ ] Generated encryption key (`openssl rand -hex 32`)
- [ ] Set up database (`pnpm db:deploy`)
- [ ] Built the project (`pnpm run build`)
- [ ] Deployed Mini App to Cloudflare Pages
- [ ] Deployed bot (Render blueprint / Docker / VPS)
- [ ] Set Telegram webhook
- [ ] Ran health check and confirmed all green

---

## Cost Estimate (Monthly)

| Service | Free Tier | Paid (if you grow) |
|---------|-----------|-------------------|
| Telegram Bot | Free | Free |
| Privy | 1,000 users | ~$10-50 |
| Alchemy | 300M CU | ~$0-49 |
| Postgres (Render/Supabase/Neon) | free tiers | ~$7-25 |
| Upstash Redis | 10K req/day | ~$10 |
| Cloudflare Pages | Unlimited | Free |
| Render (bot) | — | ~$7 |
| **Total** | **$0** | **~$50-150** |

---

## Troubleshooting

**Bot not responding?**
- Check webhook is set: `curl https://api.telegram.org/botTOKEN/getWebhookInfo`
- Check bot is running: `curl https://your-domain/health`
- Check logs: Render dashboard -> Logs, or `docker logs fxaeon-bot`

**Mini App not loading?**
- Check Cloudflare Pages deployment status
- Verify `NEXT_PUBLIC_PRIVY_APP_ID` is set correctly
- Check browser console for errors

**Database connection failed?**
- Verify the Postgres connection string
- Check your provider's IP allowlist (add the server's IP)
- Test connection: `psql YOUR_DATABASE_URL -c "SELECT 1"`

**Wallet connection not working?**
- Verify Privy App ID matches in bot and Mini App
- Check Privy dashboard for allowed domains (add your Mini App URL)
- Ensure JWKS endpoint is accessible

---

## Support

- Telegram Bot: [@FxAeonBot](https://t.me/FxAeonBot)
- GitHub Issues: [github.com/0xNaeemHassan/FxAeon/issues](https://github.com/0xNaeemHassan/FxAeon/issues)
- Documentation: See `docs/` folder in the repo
