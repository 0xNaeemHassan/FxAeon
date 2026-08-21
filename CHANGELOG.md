# Changelog

Notable changes are recorded here using [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) categories. The package version is defined in the root `package.json`.

## [Unreleased]

### Added

- Unified Mini App SDK gateway for position open/increase/reduce/close/leverage, borrowing, fxSAVE, gas-tier selection, delegated execution, all-step transaction journals, and wallet-scoped activity.
- Two-minute, wallet-bound `ActionQuoteTicket` reviews that freeze the exact server-built and simulated Mini App plan; the ticket ID is also the durable executor idempotency key.
- Operator-gated, chain-aware fxUSD/fxSAVE LayerZero bridge routes in both Ethereum→Base and Base→Ethereum directions.
- Telegram-authenticated, wallet-bound limit-order HTTP primitives and source-chain health reporting for both Ethereum and Base.
- Telegram position reduction, full close, and leverage-adjustment execution through the common policy/simulation engine.
- Ethereum wallet withdrawals bound to a server-side destination intent.
- fxSAVE deposit, queued/instant fxUSD or USDC withdrawal, direct ERC-4626 redemption to `fxUSDBasePool`, and matured queued-redemption claim flows.
- Off-chain stop-loss/take-profit execution, price alerts, deposit detection, and fxUSD arbitrage notifications.
- A source-reconciled product, command, SDK-capability, API, security, deployment, operations, and troubleshooting documentation set with explicit unsupported states.

### Changed

- Telegram trading shortcuts now use strict market-native units: wstETH for the wstETH market and WBTC for the WBTC market; the Mini App exposes the wider SDK token matrix explicitly.
- Correct short-position reduction units now distinguish WBTC raw debt from wstETH debt converted through the current stETH-per-token rate.
- The Mini App received a mobile-first visual and interaction redesign with explicit loading, degraded, empty, and transaction states.
- MEV settings now map consistently to Flashbots private broadcast behavior.
- The signer policy now grants authority only to the exact SDK-emitted signing targets rather than the full address registry; it pins every live selector, validates pool/token/position/receiver/amount/native-value relationships, correlates exact ERC-20/ERC-721 approvals, and keeps self-send cancellation and wallet withdrawal as narrow authenticated exceptions.
- Delegated position execution now accepts only protocol-native `FxRoute` v1 quotes whose encoding and packed words exactly match the pinned SDK 1.0.5 table. `FxRoute 2`, remote Odos/Velora payloads, and altered table words are refused, while nested MultiPathConverter and flash-loan callback calldata is decoded and bound to its declared token and amount.
- Dependency and workspace configuration were refreshed; the unused vulnerable Alchemy SDK dependency was removed.
- Limit-order chat copy now states that `/limit` validates a preview and does not submit an order.
- Deposit watching is started with the other in-process workers and reads Ethereum from `ALCHEMY_RPC_URL`; operational docs no longer claim a nonexistent Redis queue, global circuit breaker, or self-hosted TLS setup.

### Fixed

- Collateral decimal/unit confusion, malformed command parsing, stale/dead callbacks, duplicate aliases, misleading fee claims, and fabricated preview values.
- Fee-retry persistence, per-user transaction idempotency, durable `partial`/`cancelled` terminal states, Windows Playwright startup, Docker static serving, and Telegram launch-context handling.
- Mini App settings values, locale parity, signer-state synchronization, and wallet onboarding fallbacks.
- Supported wallet-token portfolio aggregation now includes every registry balance, values fxSAVE once through redeemable assets, and withholds the total when any positive component cannot be priced, including fxUSD.
- Direct `/webhook` proxy routing, bot port wiring, Base RPC health visibility, and production bridge configuration checks.

### Security

- Production dependency audit reduced to zero known production vulnerabilities at the time of this update.
- Mini App execution now consumes the exact server-frozen review plan rather than trusting browser calldata or silently re-quoting after review; execution re-applies policy and simulation, enforces intent-scoped bridge fields, and records replacement data for pending transaction control.
- The central executor now enforces the per-user UTC-day logical-action cap with a persisted broadcast check and Redis/in-memory live counter; it fails closed when the database check is unavailable.
- Documentation now distinguishes externally unaudited application code from internal review and protocol-level audits.

## [1.3.0] - 2026-06-20

### Added

- Flashbots Protect broadcast mode controlled by the user MEV setting.
- EIP-1559 speed-up/cancel commands for replaceable pending transactions.
- Etherscan v2 gas oracle with RPC fallback.
- Turkish and Portuguese locales, catalog parity checks, and Mini App logout.

### Changed

- Pinned/least-privilege CI workflows and dependency maintenance.
- Completed the FxAeon package/product rebrand and removed obsolete configuration names.

## [1.2.0] - 2026-06-12

### Changed

- Moved wallet creation/import to Privy's user-facing Mini App flow.
- Replaced server-owned wallet creation with an explicit revocable session-signer grant.
- Added live wallet withdrawal confirmation and lazy-loaded Privy frontend code.
- Added the PostgreSQL 17 backup workflow and fail-fast secret checks.

### Removed

- Server-side wallet creation and stale deployment/documentation artifacts.

## [1.1.0] - 2026-06-09

### Added

- Initial Telegram bot, Next.js Mini App, Prisma workspaces, localization foundation, container/deployment files, CI, health checks, and test suites.

The initial release contained incomplete and placeholder paths that were subsequently removed or replaced. Refer to current documentation rather than this historical entry for capability or security status.

## [1.0.0] - 2026-06-08

### Added

- Initial monorepo structure and basic f(x) integration scaffolding.
