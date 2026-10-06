# Setup

FxAeon is a pnpm workspace with two independent sites: the static Next.js app in
`apps/mini-app` and the standalone marketing site in `apps/landing`.

## Requirements

- Node.js 22
- Corepack and pnpm 11.19.0

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

## Run the app

```powershell
Copy-Item apps/mini-app/.env.example apps/mini-app/.env.local
pnpm dev
```

Open `http://localhost:3000`. The app opens Portfolio. Without Privy
configuration, connect an injected EVM wallet explicitly. Telegram is optional
for local browser work.

The browser build accepts these public, build-time settings:

| Variable | Use |
| --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy login and wallet connection; optional when using an injected browser wallet |
| `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` | Restricted Ethereum RPC endpoint |
| `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL` | Restricted Base RPC endpoint |
| `NEXT_PUBLIC_ALCHEMY_DATA_API_KEY` | Optional wallet-token discovery on Ethereum and Base |
| `NEXT_PUBLIC_TELEGRAM_APP_URL` | Telegram bot or Mini App link |

All `NEXT_PUBLIC_*` values ship in the browser bundle. Use origin-restricted,
quota-limited provider credentials. Never put private keys, Privy secrets, or a
Telegram bot token in this file. Local RPC endpoints are accepted only by
explicit local-fork test builds.

## Run the landing site

```powershell
pnpm build:landing
pnpm preview:landing
```

The built site is in `apps/landing/dist/` and is served locally at
`http://localhost:4173` by default. See [`docs/deployment.md`](docs/deployment.md)
for the separate Cloudflare Pages projects and production configuration.

## Verify a change

```powershell
pnpm verify
```

This runs scope and architecture checks, landing build/tests, lint, source tests,
production build, typecheck, bundle/secret checks, built-browser tests, and
landing-browser checks. Protected Anvil fork gates are separate; see
[`docs/testing.md`](docs/testing.md).
