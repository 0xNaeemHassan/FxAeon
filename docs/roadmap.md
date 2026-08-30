# Roadmap and release posture

This document describes the product that is actually shipped. FxAeon is a static Telegram Mini App: Privy owns the selected wallet, the pinned official f(x) SDK supplies protocol reads and unsigned plans, Alchemy RPC provides browser read infrastructure, and Ethereum/Base remain the source of truth.

## Non-negotiable product invariants

- No API server, backend, database, PostgreSQL, Redis, Worker, Function, indexer, subgraph, oracle, delegated signer, session signer, or automated execution path.
- Only the 15 methods in [`sdk-scope.md`](sdk-scope.md) are product capabilities.
- Every write is planned from current inputs, validated against SDK calldata, simulated when the provider supports the ordered call, and explicitly approved in the user's wallet one step at a time.
- Wallet, chain, and form changes invalidate a prepared review. Receipts, bridge GUIDs, and canonical SDK rereads—not local storage—establish state.
- Unsupported price, PnL, health, liquidation, APY, ETA, and balance values are omitted rather than approximated.

## Deliberately deferred tactics

| Tactic | Decision | Reason |
| --- | --- | --- |
| Paid runtime telemetry | Not used | The product does not need a paid observability authority; diagnostics remain local/CI-only and sanitized. |
| Runtime feature flags | Not used | Static build-time configuration is sufficient and flags are not security controls. |
| Web Worker | Not used | No measured main-thread blocker justifies moving wallet or protocol lifecycle across a Worker boundary. |
| Service Worker caching | Removed from the active product | Financial state must remain online and chain-authoritative; a one-time legacy `/sw.js` unregister remains only as stale-client cleanup. |
| Speculative transaction planning | Not used | Plans are rebuilt during review and must not survive input, wallet, chain, or state changes. |
| Generic price polling | Not used | The locked SDK does not provide a trustworthy aggregate valuation surface; no fiat/PnL fiction is added. |
| Lighthouse upload | Not used | Release evidence comes from browser tests, bundle budgets, dependency audits, and static build checks without a telemetry service. |

Transitive `ioredis` and `workerd` entries may remain in the frozen dependency graph through third-party browser/development tooling. They are not imported by the app, have no configured endpoints, and do not create Redis or Worker production services.

## Current measured release snapshot

These are measurements from the local release gate, not universal performance claims. Re-run them on the pinned Node 22 CI environment for each release baseline.

- Static bundle: `224 assets`, `7.03 MiB` total.
- JavaScript: `191 assets`, `6.50 MiB` raw, `2.00 MiB` gzip; largest asset `1.21 MiB`.
- Release E2E: `18` tests across official routes and Telegram/mobile safety checks.
- Unit/security suite: `96` total tests (`94` passed, `2` skipped when the protected fork environment is absent).
- Chaos campaign: `2` campaigns passed, including 2,000 route mutations and 600 runner iterations.
- Anvil fork gate: 24 snapshot/revert and 24 ordered-route iterations passed in the protected local run.
- Bundle guardrails: 12 MiB total, 8 MiB JavaScript, 3 MiB gzip, and 2 MiB largest JavaScript asset; these are regression limits, not UX guarantees.

## Delivery order

1. Keep scope, wallet authority, validation, simulation, sequencing, bridge recovery, and fxSAVE lifecycle green.
2. Re-run static build, dependency audit, bundle check, and mobile route tests for every release.
3. Test Telegram Android, iOS, Desktop, and Web launch behavior and wallet prompts manually; automated tests use no production funds or live signing authority.
4. Add a new SDK capability only through a reviewed scope-lock change and a matching matrix entry, tests, review UI, recovery behavior, and documentation.

The next meaningful work is upstream/runtime validation, safe fork fixtures, and real Telegram device coverage—not more infrastructure or decorative UI.
