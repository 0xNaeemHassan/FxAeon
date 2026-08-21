# Runbook: Privy degradation or outage

Privy is used for Telegram-linked wallet resolution, embedded-wallet onboarding, signer grant/revoke, delegated signing, and public transaction broadcast. FxAeon's health endpoints do not probe Privy directly.

## Detect and scope

- Record failing operation, HTTP/error class, affected Privy app/environment, start time, and whether the client SDK, server API, authorization key, or broadcast path is affected.
- Check Privy's official status page/dashboard and deployment-side error logs. Do not depend on an undocumented `/v1/health` endpoint.
- Distinguish onboarding/login failure from signing/broadcast failure. A working Mini App session does not prove delegated signing is available.
- Inspect recent `TxRecord` rows: no hash means the current transaction was not acknowledged as broadcast, but earlier transactions in a multi-call route may already have landed.

## Contain

1. Keep signing-dependent actions unavailable and show a retry/degraded message. Do not introduce a local private-key fallback.
2. Do not queue confirmed user intents for automatic replay after recovery. Quotes, balances, nonces, fees, and protocol state will be stale; require a fresh user review/confirmation or fresh automation evaluation.
3. If Privy behavior suggests credential compromise rather than outage, follow [security-incident.md](security-incident.md).
4. Preserve grant/revoke and authorization audit evidence. Do not mark delegation active from a browser flag when server sync failed.

## Recover

1. Confirm official recovery and validate the configured Privy app ID/secret, authorization key, Mini App signer ID, allowed origin, and Telegram-linked identity.
2. Test onboarding/wallet resolution with a non-production or approved canary account.
3. Test signer grant, `/wallet/sync`, server delegation gate, a no-broadcast quote/simulation, then a minimal approved transaction.
4. Reconcile all outage-window hashes and nonces before allowing replacements or retries.
5. Resume automation only after fresh market, position, RPC, signer, and route checks.

## Communication

Say which capabilities are unavailable and that FxAeon is not sending new transactions through the affected path. Do not state that funds are safe or unaffected until suspected transactions and authority have been reconciled. Remind users they can independently inspect/export their Privy embedded wallet and revoke bot trading when Privy's controls are available.
