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

`apps/bot`: **243 tests across 25 files, all passing**; `tsc --noEmit` clean.
Coverage spans webhook auth, encryption, config fail-fast, fee math,
tx state machine + idempotency, EIP-712 limit orders, notifications
(prefs/quiet-hours/throttle/audit), resilience primitives, observability
(masking, metrics, timing, scrubbing, digest).

## Phase 5: P2 product waves (in progress)

| Item | PR | What shipped | Verification |
|------|----|--------------|--------------|
| W-16 | — | Onboarding: `/start` shows a reply-keyboard **Create Wallet** web_app button (reply keyboard because `WebApp.sendData` only works for keyboard-launched Mini Apps); new `message:web_app_data` handler completes onboarding **server-side** — Privy user resolved from the authenticated Telegram id, wallet created via the W-08 default-deny policy path, client payload treated as a trigger only (forged `privyUserId`/`address` ignored); referral codes parsed from deep links, written fail-soft on signup (CSPRNG codes replace `Math.random`); funded-address empty states read live ETH/wstETH/WBTC balances fail-soft (3s timeout → no balance claims); `/refer` share link fixed (was hardcoded to the wrong bot, `fxAladdinBot`); additive `User.privyWalletId` column + migration `20260611_user_privy_wallet` with rollback. | 22 new tests; suite 201/201 |
| W-20 | #50 | TMA platform: `telegram-web-app.js` finally loaded (Telegram injects nothing — `window.Telegram` was always undefined, so sendData/theme/BackButton were silently dead); typed `lib/telegram.ts` helpers (haptics, theme→CSS vars, viewport height, Back/MainButton, all no-ops outside Telegram); `TelegramProvider` (ready/expand, live themeChanged sync, native BackButton on sub-pages); Privy SDK lazy-loaded (shared first-load JS 105 kB); Lighthouse CI budget (TTI <2.5s, 3G-Fast mobile). | mini-app `tsc` clean; static export builds; bundle split verified in build output |
| W-17 | #51 | Trade UX: first production wiring of the W-11 executor (`executeRoute` previously had **no callers**) and the bot's first `callback_query` handler (every inline button used to spin forever — unknown callbacks now answer honestly). `/trade` inline ladder (market→side→leverage→amount, one message edited in place); HMAC-signed short-TTL (10 min) trade intents that fit callback_data ≤64 B and `/start` deep links ≤64 chars; Confirm/Cancel inline buttons with quote→simulate→broadcast→receipt status edits on the SAME message; idempotency key derived from the intent nonce (double-taps dedupe); `/start t1_*` (signed share links) + `/start tq_*` (Mini App MainButton "Confirm in Telegram", re-validated server-side); mini-app trade page's dead "Execution coming soon" button replaced with the deep-link confirm (kill-switch stays — the mini-app still never broadcasts). | 19 new tests (intent sign/verify/tamper/expiry, ladder, confirm/dedupe/failure, deep links); suite 224/224 |
| W-18 | #52 | Portfolio: on-chain PoolManager reads (f(x) SDK `getPositions` per market × side) replace the dead DB cache — `prisma.position` rows were never written, so /portfolio always showed empty; partial RPC failures surfaced per-market instead of presented as "no positions". Risk meter orientation FIXED (was inverted: low debt ratio rendered "CRITICAL"); debt ratio derived from on-chain leverage (1 − 1/lev). Per-position **Close** buttons: fresh on-chain re-read at prompt AND confirm (ownership gate — forged positionIds can only resolve against the presser's own wallet), full-close quote (`reducePosition`, `isClosePosition`), simulation-gated `executeRoute` with scoped idempotency key, status edits on the same message; honest TP/SL hint (rule setup still completes in the Mini App). Unwired `nav_*` buttons removed from /portfolio. | 13 new tests; suite 237/237 |
| W-19 | — | Error taxonomy: `classifyExecutionError`/`describeExecutionError` (`core/errorTaxonomy.ts`) classify executor failures by **broadcast state first** — simulation failures/unavailability explicitly say the transaction was **NOT sent** (the old copy implied a send on every failure), on-chain reverts never claim nothing happened and link the tx hash to Etherscan; actionable cause hints (insufficient funds, slippage, nonce, rate-limit, network) appended where detectable, unknown errors stay generic instead of guessing. Wired into trade-confirm and position-close failure paths. P3 sweep: mini-app `ignoreBuildErrors: true` removed (build verified clean), trade page leverage caps read from shared `RISK_PARAMS` instead of hardcoded copies, SECURITY.md fake "audit passed" table replaced with honest unaudited status. | 6 new tests; suite 243/243 |
| W-21 | — | i18n: the bot promised "6 languages" in /help while being 100% hardcoded English with TWO dead locale dirs (stale pre-W-16 copy, wrong bot username `fxAladdinBot`, never imported). Now: single canonical Fluent dir `src/i18n/locales/{en,es,ja,ko,ru,zh-CN}.ftl` with the CURRENT command copy; `@grammyjs/i18n` middleware wired in `main.ts`, locale negotiated from `User.language` (60s per-user cache, no DB query per update) → Telegram `language_code` → `en`, fail-soft on DB errors; `/start` (incl. plurals — ru one/few/other), `/help`, `/settings`, `/trade` usage and `/portfolio` empty state translated; `/settings lang X` confirms in the NEW language (cache invalidation + `useLocale`); `tsc` doesn't copy `.ftl`, so the build script now does. Remaining English surfaces documented in GAPS.md. | rewritten i18n tests: key + variable parity across all 6 locales, required key groups, runtime Fluent checks (multiline blank lines, plural categories, select variants), locale normalization |
