# COMPLETED — Hardening Pass, Phases 1–4

Inventory of everything shipped in the audit → plan → execute → verify pass
(PRs #30–#46), with how each item was verified. Honest gaps and follow-ups
live in [GAPS.md](./GAPS.md). Work-item IDs refer to [PLAN.md](./PLAN.md).

## Phase 1–2: Audit & Plan (read-only)

| PR | What |
|----|------|
| #30 | `docs/audit/` — full security & product audit. Headline finds: hardcoded credentials in scripts/docs, a mini-app trade path broadcasting **empty calldata**, unauthenticated Telegram/Privy webhooks, a fabricated contract-address registry, fake quotes, no tx idempotency, a health endpoint that always said "healthy". |
| #31 | `docs/PLAN.md` — W-01…W-22 work items, P0–P3, dependency graph, non-negotiables. |

## Phase 3: Execution (all merged to `main`)

### P0 — security & money paths

| W | PR | Shipped | Verified by |
|----|----|---------|-------------|
| W-01 | #32 | Hardcoded credentials stripped from scripts/docs; gitleaks CI (SHA-pinned, fails on findings). Credentials **rotated by owner** (old DB/Redis/Privy/bot-token values are dead). | gitleaks clean run in CI; rotation confirmed by owner |
| W-02 | #33 | Mini-app empty-calldata trade broadcast **kill-switched**; unsound limit-order signing path removed. | unit tests; manual route review |
| W-03 | #34 | Telegram webhook auth via `X-Telegram-Bot-Api-Secret-Token` (timing-safe), fail-closed rate limiter. | unit tests incl. negative cases |
| W-04 | #35 | Fabricated `CONTRACTS` registry deleted; single `ADDRESSES` source, every entry verified on-chain. | bytecode check vs mainnet, re-run on fork (Phase 4) |
| W-06 | #39 | At-rest encryption: random salts, no fallback key, BYOK guard. | unit tests (round-trip, tamper, missing-key fail) |
| W-07 | #40 | Real fx-sdk quotes (`increasePosition`/`decreasePosition`); `simulateRoute` via `eth_simulateV1`, **fail-closed**. | unit tests + Anvil fork (Phase 4, below) |
| W-08 | #42 | Privy Policy Engine: default-deny wallet policy (allowlisted contracts/methods only), pinned `PRIVY_POLICY_ID`. | policy unit tests; live policy created by owner |
| W-09 | #41 | Limit orders: real EIP-712 signing rail, domain/types verified against the live `LimitOrderManager` (`eth_call` to `DOMAIN_SEPARATOR`/`hashTypedData` cross-check). | signature cross-check vs contract; unit tests |
| W-11 | #43 | Tx executor: idempotency keys (DB-unique), explicit state machine (`pending→simulated→submitted→confirmed/failed`), EIP-1559 fees from `eth_feeHistory` (median priority fee, clamped 0.1–10 gwei, 2× base headroom), receipt watcher (replaces Privy enterprise webhooks). | 17 unit tests; fees + simulation re-verified on fork (Phase 4) |

### P1 — correctness & operations

| W | PR | Shipped | Verified by |
|----|----|---------|-------------|
| W-13 | #36 | Unmounted `api/v1` stubs + orphaned middleware deleted; webhook limiter fail-closed. | tsc + suite green after deletion |
| W-10 | #37 | `pnpm test` actually runs the vitest suite in CI (was a no-op). | CI run executes 17+ files |
| W-05 | #38 | Production fail-fast: boot dies with an explicit list if security-critical env vars are missing. | config unit tests |
| W-12 | #44 | Real notifications: single pref-aware gate (kinds, quiet hours w/ urgent bypass, throttles, AuditLog only after confirmed delivery); health monitor sends real 🔴/🟡 alerts; limit-order poller rewritten onto the relay's real incremental `/v1/order-updates` endpoint (old endpoint didn't exist). Privy webhook path retired (enterprise-only — see ADR note in PR). Dead modules deleted (tx-notifier, rules engine writing fake AuditLogs, ai/automation stubs). | 13 notification tests + 15 limit-order tests |
| W-14 | #45 + workflows zip | Render canonical (deploy via Render Git integration); `fly.toml` deleted; `deploy.sh`/compose dev-only; `DEPLOYMENT.md` rewritten (old doc leaked infra hostnames). Workflows: least-privilege `permissions:`, third-party actions SHA-pinned, `deploy.yml` reduced to a gated DB-migration job, `fx-upgrade-monitor` opens a PR instead of pushing `main`. Workflow files delivered out-of-band (app token lacks `workflows` scope) — **apply status tracked in GAPS.md**. | YAML/bash lint; SHA pins resolved against upstream tags |
| W-15 | #46 | Observability: pino hook masks wallet addresses in all logs (tx hashes intentionally exempt); per-command timing/metrics (p50/p95); honest `/api/v1/health` (the path Render polls previously returned a hardcoded "healthy" — now real DB/Redis/RPC/worker checks, DB down ⇒ 503); Sentry errors-only with scrubbing beforeSend; daily SLO digest to `ADMIN_TELEGRAM_CHAT_ID`; fx-sdk `poolData-->` stdout spam silenced; dead duplicate env schema deleted. | 14 new tests; suite 179/179 |

## Phase 4: Mainnet-fork verification

Run via `apps/bot/scripts/fork-verify.ts` against **Anvil forking mainnet**
(block `25,290,368`) — never against live mainnet. **Result: 36/36 passed.**

1. **Addresses** — every non-sentinel entry in `ADDRESSES` has deployed
   bytecode on the fork (Router, pool managers, pools, LimitOrderManager,
   fxUSD/FXN/fxSAVE/veFXN, oracle, treasury, collateral tokens).
2. **Fees** — `getEip1559Fees` derived sane values from the fork's real
   `eth_feeHistory`: priority fee within the 0.1–10 gwei clamp, max fee
   covering current base fee with headroom.
3. **Simulation, positive** — `simulateRoute` (eth_simulateV1) ran a 3-tx
   chained route (WETH `deposit` → `approve` → `transfer`); later txs saw
   earlier txs' state; per-tx gas reported and summed correctly.
4. **Simulation, fail-closed** — a route whose 2nd tx reverts returned
   `success:false` with `failedTxIndex: 1` and the revert reason. Nothing
   would broadcast.
5. **Real quotes** — fx-sdk `quoteOpenPosition` (wstETH long 2×, 1 wstETH)
   against fork state returned 3 routes / 6 txs with live pool data; the
   quoted route's calldata simulated and failed closed at the funding step
   for an unfunded account — expected, and proof the gate runs on real
   calldata, not mocks.

## Test suite

`apps/bot`: **179 tests across 20 files, all passing**; `tsc --noEmit` clean.
Coverage spans webhook auth, encryption, config fail-fast, fee math,
tx state machine + idempotency, EIP-712 limit orders, notifications
(prefs/quiet-hours/throttle/audit), resilience primitives, observability
(masking, metrics, timing, scrubbing, digest).
