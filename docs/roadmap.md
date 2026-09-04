# Roadmap and release posture

This document describes the current implementation. FxAeon is one static application with first-class web and Telegram launch surfaces: Privy or the connected browser wallet owns signing, the pinned official f(x) SDK supplies protocol reads and unsigned plans, Alchemy RPC provides browser read infrastructure, and Ethereum/Base remain the source of truth.

## Non-negotiable product invariants

- No API server, backend, database, PostgreSQL, Redis, Worker, Function, indexer, subgraph, oracle, delegated signer, session signer, or automated execution path.
- Only the 15 methods in [`sdk-scope.md`](sdk-scope.md) are product capabilities.
- Every write is planned from current inputs, validated against SDK calldata, simulated when the provider supports the ordered call, and explicitly approved in the user's wallet one step at a time.
- Wallet, chain, and form changes invalidate a prepared review. Receipts, bridge GUIDs, and canonical SDK rereads—not local storage—establish state.
- USD prices and charts are optional display context with freshness, confidence, shape, and range checks; PnL, health, liquidation, APY, ETA, and unsupported balances remain omitted rather than approximated.

## Deliberately deferred tactics

| Tactic | Decision | Reason |
| --- | --- | --- |
| Paid runtime telemetry | Not used | The product does not need a paid observability authority; diagnostics remain local/CI-only and sanitized. |
| Runtime feature flags | Not used | Static build-time configuration is sufficient and flags are not security controls. |
| Web Worker | Not used | No measured main-thread blocker justifies moving wallet or protocol lifecycle across a Worker boundary. |
| Service Worker caching | Removed from the active product | Financial state must remain online and chain-authoritative; a one-time legacy `/sw.js` unregister remains only as stale-client cleanup. |
| Speculative transaction planning | Not used | Plans are rebuilt during review and must not survive input, wallet, chain, or state changes. |
| USD display pricing | Read-only, independently validated | DefiLlama supplies current token prices; one bounded, batched CoinGecko contract-price fallback with adaptive rate-limit retry/backoff fills missing quotes. Current-price context has no source badge; CoinGecko also supplies separately validated ETH/BTC chart history. Missing quotes never become an assumed peg or erase other validated prices. All display feeds remain isolated from SDK planning, policy, calldata, simulation, signing, and chain-authoritative state. |
| Lighthouse upload | Not used | Release evidence comes from browser tests, bundle budgets, dependency audits, and static build checks without a telemetry service. |

Transitive `ioredis` and `workerd` entries may remain in the frozen dependency graph through third-party browser/development tooling. They are not imported by the app, have no configured endpoints, and do not create Redis or Worker production services.

## Current measured release snapshot

These are measurements from the local release gate, not universal performance claims. Re-run them on the pinned Node 22 CI environment for each release baseline.

- Static bundle: `230 assets`, `7.35 MiB` total.
- JavaScript: `189 assets`, `6.60 MiB` raw, `2.03 MiB` gzip; largest asset `1.95 MiB`.
- Release E2E: `47` tests covering browser entry, 13 scoped routes (including the read-only guide), cross-workspace USD context, independent token-price fallback, price continuity across hard navigation/feed retries, owned-balance picker states, leverage keyboard/touch controls, wallet profile/Activity, Earn-to-borrow access, three-theme persistence, accessible skip navigation, responsive charts and compact sparklines, guide search/deep links, and Telegram/mobile safety checks. The width sweep covers 320, 360, 375, 390, 412, and 430px.
- Unit/security suite: `170` total tests (`167` passed, `3` skipped when the protected fork environment is absent), including exact installed SDK debt-ratio packing across both module formats, bigint-safe USD position and owned-token valuation, and wallet/source-chain balance refresh guards.
- Chaos campaign: `2` campaigns passed, including 2,000 route mutations and 600 runner iterations.
- Local Anvil gates (3 September 2026, block `25893155`): `100` snapshot/revert iterations, `100` ordered-route stress iterations, and the Node four-position protocol proof—including a real fxUSD borrow against an existing ETH long with position-ID preservation—passed. The separate browser gate opened and verified coexisting ETH/BTC long/short positions, exercised in-place wallet account switching/disconnect and the existing-long borrow flow, checked delayed discovery and cross-workspace views, and restored its snapshot. The protected workflow requires all three gates; local working-tree results and an older green badge do not replace CI on the release commit.
- Bundle guardrails: 12 MiB total, 8 MiB JavaScript, 3 MiB gzip, and 2 MiB largest JavaScript asset; these are regression limits, not UX guarantees.

## Delivery order

1. Keep scope, wallet authority, validation, simulation, sequencing, bridge recovery, and fxSAVE lifecycle green.
2. Re-run static build, dependency audit, bundle check, and mobile route tests for every release.
3. Test current desktop/mobile browsers and Telegram Android, iOS, Desktop, and Web launch behavior and wallet prompts manually; automated tests use no production funds or live signing authority.
4. Add a new SDK capability only through a reviewed scope-lock change and a matching matrix entry, tests, review UI, recovery behavior, and documentation.

The next promotion checks are the protected Alchemy workflow for the release commit and broader real-device coverage across ordinary mobile browsers and Telegram.
