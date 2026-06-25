# FxAeon — Phase 1 Security & Correctness Audit

**Date:** 2026-06-10
**Scope:** Full repo at commit `27b9478` (read-only — no source changes in this PR)
**Method:** Manual review of every file under `apps/bot/src`, `apps/mini-app/src`, `packages/*`, all workflows, deploy configs, and scripts. Contract addresses independently verified against AladdinDAO's `fx-protocol-contracts` ignition manifest and Blockscout mainnet. `tsc --noEmit` run locally for both apps (both pass).

**Severity scale:**
- **P0** — fund loss, key/credential exposure, or trade execution integrity. Fix before any user touches the bot.
- **P1** — reliability/correctness issues that will cause incidents in production.
- **P2** — UX and competitive-quality gaps.
- **P3** — hygiene, docs, dead code.

---

## P0 — Critical

### P0-1 · Live production credentials committed to a public repository
**Files:** `docs/DEPLOYMENT.md`, `deploy.sh:23`, `health-check.sh:9,121,168`, `smoke-test.js:12,137,181`, `smoke-test.sh:8,91,116`, `apps/mini-app/.env.production`

The repo (public) contains, in plaintext at HEAD:
- the **Telegram bot token** (full bot takeover: an attacker can `setWebhook` to their own server and intercept every user message),
- the **Privy app secret** (server-side wallet API authority),
- the **Supabase Postgres password** (full read/write on the production DB),
- the **Upstash Redis REST token**,
- the **Alchemy API key**.

**Action (out of band, not a code change):** rotate *all five* immediately — BotFather token revoke, Privy dashboard secret rotation, Supabase password reset, Upstash token reset, Alchemy key rotation. Then strip the values from the listed files and replace with env lookups. History scrubbing (BFG / `git filter-repo`) is secondary; rotation is what actually closes the hole. Note `scripts/cleanup-secrets.sh` exists but only un-tracks `.env` files — it never addressed hardcoded values in docs/scripts.

**Note:** the `NEXT_PUBLIC_*` values in `apps/mini-app/.env.production` are client-facing by design, but the Alchemy key embedded there is the same key used server-side and should be replaced with a separate, domain-allowlisted key after rotation.

### P0-2 · Mini App `/trade` broadcasts an empty transaction to the Router
**File:** `apps/mini-app/src/app/trade/page.tsx:41-56`

```ts
const tx = {
  to: '0x33636D49FbefBE798e15e7F356E8DBef543CC708', // Router
  data: '0x', // Would be encoded from fx-sdk
  value: '0x0',
  ...
};
const hash = await provider.request({ method: 'eth_sendTransaction', params: [tx] });
```
A real user completing the trade flow signs and broadcasts a transaction with **empty calldata** to the Router diamond. No position is opened; the user pays gas for a no-op/revert, then the UI shows a success screen and reports `trade_executed` back to the bot via `sendData`. This is the single most dangerous path in the repo: it looks finished, produces a real tx hash, and silently does nothing.

**Required:** block the confirm button behind real fx-sdk calldata + a passing `viem.simulateContract`, or hard-disable the flow with an honest "not yet live" state.

### P0-3 · Trade "simulation" is fabricated everywhere
**Files:** `apps/bot/src/fx/index.ts:32` (`gasEstimate = 250000 + Math.floor(Math.random() * 50000)`, returns `success: true` unconditionally), `apps/bot/src/api/simulate-trade.ts:75` (`currentPrice = 3000; // Would fetch from oracle`), plus `parseFloat`/`Number` math on amounts throughout both files.

There is **no `viem.simulateContract` call anywhere in the repo.** The architecture's core safety invariant ("simulate before every broadcast") does not exist. Liquidation-price and health math shown to users is derived from a hardcoded $3000 price.

**Required:** real `publicClient.simulateContract` against the Router with fx-sdk-encoded calldata; all amounts as `bigint` (wei); oracle price from the f(x) price oracle or a reputable feed — never a constant.

### P0-4 · Fabricated contract addresses in `packages/shared/src/contracts.ts`
The entire `CONTRACTS` map is fake. Verified on mainnet via Blockscout (`eth_getCode` equivalent): sampled addresses including `Market 0x3d8A56…`, `fxUSD 0x9C2D4B…`, `xETH 0x66E47E…`, `fxSave 0x52A1A5…` have **no deployed code**, and several follow an obvious `…1A2B3C4D…` synthetic hex pattern. The map also contradicts `addresses.ts` (different "fxSave"). Today only the dead `core/fx-sdk.ts` stub imports it — but any future wiring that picks the wrong import sends funds to non-existent contracts.

By contrast, `packages/shared/src/addresses.ts` (`ADDRESSES`) checks out: Router `0x33636D…` = `Router#Diamond`, PoolManager, fxUSD, FxUSDBasePool, PegKeeper all match the f(x) ignition manifest; both long/short pools carry the expected token symbols (xWBTC, sstETH, sWBTC) on-chain; FXSAVE/FXN/veFXN are live. **Exception:** `LIMIT_ORDER_MANAGER 0x112873b…` exists on-chain (TransparentUpgradeableProxy) but is *not* in the ignition manifest and its identity could not be independently confirmed — must be verified against an official f(x) source before any limit-order code goes live.

**Required:** delete `contracts.ts` and `core/fx-sdk.ts`; single source of truth = `addresses.ts`, each entry annotated with its verification source.

### P0-5 · Webhooks are unauthenticated
- **Telegram:** `apps/bot/src/main.ts:197` registers the webhook without `secret_token`, and the `/webhook` route does not check `X-Telegram-Bot-Api-Secret-Token`. Anyone who learns the URL can inject forged updates (i.e., impersonate any `from.id` → act as any user).
- **Privy:** `apps/bot/src/api/webhook.ts:8-15` checks only that a `privy-signature` header **is present**; the verification call is commented out. Forged `transaction.confirmed` / `execution_reverted` events can corrupt `TxRecord` state for arbitrary tx hashes.

**Required:** `setWebhook({ secret_token })` + constant-time header check; implement real Privy signature verification (SVIX-style HMAC) and reject on failure.

### P0-6 · Limit-order EIP-712 flow is cryptographically unsound
**File:** `apps/mini-app/src/app/limit/page.tsx:70-105`
- `salt` generated with `Math.random()` (non-CSPRNG) — predictable.
- `nonce: Date.now()` — no relation to any on-chain or relayer nonce scheme; collision/replay semantics unknown.
- `orderHash: '0x...'` **literal placeholder** submitted to the relayer.
- `fxUSDDelta/collDelta/debtDelta` all hardcoded `0`.
- Domain (`name: "f(x) Limit Order Manager", version: "1"`) and the `Order` type layout are **unverified** against the actual LimitOrderManager contract (which itself is unverified, see P0-4). No unit test pins the typed-data hash to a known-good fixture.

**Required:** verify domain separator + struct hash against the deployed contract (`eth_call` the contract's `DOMAIN_SEPARATOR`/order-hash function), compute `orderHash` with `viem.hashTypedData`, use `crypto.getRandomValues` for salt, and add a fixture test.

### P0-7 · Encryption utility is not production-grade
**File:** `apps/bot/src/utils/encryption.ts:9-16`
- Hardcoded dev fallback key `'fxbot-development-key-32-chars!!'` — in production, if `ENCRYPTION_KEY` is unset it silently falls back to `PRIVY_APP_SECRET` (now public, see P0-1) or the dev constant, with only a console warning.
- `scryptSync(secret, 'salt', 32)` — static string salt defeats the KDF.
- Docs claim libsodium sealed boxes + per-user salts; none of that exists. BYOK AI keys (`ai/index.ts` imports libsodium but is dead code) and any future key material would be protected by this.

**Required:** fail-fast if no real key in production; random per-record salt (or HKDF with context); align docs with reality.

### P0-8 · No Privy Policy Engine exists
The architecture docs describe a default-deny policy (3 ALLOW rules: Router, LimitOrderManager, fxSAVE). There is **no policy configuration anywhere in the repo** — no policy IDs, no API calls creating policies, nothing in env examples. `core/privy.ts:30` `createWallet()` returns `{ address: '0x...' }` — a string literal. Until wallets are actually created with a policy attached, every claim about transaction guardrails is aspirational.

---

## P1 — Reliability / correctness

### P1-1 · `@aladdindao/fx-sdk` is imported but not a dependency
`apps/bot/src/fx/index.ts` imports `@aladdindao/fx-sdk` (real package — verified on npm, latest 1.0.5) but it appears in **no package.json** and not in `pnpm-lock.yaml`. `apps/bot/src/types/externals.d.ts` declares ambient module types, which is why `tsc` passes. The module is currently dead at runtime (nothing in `main.ts`'s import graph reaches it), but the moment trading is wired, Node will throw `ERR_MODULE_NOT_FOUND`. This is the likely class of error behind "deploy works but bot fails."

### P1-2 · CI "test" job is vacuous; tests are unrunnable via documented commands
Root `pnpm test` → `turbo run test`, but **no workspace package defines a `test` script** (`apps/bot/package.json` scripts: build/dev/start/typecheck/audit only). `apps/bot` has `vitest` + `vitest.config.ts` + 15 test files, but CI never executes them — the test job installs, builds, runs nothing, and goes green. Claims like "106/107 tests passing" are not reproducible from the repo. Also: CI uses `--no-frozen-lockfile` (non-reproducible installs), and both `bun.lock` and `pnpm-lock.yaml` are committed.

### P1-3 · Two conflicting config systems; funds-critical env vars are optional
`apps/bot/src/middleware/config.ts` (used by `main.ts`) makes `PRIVY_APP_SECRET`, `ALCHEMY_RPC_URL`, `REDIS_URL`, `KMS_MASTER_KEY` **optional** — the bot boots with wallet creation, RPC, queues, and encryption silently disabled (warning-level logs only). A second, stricter `apps/bot/src/config.ts` also exists and is imported by `middleware/rateLimit.ts`. Production should fail fast when funds-critical configuration is missing (a degraded "read-only mode" is acceptable only if explicit and user-visible).

### P1-4 · Workers are shells; user-facing notifications are commented out
- `notifications/tx-notifier.ts`: all `sendNotification` calls commented out; stuck-tx rebroadcast is a comment.
- `notifications/health-monitor.ts`: liquidation warnings commented out — **users will not be warned before liquidation** despite docs promising it.
- `notifications/limit-order-poller.ts`: fill/cancel notifications commented out; bare `fetch` with no timeout/retry/backoff/circuit-breaker against `fx-limit-order-api.aladdin.club`.
- `rules/engine.ts`: the actual rule action (`executeRuleAction`) is commented out, yet the worker **records `rule_executed` in AuditLog and resets `failureCount`** — the audit trail lies. The condition watcher loop body is empty. (Module is also never imported by `main.ts` — see P3.)

### P1-5 · No idempotency, no tx state machine, no fee logic
Grep-verified: no Redis `SETNX` idempotency keys around any broadcast path, no BullMQ unique `jobId` usage, no `pending→mined→confirmed→reorged/replaced/dropped` state handling (only string statuses written from webhooks, which are forgeable per P0-5), and no EIP-1559 `feeHistory`-based fee estimation anywhere. All three are prerequisites for the "dup-tx = 0" SLO.

### P1-6 · Unmounted, unauthenticated API stubs that fabricate success
`apps/bot/src/api/v1/routes/{positions,twap,batch,gas}.ts` return fake success payloads (`positionId: pos_${Date.now()}`, TWAP "scheduled", etc.) with **no auth middleware**. They are currently *not mounted* (`api/index.ts` mounts only health/simulate/webhook) — but `docs/api.md` documents them as a live API. Either delete them or implement them behind real auth; do not leave honeypots that return success.

### P1-7 · Number-typed money math
`parseFloat`/`Number` used on amounts, leverage, and prices across `fx/index.ts`, `api/simulate-trade.ts`, `commands/trade.ts`, `commands/limit.ts`, and the mini-app (`BigInt(Math.floor(targetPrice * 1e18))` — precision loss above ~2^53 and on decimal prices). All value math must be `bigint` wei/1e18-scaled with explicit decimal handling at the UI boundary only.

### P1-8 · Duplicate middleware with divergent behavior
Pairs: `errorHandler` in both `middleware/index.ts` and `middleware/errors.ts`; `logger.ts` vs `logging.ts`; `rate-limiter.ts` (rate-limiter-flexible, used) vs `rateLimit.ts` (node-redis client that is **never `.connect()`ed** — every call would reject and fail open). Pick one of each; delete the rest.

### P1-9 · Deploy-target sprawl
Four deploy stories coexist: Render (`render.yaml`, webhook URL derived from `RENDER_EXTERNAL_URL`), Fly (`fly.toml` + `deploy.yml` gated on a var), docker-compose, and Cloudflare Pages for the mini-app — plus `deploy.sh` pointing the production bot webhook at a hardcoded Render URL. Render `starter` is a paid plan (~$7/mo — fits the ≤$21 budget but should be an explicit ADR). One canonical target should be chosen and the others clearly marked as dev-only or removed.

---

## P2 — UX / competitive gaps
(Summarized here; full analysis in `DEFICIENCIES.md`.)

- **P2-1** Onboarding dead-ends: `/start` never shows a Mini App button or wallet-creation flow; "Step 1: Connect Wallet" is a text message with no action attached.
- **P2-2** `/trade` and `/limit` end at text previews ("Use the Mini App to sign and submit") with no inline keyboard, no deep link, no confirm/cancel.
- **P2-3** i18n: 14 locale JSONs exist in two duplicate directories, but `@grammyjs/i18n` is wired nowhere; every user-facing string is hardcoded English.
- **P2-4** Mini App ignores Telegram platform APIs: custom `<button onClick={history.back()}>` instead of `BackButton`, no `MainButton`, no `HapticFeedback`, fixed Tailwind palette instead of `themeParams`, no `viewportStableHeight` (APIs exist only in `types/telegram.d.ts` and `ErrorBoundary.tsx`).
- **P2-5** Error UX: generic "❌ An error occurred" replies; no actionable recovery hints; user-rejection vs. real-failure distinguished only in the mini-app trade page.

---

## P3 — Hygiene

- **P3-1** Dead modules: `rules/engine.ts`, `fx/index.ts`, `ai/index.ts`, `core/fx-sdk.ts`, `core/automation.ts`, `core/webhooks.ts`, `api/v1/**` — none reachable from `main.ts`. Delete or wire deliberately.
- **P3-2** Identity drift: fxBot vs FxAeon vs @fxAladdinBot vs @FxAeonBot across README/docs/code strings.
- **P3-3** `docs/api.md` documents an API that doesn't exist; `SECURITY.md` claims passed internal audits; `docs/architecture.md` describes Policy Engine/libsodium/keeper infrastructure absent from code. Docs must be brought down to truth.
- **P3-4** `next.config.js` `ignoreBuildErrors: true` is stale — mini-app `tsc --noEmit` passes clean (verified). Remove the flag so regressions surface.
- **P3-5** `fx-upgrade-monitor.yml` pushes commits as `GitHub Action` directly to the default branch and posts to a Discord webhook secret that may not be configured.
- **P3-6** `validation.ts` `tradeSchema` allows leverage 1–31; actual pool caps are 7x long / 3x short (mirrored correctly in the mini-app). Single source for limits in `@fxaeon/shared`.

---

## Verification appendix

| Check | Result |
|---|---|
| `ADDRESSES.ROUTER` vs ignition manifest | ✅ `Router#Diamond` |
| `ADDRESSES.{LONG_POOL_MANAGER, FXUSD, FXUSD_BASE_POOL, PEG_KEEPER}` | ✅ manifest match |
| `ADDRESSES.{WSTETH,WBTC}_{LONG,SHORT}_POOL` | ✅ live, token symbols match |
| `ADDRESSES.{FXSAVE, FXN, VEFXN}` | ✅ live contracts |
| `ADDRESSES.LIMIT_ORDER_MANAGER` | ⚠️ live proxy, **identity unconfirmed** |
| `CONTRACTS.*` (4 sampled) | ❌ **no code on mainnet — fabricated** |
| `@aladdindao/fx-sdk` on npm | ✅ exists, latest 1.0.5; ❌ not in any package.json |
| `apps/bot` `tsc --noEmit` | ✅ pass |
| `apps/mini-app` `tsc --noEmit` | ✅ pass |
| Test suite via repo scripts | ❌ no `test` script in any package; CI test job vacuous |
| Secrets at HEAD | ❌ present in 6 files (P0-1) |
