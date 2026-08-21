# Known gaps

This is the current difference between the repository and the stated goal of a complete, professional mobile f(x) gateway. A missing row is not implied to be complete; use source and current verification evidence.

## Release/security gaps

1. **Independent application audit:** no external audit covers FxAeon's bot, Mini App, API, Privy integration, deployment, or operations.
2. **Bridge release evidence:** both SDK directions are implemented behind a disabled-by-default execution gate, but still need funded source-chain fork/live coverage and LayerZero delivery observation before broad enablement.
3. **Live integration evidence:** deterministic tests and fork tests do not prove production Telegram delivery, Privy delegated signing, provider quotas, or funded f(x) settlement in the deployed environment.
4. **Multi-replica worker safety:** workers are in-process intervals without general leader election.
5. **Database field encryption:** the encryption utility is not wired to active record paths; Telegram-wallet linkage and most application data rely on database/storage access controls.
6. **Legacy schema/config debt:** unused or partially used models/settings remain and can mislead operators or future features.
7. **Transaction-limit depth:** `executeRoute` enforces a database-backed, Redis/in-memory-assisted UTC-day action-count cap, but it is not a USD/value/allowance ceiling and the separate Ethereum speed-up/cancel path does not consume it. Without healthy Redis, multiple replicas can race their process-local live counters.

## Explicitly unsupported or incomplete product coverage

| Capability | Gap |
|---|---|
| Limit orders | Telegram-authenticated, maker-bound backend primitives exist; no wallet typed-data signing/submission/cancel UI |
| FXN locking and veFXN | No SDK/application integration |
| Gauge voting/reward claims | No SDK/application integration |
| TWAP, trailing stop, DCA, batch | Risk constants or schema hints are not live workflows |
| Automated arbitrage | Signal/notification only; no transaction builder |

## Mini App parity gaps

The Mini App executes position open/increase/reduce/close/leverage, mint/repay-withdraw, and fxSAVE deposit/withdraw/claim through the unified action API. Both bridge directions are implemented in that API but remain behind the disabled-by-default release gate described above; repository source is not evidence of a production bridge execution. The following remain chat-only: wallet withdrawal, alert/rule management, and pending transaction replacement. Limit-order signing is unavailable in both interfaces.

A complete mobile gateway needs these actions presented with the same server-side safety gates, not merely deep links or decorative buttons.

## UX and localization gaps

- Bot localization is strongest on recurring entry surfaces; substantial execution/error copy remains hardcoded English.
- Deep Privy onboarding errors and some edge states remain English.
- Real-device validation is still needed across iOS/Android Telegram versions, small/large text, screen readers, keyboards, slow networks, expired sessions, and interrupted transactions.
- PnL is first-observed estimation rather than historical cost-basis/accounting.
- Portfolio valuation correctly becomes unavailable when a required price is missing. `fxUSDBasePool` currently has no configured market-price mapping, so a positive wallet balance of that supported token makes the aggregate total unavailable until a trustworthy feed is integrated.
- Activity provides the source-chain executor journal, but no dedicated status/support diagnostics, partial-route reconciliation, or destination bridge-tracking screen exists.

## Operations gaps

- Health tracks every worker started by the process and reports startup grace, stale, and not-started states.
- FxAeon has no application-fee or fee-reconciliation path; the legacy database ledger remains for schema compatibility only.
- Backup upload automation needs regular restore proof, not only a green workflow.
- Production deployment evidence depends on secrets and external systems unavailable to repository-only CI.

## Completion evidence required

Before removing a gap, identify the authoritative proof: route-level source, rejection tests, UI/E2E state, funded mainnet-fork result, migration upgrade test, production config check, receipt, live provider response, or restoration exercise. A green typecheck or a screenshot alone cannot prove a funds-moving capability.
