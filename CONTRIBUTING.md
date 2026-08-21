# Contributing

FxAeon is funds-adjacent software. Correctness, honest failure states, and reviewable changes matter more than feature count.

## Development setup

Follow [SETUP.md](SETUP.md). The minimum local checks are:

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

## Repository layout

```text
apps/bot/        Telegram bot, API, workers, and execution engine
apps/mini-app/   Telegram Mini App and Playwright tests
packages/db/     Prisma schema and migrations
packages/shared/ Runtime address registry, ABIs, types, and risk constants
docs/            Current documentation and architecture decisions
ops/runbooks/    Operational response procedures
scripts/         Verification and setup utilities
```

## Change rules

For any funds-moving or signer-authority change:

1. Treat every client field, callback, SDK route, RPC response, and relay response as untrusted.
2. Keep calldata construction on the server; never accept client-provided transaction payloads for execution.
3. Route every new protocol action or withdrawal through `executeRoute` and preserve signer-policy, simulation, idempotency, action-cap, fee, and receipt gates. Pending-transaction replacement must stay in the narrow recorded-nonce replacement path and reapply its policy/fee/receipt controls.
4. Verify token identity, units, decimals, recipient, market, side, leverage, and position ownership explicitly.
5. Add the smallest new contract surface possible. Changes to `packages/shared/src/addresses.ts` require provenance and a mainnet bytecode check.
6. Do not silently fall back from a requested private broadcast to public mempool submission.
7. Render unknown or unavailable data as unknown; do not fabricate balances, prices, gas, PnL, yields, or transaction success.
8. Add unit tests for rejection paths and integration/fork tests in proportion to risk.
9. Update the command guide, API guide, capability matrix, security model, and changelog when behavior changes.

## UI and accessibility

- Design for Telegram's narrow mobile webview first, including safe-area insets and keyboard overlap.
- Use semantic controls, visible focus, sufficient contrast, accessible names, and reduced-motion behavior.
- Preserve Telegram WebApp integration (stable viewport, safe areas, haptics, and native BackButton) while keeping the deliberate dark product theme legible outside Telegram.
- Provide explicit loading, empty, stale, partial-data, disabled, success, failure, and retry states.
- Never label a preview, signal, or unavailable button as a completed transaction.
- Update and review Playwright visual snapshots for intentional visual changes.

## Database changes

Create a migration for every Prisma schema change. Do not edit an applied migration. Verify both a fresh database and an upgrade path:

```bash
pnpm --filter @fxaeon/db db:generate
pnpm --filter @fxaeon/db exec prisma migrate deploy
pnpm --filter @fxaeon/db typecheck
```

## Testing

Useful targeted commands:

```bash
pnpm --filter @fxaeon/bot test
pnpm --filter @fxaeon/mini-app test
pnpm --filter @fxaeon/mini-app test:e2e
pnpm --filter @fxaeon/bot test:fork
node scripts/gen-signer-policy.mjs --check
node scripts/verify-addresses.mjs
```

The address verifier needs `ALCHEMY_RPC_URL` or `ETH_RPC_URL`. Fork tests need Anvil and an upstream mainnet RPC. A skipped fork suite is not evidence that live protocol integration works.

## Commits and pull requests

Use Conventional Commits, for example:

```text
feat: add existing-position increase flow
fix: bind withdrawal token units to the signed intent
docs: update the SDK capability matrix
security: reject unscoped limit-order makers
```

Keep changes focused. A pull request should state:

- user-visible behavior and capability status;
- security and custody implications;
- migrations, environment, or deployment changes;
- tests run and tests not run;
- screenshots for Mini App changes;
- rollback or kill-switch behavior for high-risk changes.

Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public pull request.
