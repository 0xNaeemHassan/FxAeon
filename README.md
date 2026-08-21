# FxAeon

[![CI](https://github.com/0xNaeemHassan/FxAeon/actions/workflows/ci.yml/badge.svg)](https://github.com/0xNaeemHassan/FxAeon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15.5-black)](https://nextjs.org/)
[![Telegram Mini App](https://img.shields.io/badge/Telegram-Mini%20App-2AABEE?logo=telegram)](https://core.telegram.org/bots/webapps)

FxAeon is a next-generation mobile-first gateway to [f(x) Protocol](https://fx.aladdin.club/) on Ethereum and Base. It combines a high-performance Telegram bot, a cyber-themed Next.js Telegram Mini App, self-custodial Privy embedded wallets, and `@aladdindao/fx-sdk` 1.0.5 with zero external subscription costs.

The core safety rule is simple: **a preview is not a transaction**. For a Mini App action, the server builds and simulates the exact transaction plan, freezes it in a wallet-bound review ticket for two minutes, and executes only that plan after confirmation. Chat actions are reconstructed from their signed server intent at confirmation. Both paths are restricted to protocol-native f(x) routes, checked against exact target/selector/argument/value semantics, simulated as a complete route, and only then broadcast through a session-signer permission the user can revoke.

---

## ⚡ Next-Gen Terminal Features (100% Zero-Cost Architecture)

- **📊 High-FPS Interactive Charting**: Real-time canvas candlestick and area chart with live public WebSocket streams, timeframe switchers (`1m`, `5m`, `15m`, `1h`, `1d`), liquidation overlays, and TP/SL target lines.
- **🎯 Take-Profit / Stop-Loss & PnL Simulator**: Dynamic target price calculators, dollar outcome estimators, and live Risk:Reward ($R:R$) ratio badges.
- **🎙️ Speech-to-Trade Copilot**: Offline browser Web Speech recognition + regex intent parser. Speak *"Long ETH 3x 500"* to automatically configure trades.
- **💬 Telegram Inline Query Mode**: Type `@FxAeonBot long eth 3x` in **any** Telegram chat or group to instantly share interactive trading preview cards with direct Mini App launchers.
- **🏆 Community PnL Leaderboard**: Real-time leaderboard tracking top weekly and all-time traders, realized returns, and achievement badges (*Whale*, *Sniper*, *Legend*).
- **📲 Telegram Story & Social Share**: Export high-resolution trade badges with 1 tap directly to Telegram Stories via `Telegram.WebApp.shareToStory`.
- **🔐 Native Biometrics Security**: FaceID / TouchID biometric confirmation before transaction broadcast using `Telegram.WebApp.BiometricManager`.
- **🔊 Procedural Web Audio FX**: Zero-asset procedural sound engine for instant tactile feedback (`tap`, `confirm`, `success`, `error`).
- **🎨 Cyber Theme Studio**: 4 OLED color palettes (*Deep Space Violet*, *Matrix Terminal*, *Neon Velocity*, *Monochrome Titanium*) with instant client-side CSS switching.
- **🔄 Instant Position Reversal**: Atomic 1-tap flip modal to reverse from Long to Short (or vice-versa).
- **🌉 Cross-Chain Bridge Tracker**: Step-by-step visual tracker for LayerZero V2 transfers between Ethereum and Base.

---

## Product surfaces

| Surface | What it does today |
|---|---|
| Mini App | Live interactive charts, speech copilot, TP/SL simulator, PnL leaderboard, theme studio, wallet onboarding; portfolio summary; SDK 1.0.5 position, borrowing, and fxSAVE actions; receive QR; bridge review; settings and signer controls |
| Telegram Inline Mode | Type `@FxAeonBot <query>` in any chat to share live market cards and pre-configured trade launch buttons |
| Telegram trading | Open, close, partially reduce, and adjust leverage for wstETH and WBTC long/short positions |
| Borrowing | Deposit collateral and mint fxUSD; repay fxUSD debt and withdraw collateral |
| fxSAVE | Read balances/config; deposit fxUSD, USDC, or Base Pool tokens; request queued or instant fxUSD/USDC withdrawal, redeem directly to `fxUSDBasePool`, and claim a matured queued redemption |
| Wallet operations | Show the Ethereum deposit address and send explicit ETH/ERC-20 withdrawals to a validated destination |
| Monitoring & Alerts | Automated risk poller, liquidation warnings, price alerts, deposit detection, and transaction history |
| Automation | Off-chain stop-loss and take-profit rules that execute the standard full-close path |
| Transaction control | Speed up or cancel the latest replaceable pending transaction |
| Bridge | SDK-native fxUSD/fxSAVE LayerZero code paths between Ethereum and Base with visual step tracking |

---

## Transaction lifecycle

Every protocol action and wallet withdrawal follows the central execution path:

1. Validate the Telegram callback, signed intent, or authenticated Mini App request.
2. Resolve the user and confirm that the Privy session-signer grant is active.
3. Build the route from current server-side state; never accept client calldata. A Mini App quote freezes the exact wallet, action, chain, targets, calldata, and values in a two-minute server ticket.
4. Claim the ticket/intent and create or recover its per-user idempotent transaction record. Replays converge on that record instead of creating a second broadcast.
5. Apply the default-deny signer policy to the exact SDK-emitted targets, selectors, pools/tokens, amounts, receivers, approvals, nested converter/callback payloads, and native value.
6. Simulate the ordered route on its source chain with `eth_simulateV1`; unavailable or failed simulation stops execution.
7. Enforce the user's UTC-day logical-action cap, failing closed if its persisted check is unavailable.
8. Derive EIP-1559 fees on the server and broadcast transactions sequentially on the stamped source chain.
9. Watch every route step and persist its hash and receipt-derived status.

---

## Repository Structure

```text
apps/bot/        grammY bot, Express API, workers, risk watcher, inline queries, execution policy
apps/mini-app/   Next.js 15 Telegram Mini App (charting, audio, copilot, themes, leaderboard)
packages/db/     Prisma schema, migrations, and database client
packages/shared/ Address registry, ABI fragments, risk constants, shared types
docs/            Product, API, security, deployment, and operations guides
ops/runbooks/    Incident-response runbooks
scripts/         Verification and operator utilities
```

---

## Verify Locally

Requirements: Node.js 22, Corepack, pnpm 11.16, and PostgreSQL.

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
pnpm --filter @fxaeon/db db:generate
pnpm typecheck
pnpm test
pnpm --filter @fxaeon/mini-app build
```

---

## Documentation

- [Documentation map](docs/README.md)
- [Setup Guide](SETUP.md)
- [User Guide](docs/user-guide.md)
- [Mini App Guide](docs/mini-app.md)
- [Telegram Commands](docs/telegram-commands.md)
- [SDK Capability Matrix](docs/sdk-capabilities.md)
- [Architecture](docs/architecture.md)
- [HTTP API](docs/api.md)
- [Security Model](docs/security.md)
- [Deployment](docs/DEPLOYMENT.md)

---

## License

[MIT](LICENSE)
