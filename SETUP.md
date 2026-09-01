# Local setup and deployment

FxAeon is a single static Next.js application for modern browsers and Telegram Mini Apps. There is no FxAeon API, Telegram webhook process, database, Redis instance, worker, queue, or production container to configure.

## Prerequisites

- Node.js 22
- Corepack with pnpm 11.19.0
- Optional Privy application configured for the web origins you use and Telegram login; browser users can connect an injected EVM wallet without Privy
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
| `NEXT_PUBLIC_PRIVY_APP_ID` | Optional public Privy application identifier; omit it for direct browser-wallet access |
| `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` | Domain-restricted Ethereum RPC endpoint |
| `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL` | Domain-restricted Base RPC endpoint |
| `NEXT_PUBLIC_TELEGRAM_APP_URL` | Secondary Telegram Main Mini App or menu URL; browser entry does not depend on it |

`NEXT_PUBLIC_*` values are embedded in the browser bundle. Never place a bot token, Privy secret, authorization key, private key, unrestricted RPC key, or other signing authority in this file. Inject production values through the protected deployment environment, not through committed files.

When configured, Privy should allow the exact local, preview, and production origins and expose only Ethereum (chain ID `1`) and Base (chain ID `8453`). Provider applications should use separate preview and production credentials with origin allowlists, network restrictions, usage caps, and alerts. If Privy is omitted, FxAeon uses the browser wallet's EIP-1193 provider directly; no account is requested until the user presses Connect.

### Where production values go

The checked-in deployment workflow reads build-time values before it creates the static `dist/` artifact. Add them in **GitHub → repository Settings → Secrets and variables → Actions**:

- **Secrets:** `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL`, `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL`, and (when used) `NEXT_PUBLIC_PRIVY_APP_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **Variables:** `NEXT_PUBLIC_TELEGRAM_APP_URL` — for this deployment use `https://t.me/FxAeonBot` (or a Telegram direct Mini App link if BotFather assigns one).

For a local build, copy `apps/mini-app/.env.example` to `apps/mini-app/.env.local` and replace the two Alchemy placeholders with the matching `/v2/<key>` endpoints. Cloudflare Pages dashboard builds must define the same values under **Workers & Pages → project → Settings → Environment variables** for the selected Preview/Production environment; they are consumed at build time, not dynamically at runtime.

## Development

```bash
pnpm dev
```

Open `http://localhost:3000` to use the complete browser application. Telegram is optional: use a Mini App launch only when testing seamless Telegram authentication, native theme/viewport behavior, haptics, or the host Back button. Use a disposable test wallet for local work in either environment.

## Verification

Run the aggregate release gate:

```bash
pnpm verify
```

For the built artifact, run the Playwright suite:

```bash
pnpm test:e2e
```

The suite builds and serves the static export with empty wallet credentials. In CI, `pnpm build` runs once and `E2E_BUILD=0 pnpm test:e2e` reuses that exact artifact. It covers browser entry, mobile and Telegram-sized routing, unavailable states, accessibility, and the absence of a backend request path. It never uses production funds.

The deterministic stress harness is opt-in:

```bash
pnpm test:chaos
```

Anvil fork tests require a locally running Anvil binary and an operator-supplied Ethereum fork endpoint. Keep the endpoint in the process environment or a secret manager; do not commit it. The dedicated `ANVIL_FORK_URL` is preferred; the reviewed `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` is accepted as a convenient fallback for the heavy fork gate:

```powershell
$env:ANVIL_FORK_URL = (Get-Secret FXAEON_ANVIL_FORK_URL)
pnpm test:anvil
```

If the Alchemy endpoint is already loaded in the shell, `pnpm test:anvil` uses `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` automatically when `ANVIL_FORK_URL` is absent. The URL is passed to Anvil only, redacted from logs, and removed before application tests start.

Optional `ANVIL_FORK_BLOCK`, `ANVIL_PORT`, and `FX_ANVIL_ITERATIONS` variables control the fork block, port, and randomized iteration count. The test script refuses to run when the endpoint or binary is missing.

## Static deployment

The release artifact is `apps/mini-app/dist/`. The checked-in Cloudflare Pages workflow targets the `fxaeon-mini-app` project and performs a frozen install, production-environment validation, the complete `pnpm verify` gate, and then deploys that directory. Verify that the target project exists before dispatching the manual workflow.

### Cloudflare dashboard build settings

The pasted build log reaches `Success: Build command completed` and then fails because `npx wrangler deploy` is a Workers deploy command running from the root of this pnpm workspace. Configure the Cloudflare project as **Pages** and use:

| Setting | Value |
| --- | --- |
| Root directory | `/` |
| Build command | `pnpm --filter @fxaeon/mini-app build` |
| Build output directory | `apps/mini-app/dist` |
| Deploy command | Leave blank for Pages; Pages publishes the output directory automatically |

If the provider requires an explicit deploy command, use `pnpm exec wrangler pages deploy apps/mini-app/dist --project-name=fxaeon-mini-app` instead of `npx wrangler deploy`. The repository workflow already uses this Pages-specific command. Do not configure a Worker deploy for this static export.

The protected environment supplies:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `NEXT_PUBLIC_PRIVY_APP_ID`
- domain-restricted Ethereum and Base RPC URLs
- `NEXT_PUBLIC_TELEGRAM_APP_URL`

No Pages Function, Worker, server runtime, database, or secret-bearing client API is part of the release.
