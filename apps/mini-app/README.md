# FxAeon Mini App

FxAeon is the official f(x) SDK experience wrapped in a polished,
Telegram-native interface. This package is a Next.js 15 static export for the
Telegram WebView. Reads, transaction planning, simulation, and explicit user
signing happen in the browser; FxAeon has no API server or delegated signer.

## Develop and verify

Run workspace commands from the repository root:

```bash
pnpm dev
pnpm verify
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check:bundle
pnpm test:e2e
```

Production output is `apps/mini-app/dist/`. Development output is kept in
`apps/mini-app/.next/`.

## Build-time environment

Every `NEXT_PUBLIC_*` value is exposed in the browser bundle and fixed at build
time. The supported values are documented in
[`apps/mini-app/.env.example`](.env.example). They contain no signing secret.

The app uses exactly Ethereum and Base. Alchemy keys must be domain-restricted
and capped. Privy must be configured for the deployed origins and visible
wallet confirmation UIs.

## Static deployment

Cloudflare Pages serves `apps/mini-app/dist/` as static assets. The root
workflow runs frozen installation and the complete `pnpm verify` gate before
deployment. No Cloudflare Function, Worker, Render service, Docker container,
bot webhook, database, or Redis service is needed.
