# Operations and troubleshooting

This guide is the current operational reference. The focused procedures under [`ops/runbooks/`](../ops/runbooks/) use the same safety posture: preserve evidence, avoid destructive shortcuts, and verify every deployment-specific target before acting.

## Health endpoints

| Path | Meaning | Expected success |
|---|---|---|
| `/health` | Process can answer HTTP | 200 `{ ok: true }` |
| `/api/v1/info` | Process/build metadata | 200 |
| `/api/v1/health` | Database, Redis, Ethereum/Base RPC heads, selected workers, metrics | 200 healthy/degraded; 503 database unhealthy |
| `/api/v1/health/ready` | Database query succeeds | 200 ready; 503 otherwise |
| `/api/v1/health/deps` | Flat `db`/`redis`/`rpc`/`baseRpc` state | 200 with `ok`, `degraded`, or `down` |

The deep endpoint exercises `prisma.user.count()`, not merely `SELECT 1`, so it detects a missing schema and common PgBouncer failures. RPC is degraded if the latest block is more than about 60 seconds old.

Only `health-monitor` and `limit-order-poller` are included in the current health heartbeat set. A green deep response does not prove price alerts, automation, deposit watching, arbitrage, or SLO digest are running.

The deep endpoint probes Ethereum through `ALCHEMY_RPC_URL` and Base through `BASE_RPC_URL`. It reports Base as `skipped` when no URL is configured and bridge execution is off; when `BRIDGE_EXECUTION_ENABLED=true`, a missing/unhealthy Base RPC degrades the response. Each probe verifies the expected chain ID (1 or 8453) and block freshness. It does not prove simulation support, OFT behavior, or destination delivery, so release verification must still make explicit `eth_simulateV1` and funded-route checks.

## Worker inventory

Workers start about five seconds after bot startup.

| Worker | Interval | Function |
|---|---:|---|
| Limit-order poller | 30 s | Incremental relay updates for locally known open orders |
| Price-alert poller | 60 s | One-shot price/24h alerts |
| Automation poller | 60 s | Stop-loss/take-profit claim and close execution |
| Deposit watcher | 30 s | Batched ERC-20 logs and ETH balance delta; watchers expire after 24 h |
| Position health monitor | 5 min | On-chain position warning/urgent notifications |
| Arbitrage poller | 5 min | fxUSD signal notifications for opted-in users |
| SLO digest | 24 h | Admin summary when admin chat is configured |

FxAeon does not add an application fee; users pay only fees returned by live protocol routes and the source chain. `DAILY_TX_CAP` is live in `executeRoute`: it checks persisted UTC-day broadcasts and consumes one logical-action point through Redis or an in-process fallback before any route broadcast. It is not a transaction-value ceiling, does not cover Ethereum replacement broadcasts, and cannot make worker replicas safe.

Workers are in-process intervals. Run one bot replica unless you have reviewed duplication behavior and added leader election. Automation has an atomic database claim; not every worker has equivalent cross-replica protection.

## Logs and alerts

- Pino structured logs use `LOG_LEVEL`.
- Common secret fields are redacted, but raw external errors can still contain sensitive context; restrict log access.
- `SENTRY_DSN` enables Sentry error capture.
- `ADMIN_TELEGRAM_CHAT_ID` enables sanitized error messages and the SLO digest.
- Watch for `policy.violation`, simulation failures, receipt timeouts, partial route failures, stale workers, database hints, Redis fallback, and repeated provider 429/5xx errors.

Never paste full environment output, Telegram initData, Privy objects, authorization headers, or database URLs into tickets or chat.

## Routine checks

Daily:

- inspect liveness/deep health and Telegram webhook errors;
- inspect non-terminal/reverted/partial/cancelled/failed transaction records and every step hash;
- confirm recent database backup object and size;
- check Ethereum and Base RPC, CoinGecko, Privy, Telegram, relay, and Flashbots provider status;
- check unexpected policy violations and admin-mode changes.

Weekly:

- restore a recent backup into an isolated database and run sanity queries;
- review dependency/security alerts and f(x) contract/SDK updates;
- verify the signer-policy artifact and mainnet bytecode;
- confirm Mini App build variables match backend/Privy configuration;
- test delegation grant/revoke and one small end-to-end action.

## Backups

`.github/workflows/backup.yml` runs daily at 03:00 UTC when secrets are configured. It uses PostgreSQL 17 `pg_dump`, gzip, Cloudflare R2 bucket `fxbot-backups`, and keeps the newest 30 objects.

Required repository secrets:

- `DATABASE_URL`
- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

The workflow fails when a secret is absent. A successful upload is not a tested backup: rehearse decompression and restore, validate row counts/constraints, encrypt/control bucket access, and document recovery time.

## Troubleshooting

### Bot does not respond

1. Check `/health`; if unavailable, inspect host/container status.
2. Query Telegram `getWebhookInfo` with the bot token. Confirm exact `/webhook`, pending count, and `last_error_message`.
3. Check `TELEGRAM_WEBHOOK_SECRET` and whether cached URL registration skipped after a secret rotation.
4. Check HTTP 401/429/503 logs on `/webhook`.
5. Verify `/api/v1/health/ready` and migrations.

The removed `/api/webhook/telegram` compatibility path is not a fallback. Telegram must point to the direct `/webhook` handler.

### Database unhealthy

Use `services.databaseHint`:

- `schema-missing`: run `prisma migrate deploy` against the database in `DATABASE_URL`.
- `auth-failed`: rotate/fix password and URL encoding.
- `unreachable`: verify host, port, network, and provider pooler.
- `pgbouncer`: use the provider's Prisma-compatible/session pool or correct `pgbouncer=true` configuration.
- `timeout`: inspect pool exhaustion, locks, and provider load.

Suspend writes before restoration or destructive maintenance.

### Redis unhealthy

`REDIS_URL` must be `redis://` or `rediss://`, not `https://`. The process falls back to in-memory HTTP limits and a per-process daily-action counter, while the executor still checks persisted broadcast records in PostgreSQL. One replica can continue; multiple replicas lose an atomic shared live counter and can race. Fix credentials/network and watch for reconnect logs; do not flush Redis as a substitute for revoking Privy session signers.

### RPC or simulation failure

- Confirm chain ID 1 and a recent head with `eth_blockNumber`/`eth_getBlockByNumber`.
- Confirm the provider supports `eth_simulateV1`/viem `simulateCalls`.
- Inspect rate limits and request timeout.
- Never bypass simulation to restore service.
- Fail funds-moving actions closed and leave read displays explicitly degraded.

### Mini App cannot load account

- Open it from Telegram, not a normal browser.
- Confirm `NEXT_PUBLIC_BOT_API_URL` points to the deployed bot origin and backend CORS uses the exact Mini App origin.
- Confirm device time is reasonable and launch `initData` is fresh.
- Inspect 401 vs 404/409 vs 5xx responses.
- Rebuild after changing any `NEXT_PUBLIC_*` value.

### Wallet setup or bot trading fails

- Verify the Privy app ID is identical in frontend/backend configuration.
- Verify Telegram login is enabled and the Telegram account is linked.
- Verify the embedded Ethereum wallet exists in Privy's user record.
- Verify `NEXT_PUBLIC_PRIVY_SIGNER_ID` matches the authorization quorum behind `PRIVY_AUTHORIZATION_KEY`.
- Call wallet sync after grant/revoke and compare `/security` with `/me`.
- Never mark delegation active from a browser-supplied boolean.

### Transaction is stuck or outcome unknown

1. Inspect the `TxRecord` status, ordered `steps`, all hashes, and pending nonce data.
2. Check each receipt and current nonce on the `chainId` stored in the record. Legacy replacement controls are Ethereum-only.
3. Use `/speedup` or `/cancel` only while the original is replaceable.
4. Treat `partial` as terminal: if an earlier route transaction landed, inspect every receipt, allowance, and current state before creating a fresh ticket/key for any retry.
5. A receipt timeout remains broadcast/unknown; do not tell the user it failed or succeeded without chain evidence.

### Automation did not fire

- Confirm rule is active, not paused/expired/triggered.
- Confirm bot trading is still delegated.
- Confirm a matching on-chain market/side position exists.
- Confirm CoinGecko snapshot is fresh; stale data intentionally skips execution.
- Inspect worker logs and failure count. Rules pause after repeated failures.
- Remember the worker checks about once per minute and cannot guarantee threshold price.

### Bridge confirm is missing

This is expected when `BRIDGE_EXECUTION_ENABLED` is not `true`. Ethereum-source quotes need `ALCHEMY_RPC_URL`; Base-source quotes additionally need `BASE_RPC_URL`. Enabling execution requires both, but configuration alone is not readiness evidence. Check that the UI direction maps to source chain 1 or 8453, the corresponding RPC reports that chain, and Base MEV mode is public. Do not enable the flag until both exact OFT routes, Ethereum approval amount, native LayerZero fee, refund address, chain-scoped policy targets, funded source-chain behavior, and destination delivery are reviewed.

A confirmed source-chain receipt is not destination delivery. If delivery appears delayed, record the source chain/hash and inspect LayerZero/destination state before retrying. Never resend solely because the destination balance has not appeared yet.

## Security incident minimum response

1. Stop or isolate new funds-moving requests.
2. Rotate/revoke the Privy authorization key and instruct users to revoke bot trading.
3. Rotate bot/webhook/admin/database/RPC secrets as exposure requires.
4. Pause automation rules in the database; this does not revoke wallet authority by itself.
5. Preserve logs/database snapshots and enumerate every recent transaction hash.
6. Reconcile chain state, allowances, nonces, and limit-order relay state.
7. Restore from known-good code/config only after the attack path is understood.
8. Communicate scope and recovery steps without exposing user data or exploit details.

See [Security model](security.md), [Threat model](threat-model.md), and [SECURITY.md](../SECURITY.md).
