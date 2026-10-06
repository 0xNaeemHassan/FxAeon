# FxAeon web and Telegram app

This package is the static Next.js app used at `fxaeon.com` and in Telegram
Mini Apps. Its root opens Portfolio. Trade, Positions, Earn, Borrow, and Move
use the pinned official f(x) SDK and the currently selected user wallet.

## Workspace commands

Run from the repository root:

```powershell
pnpm dev
pnpm test
pnpm test:e2e
pnpm lint
pnpm typecheck
pnpm build
```

See the root [`SETUP.md`](../../SETUP.md) for installation and environment
configuration, and [`docs/testing.md`](../../docs/testing.md) for CI and fork
tests.

## Runtime boundary

The app is a static export. Protocol reads and plans use the approved SDK
surface; public chain reads use configured RPCs; the selected wallet approves
each transaction. There is no FxAeon transaction backend or delegated signer.
The optional `/api/gas` Pages Function is a read-only display fallback. See
[`docs/architecture.md`](../../docs/architecture.md) and
[`docs/security.md`](../../docs/security.md).

The app can run in a browser without Privy by connecting an injected EVM wallet.
Configured Privy adds email and wallet login; Telegram adds host-specific
layout and navigation behavior. Native Telegram authentication and wallet
handoff require separate device testing.

## Routes and transaction records

The app includes Portfolio, Trade, Positions, Earn, Borrow, Move, Activity,
Settings, More, and the read-only `/docs` guide. Reviews stay on their product
route. The displayed simulated route is bound to its current inputs and wallet
session; stale reviews refresh before signing is enabled again.

History separates local resume drafts from submitted transactions. A saved
draft is not proof a wallet prompt opened or a transaction was submitted.
Continue restores form values into a fresh review. Submitted records are
rechecked against the selected chain and do not resend automatically.

## Build output

- Development: `apps/mini-app/.next/`
- Static production export: `apps/mini-app/dist/`

For Cloudflare Pages settings and release behavior, see
[`docs/deployment.md`](../../docs/deployment.md).
