# FxAeon Deployment Guide

**Canonical production target: Render** (Docker web service from `render.yaml`,
starter plan). Render auto-deploys every push to `main`. Fly.io support was
removed in W-14; `docker-compose.yml` + `deploy.sh` are local/dev only.

## Production (Render)

1. Render Blueprint picks up `render.yaml` (repo root). The service builds
   `apps/bot/Dockerfile` with the repo root as Docker context.
2. Set all `sync: false` env vars from `render.yaml` in the Render dashboard
   (Environment tab). Secrets live **only** there and in GitHub Actions
   secrets — never in files.
3. Health check: Render pings `/health` (liveness only — deploy gating and
   restarts must not depend on DB/Redis health; the deep per-dependency
   check is `/api/v1/health`, used by monitoring and the smoke test).
   If the service was created manually (not via this Blueprint), set
   *Settings → Health Check Path* to `/health` in the dashboard too.
4. Database migrations: run `pnpm --filter @fxbot/db db:deploy` against the
   production `DATABASE_URL` (or enable the gated `deploy-db` job in
   `.github/workflows/deploy.yml` via the `DEPLOY_DB_ENABLED` repo variable).
   **Required for the next release:** the W-11 migration
   `20260611_txrecord_idempotency`.
5. Set the Telegram webhook once per host change:

```bash
curl -sf -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://<render-host>/webhook" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

### Production troubleshooting (learned the hard way, 2026-06-11)

Symptom: process "up", webhook registered, but the bot answers nothing.

- **REDIS_URL must be the TCP string** (`rediss://default:<password>@<host>:6379`),
  *not* the Upstash REST `https://` endpoint. The bot now refuses non-redis
  URLs and runs with in-memory rate limits instead of hanging, but fix the
  env var to get real Redis limits back.
- **DATABASE_URL must be reachable from Render.** Supabase's direct host
  (`db.<ref>.supabase.co:5432`) is IPv6-only; Render has no outbound IPv6, so
  connections hang. Use the **Session pooler** connection string from
  Supabase → Connect (IPv4-compatible, port 5432).
- `TELEGRAM_WEBHOOK_SECRET` and `ENCRYPTION_KEY` are required in production
  (config fail-fast) — both are listed in `render.yaml` so the Blueprint
  prompts for them. Generate with `openssl rand -hex 32`.
- Quick checks: `GET /api/v1/health` (deep, 503 when a dependency is down,
  per-service status in the body) and `GET /api/v1/info` (always-fast build
  info). The webhook re-registers itself on every boot from
  `RENDER_EXTERNAL_URL` — no manual `setWebhook` needed on Render.

## Mini App (Cloudflare Pages)

Deployed by `.github/workflows/deploy-mini-app.yml` on pushes touching
`apps/mini-app/**` or `packages/shared/**` (wrangler → `fxbot-mini-app`).

## Local / dev (docker-compose)

```bash
cp .env.example .env   # fill in real values; never commit .env
export TELEGRAM_BOT_TOKEN=... WEBHOOK_URL=https://<tunnel-host>/webhook
./deploy.sh
```

## CI/CD inventory (W-14)

| Workflow | Trigger | Notes |
|---|---|---|
| `ci.yml` | push/PR | lint, typecheck, tests, on-chain address verification |
| `deploy.yml` | push to main | DB migrations only, gated by `DEPLOY_DB_ENABLED` (Render handles the bot deploy itself) |
| `deploy-mini-app.yml` | path-filtered push | Cloudflare Pages |
| `backup.yml` | daily 03:00 UTC | pg_dump → R2, 30-day retention |
| `smoke-test.yml` | after deploys | hits prod/staging endpoints |
| `fx-upgrade-monitor.yml` | weekly | upstream address diff → **opens a PR for human review** (never pushes to main) |
| `gitleaks.yml` / `release.yml` | push / tags | secret scanning / GitHub releases |

All workflows run with least-privilege `permissions:`; third-party actions are
pinned by commit SHA.

## Verification checklist

- [ ] `/start` in Telegram opens the Mini App
- [ ] Wallet connects via Privy
- [ ] `/portfolio` shows positions
- [ ] Health endpoint responds: `curl https://<render-host>/api/v1/health`

## Security notes

1. Secrets only in Render env vars / GitHub Actions secrets.
2. Enable 2FA on Supabase, Upstash, Alchemy, Privy, Render, Cloudflare.
3. Set IP allowlists on Supabase and Upstash where possible.
4. Review Privy dashboard audit logs weekly.
