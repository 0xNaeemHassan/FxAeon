# Local setup

FxAeon is a single static Next.js Mini App. There is no FxAeon API, Telegram
webhook process, database, Redis instance, worker, queue, or production
container to configure.

## Prerequisites

- Node.js 22
- Corepack with pnpm 11.19.0
- A Privy application configured for Telegram login and Ethereum/Base
- Domain-restricted Alchemy browser RPC keys for Ethereum and Base
- Optional: a Telegram test bot for the Mini App launch context

## Install

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

## Configure the browser build

Copy the example file and fill only public values:

```bash
cp apps/mini-app/.env.example apps/mini-app/.env.local
```

Required values:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Public Privy application identifier |
| `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` | Domain-restricted Ethereum RPC endpoint |
| `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL` | Domain-restricted Base RPC endpoint |
| `NEXT_PUBLIC_TELEGRAM_APP_URL` | Telegram Main Mini App/menu URL |

`NEXT_PUBLIC_*` values are embedded in the browser bundle. Never put a bot
token, Privy secret, authorization key, private key, unrestricted RPC key, or
other signing authority in this file.

Privy should allow the exact local/preview/production origins and expose only
Ethereum (chain ID `1`) and Base (chain ID `8453`). Alchemy applications
should use separate preview and production keys with origin allowlists,
network restrictions, usage caps, and alerts.

## Development

```bash
pnpm dev
```

The app can render outside Telegram, but wallet login and native Telegram
viewport behavior are best tested from a Mini App launch context.

## Verification

The aggregate gate runs scope verification, lint, typecheck, unit tests, the
high-severity production dependency audit, the static build, and the bundle
budget:

```bash
pnpm verify
pnpm test:e2e
```

The Playwright harness builds and serves the static export with empty wallet
credentials. In CI, `pnpm build` runs once and `E2E_BUILD=0 pnpm test:e2e`
reuses that exact artifact. It verifies mobile routing, unavailable states,
accessibility, and the absence of a backend request path. It never uses
production funds.

## Static deployment

The release artifact is `apps/mini-app/dist/`. The checked-in Cloudflare Pages
workflow targets the `fxaeon-mini-app` project and performs a frozen install,
the complete `pnpm verify` gate, placeholder/secret validation, and then
deploys that directory. Renaming the project in repository configuration does
not create or modify a Cloudflare project; verify the target exists before an
operator dispatches the workflow. It requires only:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `NEXT_PUBLIC_PRIVY_APP_ID` as a repository/environment secret
- domain-restricted Ethereum and Base RPC URLs as repository/environment secrets
- `NEXT_PUBLIC_TELEGRAM_APP_URL` as a repository/environment variable

No Pages Function, Worker, server runtime, database, or secret-bearing client
API is part of the release.
