# External services

FxAeon is an orchestrator across several providers. A healthy process does not imply every dependency is healthy, and no provider response should be treated as trusted transaction intent.

| Service | Used for | Credentials/config | Current failure behavior |
|---|---|---|---|
| Telegram Bot API | Updates, commands, messages, Mini App launch | `TELEGRAM_BOT_TOKEN`, webhook secret, public origin | Webhook retries; API output throttled; bot unavailable if Telegram fails |
| Telegram WebApp script | Browser Mini App bridge | Loaded from `telegram.org` | App shows non-Telegram/degraded behavior when unavailable |
| Privy | Telegram auth, embedded wallet lifecycle, delegated signing | App ID/secret, authorization key, public signer ID | Onboarding/signing fails; no local-key fallback |
| Ethereum RPC | f(x) reads/routes, simulation, fees, nonce, receipt, logs | `ALCHEMY_RPC_URL` | Funds-moving paths fail closed; reads show unavailable/partial |
| Base RPC | Base-source bridge quote, simulation, fees, nonce, receipts, and health | `BASE_RPC_URL` | Base→Ethereum quote/execution unavailable; bridge execution gate cannot validate without it |
| f(x) SDK 1.0.5 | Protocol route construction and state methods | Installed package + RPC | No route/action; never substitute fabricated calldata |
| f(x) contracts | Positions, mint/repay, fxSAVE, orders, bridge OFTs | Runtime registry + SDK-pinned Base OFTs | On-chain revert/upgrade risk; source receipt is authoritative only for its chain |
| LayerZero V2 | fxUSD/fxSAVE OFT message delivery between Ethereum and Base | Native source-chain fee from SDK quote | Source transaction can confirm before delayed/failed destination delivery |
| CoinGecko | Spot/market data for display, PnL, alerts, automation | Optional `COINGECKO_API_KEY` | 45 s cache; on failure serve marked stale data up to 10 min; automation skips stale |
| Etherscan v2 | `/gas` oracle and ETH price | `ETHERSCAN_API_KEY` | 12 s cache, marked stale up to 5 min; `/gas` can use RPC fallback |
| Flashbots Protect | Private raw transaction submission | User MEV setting | Private submission failure surfaces; no silent public downgrade |
| f(x) limit-order relay | Signed order submission and incremental status updates | No API key in current client | 10 s request timeout, up to 3 attempts for transport/5xx; 4xx fails immediately |
| QR Server | Telegram `/deposit` QR image URL | None | QR button/image may fail; address remains available as text |
| PostgreSQL | Account linkage and application state | `DATABASE_URL` | Readiness 503; production actions generally unavailable |
| Redis | Shared HTTP rate-limit decisions and live per-user daily-action counter | `REDIS_URL` TCP | 250 ms decision deadline then in-memory fallback; no worker queue; the durable broadcast-count check remains in PostgreSQL |
| Sentry | Optional error telemetry | `SENTRY_DSN` | Disabled when unset/failing; application continues |

## RPC requirements

`ALCHEMY_RPC_URL` must serve Ethereum mainnet (chain 1). `BASE_RPC_URL` must serve Base mainnet (chain 8453) when Base-source bridge quoting/execution is used. Each execution provider must support standard reads, `eth_feeHistory`, receipts/logs, and `eth_simulateV1` as used by viem `simulateCalls`. A provider that lacks ordered-call simulation cannot safely serve that source-chain execution path.

Deep health reports `rpc` for Ethereum and `baseRpc` for Base. It considers a configured RPC degraded when the latest visible block timestamp is more than about 60 seconds behind. Missing Base RPC is `skipped` unless bridge execution is requested, in which case it is unhealthy. The health probe has a three-second budget; transaction operations have their own call behavior.

Do not place RPC URLs with embedded secrets in client-side `NEXT_PUBLIC_*` variables. The Mini App talks to the bot API, not directly to either production RPC.

## CoinGecko cache and automation

One `/coins/markets` request covers displayed and internal spot assets. Concurrent requests share an in-flight promise. Fresh cache lifetime is 45 seconds. If refresh fails, a snapshot no older than ten minutes may be returned with `stale: true`.

Portfolio display may use a fresh snapshot. Stop-loss/take-profit intentionally refuses to fire on stale data. This avoids knowingly trading on old prices but creates availability risk during an upstream outage.

## Etherscan

The client uses v2 endpoints for gas oracle, ETH price, and gas-time estimate with an eight-second timeout and typed validation. Missing/invalid responses are never converted to synthetic values. Etherscan is optional because transaction fee derivation ultimately uses the RPC path.

## Limit-order relay

Before relay submission, FxAeon validates order deltas, verifies that the signature recovers to `maker`, and compares the local typed-data hash with the deployed contract. The relay remains an external availability and censorship dependency. Polling uses `/v1/order-updates` every 30 seconds for locally recorded open orders.

No supported end-user signing UI currently reaches this path. Every HTTP primitive requires fresh Telegram Mini App authentication and an onboarded user; prepare, submit, and single-order cancellation bind the maker to that user's database wallet. This prevents anonymous relay/RPC proxy use, but the routes remain internal application primitives rather than a stable public API.

## Flashbots

MEV-enabled broadcasts are signed through Privy and submitted as raw EIP-1559 transactions to the built-in Flashbots Protect endpoint in `apps/bot/src/fx/index.ts`. It is not currently an environment-configurable URL. Standard reads and receipt checks continue through the normal Ethereum RPC.

Private submission can be delayed, censored, leaked, or rejected and cannot guarantee protection or inclusion. FxAeon fails the action if it cannot obtain the explicit nonce needed for private signing.

## Privy

The browser handles embedded wallet creation/import/export. The backend uses the server SDK to resolve the Telegram-linked user and request signatures from delegated wallets. There is no supported mode that exports or stores user private keys on the FxAeon server.

Treat `PRIVY_APP_SECRET` and especially `PRIVY_AUTHORIZATION_KEY` as high-impact credentials. Rotate immediately after suspected exposure and instruct users to revoke bot trading.

## Operational principle

For every dependency, distinguish:

- **unavailable**: show a retry/degraded state;
- **stale**: label age and never use for automation when prohibited;
- **unknown**: do not replace with zero or fabricated success;
- **partial**: preserve successful on-chain effects and reconcile before retry;
- **untrusted**: validate identity, shape, units, addresses, and economic intent before signing.
