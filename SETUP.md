# Local setup and deployment

FxAeon has two independent static sites: the financial Next.js app in
`apps/mini-app` and the marketing site in `apps/landing`. The financial app
supports modern browsers and Telegram Mini Apps. It has no application backend,
Telegram webhook process, database, Redis instance, worker, queue, or production
container to configure. A deployment may expose one optional, read-only Pages
Function at `/api/gas` for the Ethereum gas display; it has no signing,
protocol-state, or wallet authority.

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
| `NEXT_PUBLIC_PRIVY_APP_ID` | Public Privy application identifier for email, external-wallet, and enabled Telegram sign-in; required for the complete login experience |
| `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` | Domain-restricted Ethereum RPC endpoint |
| `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL` | Domain-restricted Base RPC endpoint |
| `NEXT_PUBLIC_ALCHEMY_DATA_API_KEY` | Domain-restricted Alchemy Data API key for foreground token discovery on Ethereum/Base |
| `NEXT_PUBLIC_TELEGRAM_APP_URL` | Secondary Telegram Main Mini App or menu URL; browser entry does not depend on it |

`NEXT_PUBLIC_*` values are embedded in the browser bundle. Never place a bot token, Privy secret, authorization key, private key, unrestricted RPC key, or other signing authority in this file. Inject production values through the protected deployment environment, not through committed files.

Runtime configuration accepts only HTTPS Alchemy application endpoints for the
matching chain: `eth-mainnet.g.alchemy.com/v2/<key>` for Ethereum and
`base-mainnet.g.alchemy.com/v2/<key>` for Base, without credentials, custom
ports, query strings, or fragments. A localhost RPC is accepted only by an
explicit screenshot/test build for a disposable local fork. The client also
probes `eth_chainId` at financial planning, signing, and recovery boundaries.

When configured, Privy should allow the exact local, preview, and production origins and expose only Ethereum (chain ID `1`) and Base (chain ID `8453`). Provider applications should use separate preview and production credentials with origin allowlists, network restrictions, usage caps, and alerts. The Alchemy Data key is browser-visible by design, but should still be restricted to the deployed app origins and capped conservatively. If Privy is omitted, FxAeon uses the browser wallet's EIP-1193 provider directly; no account is requested until the user presses Connect.

Enable email and wallet authentication in Privy's dashboard. For Telegram,
enable Telegram login and seamless Mini App authentication, configure the bot
there, and set its allowed domain through BotFather. A bot token stored in
GitHub secrets does not enable Privy authentication. Keep that token out of
browser configuration. See [Privy's Telegram setup](https://docs.privy.io/guide/dashboard/telegram).

Positions, Borrow, and fxSAVE use Ethereum as their financial source of truth.
Move supports the supported `fxUSD` and `fxSAVE` bridge routes in either
Ethereum/Base direction; Base is not presented as a position or fxSAVE ledger.

### Where production values go

The checked-in deployment workflow reads build-time values before it creates a verification `dist/` artifact. Add them in **GitHub → repository Settings → Secrets and variables → Actions**:

- **Secrets/configuration:** `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL`, `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL`, `NEXT_PUBLIC_ALCHEMY_DATA_API_KEY`, and (when used) `NEXT_PUBLIC_PRIVY_APP_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **Variables:** `NEXT_PUBLIC_TELEGRAM_APP_URL` — for this deployment use `https://t.me/FxAeonBot` (or a Telegram direct Mini App link if BotFather assigns one).

For a local build, copy `apps/mini-app/.env.example` to `apps/mini-app/.env.local` and replace the two Alchemy placeholders with the matching `/v2/<key>` endpoints. Cloudflare Pages dashboard builds must define the same values under **Workers & Pages → project → Settings → Environment variables** for the selected Preview/Production environment; they are consumed at build time, not dynamically at runtime. GitHub secrets do not automatically become Cloudflare build variables. The release workflow therefore checks the published JavaScript for the expected public Privy app ID before it updates the Telegram bot menu. The sync uses only the fixed `https://api.telegram.org` Bot API host, validates the Mini App URL against the FxAeon HTTPS origins without credentials, ports, queries, or fragments, clears the default command suggestions because this Mini App has no Telegram command handler, and performs bounded writes followed by exact metadata/menu readbacks; any timeout, API error, or readback mismatch stops the job. Configure the native Main Mini App and its profile launch button separately in `@BotFather`; the workflow's menu update does not replace that BotFather setting.

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

The suite builds and serves the static export with empty wallet credentials. In CI, `pnpm build` runs once and `E2E_BUILD=0 pnpm test:e2e` reuses that exact artifact. It covers browser entry, mobile and Telegram-sized routing, unavailable states, accessibility, and the absence of FxAeon application-backend traffic; the optional same-origin `/api/gas` function is not enabled in credential-free E2E. It never uses production funds.

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

The financial release artifact is `apps/mini-app/dist/`. Cloudflare Pages' native Git integration publishes the existing `fxaeon` project at `https://fxaeon.com/`; `https://fxaeon.pages.dev/` is its preview origin. The app opens Portfolio at `/`; `/portfolio` remains a backwards-compatible alias. The public marketing site is a separate static project, `fxaeon-landing`, to publish at `https://fxaeon.xyz/` from `apps/landing/dist/`. These projects must have separate custom domains, build settings, and deployment checks.

The checked-in financial workflow independently performs a frozen installation, production-environment validation, the complete `pnpm verify` gate, builds the same artifact, waits for the commit-scoped `Cloudflare Pages` check, and verifies that the live bundle contains the expected public wallet configuration before updating Telegram. Because Cloudflare uses the same check name for Pages projects, the checker also requires the check's Cloudflare details URL to contain `/pages/view/fxaeon/`; a successful landing-project deployment cannot authorize the financial release. Verify that both target projects exist in the Cloudflare dashboard before enabling their native Git builds.

### Cloudflare dashboard build settings

The pasted build log reaches `Success: Build command completed` and then fails because `npx wrangler deploy` is a Workers deploy command running from the root of this pnpm workspace. Configure the Cloudflare project as **Pages** and use:

| Setting | Value |
| --- | --- |
| Root directory | `/` |
| Build command | `pnpm --filter @fxaeon/mini-app build` |
| Build output directory | `apps/mini-app/dist` |
| Deploy command | Leave blank for Pages; Pages publishes the output directory automatically |

If the provider requires an explicit deploy command for the financial project, use `pnpm exec wrangler pages deploy apps/mini-app/dist --project-name=fxaeon` instead of `npx wrangler deploy`. For the landing project, use `apps/landing` as the root directory, `node build.mjs` as the build command, and `dist` as its output directory; its project configuration is [apps/landing/wrangler.toml](apps/landing/wrangler.toml). The repository uses Cloudflare's native Pages Git builds and waits for their commit checks; it does not run Wrangler from GitHub Actions. Do not configure a Worker deploy for either static export.

The protected financial environment supplies:

- `NEXT_PUBLIC_PRIVY_APP_ID`
- domain-restricted Ethereum and Base RPC URLs
- `NEXT_PUBLIC_TELEGRAM_APP_URL`

The production Privy application ID is deployment configuration and is never
committed. Configure separate Privy applications and exact origins for
development, preview, and production. Privy's [cookie configuration guidance](https://docs.privy.io/recipes/react/cookies)
describes the separate development/production cookie setup; DNS and the Privy
dashboard still require verification after deployment.

The release has no application server, Worker, database, delegated signer, or secret-bearing client API. It may include one optional Cloudflare Pages Function at `/api/gas`, a fixed read-only Ethereum gas-price oracle. If enabled, add `ETHERSCAN_API_KEY` as a Pages **Secret** binding in the production and preview environments; it is never a `NEXT_PUBLIC_*` variable and is never included in the browser bundle. The function rejects query parameters, accepts only GET, uses a fixed Etherscan v2 gas-oracle request for chain `1`, and returns a bounded stale value during a short upstream outage. Leaving the binding unset disables only this Etherscan fallback; the primary RPC fee and gas estimates remain usable when the configured RPC supports them.
