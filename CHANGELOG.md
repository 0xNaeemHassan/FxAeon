# Changelog

All notable changes to FxAeon will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-06-12

### Changed
- **User-owned wallets (#66):** wallets are now created or imported by the user
  in the Mini App via Privy — the server never creates or owns keys. Bot
  trading is an explicit, revocable session-signer grant (Settings → Wallet).
  Live `/withdraw` with CSPRNG confirmation codes. 6 locales.
- Session-signer key quorum registered; bot-trading toggle live (#67).
- Privy SDK lazy-loaded in the Mini App — first-load JS back to ~113 kB,
  Lighthouse TTI inside the 4s budget (#68).
- Nightly backup workflow: pg_dump 17 (matches the Postgres 17 server) and
  fail-fast secret guard.

### Removed
- Server-side wallet creation and the Privy policy engine.
- Stale fxBot-era docs (Fly.io/Supabase deployment guides, Grafana monitoring
  doc, mock health dashboard), duplicate scripts, and the orphaned `bun.lock`.

## [1.1.0] - 2026-06-09

### Added
- Telegram bot with 30+ DeFi commands for f(x) Protocol
- Next.js Mini App with Privy wallet integration
- Multi-language support (EN, ES, JA, KO, ZH, RU, AR, DE)
- Docker Compose deployment configuration
- GitHub Actions CI/CD pipelines
- Health checks and smoke tests
- Security middleware and rate limiting
- Comprehensive test suite (unit, integration, e2e, edge cases)
- Documentation: architecture, deployment, threat model
- Runbooks for incident response
- Monitoring dashboard configuration
- Database migration verification scripts
- Cloudflare Pages deployment script

### Security
- MPC wallet infrastructure via Privy
- Encryption for sensitive data
- Rate limiting on all endpoints
- Input validation and sanitization
- CORS protection

## [1.0.0] - 2026-06-08

### Added
- Initial project structure
- Core bot framework with Grammy
- Basic f(x) Protocol integration
- Database schema with Prisma
