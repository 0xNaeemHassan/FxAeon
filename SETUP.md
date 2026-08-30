# Local setup and deployment

FxAeon is a single static Next.js Mini App. There is no FxAeon API, Telegram webhook process, database, Redis instance, worker, queue, or production container to configure.

## Prerequisites

- Node.js 22
- Corepack with pnpm 11.19.0
- A Privy application configured for Telegram login and Ethereum/Base
- Domain-restricted browser RPC endpoints for Ethereum and Base
- Optional: a Telegram test bot for validating the Mini App launch context

## Install

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

## Configure the browser build

Copy the example file:

```powershell
Copy-Item apps/mini-app/.env.example apps/mini-app/.env.local
```

The client accepts only public configuration:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Public Privy application identifier |
| `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` | Domain-restricted Ethereum RPC endpoint |
| `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL` | Domain-restricted Base RPC endpoint |
| `NEXT_PUBLIC_TELEGRAM_APP_URL` | Telegram Main Mini App or menu URL |

`NEXT_PUBLIC_*` values are embedded in the browser bundle. Never place a bot token, Privy secret, authorization key, private key, unrestricted RPC key, or other signing authority in this file. Inject production values through the protected deployment environment, not through committed files.

Privy should allow the exact local, preview, and production origins and expose only Ethereum (chain ID `1`) and Base (chain ID `8453`). Provider applications should use separate preview and production credentials with origin allowlists, network restrictions, usage caps, and alerts.

## Development

```bash
pnpm dev
```

The app can render outside Telegram, but wallet login and native Telegram viewport behavior are best tested from a Mini App launch context. Use a disposable test wallet for local work.

## Verification

Run the aggregate release gate:

```bash
pnpm verify
```

For the built artifact, run the Playwright suite:

```bash
pnpm test:e2e
```

The suite builds and serves the static export with empty wallet credentials. In CI, `pnpm build` runs once and `E2E_BUILD=0 pnpm test:e2e` reuses that exact artifact. It covers mobile routing, unavailable states, accessibility, and the absence of a backend request path. It never uses production funds.

The deterministic stress harness is opt-in:

```bash
pnpm test:chaos
```

Anvil fork tests require a locally running Anvil binary and an operator-supplied fork endpoint. Keep the endpoint in the process environment or a secret manager; do not commit it:

```powershell
$env:ANVIL_FORK_URL = (Get-Secret FXAEON_ANVIL_FORK_URL)
pnpm test:anvil
```

Optional `ANVIL_FORK_BLOCK`, `ANVIL_PORT`, and `FX_ANVIL_ITERATIONS` variables control the fork block, port, and randomized iteration count. The test script refuses to run when the endpoint or binary is missing.

## Static deployment

The release artifact is `apps/mini-app/dist/`. The checked-in Cloudflare Pages workflow targets the `fxaeon-mini-app` project and performs a frozen install, production-environment validation, the complete `pnpm verify` gate, and then deploys that directory. Verify that the target project exists before dispatching the manual workflow.

The protected environment supplies:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `NEXT_PUBLIC_PRIVY_APP_ID`
- domain-restricted Ethereum and Base RPC URLs
- `NEXT_PUBLIC_TELEGRAM_APP_URL`

No Pages Function, Worker, server runtime, database, or secret-bearing client API is part of the release.
