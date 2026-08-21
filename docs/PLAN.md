# Product completion plan

This roadmap is derived from [Known gaps](GAPS.md) and the goal of making FxAeon a complete mobile f(x) gateway. It is not a claim that an item has shipped.

## 1. Close production safety gaps

- Authenticate or isolate the general trade-simulation endpoint.
- Add route-specific semantic/value constraints for every payable or sensitive allowed contract call.
- Remove/repair misleading legacy configuration, schema, and smoke checks; keep the rewritten runbooks source-reconciled.
- Extend the live database/Redis-assisted logical-action cap with reviewed value/allowance limits and explicit replacement-path accounting; add multi-replica failure/race tests.
- Prove backup restoration, webhook rotation, Privy authorization rotation, and partial-route reconciliation.

Evidence: negative auth tests, policy tests, edge configuration, current source search, migration/restore transcript, and staged incident exercise.

## 2. Harden completed SDK 1.0.5 coverage

- Add funded fork/live evidence for existing-position increase, `fxUSDBasePool`, and both bridge source chains.
- Add destination-chain delivery tracking and reconciliation for LayerZero messages; a source receipt alone is insufficient.
- Keep SDK addresses/token types locked to reviewed source truth and fail new routes closed until policy/tests are updated.
- Preserve explicit unsupported states for governance and non-SDK features.

Evidence: method-by-method capability matrix, funded fork tests on each source chain, policy artifacts, and user-facing end-to-end tests.

## 3. Finish remaining Mini App parity

- Wallet: asset withdrawal, address book/recent recipients, pending transaction controls.
- Alerts and automation: create/list/pause/delete with worker health and last evaluation.
- Bridge: add destination-message status and recovery guidance beyond the source-chain activity record.
- Limit orders only after authenticated signing is ready.

Every surface needs loading, stale, unavailable, confirm, submitted, unknown-broadcast, partial-route, cancelled, confirmed, reverted, and retry/reconcile states.

## 4. Mobile quality

- Test real Telegram clients on current iOS/Android releases and common viewport/font/accessibility settings.
- Complete localization with native review for all funds/risk/error copy.
- Add screen-reader, keyboard, contrast, reduced-motion, and zoom assertions.
- Measure cold/warm startup, route bundle sizes, quote latency, confirmation latency, and provider failure behavior.
- Add an in-product transaction timeline and support-safe diagnostics export.

## 5. Operational maturity

- Separate web and worker roles or add leader election before horizontal scale.
- Expand health heartbeats to every worker and expose last success/error, not only process liveness.
- Add reconciliation for long-lived `broadcast` records and externally changed positions/orders.
- Define staged rollout, per-feature kill switches, rollback, and user notification for every new funds path.
- Commission an independent application audit after the feature surface stabilizes and remediate before broad release.

## Definition of done

A capability is complete only when product behavior, server safeguards, deployment configuration, operations, documentation, and current verification all agree. SDK method existence, route-builder output, a passing mocked test, or a polished screen is insufficient alone.
