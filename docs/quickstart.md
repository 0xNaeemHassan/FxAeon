# fxBot Quick-Start Deployment Guide

> Deploy a production-ready f(x) Protocol Telegram bot in under 30 minutes.

---

## Prerequisites

- Node.js 22+ and pnpm 9+
- Fly.io CLI (`brew install flyctl`)
- Cloudflare account (free)
- Supabase account (free)
- Privy account (free) — https://dashboard.privy.io
- Telegram BotFather — https://t.me/BotFather
- Alchemy API key (free) — https://dashboard.alchemy.com

---

## Step 1: Clone & Install (2 min)

```bash
git clone https://github.com/your-org/fxbot.git
cd fxbot
pnpm install
```

---

## Step 2: Configure Environment (5 min)

```bash
cp apps/bot/.env.example apps/bot/.env
```

Edit `apps/bot/.env` with your keys:

| Variable | Where to get it |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather → /newbot |
| `PRIVY_APP_ID` | Privy Dashboard → App Settings |
| `PRIVY_APP_SECRET` | Privy Dashboard → Secrets |
| `PRIVY_AUTHORIZATION_KEY` | `openssl rand -hex 32` |
| `DATABASE_URL` | Supabase → Settings → Database → Connection String |
| `REDIS_URL` | Upstash → Redis → Connect → Node.js |
| `ALCHEMY_RPC_URL` | Alchemy Dashboard → Create App → Ethereum Mainnet |
| `KMS_MASTER_KEY` | `openssl rand -hex 32` |
| `SURPLUS_API_KEY` | Surplus Intelligence Dashboard (optional) |

---

## Step 3: Deploy Database (2 min)

```bash
cd packages/db
pnpm db:generate
pnpm db:deploy
```

---

## Step 4: Deploy Bot to Fly.io (5 min)

```bash
cd apps/bot
flyctl apps create fxbot
flyctl secrets set TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN   PRIVY_APP_ID=$PRIVY_APP_ID   PRIVY_APP_SECRET=$PRIVY_APP_SECRET   PRIVY_AUTHORIZATION_KEY=$PRIVY_AUTHORIZATION_KEY   DATABASE_URL=$DATABASE_URL   REDIS_URL=$REDIS_URL   ALCHEMY_RPC_URL=$ALCHEMY_RPC_URL   KMS_MASTER_KEY=$KMS_MASTER_KEY
flyctl deploy
```

Get your Fly.io URL: `flyctl status`

---

## Step 5: Set Telegram Webhook (1 min)

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"   -d "url=https://fxbot.fly.dev/webhook"
```

---

## Step 6: Deploy Mini App to Cloudflare Pages (5 min)

```bash
cd apps/mini-app
# Set your Privy app ID in .env.local
echo "NEXT_PUBLIC_PRIVY_APP_ID=$PRIVY_APP_ID" > .env.local
pnpm build
# Upload dist/ folder to Cloudflare Pages
```

Set `MINI_APP_URL` in Fly.io secrets:
```bash
flyctl secrets set MINI_APP_URL=https://your-project.pages.dev
```

---

## Step 7: Verify (5 min)

Send these commands to your bot in Telegram:

```
/start          → Should show welcome + "Connect Wallet" button
/portfolio      → Should show "No positions" (or your positions)
/settings       → Should show current settings
/help           → Should list all 20 commands
/deposit        → Should show QR code for your wallet address
```

---

## Step 8: Enable Monitoring (Optional, 5 min)

| Service | What to monitor | Free tier |
|---|---|---|
| UptimeRobot | `https://fxbot.fly.dev/health` | 50 monitors |
| Sentry | Error tracking | 5k events/mo |
| PostHog | Onboarding funnel | 1M events/mo |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Bot not responding | Check webhook URL with `curl` |
| "Database error" | Verify `DATABASE_URL` in Fly.io secrets |
| "Privy auth failed" | Check `PRIVY_APP_ID` and `PRIVY_APP_SECRET` |
| Mini App blank | Check `NEXT_PUBLIC_PRIVY_APP_ID` in build |
| Rate limited | Check Alchemy dashboard for CU usage |

---

## Next Steps

- Read the full [deployment guide](docs/deployment-guide.md) for advanced config
- Review [security runbooks](apps/ops/runbooks/) for incident response
- Check the [threat model](docs/threat-model.md) for security architecture
- Monitor the [architecture diagram](docs/architecture-diagram.md) for system overview

**Estimated total cost: ~$21/mo at 500 MAU** (mostly Surplus AI tokens; everything else is free tier)
