# Runbook: confirmed or high-confidence security incident

This is the canonical response for unauthorized signing, credential compromise, malicious deployment, cross-user execution, or confirmed data exposure.

## 1. Contain signing and execution

1. Isolate funds-moving HTTP/bot traffic or stop the affected process. There is no global in-app broadcast switch.
2. Revoke/rotate the affected Privy authorization key/quorum. Notify users to revoke the FxAeon session signer in their wallet controls.
3. Pause active automation rules and stop worker replicas. This is additional containment, not delegation revocation.
4. Keep `BRIDGE_EXECUTION_ENABLED=false`; remember that it controls bridge execution only.
5. If the Telegram bot token is exposed, rotate it through BotFather, update the service, rebuild confidence in Mini App `initData` authentication, register the new webhook secret/token combination, and invalidate the cached webhook URL before restart.

## 2. Preserve evidence

- Snapshot the database and retain immutable copies of application, edge, provider, CI, Privy, Telegram, and deployment audit logs.
- Record deployed commit/image, environment variable names and rotation times (never secret values), process replica count, and signer-policy mode.
- Export the affected `TxRecord`, user linkage, automation, withdrawal intent, limit-order, and audit metadata through a restricted channel.
- Record every Ethereum/Base hash, nonce, receipt, approval, target, calldata selector, and current allowance/state.

Do not mutate transaction history to make it look terminal. A receipt timeout remains unknown/broadcast until chain evidence says otherwise.

## 3. Rotate by exposure scope

Rotate only through each provider's supported control plane and track propagation:

- `PRIVY_AUTHORIZATION_KEY`, then `PRIVY_APP_SECRET` if applicable;
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` if Telegram authentication is affected;
- `ADMIN_TOKEN`, database credentials, RPC credentials, Sentry credentials, CI/deployment tokens, and backup credentials as applicable;
- `INTENT_SECRET` if signed chat intents could be forged;
- `ENCRYPTION_KEY` only with a data-migration/recovery plan. Current active rows are not generally application-encrypted, so rotating it is not a substitute for database containment.

Redis flushing does not revoke a Privy signer and weakens rate limits.

## 4. Eradicate and recover

1. Identify the exact attack path and create a reviewed fix; do not restore merely because keys were rotated.
2. Rebuild from a known-good source/lockfile in a clean environment and verify the signer-policy artifact and contract registry.
3. Restore data only through [data-recovery.md](data-recovery.md). Compare wallet bindings, rules, recipients, and transactions with Privy and chain truth.
4. Reconcile partial routes, approvals, pending nonces, Base/Ethereum bridge source receipts, LayerZero destination state, and relay orders.
5. Re-enable read-only traffic first, then signing for a minimal canary population/value. Require fresh quotes and confirmations; do not replay queued intents.

## 5. Validate and communicate

- Production boots with `SIGNER_POLICY_MODE=enforce` and the intended, minimal worker count.
- Webhook, Mini App auth, Privy wallet resolution, signer grant/revoke, deep health, and policy rejection tests pass.
- Every affected hash is classified with source-chain evidence; destination bridge delivery is tracked separately.
- Affected users receive factual scope, revoked/rotated authority, actions to take, and residual uncertainty. Do not claim funds are safe before reconciliation.
- Record root cause, timeline, impact, recovery evidence, and follow-up owners; update the threat model and commission independent review as warranted.
