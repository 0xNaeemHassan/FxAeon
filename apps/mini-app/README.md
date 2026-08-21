# FxAeon Mini App

The Mini App is FxAeon's mobile f(x) Protocol gateway: a Next.js 15 static export for Telegram's webview. Its primary navigation is **Home, Trade, Earn, Move, More**; account reads and every transaction review use the Telegram-authenticated bot API rather than a browser RPC.

The full route, action, launch-context, and degraded-state reference is in [`docs/mini-app.md`](../../docs/mini-app.md).

## Develop and verify

Run workspace commands from the repository root:

```bash
pnpm --filter @fxaeon/shared build
pnpm --filter @fxaeon/mini-app dev
pnpm --filter @fxaeon/mini-app test
pnpm --filter @fxaeon/mini-app test:e2e
pnpm --filter @fxaeon/mini-app build
```

Production build output is `apps/mini-app/dist/`. Development output is kept separately under `.next/`.

## Build-time environment

Every `NEXT_PUBLIC_*` value is exposed in the browser bundle and fixed at build time.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_BOT_API_URL` | Explicit bot/API origin used for authenticated account and action requests |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Bot username without `@`, used for Telegram links |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Public Privy application ID for wallet setup |
| `NEXT_PUBLIC_PRIVY_SIGNER_ID` | Public signer/quorum identifier used for bot-trading grant/revoke |

Copy `.env.example` to `.env.local` for development. Do not put RPC URLs, bot tokens, Privy secrets, or authorization keys in `NEXT_PUBLIC_*` variables.

## Deploy to Cloudflare Pages

The explicit GitHub Actions path uses these repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `PRIVY_APP_ID`
- `PRIVY_SIGNER_ID`
- `TELEGRAM_BOT_USERNAME`
- `PRODUCTION_URL` (the bot/API origin)

The workflow builds the shared package and Mini App, then deploys `apps/mini-app/dist/`. It skips the Wrangler deploy when `CLOUDFLARE_API_TOKEN` is absent so a separately configured Cloudflare Git integration can remain authoritative.

For a reviewed manual deployment, export the four frontend values above and run from the repository root:

```bash
pnpm --filter @fxaeon/shared build
pnpm --filter @fxaeon/mini-app build
npx wrangler@3 pages deploy apps/mini-app/dist --project-name=fxbot-mini-app --branch=main
```

Deployment and post-release checks are documented in [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).
