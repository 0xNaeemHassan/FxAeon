# Changelog

## [Unreleased]

### Changed

- Reset FxAeon to the official f(x) SDK capability boundary.
- Moved reads, SDK transaction planning, simulation, and explicit signing into
  the static Telegram Mini App.
- Removed the application backend, delegated/session signer, database, Redis,
  workers, queues, price feeds, analytics, and unsupported trading features.
- Pinned `@aladdindao/fx-sdk@1.0.5` with the reviewed upstream short-pool fix
  until that fix is released through npm.
- Standardized releases on a static Cloudflare Pages export with a reproducible
  bundle-size budget and frozen pnpm installs.

### Security

- The selected Privy wallet is the only transaction authority.
- Every SDK-produced transaction is independently reviewed, simulated,
  explicitly approved, receipt-checked, and followed by a fresh chain/SDK read.
- No private key, Privy secret, Telegram bot token, or backend credential is
  accepted by the static build.

## Historical releases

The repository previously contained a Telegram bot, API, delegated execution,
Prisma/PostgreSQL state, Redis limits, workers, and experimental automation.
Those features are intentionally removed from the active product. Git history
preserves their source for forensic reference; they are not supported FxAeon
capabilities.
