# FxAeon

FxAeon is a mobile-first gateway to [f(x) Protocol](https://fx.aladdin.club/) on Ethereum and Base. It combines a Telegram bot, a Next.js Telegram Mini App, a user-controlled Privy embedded wallet, and `@aladdindao/fx-sdk` 1.0.5.

The core safety rule is simple: **a preview is not a transaction**. For a Mini App action, the server builds and simulates the exact transaction plan, freezes it in a wallet-bound review ticket for two minutes, and executes only that plan after confirmation. Chat actions are reconstructed from their signed server intent at confirmation. Both paths are restricted to protocol-native f(x) routes, checked against exact target/selector/argument/value semantics, simulated as a complete route, and only then broadcast through a session-signer permission the user can revoke.

> FxAeon and this repository have not received an independent application security audit. Leveraged positions, smart contracts, bridges, private relays, RPC providers, and embedded-wallet infrastructure all carry risk. Do not use funds you cannot afford to lose.

## Product surfaces

| Surface | What it does today |
|---|---|
| Mini App | Wallet onboarding; supported-asset portfolio summary and wallet-scoped activity; all SDK 1.0.5 position, borrowing, and fxSAVE actions; receive QR; bidirectional bridge review; settings and signer controls |
| Telegram trading | Open, close, partially reduce, and adjust leverage for wstETH and WBTC long/short positions |
| Borrowing | Deposit collateral and mint fxUSD; repay fxUSD debt and withdraw collateral |
| fxSAVE | Read balances/config; deposit fxUSD, USDC, or Base Pool tokens; request queued or instant fxUSD/USDC withdrawal, redeem directly to `fxUSDBasePool`, and claim a matured queued redemption |
| Wallet operations | Show the Ethereum deposit address and send explicit ETH/ERC-20 withdrawals to a validated destination |
| Monitoring | Market and gas data, position-health warnings, deposit detection, price alerts, and transaction history |
| Automation | Off-chain stop-loss and take-profit rules that execute the standard full-close path |
| Transaction control | Speed up or cancel the latest replaceable pending transaction |
| Bridge | SDK-native fxUSD/fxSAVE LayerZero code paths between Ethereum and Base; execution is disabled by default and remains a release-gated capability, not production-readiness evidence |
| Limit orders | Prepare/relay/status/cancel HTTP primitives exist; `/limit` is preview-only because no signing UI is exposed |
| Governance | FXN locking, gauge voting, and reward claiming are not implemented |

The detailed, method-by-method status is in the [SDK capability matrix](docs/sdk-capabilities.md). It explicitly distinguishes SDK support, application support, operator-gated behavior, and unsupported behavior.

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
9. Watch every route step and persist its hash and receipt-derived status. The durable record distinguishes `broadcast` (outcome still unknown), `confirmed`, `reverted`, `partial`, `cancelled`, and pre-broadcast `failed` outcomes.

Position routes are requested only through the protocol-native SDK target and must return `FxRoute` v1. `FxRoute 2`, remote Odos/Velora payloads, unlisted token pairs, and any encoding or packed route word that differs from the exact SDK 1.0.5 table are rejected. MultiPathConverter is allowed only as a decoded nested protocol target, never as a direct session-signer destination.

Ethereum speed-up/cancel is a separate replacement path: after record-owner and wallet checks, speed-up replays only the recorded pending call, while cancel may replace it only with a zero-value, empty-calldata self-send. The policy is reapplied with this narrow replacement scope, fees are bumped server-side, and the replacement receipt is watched. The path does not re-run the original route simulation or consume the normal logical-action cap.

See [Architecture](docs/architecture.md) and [Security model](docs/security.md) for trust boundaries and exceptions.

## Repository

```text
apps/bot/        grammY bot, Express API, workers, f(x) routes, execution policy
apps/mini-app/   Next.js 15 static Telegram Mini App
packages/db/     Prisma schema, migrations, and database client
packages/shared/ Address registry, ABI fragments, risk constants, shared types
docs/            Product, API, security, deployment, and operations guides
ops/runbooks/    Incident-response runbooks
scripts/         Verification and operator utilities
```

## Verify locally

Requirements: Node.js 22, Corepack, pnpm 11.16, and PostgreSQL. An Ethereum mainnet RPC is required for protocol reads and transactions. A Base RPC is additionally required for Base-source bridge quotes/execution. Redis is optional and provides shared HTTP rate limits plus the cross-process live counter for `DAILY_TX_CAP`; PostgreSQL supplies the durable broadcast-count check and a single process falls back to memory. The cap limits logical executor actions, not transaction value, and does not make the in-process workers safe to run in multiple replicas.

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
pnpm --filter @fxaeon/db db:generate
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

The bot loads `.env.local`, `.env.production`, and `.env` relative to its process working directory without overriding variables already supplied by the shell or process manager. Docker Compose separately reads the root `.env`. Follow [SETUP.md](SETUP.md) before starting either service.

## Documentation

- [Documentation map](docs/README.md)
- [Setup](SETUP.md)
- [User guide](docs/user-guide.md)
- [Mini App guide](docs/mini-app.md)
- [Telegram commands](docs/telegram-commands.md)
- [SDK capability matrix](docs/sdk-capabilities.md)
- [Architecture](docs/architecture.md)
- [HTTP API](docs/api.md)
- [Security model](docs/security.md)
- [Threat model](docs/threat-model.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Operations and troubleshooting](docs/operations.md)
- [Incident runbooks](ops/runbooks/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
