# Runbook: bot or API unavailable

## Detect and scope

1. Check the deployed origin's `/health`. If it fails, inspect host/container state and the most recent startup logs.
2. If liveness succeeds, check `/api/v1/health`, `/api/v1/health/ready`, and `/api/v1/health/deps` to separate database, Redis, Ethereum RPC, Base RPC, and selected-worker failures.
3. Query Telegram `getWebhookInfo` with the intended bot token through an approved secret-safe terminal. Record the configured URL, pending update count, and last error without copying the token.
4. Confirm whether the Mini App API, Telegram webhook, long polling, or only a dependency is affected.

## Contain

- Do not repeatedly restart a process that may have already broadcast a transaction. First preserve logs and enumerate non-terminal `TxRecord` rows/hashes.
- If behavior suggests compromise rather than outage, follow [security-incident.md](security-incident.md).
- If only a dependency is down, leave liveness available and keep money paths fail-closed. Avoid a restart loop triggered by deep-health degradation.

## Diagnose

- Configuration: production requires `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, `TELEGRAM_WEBHOOK_SECRET`, `ENCRYPTION_KEY`, an external origin, and `SIGNER_POLICY_MODE=enforce`.
- Port/routing: the bot listens on 8080 by default; the direct webhook is exactly `/webhook`; the checked-in root Nginx proxies `/api/`, `/health`, and `/webhook` to the bot.
- Database: use the secret-free `services.databaseHint` before changing credentials or migrations.
- Webhook repair: the startup cache is cross-checked against Telegram's live URL. After a secret rotation or external deletion, use authenticated `POST /api/v1/admin/rewebhook` to force immediate registration; no restart is required.
- Rate limiting: Redis failure falls back to in-process HTTP limits. It should not make the whole process unavailable, but logs should show the fallback.

## Recover

1. Correct the smallest verified fault through the deployment control plane.
2. Apply pending Prisma migrations before code that requires them.
3. Restart or redeploy the known-good image only after preserving evidence and reconciling unknown transactions.
4. Verify webhook registration, then send a read-only command before permitting a small confirmed action.

## Validate and close

- `/health` and all three deep/readiness endpoints behave as documented.
- Telegram points to the exact HTTPS `<origin>/webhook` and reports no new error.
- `/api/v1/info` identifies the intended deployment.
- Mini App `/me`, a read-only bot command, and signer grant/revoke converge.
- In-process workers started once; multi-replica duplication was not introduced.
- Every transaction from the outage window has a chain-backed or explicitly unknown status.
