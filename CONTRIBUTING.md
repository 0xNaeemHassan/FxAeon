# Contributing

FxAeon is a funds-adjacent static client. Keep the implementation small,
auditable, and limited to the official `fx-sdk-skill` capability set.

## Development setup

Follow [SETUP.md](SETUP.md), then run:

```bash
pnpm install --frozen-lockfile
pnpm verify
```

## Repository layout

```text
apps/mini-app/       Static Telegram Mini App, SDK adapter, wallet runner, tests
brand/               Product marks and brand assets
docs/                Current architecture, scope, security, and test docs
patches/             Audited patch for the pinned official f(x) SDK package
scripts/             Scope and release verification scripts
```

There is intentionally no application server, bot runtime, database package,
Redis client, worker, queue, or protocol-logic shared package.

## Scope and money-path rules

1. Every retained protocol capability must map to the immutable method list in
   [`fx-scope.lock.json`](fx-scope.lock.json).
2. Keep protocol planning in the official f(x) SDK. FxAeon may validate inputs,
   display the SDK plan, simulate it, and execute its ordered transactions.
3. The selected Privy wallet is the only signing authority. Do not add raw
   private-key handling, delegated/session signing, server execution, or hidden
   automation.
4. Validate chain ID, sender, destination, selector, native value, spender,
   approval amount, nonce, route order, and receipt status before progressing.
5. Stop after any rejected, reverted, timed-out, or nonce-drifted transaction.
6. Read protocol state from Ethereum/Base and the SDK. Never treat local
   storage as authoritative for balances, permissions, receipts, or bridge
   delivery.
7. Render unavailable data as unavailable. Do not fabricate prices, balances,
   gas estimates, PnL, liquidation values, yields, transaction success, or
   bridge completion.
8. Do not add DCA, alerts, limit orders, TP/SL, copy trading, whales,
   arbitrage, referrals, custom analytics, or background jobs.

## UI and accessibility

- Design for Telegram's narrow mobile WebView first, including safe areas and
  keyboard overlap.
- Keep semantic controls, visible focus, sufficient contrast, accessible names,
  reduced-motion behavior, and explicit loading/empty/error states.
- Require an explicit review action and a visible wallet confirmation for every
  transaction in a multi-step route.
- Update visual snapshots only for intentional UI changes and review every diff.

## Testing

```bash
pnpm verify:scope
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check:bundle
pnpm test:e2e
```

Protocol transaction tests must assert parameter/chain correctness, SDK order,
per-step user approval, receipt waiting, stop-on-failure behavior, and a fresh
post-confirmation read. Use a local fork or safe simulation; never use a
production wallet merely to prove the client architecture.

## Pull requests

State the retained official capability, security implications, tests run, and
whether any public build configuration changed. Do not introduce infrastructure
unless the client cannot safely perform a required operation and the concrete
blocking reason is documented.
