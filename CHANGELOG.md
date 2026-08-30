# Changelog

All notable changes to FxAeon are documented here. The project currently maintains an unreleased integration line; versioned release notes will be added when a public release is cut.

## [Unreleased]

### Added

- Deterministic route and wallet-runner chaos campaigns.
- Opt-in Anvil fork coverage for randomized snapshot/revert and ordered-route execution.
- Recovery handling for pending transaction and bridge records after a reload.
- Production configuration and bundle-budget checks for the static release artifact.

### Changed

- Standardized the product on the official f(x) SDK capability boundary.
- Moved reads, SDK transaction planning, simulation, and explicit signing into the static Telegram Mini App.
- Reworked transaction review, wallet connection, bridge progress, unavailable states, and mobile accessibility.
- Standardized releases on a reproducible Cloudflare Pages static export with frozen pnpm installs.
- Pinned `@aladdindao/fx-sdk@1.0.5` with the reviewed upstream short-pool fix until that fix is released through npm.

### Removed

- The application backend, delegated/session signer, database, Redis, workers, queues, price feeds, analytics, and unsupported trading features.
- Lighthouse CI and other checks that did not reflect the static client release boundary.

### Security

- Privy remains the only transaction authority; no private key is accepted or stored.
- Every SDK-produced transaction is independently reviewed, simulated, explicitly approved, receipt-checked, and followed by a fresh chain/SDK read.
- Rejection, revert, timeout, and nonce drift stop a route before later steps are submitted.
- No Privy secret, Telegram bot token, provider credential, or other signing authority is accepted by the static build.

## Historical architecture

Earlier commits contained experimental bot, API, delegated execution, persistence, and automation designs. They are retained in Git history for provenance only and are not supported FxAeon capabilities.
