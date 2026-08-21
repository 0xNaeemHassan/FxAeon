# Setup

This guide configures a local development environment and identifies the production-only requirements. Deployment procedures are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Prerequisites

- Node.js 22 (`.nvmrc` is authoritative)
- Corepack and pnpm 11.16.0
- PostgreSQL compatible with Prisma 5
- An Ethereum mainnet RPC for on-chain reads, quotes, simulations, and transactions
- A Base mainnet RPC for Base-source bridge quotes and for any bidirectional bridge execution rollout
- A Telegram bot token from [BotFather](https://t.me/BotFather)
- A Privy application for wallet onboarding and delegated execution
- Redis for shared HTTP rate limits and a cross-process `DAILY_TX_CAP` counter; development can use the in-memory fallback. The executor also checks the day's persisted broadcast records and fails closed if that database query is unavailable. Redis does not make the in-process workers multi-replica safe, and the cap is an action-count guard rather than a transaction-value ceiling.

Optional operator services include Sentry, Etherscan, CoinGecko's API key, and an admin Telegram chat.

## 1. Install

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
pnpm --filter @fxaeon/db db:generate
```

## 2. Configure PostgreSQL

Create a database and export its connection string:

```bash
export DATABASE_URL='postgresql://user:password@localhost:5432/fxaeon'
pnpm --filter @fxaeon/db exec prisma migrate deploy
```

PowerShell equivalent:

```powershell
$env:DATABASE_URL = 'postgresql://user:password@localhost:5432/fxaeon'
pnpm --filter @fxaeon/db exec prisma migrate deploy
```

For PgBouncer transaction pooling, follow the provider's Prisma guidance and add `pgbouncer=true` where required. The deep health endpoint reports common missing-schema, authentication, reachability, and prepared-statement failures without returning credentials.

## 3. Configure the bot process

At startup the bot loads `.env.local`, `.env.production`, and `.env` in that order through dotenv, relative to the process working directory. Existing shell or process-manager values win because file loading does not override them. For `pnpm --filter @fxaeon/bot dev`, copy `apps/bot/.env.example` to `apps/bot/.env` or export the variables explicitly. Docker Compose separately reads the repository-root `.env.example`/`.env` pair.

### Core schema

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `DATABASE_URL` | PostgreSQL connection string |
| `NODE_ENV` | `development`, `production`, or `test`; defaults to `development` |
| `PORT` | Express port; defaults to `8080` |
| `LOG_LEVEL` | `trace`, `debug`, `info`, `warn`, `error`, or `fatal`; defaults to `info` |

Only `TELEGRAM_BOT_TOKEN` and `DATABASE_URL` have no schema default. Set `NODE_ENV=production` explicitly in a deployment so production fail-fast validation is active.

### Required in production

| Variable | Purpose |
|---|---|
| `TELEGRAM_WEBHOOK_SECRET` | At least 32 characters; Telegram secret-token verification |
| `ENCRYPTION_KEY` | At least 32 characters; required by startup validation |
| `INTENT_SECRET` | Independent, at least 32-character HMAC key for expiring transaction intents |
| `RENDER_EXTERNAL_URL` or `WEBHOOK_URL` | Public HTTPS origin used to register `<origin>/webhook` |
| `MINI_APP_URL` | Exact HTTPS Mini App origin used by Telegram links and CORS |

Generate independent secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Do not reuse the bot token, Privy secret, authorization key, or database password.

### Wallet and execution

| Variable | Purpose | Behavior when absent |
|---|---|---|
| `PRIVY_APP_ID` | Server-side Privy application ID | Wallet resolution/onboarding unavailable |
| `PRIVY_APP_SECRET` | Privy application secret | Must be paired with `PRIVY_APP_ID` |
| `PRIVY_AUTHORIZATION_KEY` | Server authorization key for delegated wallet signing | Server broadcasts unavailable |
| `ALCHEMY_RPC_URL` | Ethereum mainnet RPC URL | On-chain reads, SDK routes, simulation, gas, and execution unavailable |
| `BASE_RPC_URL` | Base mainnet RPC URL | Base-source bridge quotes and execution unavailable |
| `SIGNER_POLICY_MODE` | `enforce` (default), `observe`, or `off` | Always use `enforce` for production funds |
| `BRIDGE_EXECUTION_ENABLED` | Enables Ethereum↔Base bridge broadcast when `true`; startup then requires both RPC URLs | Bridge broadcast stays disabled |
| `DAILY_TX_CAP` | Per-user UTC-day logical-action cap in the central executor | Defaults to `50`; counts one ordered route as one action, not its transaction count or value; replacement broadcasts use a separate path |

`observe` permits disallowed routes after logging them, and `off` disables the policy. They are diagnostic/test modes, not normal production settings.

### Runtime services and observability

| Variable | Purpose |
|---|---|
| `REDIS_URL` | `redis://` or `rediss://` TCP URL for shared HTTP limits and the live daily-action counter; do not use an Upstash REST URL |
| `SENTRY_DSN` | Optional error reporting |
| `ADMIN_TELEGRAM_CHAT_ID` | Optional admin errors and SLO digest target |
| `ADMIN_TOKEN` | Bearer token for `/api/v1/admin/*`; routes return 403 when unset |
| `COINGECKO_API_KEY` | Optional higher-rate market-data access |
| `ETHERSCAN_API_KEY` | Optional `/gas` oracle access; RPC fallback remains |

The authoritative validated schema is `apps/bot/src/middleware/config.ts`. A few operational variables are read directly at their call sites and therefore do not appear in that schema. `BRIDGE_EXECUTION_ENABLED=true` is deliberately fail-fast unless both `ALCHEMY_RPC_URL` and `BASE_RPC_URL` are valid URLs.

## 4. Configure Privy

In the Privy dashboard:

1. Create an Ethereum application and enable Telegram login.
2. Configure the production Mini App origin as an allowed origin.
3. Configure an authorization-key quorum/session signer for bot trading.
4. Put its public signer identifier in `NEXT_PUBLIC_PRIVY_SIGNER_ID` at Mini App build time.
5. Put the matching server authorization key in `PRIVY_AUTHORIZATION_KEY`.

The user creates or imports the embedded wallet in Privy's client UI. The backend resolves the wallet from the verified Telegram-linked Privy user; it must never accept a browser-supplied execution wallet as authoritative.

## 5. Configure the Mini App build

The Mini App is a static export. Every `NEXT_PUBLIC_*` value is embedded by `next build`, so changing one requires a rebuild and redeploy.

| Variable | Required | Purpose |
|---|---:|---|
| `NEXT_PUBLIC_BOT_API_URL` | Yes | Explicit backend origin, such as `https://bot.example.com`; current client treats an empty value as unavailable rather than using same-origin |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Yes | Bot username without `@` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Yes for wallet setup | Public Privy app ID |
| `NEXT_PUBLIC_PRIVY_SIGNER_ID` | Yes for bot-trading grant/revoke | Signer/quorum identifier matching backend authorization |

Create `apps/mini-app/.env.local` for local Next.js development, or export these variables before the build. Do not put server secrets in a `NEXT_PUBLIC_*` variable.

## 6. Run locally

Build shared dependencies once, migrate the database, then start development mode:

```bash
pnpm --filter @fxaeon/shared build
pnpm --filter @fxaeon/db build
pnpm --filter @fxaeon/bot dev
pnpm --filter @fxaeon/mini-app dev
```

Run the two `dev` commands in separate terminals. In `NODE_ENV=development`, the bot uses Telegram long polling. The Mini App normally needs HTTPS and a Telegram launch context for real `initData`; use the Playwright harness for deterministic local UI flows.

## 7. Build and test

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @fxaeon/mini-app test:e2e
```

Install Chromium first if needed:

```bash
pnpm --filter @fxaeon/mini-app exec playwright install chromium
```

Mainnet-fork money-path tests require Foundry/Anvil and a mainnet RPC:

```bash
export FORK_BACKEND_RPC_URL='https://your-mainnet-rpc'
pnpm --filter @fxaeon/bot test:fork
```

## 8. Docker Compose

Create a filled `.env` at the repository root, then:

```bash
docker compose build
docker compose up -d
docker compose ps
```

Compose starts the bot, static Mini App, Redis, and an HTTP-only Nginx reverse proxy. It does not provision PostgreSQL or TLS, and the checked-in Nginx configuration has no certificate mount or HTTPS listener. Terminate TLS at a trusted edge or replace the proxy configuration before internet exposure.

## First-run checks

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/v1/health
curl http://localhost:8080/api/v1/health/ready
```

Then verify in Telegram:

1. `/start` opens onboarding.
2. The Mini App creates/imports and links the expected embedded wallet.
3. `/deposit` shows the same address.
4. `/security` reports the intended delegation and policy state.
5. Use read-only `/price`, `/gas`, and `/portfolio` before testing a small, explicitly confirmed transaction.

See [Operations](docs/operations.md) for failure diagnosis and [Security](docs/security.md) before enabling live funds.
