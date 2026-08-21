# Deployment

The canonical topology is a Render Docker service for the bot/API, a static Mini App host such as Cloudflare Pages, managed PostgreSQL, and optional Redis. Deployments touch wallet-signing authority; treat configuration review as part of the release.

## Pre-deployment gates

From a clean checkout:

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @fxaeon/mini-app test:e2e
node scripts/gen-signer-policy.mjs --check
```

With an Ethereum RPC:

```bash
ALCHEMY_RPC_URL='https://...' node scripts/verify-addresses.mjs
FORK_BACKEND_RPC_URL='https://...' pnpm --filter @fxaeon/bot test:fork
```

A self-skipped fork suite does not validate live integration. Review dependency audit output, migration SQL, generated policy drift, visual snapshots, and every changed address/ABI.

## Database migration

Apply migrations before promoting code that depends on them:

```bash
DATABASE_URL='postgresql://...' pnpm --filter @fxaeon/db exec prisma migrate deploy
```

`.github/workflows/deploy.yml` can run migrations when repository variable `DEPLOY_DB_ENABLED=true` and secret `DATABASE_URL` are configured. Do not assume a Render image start automatically migrates the database; the bot Dockerfile only builds and starts the process.

Back up before a destructive or high-risk migration and rehearse restore on a separate database.

## Bot/API on Render

`render.yaml` builds `apps/bot/Dockerfile` from the repository root. The blueprint lists only a subset of runtime variables and leaves secret values for the operator; it is not a complete production environment manifest. Configure all values described in [SETUP.md](../SETUP.md), especially:

- `TELEGRAM_BOT_TOKEN`
- `DATABASE_URL`
- `TELEGRAM_WEBHOOK_SECRET`
- `ENCRYPTION_KEY`
- `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and `PRIVY_AUTHORIZATION_KEY`
- `ALCHEMY_RPC_URL`
- `BASE_RPC_URL` when bridge execution is enabled
- `BRIDGE_EXECUTION_ENABLED=false` until the bridge release gate is deliberately approved
- `MINI_APP_URL`
- `REDIS_URL` for production-grade shared limits
- `INTENT_SECRET`
- `SIGNER_POLICY_MODE=enforce`
- `ADMIN_TOKEN` if admin routes are retained

Render supplies `RENDER_EXTERNAL_URL`; other hosts must set `WEBHOOK_URL` to the public origin, not the full webhook path.

Render's blueprint liveness path is `/health`. This intentionally checks only that the process serves HTTP so a dependency outage does not cause a destructive restart loop. External monitoring and promotion checks must also query `/api/v1/health` and inspect `status`/`services`.

At startup the bot registers `<origin>/webhook` and caches the URL plus a non-reversible secret fingerprint in PostgreSQL `BotState`. A matching cache is trusted only after live `getWebhookInfo` confirms the same endpoint, so external Telegram drift self-heals. After rotating `TELEGRAM_WEBHOOK_SECRET` or repairing Telegram configuration, call the authenticated admin `POST /api/v1/admin/rewebhook` to force immediate registration, then verify `getWebhookInfo`.

## Mini App static deployment

Build-time variables:

```bash
export NEXT_PUBLIC_BOT_API_URL='https://bot.example.com'
export NEXT_PUBLIC_TELEGRAM_BOT_USERNAME='FxAeonBot'
export NEXT_PUBLIC_PRIVY_APP_ID='your-public-app-id'
export NEXT_PUBLIC_PRIVY_SIGNER_ID='your-session-signer-id'
pnpm --filter @fxaeon/shared build
pnpm --filter @fxaeon/mini-app build
```

Deploy `apps/mini-app/dist/` to a static host. For Cloudflare Pages:

```bash
npx wrangler pages deploy apps/mini-app/dist --project-name=fxbot-mini-app --branch=main
```

`.github/workflows/deploy-mini-app.yml` is the optional secrets-driven deployment path; Cloudflare Git integration may also deploy. The workflow fails before build if any of its four current values are absent, then maps repository secrets `PRIVY_APP_ID`, `PRIVY_SIGNER_ID`, `TELEGRAM_BOT_USERNAME`, and `PRODUCTION_URL` to the frontend variables above. Legacy `NEXT_PUBLIC_MINI_APP_URL` and `NEXT_PUBLIC_ALCHEMY_RPC_URL` do not configure the current frontend.

After deployment:

1. Set bot `MINI_APP_URL` to the exact HTTPS origin.
2. Confirm the Mini App was built with a non-empty `NEXT_PUBLIC_BOT_API_URL` pointing to the bot origin, even when both surfaces share an edge hostname.
3. Add the Mini App origin to Privy's allowed origins.
4. Verify backend CORS allows that exact origin.
5. Run Telegram's bot-profile/menu setup if needed.
6. Open from Telegram; a normal browser cannot prove the account flow.

## Docker Compose

For local or self-hosted evaluation:

```bash
cp .env.example .env
docker compose build
docker compose up -d
docker compose ps
```

Services:

- bot on its internal port 8080;
- Mini App static Nginx on internal port 3000 and host port 3001;
- Redis with AOF persistence;
- root Nginx proxy on port 80.

Compose does not include PostgreSQL or TLS. The checked-in root Nginx configuration listens on port 80 only and mounts no certificates; terminate HTTPS at a trusted edge or supply and review a replacement proxy configuration before internet exposure. Build-time `NEXT_PUBLIC_*` values must be present during `docker compose build`, not added only at runtime.

## Release verification

```bash
BOT_URL='https://bot.example.com' \
TELEGRAM_BOT_TOKEN='...' \
ALCHEMY_RPC_URL='https://...' \
MINI_APP_URL='https://app.example.com' \
./health-check.sh
```

`smoke-test.js` performs broader checks but requires `TELEGRAM_TOKEN` and other configured service values. Review the script's target configuration before treating a pass as release evidence.

Manual checks:

1. `/health`, `/api/v1/info`, `/api/v1/health`, `/api/v1/health/ready`, and `/api/v1/health/deps` return expected states, including `services.baseRpc`/`deps.baseRpc` when configured.
2. Telegram `getWebhookInfo` shows the exact HTTPS `/webhook`, zero/low pending updates, and no recent error.
3. The Mini App loads inside Telegram and reports the intended bot/API origin.
4. Privy onboarding links the expected embedded wallet.
5. Grant and revoke bot trading; `/security` and Mini App `/me` converge.
6. Read portfolio/market/gas without fabricated values under a forced dependency failure.
7. Execute the smallest approved test transaction, verify every hash/receipt, then close/recover it.
8. Confirm workers heartbeat/notify and database backups are current.

## Feature gates

- Production signer policy: `enforce` only.
- Bridge: keep `BRIDGE_EXECUTION_ENABLED=false` until Ethereum→Base and Base→Ethereum have passed funded source-chain fork/live tests and the exact OFT target, Ethereum allowance, refund address, native fee/value, and destination delivery have been observed. When enabling, configure both `ALCHEMY_RPC_URL` and `BASE_RPC_URL`; startup deliberately rejects a partial bridge configuration. A clean startup or successful source-chain receipt is not production-readiness or destination-delivery evidence.
- FxAeon adds no application fee. Do not advertise or attempt to enable a separate billing path.
- Limit-order HTTP primitives require fresh TMA auth and bind `maker` to the authenticated wallet, but no supported signing surface exists. Keep them treated as internal application endpoints until that workflow ships.

## Rollback

1. Disable new traffic or funds-moving routes at the edge if a security issue is suspected.
2. Revoke/rotate compromised Privy authorization, Telegram, admin, database, RPC, and webhook credentials as applicable.
3. Redeploy the last known-good image/commit. Do not roll back the database blindly after a forward migration.
4. Reconcile all `broadcast`/non-terminal transaction records and every route hash.
5. Verify webhook registration, deep health, Mini App configuration, and signer policy after rollback.
6. Notify affected users to revoke bot trading when signer authority may be compromised.

See [Operations](operations.md) and [Security](security.md).
