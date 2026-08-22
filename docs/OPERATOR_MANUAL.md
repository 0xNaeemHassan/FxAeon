# 🛠️ FxAeon Production Operator Manual

This guide covers deployment, environment configuration, database maintenance, Telegram Bot registration, and operational runbooks for running FxAeon in production.

---

## 1. Production Deployment Architectures

FxAeon can be deployed using **Docker Compose** (single-node VPS or bare metal) or **Render Blueprint** (cloud managed).

### Option A: 1-Click Docker Compose Deployment

1. **Clone repository and configure environment**:
   ```bash
   git clone https://github.com/0xNaeemHassan/FxAeon.git
   cd FxAeon
   cp apps/bot/.env.example .env.prod
   ```

2. **Launch production containers**:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

3. **Verify running services**:
   ```bash
   docker compose -f docker-compose.prod.yml ps
   ```

---

## 2. Environment Variables Checklist

| Variable | Required | Description | Example / Default |
|---|:---:|---|---|
| `TELEGRAM_BOT_TOKEN` | **YES** | Telegram Bot API token from `@BotFather`. | `123456789:ABCdef...` |
| `DATABASE_URL` | **YES** | PostgreSQL connection string. | `postgresql://user:pass@postgres:5432/fxaeon` |
| `REDIS_URL` | OPTIONAL | Redis URL for distributed rate limits & locks. | `redis://redis:6379` |
| `NEXT_PUBLIC_MINI_APP_URL` | **YES** | Public HTTPS domain serving the Mini App. | `https://mini-app.fxaeon.app` |
| `PORT` | OPTIONAL | Backend API port. | `3000` |
| `PRIVY_APP_ID` | **YES** | Privy Application ID for embedded wallets. | `clp...` |
| `PRIVY_APP_SECRET` | **YES** | Privy App Secret for backend authentication. | `sec...` |
| `PRIVY_AUTHORIZATION_KEY` | **YES** | Privy Server-side signing authorization key. | `privkey_...` |
| `RPC_URL_MAINNET` | **YES** | Ethereum Mainnet JSON-RPC endpoint. | `https://eth-mainnet.g.alchemy.com/v2/...` |
| `RPC_URL_BASE` | **YES** | Base L2 JSON-RPC endpoint. | `https://base-mainnet.g.alchemy.com/v2/...` |

---

## 3. Automated Telegram Bot Setup Script

Run the automated bot setup utility to register all slash commands, descriptions, and the WebApp Menu Button in one step:

```bash
node scripts/setup_telegram_bot.mjs
```

This will automatically configure:
* **Commands**: `/start`, `/trade`, `/portfolio`, `/radar`, `/whales`, `/pulse`, `/dca`, `/quests`, `/leaderboard`, `/affiliates`, `/help`.
* **Chat Menu Button**: Sets the persistent bottom-left WebApp button to `🚀 Launch FxAeon`.
* **Short Description & About Text**: Sets official high-conversion copy in Telegram directory.

---

## 4. Database Migrations & Prisma Management

1. **Apply migrations**:
   ```bash
   npx pnpm --filter @fxaeon/db prisma migrate deploy
   ```

2. **Inspect database using Prisma Studio**:
   ```bash
   npx pnpm --filter @fxaeon/db prisma studio
   ```

---

## 5. Risk Watcher & Background Poller Operation

The Risk Watcher daemon runs continuously inside the bot process to monitor open positions:
* **Scan Interval**: Every 60 seconds (`WORKER_INTERVAL_MS=60000`).
* **Liquidation Warning Threshold**: Triggers proactive Telegram DM alerts when collateral health falls below 110%.
* **Self-Healing RPC Failover**: Rotates between primary and fallback RPCs automatically on 429 / 503 errors.

---

## 6. Healthchecks & Diagnostics

* **API Healthcheck**: `GET /api/v1/health` ➔ Returns `{ status: "ok", uptime: 12400, timestamp: 1724281200 }`.
* **Prisma Connectivity**: `GET /api/v1/health/db` ➔ Returns `{ status: "ok", latencyMs: 3.2 }`.
