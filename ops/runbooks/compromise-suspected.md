# Runbook: suspected compromise triage

Use this when evidence is incomplete: unexpected transaction, account-binding anomaly, signer-policy violation, secret exposure report, malicious deployment, or unexplained database change.

## First 15 minutes

1. Open a private incident record, name a lead, and record time/source of the alert.
2. Preserve the relevant application/access logs, deployed image identifier, database snapshot, provider audit events, and all suspected chain hashes before changing state.
3. If unauthorized signing or deployment compromise is plausible, contain new state-changing traffic at the edge or stop the process. FxAeon has no global application circuit breaker.
4. Ask affected users to revoke bot trading through Privy. If the server authorization key may be exposed, revoke/rotate it in Privy as soon as evidence capture allows.
5. Pause active automation rules as a separate containment step. This prevents the local automation worker from claiming more rules; it does not revoke wallet authority or stop interactive routes.
6. Do not flush Redis, delete logs, edit transaction rows, or run cleanup scripts.

## Establish scope

- Which Telegram IDs, Privy users/wallets, chains, contracts, transaction hashes, IPs, and time window are involved?
- Was the transaction built by a known route and allowed target, or did policy run in an unsafe mode?
- Did an approval land before a later transaction failed?
- Which credentials or systems could explain the event: bot token, webhook secret, Privy app/authorization key, database, deployment/CI, RPC, admin token, or user Telegram/Privy account?
- Are limit-order relay records, automation thresholds, recipients, or wallet bindings altered?

If compromise remains plausible, escalate immediately to [security-incident.md](security-incident.md). If disproved, document the evidence and restore traffic cautiously; do not erase the alert as noise without a chain/database explanation.
