# FxAeon System Architecture

## Overview

FxAeon is a non-custodial Telegram interface for [f(x) Protocol](https://fx.aladdin.club/) DeFi trading on Ethereum mainnet. The system is built around **zero key custody** — users create or import their own [Privy](https://privy.io) embedded wallet, whose private key never leaves Privy's TEE (Trusted Execution Environment). The bot can only sign while the user's **revocable session-signer grant** is active.

## Architecture Layers

### 1. Telegram Layer
- **Bot**: [@FxAeonBot](https://t.me/FxAeonBot) built with grammY + TypeScript
- **Inline Mode**: price queries (`@FxAeonBot wsteth`) in any chat
- **Mini App**: Next.js 15 webview (static export) for wallet setup, portfolio, and trade confirmation
- **Rate Limiting**: grammY `transformer-throttler` (30 msg/s global, 1 msg/s per user)

### 2. Mini App Layer (Next.js 15 + Privy React SDK, static export)

| Route | Purpose |
|---|---|
| `/login` | Telegram auth → create or import the user's own Privy embedded wallet (`createWallet` / `importWallet`), with an optional revocable bot-trading session-signer grant |
| `/trade` | Build a trade and confirm it back in Telegram via a signed deep link (the Mini App itself never broadcasts — see the kill-switch note below) |
| `/portfolio` | On-chain positions, balances, and health status |
| `/qr` | Deposit address as a QR code |
| `/settings` | Language, slippage, MEV (Flashbots) toggle, notifications, session-signer revoke |
| `/policy` | Self-custody + session-signer security explainer |

> **Kill-switch:** the Mini App is intentionally read/build-only and never calls `eth_sendTransaction`. All broadcasts happen server-side in the bot, behind the simulation gate and signer policy (see §5 and the security model).

### 3. Backend Layer (Node 22, Docker on Render)
- **Webhook Handler**: processes Telegram updates (Express + grammY)
- **Command Router**: ~29 commands with validation
- **Privy Server SDK**: signs via the user's revocable session-signer grant — the server never creates or owns user wallets
- **fx-sdk Wrapper**: `@aladdindao/fx-sdk` for protocol quotes and calldata
- **viem**: `eth_simulateV1` pre-flight simulation (fail-closed), EIP-712 limit-order signing, EIP-1559 fee derivation
- **Automation & pollers (BullMQ + Redis / node-cron)**: limit-order fill polling, price alerts, health monitoring, automation rules, and the daily SLO digest
- **Signer Policy**: a fail-closed allow-list (`core/signerPolicy.ts`) — every broadcast target must be a verified `ADDRESSES` contract
- **At-rest Encryption**: per-record random salt, versioned ciphertext, no fallback key (BYOK guard)
- **Notification Service**: one preference-aware `notify()` gate (tx confirmations, order fills, health alerts)
- **Rate Limiter**: Redis-backed when `REDIS_URL` is set, in-memory fallback otherwise

### 4. Data Layer
- **Postgres (Supabase)**: users, positions, limit orders, automation rules, audit logs, referrals
- **Redis (Upstash)**: BullMQ job queues, distributed locks (`SETNX`), caches
- **Cloudflare R2**: nightly `pg_dump` backups (GitHub Actions)

### 5. Blockchain Layer (Ethereum Mainnet)
- **RPC**: Alchemy (free tier) — `ALCHEMY_RPC_URL`
- **Flashbots Protect**: user-toggleable MEV protection (`/settings`)
- **Simulation gate**: every broadcast is simulated with `eth_simulateV1` and fails closed if the simulation reverts
- **Addresses**: the single verified registry lives in `packages/shared/src/addresses.ts`; CI (`verify-addresses.mjs`) asserts every entry has live bytecode on mainnet. Key contracts: f(x) Router, long/short pool managers, the four pools (wstETH/WBTC × long/short), `LimitOrderManager`, `fxUSD`, `FXN`, `fxSAVE`, the spot-price oracle, and the LayerZero OFT adapters used by `/bridge`.
- **f(x) Keepers**: protocol-run; fill limit orders when triggers are met

### 6. External APIs

See **[external-apis.md](./external-apis.md)** for the authoritative table (timeouts, retries, circuit breakers). In summary:

- **DefiLlama / CoinGecko**: market prices and pool data (cached)
- **fx limit-order relay** (`fx-limit-order-api.aladdin.club`): `POST /v1/order`, incremental `GET /v1/order-updates?after=` (30s poll)
- **Etherscan v2**: `/gas` command gas oracle + ETH/BTC price (optional `ETHERSCAN_API_KEY`)

### 7. Monitoring & CI/CD
- **Sentry**: errors-only with `beforeSend` scrubbing (optional `SENTRY_DSN`)
- **`/api/v1/health`**: real DB/Redis/RPC/worker checks (the path Render polls)
- **Daily SLO digest** → admin Telegram chat (`ADMIN_TELEGRAM_CHAT_ID`)
- **GitHub Actions**: CI (typecheck, tests, address verification, gitleaks), Lighthouse budget for the Mini App, nightly backup, weekly f(x) upgrade monitor (opens a PR, never pushes `main`)

## Security Model

```
User (Telegram) — creates/imports their OWN wallet in the Mini App
    ↓
Privy TEE (SOC 2 Type II) — user-owned keys, exportable by the user only
    ↓
Session signer (key quorum) — the bot may sign ONLY while the user's
revocable grant is active (walletDelegated); revoke in Settings → Wallet
    ↓
Signer policy (default-deny) — broadcast targets must be verified ADDRESSES
    ↓
Simulation gate — every broadcast is simulated (eth_simulateV1) first; fail-closed
```

## Data Flow: Opening a Leveraged Position

1. User sends `/trade wstETH long 3x 1ETH` (or uses the inline ladder).
2. Bot validates the market and leverage bounds (1.1× to the asset cap).
3. Bot builds an HMAC-signed, short-TTL trade intent and shows a Confirm/Cancel inline keyboard.
4. On Confirm, the bot fetches a real fx-sdk quote → simulates the route (`eth_simulateV1`).
5. If the simulation passes, the signer policy checks every target, then the bot signs via the user's Privy session signer and broadcasts (EIP-1559 fees from `eth_feeHistory`).
6. The W-11 receipt watcher polls for the receipt and drives the tx state machine (`pending → submitted → confirmed/failed`); status edits land on the same Telegram message.
7. On a confirmed receipt, the AuditLog row is written and the notification is sent.

> The bot broadcasts every transaction itself and reconciles by receipt — it does **not** rely on Privy transaction webhooks (an enterprise-only feature that was removed).

## Data Flow: Limit Order

1. User sends `/limit open wstETH long at 2800`.
2. Bot builds an EIP-712 `Order` struct; domain and types are pinned against the deployed `LimitOrderManager`.
3. User signs `signTypedData` via Privy in the Mini App.
4. Signature + order data are POSTed to the f(x) limit-order relay.
5. The poller reads `GET /v1/order-updates?after=` every 30s; when an f(x) keeper fills the order, the user gets a Telegram notification.

## Cost Breakdown (500 MAU)

| Service | Provider | Plan | Monthly Cost |
|---|---|---|---|
| Backend | Render | Starter (Docker web service) | ~$7 |
| Database | Supabase | Free (500 MB) | $0 |
| Cache/Queue | Upstash | Free | $0 |
| RPC | Alchemy | Free (30M CU) | $0 |
| Storage | Cloudflare R2 | Free (10 GB) | $0 |
| Wallets | Privy | Free (≤499 MAU) | $0 |
| Error tracking | Sentry | Free | $0 |
| Domain | Cloudflare Registrar | ~$9/yr | ~$1 |
| **TOTAL** | | | **~$8/mo** |

## Key Design Decisions

1. **No 4337/7702**: plain EOA via Privy is cheaper and simpler than smart-account infra.
2. **No custom keeper**: f(x) keepers fill limit orders — no centralization, no extra infra.
3. **No subgraph indexing**: fx-sdk + on-chain reads cover all read paths.
4. **No third-party simulation service**: viem `eth_simulateV1` is free on Alchemy.
5. **No fiat on-ramps**: users fund their own wallets — zero compliance surface.
6. **Self-custody by default**: the server never holds keys; bot trading is an explicit, revocable grant.
