# fxBot Scripts

## Development

| Script | Purpose |
|---|---|
| `dev-setup.sh` | One-command local development setup |
| `cleanup-secrets.sh` | Remove secrets from git before committing |
| `verify-migrations.sh` | Verify database migrations are applied |

## Deployment

| Script | Purpose |
|---|---|
| `deploy.sh` | Deploy bot via Docker Compose |
| `deploy-mini-app.sh` | Deploy Mini App to Cloudflare Pages |

## Monitoring

| Script | Purpose |
|---|---|
| `health-check.sh` | Verify all services are healthy |
| `health-check.js` | Node.js version of health check |
| `smoke-test.sh` | Post-deployment smoke tests |
| `smoke-test.js` | Node.js version of smoke tests |

## Usage

```bash
# Setup local development
./scripts/dev-setup.sh

# Before committing
./scripts/cleanup-secrets.sh

# Verify database
./scripts/verify-migrations.sh

# Check health
./health-check.sh https://your-bot-domain.com

# Run smoke tests
./smoke-test.sh https://your-bot-domain.com
```
