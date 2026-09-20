# Deployment

FxAeon deploys as two independent Cloudflare Pages sites. Keep their roots,
build outputs, environment variables, and custom domains separate.

| Site | Pages project | Root | Build | Output | Intended domain |
| --- | --- | --- | --- | --- | --- |
| Financial web and Telegram app | `fxaeon` | Repository root `/` | `pnpm --filter @fxaeon/mini-app build` | `apps/mini-app/dist` | `fxaeon.com`, `www.fxaeon.com` |
| Marketing site | `fxaeon-landing` | `apps/landing` | `node build.mjs` | `dist` | `fxaeon.xyz` |

The landing project watches `apps/landing/*`, as recorded in
[`apps/landing/wrangler.toml`](../apps/landing/wrangler.toml). The app project
uses the root [`wrangler.toml`](../wrangler.toml). Both deploy static Pages
output; `wrangler deploy` is for Workers and is not the deployment command for
these sites.

## Build configuration

The financial app consumes public variables at build time. Set them for the
Production and Preview builds in Cloudflare Pages, and provide the matching
protected values to GitHub Actions for the release workflow:

| Name | GitHub storage | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Secret | Production Privy app; local-development ID is rejected |
| `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` | Secret | Origin-restricted Ethereum RPC |
| `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL` | Secret | Origin-restricted Base RPC |
| `NEXT_PUBLIC_ALCHEMY_DATA_API_KEY` | Secret | Browser-visible wallet-token discovery key, restricted by origin and quota |
| `NEXT_PUBLIC_TELEGRAM_APP_URL` | Variable | `https://t.me/FxAeonBot` or a configured Mini App launcher |
| `TELEGRAM_BOT_TOKEN` | Secret | Bot metadata and menu synchronization; never a `NEXT_PUBLIC_*` value |
| `ETHERSCAN_API_KEY` | Secret | Read-only `/api/gas` Pages Function binding |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Secrets | Set or verify the Pages gas-oracle secret |

All `NEXT_PUBLIC_*` values are exposed in the compiled client. The production
validator requires the Privy ID, both Alchemy RPCs, Data API key, Telegram URL,
and bot token. Configure Privy for the exact production and preview origins and
Ethereum/Base networks. Do not reuse the local Privy application in production.

The landing site only needs its optional Telegram URL when building. It has no
wallet, Privy, RPC, or protocol configuration. The Pages build can use the
defaults in its source when no Telegram URL is set.

## Release workflow

`.github/workflows/deploy-mini-app.yml` runs on `main` or manual dispatch. It
validates production inputs, runs `pnpm verify`, builds the static app, waits
for the commit-matched Cloudflare Pages check for project `fxaeon`, verifies
the live gas-oracle binding and public Privy configuration, then synchronizes
the Telegram bot metadata and default Mini App menu. A Telegram sync does not
configure the native Main Mini App or profile launch button; those remain
BotFather settings.

Cloudflare Pages Git integration publishes the static output. The release
workflow may use Wrangler Pages commands to bind the gas-oracle secret or
republish the already-verified artifact; it does not deploy a Worker. The
standalone landing build is tested in CI but is deployed by its separate Pages
project.

Protected fork testing is separate from deployment. It uses a disposable local
Anvil fork and a protected Ethereum RPC secret; see
[`testing.md`](testing.md).
