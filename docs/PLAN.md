# FxAeon — Phase 2 Implementation Plan

**Date:** 2026-06-11 · **Baseline:** commit `27b9478` · **Inputs:** `docs/audit/AUDIT.md`, `THREAT_MODEL.md`, `DEFICIENCIES.md`, `METRICS.md` (PR #30)

**Contract for Phase 3:** one PR per work item, titled `[P0|P1|P2|P3] <area>: <change>`, each with What/Why/Risk/Rollback/How-verified. Simulation evidence (before/after) for any on-chain path. Every PR passes typecheck + tests + smoke. DB changes ship with migration **and** rollback. Env changes update `.env.example` + SETUP docs in the same PR.

---

## 0. Pre-work (owner actions, not PRs)

| ID | Action | Owner | Blocking |
|---|---|---|---|
| **A1** | Rotate all 5 leaked credentials: BotFather token, Privy app secret, Supabase password, Upstash token, Alchemy key (AUDIT P0-1) | **@0xNaeemHassan** | Blocks W-08 (wallet creation must not ship on burned secrets). W-01 can land before rotation but rotation makes it meaningful. |
| **A2** | Confirm identity of `LIMIT_ORDER_MANAGER 0x112873b…` against an official f(x) source (Aladdin docs/team/repo), or accept my proposal to keep limit-order signing disabled until verified | **@0xNaeemHassan** | Blocks W-09 only. |

---

## 1. Backlog

Effort: S (≤½ day) · M (1–2 days) · L (3+ days). "Verify" = how the PR proves itself beyond typecheck/tests.

### P0 — must land before any real user/funds exposure

| ID | Area | Change | Effort | Depends on | Verify |
|---|---|---|---|---|---|
| **W-01** | secrets | Strip hardcoded credentials from `docs/DEPLOYMENT.md`, `deploy.sh`, `health-check.sh`, `smoke-test.{js,sh}`, `apps/mini-app/.env.production` → env lookups; add gitleaks to CI; update `.env.example` | S | — | gitleaks scan clean on the PR; grep for known prefixes returns nothing |
| **W-02** | kill-switch | Hard-disable Mini App `/trade` broadcast (empty-calldata tx) and `/limit` signing behind an honest "execution not yet live" state; remove fake success screens & `sendData('trade_executed')` | S | — | Manual walkthrough: flows end at honest state; no `eth_sendTransaction` reachable |
| **W-03** | webhooks | Telegram `setWebhook({secret_token})` + constant-time header check; real Privy signature verification (SVIX HMAC) with timestamp-skew rejection | S | — | Unit tests: forged/missing/stale signatures → 401; valid fixture → 200 |
| **W-04** | addresses | Delete fabricated `packages/shared/src/contracts.ts` + dead `core/fx-sdk.ts`; `addresses.ts` becomes the single registry, each entry annotated with verification source; CI job asserts every address has code on a mainnet fork | S | — | CI address-check green; repo-wide grep shows zero imports of deleted modules |
| **W-05** | config | Merge dual config systems into one; funds-critical vars (`PRIVY_APP_SECRET`, `ALCHEMY_RPC_URL`, `REDIS_URL`, `ENCRYPTION_KEY`) **fail-fast** in production; explicit read-only degraded mode if intentionally absent | M | — | Boot test matrix: missing var → process exits non-zero with named error in prod, warns in dev |
| **W-06** | encryption | Remove dev fallback + `PRIVY_APP_SECRET` fallback; require real `ENCRYPTION_KEY` in prod (fail-fast via W-05); per-record random salt (HKDF), versioned ciphertext format with migration for any existing rows | M | W-05 | Round-trip unit tests; old-format decrypt + re-encrypt migration test; prod boot without key fails |
| **W-07** | execution-core | Real trade pipeline foundation: add `@aladdindao/fx-sdk` as a real dependency (kills the ambient `.d.ts`), fx-sdk-encoded calldata, **mandatory `viem.simulateContract` gate** before any broadcast, all money math `bigint`, oracle price from f(x) price oracle (no `currentPrice = 3000`) | L | W-04, W-10 | Anvil mainnet-fork: open-position sim succeeds with real calldata; sim-gate refuses unsimulated calldata (unit test); fixture tests for wei math |
| **W-08** | wallets | Real Privy wallet creation + **default-deny Policy Engine** (ALLOW: Router diamond, fxSAVE; LimitOrderManager only after A2); policy ID pinned in env and asserted at boot; `/start` wires to it | L | A1, W-03, W-05 | Integration test against Privy sandbox/staging app; boot assertion test; policy JSON committed + reviewed |
| **W-09** | limit-orders | Sound EIP-712: domain separator read from the deployed contract and pinned in a fixture test, `orderHash` via `hashTypedData`, CSPRNG salt, real deltas from quote, nonce scheme per contract/relayer spec | M | A2, W-07 | Fixture test: typed-data hash matches contract `eth_call`; fork test submits a valid order struct |

### P1 — reliability before scale

| ID | Area | Change | Effort | Depends on | Verify |
|---|---|---|---|---|---|
| **W-10** | ci-tests | Add `test` scripts to packages; run vitest in CI for real; `--frozen-lockfile`; delete `bun.lock` (pnpm is canonical); fix/skip-with-issue any currently-broken tests | M | — | CI run shows N tests executed (not 0); lockfile drift fails CI |
| **W-11** | tx-integrity | Idempotency (Redis `SETNX` per intent + BullMQ unique `jobId`), tx state machine (`pending→mined→confirmed/replaced/reorged/dropped`, additive `TxRecord` columns + migration/rollback), EIP-1559 fees from `feeHistory` with caps & replacement bumps, receipt-based reconciliation (don't trust webhooks alone) | L | W-07 | Fork tests: double-submit blocked; replacement detected; state transitions asserted; dup-detection SQL = 0 |
| **W-12** | workers | Wire real notifications (tx-notifier, health-monitor liquidation warnings, limit-order fills) through one pref-aware `notify()` gate; timeouts + backoff + jitter + circuit breaker on all external calls; create `docs/external-apis.md`; **delete** dead `rules/engine.ts` (incl. lying AuditLog write), `ai/index.ts`, `core/automation.ts`, `core/webhooks.ts` | M | W-11 | Unit tests for breaker/timeout; staged Telegram test chat receives each notification type; AuditLog written only on confirmed receipt |
| **W-13** | api-cleanup | Delete unmounted fake `api/v1` stubs; delete duplicate middleware (`errors.ts`, `logging.ts`, never-connected `rateLimit.ts`); webhook route limiter fail-closed; align `docs/api.md` with reality | S | — | Grep: no orphan imports; rate-limit behavior test |
| **W-14** | deploy | Single canonical target = Render (existing paid starter, ~$7/mo); `deploy.sh` de-hardcoded; Fly/compose marked dev-only or removed; least-privilege `permissions:` on workflows; fx-upgrade-monitor commits → PR instead of direct push to main; pin third-party actions by SHA | S–M | W-01 | Deploy dry-run; workflow lint; monitor produces a PR in a test run |
| **W-15** | observability | pino redaction (addresses → last-4, no tokens/headers), command-timing middleware, sim/health counters, `/health` v2 (DB/Redis/RPC-lag/worker heartbeats), Sentry with `beforeSend` scrubber (free tier), daily SLO digest → admin Telegram chat | M | W-05 | Log snapshot shows redaction; `/health` returns full JSON; digest fires in staging |

### P2 — product competitiveness (separate sign-off after P0+P1)

| ID | Area | Change | Effort | Depends on |
|---|---|---|---|---|
| W-16 | onboarding | `/start` → Create-Wallet web_app button → funded-address empty states → referral write | M | W-08 |
| W-17 | trade-ux | Inline keyboard ladder + signed deep links (short TTL) + Mini App MainButton confirm + status edits on the same message | L | W-07, W-11 |
| W-18 | portfolio | On-chain position reads (PoolManager) as source of truth; per-position Close/TP-SL buttons; health bars | L | W-07 |
| W-19 | error-ux | Error taxonomy → actionable copy; every failure states whether anything was broadcast | M | W-11 |
| W-20 | tma-platform | BackButton/MainButton/haptics/themeParams/viewportStableHeight; lazy-load Privy SDK; Lighthouse CI budget (TTI <2.5s 3G-Fast) | M | — |
| W-21 | i18n | Single locale dir, wire `@grammyjs/i18n` keyed off `User.language`, move strings to catalogs, CI key check | M | W-16/17 strings stable |

### P3 — hygiene (bundled into nearby PRs or one sweep PR)

`ignoreBuildErrors` removal (with W-10) · leverage-cap single source in `@fxaeon/shared` (with W-07) · docs truth pass: `SECURITY.md` fake audit claims, `architecture.md` nonexistent components (with W-13) · naming decision fxBot vs FxAeon (owner call, no code risk).

---

## 2. Dependency graph

```
A1 (rotate creds) ──────────────┐
A2 (verify LOM addr) ──┐        │
                       │        ▼
W-01 secrets   W-02 kill-switch   W-03 webhooks   W-04 addresses   W-10 ci-tests   W-13 api-cleanup
   │                                  │                │               │
   ▼                                  │                └──────┬────────┘
W-14 deploy                           │                       ▼
                                      │              W-07 execution-core ◄── (fx-sdk dep)
W-05 config ──► W-06 encryption       │                  │         │
   │                                  ▼                  │         └──► W-09 limit-orders (also ◄ A2)
   └─────► W-15 observability     W-08 wallets ◄─────────┤
                                   (also ◄ A1)           ▼
                                                     W-11 tx-integrity
                                                          │
                                                          ▼
                                                     W-12 workers
                                                          │
                              P2: W-16 onboarding ◄───────┴──► W-17 trade-ux ──► W-18/19/20/21
```

**Suggested landing order (P0+P1):**
Wave 1 (parallel, all small): W-01, W-02, W-03, W-04, W-10, W-13
Wave 2: W-05 → W-06; W-14
Wave 3: W-07 (the big one)
Wave 4: W-08, W-11 (parallel)
Wave 5: W-12, W-15, W-09 (if A2 resolved)

## 3. No-touch list

- **`packages/db` schema:** additive migrations only (new `TxRecord` columns/status enum). No renames/drops of existing tables/columns.
- **No rebrand/restructure:** fxBot/FxAeon naming drift stays as-is until you decide (P3 owner call). No monorepo reshuffles.
- **`addresses.ts` verified entries:** values unchanged; only annotations + registry consolidation. Any address change requires an explicit verification citation in the PR.
- **No new paid services, no new DB, no new queue system.** BullMQ + Redis + Postgres stay.
- **Existing locale JSON content** untouched until W-21.
- **Privy policy scope:** default-deny baseline only; any widening = separate ADR PR.
- **Live mainnet:** no Phase 3/4 verification against live mainnet — Anvil mainnet-fork only.

## 4. Budget guard

| Item | Cost | Notes |
|---|---|---|
| Render starter (bot) | ~$7/mo | existing |
| Supabase, Upstash, CF Pages, Sentry, UptimeRobot, Lighthouse CI, GH Actions | $0 | free tiers, validated against 500 MAU in METRICS.md |
| Anvil fork (verification) | $0 | local foundry in CI/sandbox |
| **Total** | **~$7/mo** | ceiling $21/mo; anything new = ADR before adoption |

## 5. Sign-off requested

Approve **P0 (W-01…W-09) + P1 (W-10…W-15)** as the Phase 3 scope (with A1/A2 on you). P2 gets its own go/no-go after P0+P1 land. Reply with adjustments or **proceed** to start Wave 1.
