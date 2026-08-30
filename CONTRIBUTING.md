# Contributing

FxAeon is a funds-adjacent static client. Keep the implementation small, auditable, accessible, and limited to the official `fx-sdk-skill` capability set.

## Development workflow

1. Read [`SETUP.md`](SETUP.md) and install the pinned toolchain.
2. Create a focused branch from the current integration branch.
3. Make the smallest change that satisfies the issue, preserving the client-only boundary.
4. Run the relevant checks locally; run `pnpm verify` before opening a pull request.
5. Describe the behavior, security implications, and verification evidence in the pull request.

## Repository layout

```text
apps/mini-app/       Static Telegram Mini App, SDK adapter, wallet runner, tests
brand/               Product marks and brand assets
docs/                Current architecture, scope, security, testing, and roadmap
patches/             Audited patch for the pinned official f(x) SDK package
scripts/              Scope, environment, build, and release verification scripts
```

There is intentionally no application server, bot runtime, database package, Redis client, worker, queue, or protocol-logic shared package.

## Scope and money-path rules

1. Every retained protocol capability must map to the immutable method list in [`fx-scope.lock.json`](fx-scope.lock.json).
2. Keep protocol planning in the official f(x) SDK. FxAeon may validate inputs, display the SDK plan, simulate it, and execute its ordered transactions.
3. The selected Privy wallet is the only signing authority. Do not add raw private-key handling, delegated/session signing, server execution, or hidden automation.
4. Validate chain ID, sender, destination, selector, native value, spender, approval amount, nonce, route order, and receipt status before progressing.
5. Stop after any rejected, reverted, timed-out, or nonce-drifted transaction.
6. Read protocol state from Ethereum/Base and the SDK. Never treat local storage as authoritative for balances, permissions, receipts, or bridge delivery.
7. Render unavailable data as unavailable. Do not fabricate prices, balances, gas estimates, PnL, liquidation values, yields, transaction success, or bridge completion.
8. Do not add DCA, alerts, limit orders, take-profit/stop-loss automation, copy trading, whale tracking, arbitrage, referrals, custom analytics, or background jobs.

## UI and accessibility

- Design for Telegram's narrow mobile WebView first, including safe areas and keyboard overlap.
- Keep semantic controls, visible focus, sufficient contrast, accessible names, reduced-motion behavior, and explicit loading, empty, and error states.
- Require an explicit review action and a visible wallet confirmation for every transaction in a multi-step route.
- Update visual snapshots only for intentional UI changes and review every diff.

## Testing

```bash
pnpm verify:scope
pnpm typecheck
pnpm lint
pnpm test
pnpm test:chaos
pnpm build
pnpm check:bundle
pnpm test:e2e
```

Protocol transaction tests must assert parameter and chain correctness, SDK order, per-step user approval, receipt waiting, stop-on-failure behavior, and a fresh post-confirmation read. Use local fixtures, safe simulations, or an operator-supplied local fork; never use a production wallet merely to prove the client architecture.

## Pull requests

Include:

- the retained official capability or user-facing behavior;
- security and data-boundary implications;
- commands run and their results;
- any public build or deployment configuration changes; and
- screenshots or recordings for material UI changes.

Do not introduce infrastructure unless the client cannot safely perform a required operation and the concrete blocking reason is documented. Keep commits focused and do not include generated build output, credentials, or local environment files.
