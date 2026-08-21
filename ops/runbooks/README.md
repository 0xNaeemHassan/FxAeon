# Operations runbooks

These runbooks are source-aligned response guides, not automatic commands. Hosting providers, service names, credentials, and escalation channels differ by deployment. Resolve the exact target before changing anything.

## Rules for every incident

1. Name an incident lead, timestamp actions in UTC, and separate facts from hypotheses.
2. Preserve logs, relevant database snapshots, deployment metadata, configuration fingerprints, and every known transaction hash before cleanup or rotation destroys evidence.
3. Contain the smallest confirmed scope. FxAeon has no global in-application transaction circuit breaker; stopping all signing requires edge/process isolation and/or rotation/revocation of Privy signing authority.
4. Do not print or paste environment dumps, database URLs, Telegram `initData`, bot tokens, Privy objects, authorization headers, or private keys into tickets or chat.
5. Treat `BRIDGE_EXECUTION_ENABLED` as a bridge-only gate. It does not stop Ethereum trading, automation, withdrawals, or other broadcasts.
6. Treat pausing `AutomationRule` rows as automation containment only. It does not revoke a user's Privy session signer.
7. Never flush Redis as a security response. Redis holds rate-limit state, not Privy signing sessions, and flushing it weakens throttling.
8. Never retry a transaction with an unknown outcome until every source-chain hash, nonce, receipt, allowance, and current protocol state has been reconciled.
9. Prefer an isolated restore/canary over destructive repair of the live database or deployment.
10. Close an incident only after liveness, deep health, webhook state, signer policy, worker behavior, and relevant on-chain state have been verified.

## Quick evidence set

- `/health`, `/api/v1/info`, `/api/v1/health`, `/api/v1/health/ready`, and `/api/v1/health/deps`
- Telegram `getWebhookInfo` for the intended bot
- deployed image/commit and environment-variable names (values redacted)
- recent `TxRecord` statuses, chain IDs, hashes, and idempotency keys
- recent policy violations, simulation errors, provider errors, and worker heartbeats
- current Privy authorization-key/quorum state and affected users' delegation state
- database backup identifier, checksum, size, creation time, and restore-test result

The canonical security response is [security-incident.md](security-incident.md). Product-wide operating details live in [docs/operations.md](../../docs/operations.md).
