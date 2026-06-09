# Contributing to FxAeon

Thank you for your interest in contributing! This document outlines the process for contributing to the FxAeon Telegram DeFi bot.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/0xNaeemHassan/FxAeon.git
cd FxAeon

# One-command setup
./scripts/dev-setup.sh
```

## Project Structure

```
FxAeon/
├── apps/
│   ├── bot/          # Telegram bot (Node.js + Grammy)
│   └── mini-app/     # Next.js Mini App
├── packages/
│   ├── shared/       # Shared types, constants, ABIs
│   └── db/           # Prisma schema and database client
├── docs/             # Documentation
├── scripts/          # Utility scripts
└── ops/              # Runbooks and operations
```

## Making Changes

1. **Create a branch**: `git checkout -b feature/your-feature-name`
2. **Make your changes** with clear, focused commits
3. **Run tests**: `pnpm test`
4. **Run type check**: `pnpm typecheck`
5. **Run lint**: `pnpm lint`
6. **Submit a PR** with a clear description

## Commit Message Format

We follow conventional commits:

```
feat: add new command /trade-limit
fix: resolve gas estimation bug
docs: update deployment guide
chore: update dependencies
test: add integration test for deposits
refactor: simplify middleware chain
security: patch rate limiter
```

## Code Standards

- TypeScript strict mode enabled
- All functions must have return types
- Error handling required for all async operations
- No `any` types without justification
- 100% test coverage for critical paths (trades, deposits, withdrawals)

## Testing

```bash
# Run all tests
pnpm test

# Run specific test suite
pnpm test -- apps/bot/tests/commands.test.ts

# Run with coverage
pnpm test -- --coverage
```

## Pull Request Process

1. Ensure all tests pass
2. Update documentation if needed
3. Add a changelog entry
4. Request review from a maintainer
5. Address feedback promptly

## Questions?

Open a discussion on GitHub or reach out via Telegram: [@FxAeonBot](https://t.me/FxAeonBot)
