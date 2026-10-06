# Contributing

FxAeon is a static client for financial actions. Keep protocol behavior within
the pinned official SDK surface, preserve explicit wallet approval, and make
data freshness and failure states visible.

Prefer existing dependencies and shared components before adding another
package or abstraction. Check maintained official upstreams for an existing
solution, verify compatibility and license terms, record attribution when code
is adapted, and test FxAeon-specific wallet and network cases.

## Before opening a change

1. Follow [`SETUP.md`](SETUP.md) to install the pinned Node and pnpm versions.
2. Check [`docs/architecture.md`](docs/architecture.md),
   [`docs/security.md`](docs/security.md), and [`docs/sdk-scope.md`](docs/sdk-scope.md)
   before changing wallet, transaction, or protocol behavior.
3. Keep changes focused and add regression coverage for behavior, not source
   text or implementation details.
4. Run the relevant tests and `pnpm verify` when practical. Describe any gate
   that could not be run and why.
5. In a pull request, explain the user-visible change, the risk boundary it
   touches, and the checks run.

## Workspace map

```text
apps/mini-app/       Static web and Telegram app, SDK adapter, wallet runner
apps/landing/        Independent static marketing site
docs/                Maintained architecture, security, test, and asset guides
patches/             Reviewed patch for the pinned official f(x) SDK package
scripts/             Verification, build, capture, and deployment helpers
```

There is no protocol backend or shared transaction service. The optional
`/api/gas` Pages Function is read-only display support. Do not add server-side
signing, private-key handling, background execution, persistent account
infrastructure, or a new protocol capability through routine refactoring.

## Transaction changes

- Keep planning in the official SDK and maintain the method list in
  [`fx-scope.lock.json`](fx-scope.lock.json).
- Bind the review to the selected wallet, chain, inputs, and simulated route.
  Revalidate exact transaction policy before each wallet request.
- Require explicit wallet approval for every transaction. Stop a route after a
  rejection, failed receipt, timeout, or nonce/receipt mismatch.
- Treat local storage as a recovery hint only. Re-read authoritative chain and
  SDK state before enabling dependent actions.
- Keep price feeds and charts outside execution decisions. Do not describe
  position value as P&L, ROI, health, or liquidation value.

Follow the repository's existing formatting and test organization. Do not commit
generated build output, local secrets, or temporary fork state.
