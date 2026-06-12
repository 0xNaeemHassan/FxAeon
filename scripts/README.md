# FxAeon Scripts

## Development

| Script | Purpose |
|---|---|
| `dev-setup.sh` | One-command local development setup (copies `.env` templates, installs deps) |
| `cleanup-secrets.sh` | Remove secrets from git before committing |
| `verify-migrations.sh` | Verify database migrations are applied |
| `verify-addresses.mjs` | On-chain `eth_getCode` check of the f(x) contract-address registry (also runs in CI) |

## Deployment & health (repo root)

| Script | Purpose |
|---|---|
| `deploy.sh` | Local/dev deploy via Docker Compose (production is Render — see `docs/DEPLOYMENT.md`) |
| `deploy-mini-app.sh` | Manual Mini App deploy to Cloudflare Pages (CI normally handles this) |
| `health-check.sh` | Verify a running bot's health endpoints |
| `smoke-test.js` | Post-deployment smoke tests (same script CI runs) |

## Usage

```bash
./scripts/dev-setup.sh                 # set up local development
./scripts/cleanup-secrets.sh           # before committing
./scripts/verify-migrations.sh         # verify database
node scripts/verify-addresses.mjs      # verify contract registry on-chain
./health-check.sh https://your-bot-domain.com
BOT_URL=https://your-bot-domain.com TELEGRAM_TOKEN=... node smoke-test.js
```
