# fxBot System Architecture

## Overview

fxBot is a non-custodial Telegram interface for f(x) Protocol DeFi trading. The system is designed around the principle of **zero key custody** — user private keys never leave Privy's TEE (Trusted Execution Environment).

## Architecture Layers

### 1. Telegram Layer
- **Bot**: `@fxAladdinBot` built with grammY + TypeScript
- **Inline Mode**: Price queries (`@fxAladdinBot wsteth`) in any chat
- **Mini App**: Next.js 15 webview for complex interactions (signing, settings, portfolio)
- **Rate Limiting**: 30 msg/s global, 1 msg/s per user via transformer-throttler

### 2. Mini App Layer (Next.js 15 + Privy React SDK)
| Page | Purpose |
|---|---|
| `/login` | Telegram auth → Privy wallet provisioning |
| `/trade` | Simulate trade → sign → submit via Privy |
| `/limit` | EIP-712 typed data signing for limit orders |
| `/portfolio` | View positions, balances, health status |
| `/settings` | Language, slippage, MEV toggle, notifications, BYOK |
| `/auto` | Create/pause/delete automation rules |
| `/qr` | Show deposit address as QR code |
| `/import` | Import existing wallet via Privy `importWallet` |
| `/policy` | Read and sign Privy Policy Engine authorization |

### 3. Backend Layer (Node 22 on Fly.io Free Tier)
- **Webhook Handler**: Processes Telegram updates
- **Command Router**: 20 commands with validation
- **Privy Server SDK**: Key management, transaction signing, policy enforcement
- **fx-sdk Wrapper**: `@aladdindao/fx-sdk@1.0.5` for protocol interactions
- **viem**: EIP-712 signing, `simulateContract` for pre-flight checks
- **Rule Engine**: BullMQ + Redis for scheduled/conditional automation
- **AI Module**: Surplus Intelligence for position explanations and rule suggestions
- **BYOK Encryption**: libsodium `crypto_secretbox` with per-user salt + KMS
- **Notification Service**: Tx confirmations, order fills, health alerts
- **Rate Limiter**: HTTP rate limiting via rate-limiter-flexible

### 4. Data Layer
- **Supabase Postgres**: Users, positions, limit orders, rules, audit logs, referrals
- **Upstash Redis**: BullMQ job queues, distributed locks (SETNX), session cache
- **Cloudflare R2**: Daily `pg_dump` backups with 30-day retention

### 5. Blockchain Layer (Ethereum Mainnet)
- **Alchemy RPC**: Free tier (30M CU/month) — default
- **Flashbots Protect**: User-toggleable, free MEV protection
- **f(x) Router**: `0x33636D49FbefBE798e15e7F356E8DBef543CC708` — all trades route here
- **Pool Managers**: 4 pools (wstETH long/short, WBTC long/short)
- **LimitOrderManager**: `0x112873b395B98287F3A4db266a58e2D01779Ad96` — EIP-712 orders
- **fxSAVE**: `0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39` — yield vault
- **f(x) Keepers**: Protocol-run, fill limit orders when triggers are met

### 6. External APIs
- **DefiLlama**: ETH/BTC prices (30s cache), pool TVL/APY (5min cache)
- **Aave Subgraph**: Borrow APR for fxMINT context (5min cache)
- **fx-limit-order-api**: `POST /v1/order`, `GET /v1/order-updates` (30s poll)
- **Surplus Intelligence**: `https://www.surplusintelligence.ai/api/inference/v1`

### 7. Monitoring & CI/CD
- **UptimeRobot**: 50 monitors (free) — backend, Mini App, RPC, relayer
- **Sentry**: 5k events/month (free) — error tracking
- **PostHog**: 1M events/month (free) — onboarding analytics (hashed IDs)
- **Discord Webhook**: Ops alerts for critical events
- **GitHub Actions**: CI (lint, test, typecheck), deploy (Fly.io + Cloudflare Pages), backup (daily pg_dump → R2), fx upgrade monitor (weekly diff)

## Security Model

```
User (Telegram + email/passkey)
    ↓
Privy TEE (SOC 2 Type II) — keys generated/stored here
    ↓
Policy Engine evaluates EVERY action before signing
    ↓
3 ALLOW rules only:
  1. f(x) Router calls (0x33636D...)
  2. fxSAVE harvest (0x7743e5...)
  3. EIP-712 limit order signing (f(x) Limit Order Manager)
    ↓
Default-deny: everything else REJECTED
```

## Data Flow: Opening a Leveraged Position

1. User sends `/trade wstETH long 3x 1ETH` in Telegram
2. Bot validates: market exists, leverage within bounds (1.1–7x)
3. Bot shows preview with Mini App deep-link
4. User taps "Confirm Trade" → Mini App opens
5. Mini App calls backend `/api/simulate-trade` → viem `simulateContract`
6. If simulation passes, user signs via Privy embedded wallet
7. Privy TEE signs transaction → sends to Alchemy/Flashbots RPC
8. Transaction confirmed on-chain → position NFT minted
9. Privy webhook fires → backend updates Postgres → Telegram notification sent

## Data Flow: Limit Order

1. User sends `/limit open wstETH long at 2800` in Telegram
2. Bot shows preview with Mini App deep-link
3. User taps "Sign & Submit" → Mini App opens
4. Mini App constructs EIP-712 `Order` struct with 14 fields
5. User signs `signTypedData_v4` via Privy
6. Signature + order data POSTed to `fx-limit-order-api.aladdin.club/v1/order`
7. Backend polls `GET /v1/order-updates` every 30s
8. When f(x) keeper fills order → status update → Telegram notification

## Cost Breakdown (500 MAU)

| Service | Provider | Plan | Monthly Cost |
|---|---|---|---|
| Backend | Fly.io | Free (3 shared CPUs, 256MB) | $0 |
| Database | Supabase | Free (500MB) | $0 |
| Cache/Queue | Upstash | Free (10k cmd/day) | $0 |
| RPC | Alchemy | Free (30M CU) | $0 |
| Storage | Cloudflare R2 | Free (10GB) | $0 |
| Analytics | PostHog | Free (1M events) | $0 |
| Wallet | Privy | Free (499 MAU) | $0 |
| AI | Surplus Intelligence | Pay-per-token | ~$20 |
| Domain | Cloudflare Registrar | $9/yr | ~$1 |
| **TOTAL** | | | **~$21/mo** |

## Key Design Decisions

1. **No 4337/7702**: Plain EOA via Privy is ~$70/mo cheaper than ZeroDev Kernel
2. **No custom keeper**: f(x) keepers fill orders — saves ~$300/mo and removes centralization
3. **No subgraph indexing**: fx-sdk + Etherscan API cover all read paths — saves $0–$300/mo
4. **No Tenderly**: viem `simulateContract` (eth_call) is free on Alchemy
5. **No fiat on-ramps**: Users fund their own wallets — zero compliance surface
6. **No geo-blocking**: Non-custodial, non-issuer — no jurisdiction restrictions
