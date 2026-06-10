# FxAeon — Threat Model (STRIDE)

**Date:** 2026-06-10 · **Scope:** Telegram bot (grammY/Express), Next.js Mini App, Privy embedded wallets, Postgres/Redis, f(x) Protocol mainnet contracts.
**Assets at risk:** user wallet keys/signing authority (Privy), user funds in f(x) positions, the bot token (identity), the production DB, user PII (Telegram IDs ↔ wallet addresses), BYOK AI keys.

Status legend: 🔴 unmitigated · 🟡 partial · 🟢 mitigated (current repo state, commit `27b9478`).

---

## 1. Spoofing

| Vector | Scenario | Status | Required mitigation |
|---|---|---|---|
| **Telegram webhook spoofing** | Webhook registered without `secret_token` (`main.ts:197`); `/webhook` accepts any POST. Attacker who learns the URL forges updates with arbitrary `from.id` → issues commands *as any user* (e.g., `/limit`, future trade confirmations). | 🔴 | `setWebhook({secret_token})` + constant-time check of `X-Telegram-Bot-Api-Secret-Token`; reject otherwise. Keep webhook path unguessable as defense-in-depth only. |
| **Privy webhook spoofing** | `api/webhook.ts` checks header *presence* only; verification commented out. Forged `transaction.confirmed`/`execution_reverted` mutate `TxRecord` for arbitrary hashes; once notifications are wired, forged events trigger false user messages ("✅ confirmed") for trades that never landed. | 🔴 | Implement real signature verification (Privy uses SVIX-style HMAC: verify `svix-id`/`svix-timestamp`/`svix-signature` with the endpoint secret); reject on mismatch; bound timestamp skew (replay window). |
| **Mini App identity** | Pages trust Privy session only; `Telegram.WebApp.initData` is never validated server-side, and `sendData('trade_executed')` is trusted by the bot side without verification. A hostile web context can fabricate trade-executed messages. | 🔴 | Validate `initData` HMAC (bot token-derived key) on any server endpoint consuming Mini App data; never trust `sendData` payloads for state transitions — reconcile against chain. |
| **Deep link forgery** | Planned signed deep links (arch doc) don't exist; query params (`market`, `side`, `lev`, `amt`, `price`) are attacker-controllable in shared links — a victim can be handed a prefilled "open 7x short" link. | 🟡 (no execution wired yet) | HMAC-signed params + short TTL + display-before-confirm that re-derives everything server-side. |

## 2. Tampering

| Vector | Scenario | Status | Required mitigation |
|---|---|---|---|
| **Fabricated calldata / wrong target** | `CONTRACTS` map is fabricated addresses (no mainnet code); mini-app trade tx is `data:'0x'`. Any future mis-wiring sends value to dead addresses or executes no-ops. | 🔴 | Single verified address registry (`addresses.ts` + per-entry source citation); CI check: every address must have code on mainnet fork; mandatory `simulateContract` gate. |
| **DB tampering via leaked credentials** | Supabase password is public (AUDIT P0-1) → direct mutation of positions, limit orders, audit logs. | 🔴 | Rotate credentials; restrict DB network access (Supabase IP allowlist / pooler auth); treat AuditLog as append-only (DB role without UPDATE/DELETE). |
| **Replay / duplicate trade execution** | No idempotency keys, no unique BullMQ jobIds, no nonce management. Double-tap on confirm, webhook redelivery, or worker retry → duplicate broadcasts. | 🔴 | Redis `SETNX` idempotency key per user-intent (TTL > max confirmation time); BullMQ `jobId` = intent hash; per-wallet nonce serialization. |
| **Limit order tampering** | Order struct fields hardcoded (deltas 0), `orderHash` placeholder, salt from `Math.random()` — relayer-side substitution or replay semantics unverifiable. | 🔴 | Compute orderHash via `hashTypedData`; CSPRNG salt; pin domain separator to contract value in a unit test; verify relayer echoes the same hash. |

## 3. Repudiation

| Vector | Scenario | Status | Required mitigation |
|---|---|---|---|
| **Lying audit trail** | `rules/engine.ts` writes `rule_executed` AuditLog entries while the action itself is commented out; tx state comes from unverified webhooks. Users could be told a rule fired when nothing happened (or vice versa). | 🔴 | AuditLog entries only after on-chain confirmation (receipt + block hash recorded); include tx hash, block number, and effective values. |
| **No signing receipts** | No record binds a user confirmation (Telegram callback / Mini App tap) to the exact calldata signed. Disputes ("I never approved 7x") are unresolvable. | 🔴 | Persist intent → calldata hash → signature/tx hash chain per trade; show the same digest in the confirm UI. |

## 4. Information Disclosure

| Vector | Scenario | Status | Required mitigation |
|---|---|---|---|
| **Committed secrets** | See AUDIT P0-1 — bot token, Privy secret, DB password, Redis token, Alchemy key public at HEAD. | 🔴 | Rotate all; secret scanning (gitleaks) in CI; pre-commit hook. |
| **Key derivation weakness** | `encryption.ts`: static `'salt'`, dev fallback key, fallback to (now public) `PRIVY_APP_SECRET`. Any ciphertext produced so far (BYOK keys per schema `AiKey`) must be considered compromised. | 🔴 | Fail-fast key policy; re-encrypt stored ciphertexts after rotation; per-record random salt/nonce; document key hierarchy. |
| **Logging/Sentry PII** | pino logs include full request paths and IPs; no scrubbers configured for addresses/tokens; Sentry DSN planned. Docs require addresses truncated to last 4 — not implemented. | 🟡 | pino redact paths (`req.headers.authorization`, address fields); Sentry `beforeSend` scrubber; hash Telegram IDs in analytics. |
| **Telegram ↔ wallet linkage** | DB stores `telegramId ↔ walletAddress` 1:1; leak deanonymizes traders. | 🟡 | Covered by DB credential rotation + access restriction; consider encrypting telegramId at rest if threat profile grows. |

## 5. Denial of Service

| Vector | Scenario | Status | Required mitigation |
|---|---|---|---|
| **Webhook flood** | Rate limiter exists (rate-limiter-flexible, 30 r/s webhook) and fails *open* when Redis is down; unauthenticated webhook (above) makes the flood cheap and meaningful. | 🟡 | Auth first (secret token), keep limiter, fail-closed for the webhook route specifically. |
| **External API hangs** | `limit-order-poller` uses bare `fetch` (no timeout) every 30s; a hung upstream pins the event loop's interval chain and stalls all polling. No circuit breaker; `docs/external-apis.md` doesn't exist. | 🔴 | AbortController timeouts, exponential backoff + jitter, circuit breaker, and document every upstream (Telegram, Privy, Alchemy, aladdin.club relayer, price oracle). |
| **RPC exhaustion** | Single Alchemy key (public!), no fallback transport. Key revocation or throttle = full outage. | 🔴 | Rotate; viem `fallback([alchemy, publicnode, …])` with rank + retry; per-feature read budgets. |
| **Quota burn via fake API** | Unauthenticated stub routes (if ever mounted) accept unbounded POSTs and write nothing — pure log/CPU burn. | 🟡 | Delete or auth them (AUDIT P1-6). |

## 6. Elevation of Privilege

| Vector | Scenario | Status | Required mitigation |
|---|---|---|---|
| **Missing Privy Policy Engine** | No policy exists; once wallet creation is wired, a compromised bot server (or forged webhook driving delegated actions) could sign *arbitrary* transactions — unlimited approvals, transfers to attacker EOAs. | 🔴 | Create default-deny policy before first real wallet: ALLOW only Router diamond, (verified) LimitOrderManager, fxSAVE; deny raw `eth_sendTransaction` to other targets; policy ID pinned in env + checked at boot; any widening requires an ADR. |
| **BYOK key misuse** | `AiKey` ciphertexts protected by the weak KDF (above); a DB+config leak yields user OpenAI/etc. keys → spend on victim accounts. | 🔴 | Fix encryption (P0-7), re-encrypt, scope-test stored keys, document revocation guidance for users. |
| **CI/CD takeover** | `fx-upgrade-monitor.yml` auto-commits to the default branch; deploy workflows hold Fly/Cloudflare/DB secrets. A malicious PR modifying workflows + `--no-frozen-lockfile` installs widen supply-chain surface. | 🟡 | `permissions:` blocks per workflow (least privilege), frozen lockfile, pin third-party actions by SHA, require review for workflow changes, move monitor commits to a PR instead of direct push. |

---

## On-chain execution risks (cross-cutting)

| Risk | Current state | Required handling |
|---|---|---|
| **MEV / sandwich** | `mevProtection` column exists ("off" default); no Flashbots Protect/MEV-Share integration despite `features.enableFlashbots = true`. Leveraged opens on wstETH/WBTC are sandwichable. | Route through Flashbots Protect RPC when enabled; sensible slippage defaults (`slippageBps` exists — enforce it in calldata, not just UI). |
| **Reorg divergence** | Tx status flips to `confirmed` on a single webhook event; no confirmation depth, no `reorged/replaced/dropped` states. | Explicit state machine: `pending → mined(n confs) → confirmed(k confs)`, watch for replacement (same nonce), reconcile via `eth_getTransactionReceipt` on a schedule, not only webhooks. |
| **Gas/fee correctness** | No `feeHistory`-based EIP-1559 estimation; fabricated gas numbers in simulation. | maxFeePerGas/maxPriorityFeePerGas from `feeHistory` percentiles with caps; re-estimate on retry; +20% replacement bumps (the commented-out stuck-tx logic, done properly). |
| **Limit-order front-running** | Orders go to a third-party relayer (`fx-limit-order-api.aladdin.club`) whose execution guarantees are undocumented in-repo. | Document relayer trust assumptions in `docs/external-apis.md`; trigger-price slack; user-visible "executable price" disclosure. |
| **Oracle integrity** | Hardcoded $3000 price for all health/liquidation math. | Use f(x)'s own oracle contracts (e.g., `PriceOracle#StETHPriceOracle` in the manifest) for liquidation math parity with the protocol. |

---

## Trust boundaries (summary)

1. **Telegram ⇄ bot server** — currently unauthenticated inbound (🔴). 
2. **Mini App (browser) ⇄ bot API** — CORS configured, but no initData validation, no session binding (🔴).
3. **Bot server ⇄ Privy** — secret now public (🔴 until rotation); no policy guardrails (🔴).
4. **Bot server ⇄ Ethereum RPC** — leaked key, single provider (🔴).
5. **Bot server ⇄ aladdin.club relayer** — no timeout/breaker, trust assumptions undocumented (🔴).
6. **CI ⇄ production** — secrets in GH Actions, deploy gated by repo vars (🟡).

**Priority order for closing boundaries:** rotate credentials (P0-1) → webhook auth (P0-5) → Privy policy before first wallet (P0-8) → simulation + idempotency + state machine (P0-3/P1-5) → relayer hardening.
