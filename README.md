<div align="center">
  <img src="brand/fxaeon-wordmark.svg" alt="FxAeon" width="720" />

  <h3>The high-integrity, self-custodial interface for f(x) Protocol.</h3>

  <p>
    Trade positions, mint fxUSD, manage fxSAVE, and bridge across Ethereum and Base<br />
    from the web or Telegram—without handing control of your wallet to an application server.
  </p>

  <p>
    <a href="https://github.com/0xNaeemHassan/FxAeon/actions/workflows/ci.yml"><img src="https://github.com/0xNaeemHassan/FxAeon/actions/workflows/ci.yml/badge.svg" alt="Client CI" /></a>
    <a href="https://github.com/0xNaeemHassan/FxAeon/actions/workflows/e2e-mini-app.yml"><img src="https://github.com/0xNaeemHassan/FxAeon/actions/workflows/e2e-mini-app.yml/badge.svg" alt="End-to-end tests" /></a>
    <a href="https://github.com/0xNaeemHassan/FxAeon/actions/workflows/supply-chain.yml"><img src="https://github.com/0xNaeemHassan/FxAeon/actions/workflows/supply-chain.yml/badge.svg" alt="Supply-chain checks" /></a>
    <a href="https://github.com/0xNaeemHassan/FxAeon/actions/workflows/anvil-fork.yml"><img src="https://github.com/0xNaeemHassan/FxAeon/actions/workflows/anvil-fork.yml/badge.svg" alt="Protected Anvil fork" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b6dff.svg" alt="MIT License" /></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-15-000000?logo=next.js" alt="Next.js 15" />
    <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white" alt="TypeScript 5.9" />
    <img src="https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white" alt="Node.js 22" />
    <img src="https://img.shields.io/badge/pnpm-11.19-f69220?logo=pnpm&logoColor=white" alt="pnpm 11.19" />
    <img src="https://img.shields.io/badge/chains-Ethereum%20%7C%20Base-627eea" alt="Ethereum and Base" />
  </p>

  <p>
    <a href="#product">Product</a> ·
    <a href="#security-by-construction">Security</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#verification">Verification</a> ·
    <a href="docs/README.md">Documentation</a>
  </p>
</div>

---

## Product

FxAeon turns the official f(x) SDK into a focused, reviewable product surface for both ordinary browsers and Telegram Mini Apps. The same static application, wallet boundary, SDK adapter, and transaction policy run in both environments.

<img src="docs/assets/fxaeon-web.png" alt="FxAeon web landing page" width="100%" />

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/assets/fxaeon-bridge.png" alt="FxAeon Ethereum to Base bridge workflow" width="100%" />
      <br /><strong>Ethereum ↔ Base bridge workflow</strong>
    </td>
    <td width="50%" align="center">
      <img src="docs/assets/fxaeon-trade.png" alt="FxAeon trading form" width="100%" />
      <br /><strong>Reviewable position workflows</strong>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/assets/fxaeon-login.png" alt="FxAeon browser wallet connection screen" width="100%" />
      <br /><strong>Browser wallet entry</strong>
    </td>
    <td width="50%" align="center">
      <img src="docs/assets/fxaeon-portfolio.png" alt="FxAeon portfolio with wallet connection state" width="100%" />
      <br /><strong>Portfolio at a glance</strong>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/assets/fxaeon-positions.png" alt="FxAeon live ETH and BTC positions workspace" width="100%" />
      <br /><strong>Live position workspace</strong>
    </td>
    <td width="50%" align="center">
      <strong>Fork-backed position capture</strong><br />
      <span>Official SDK reads only — no demo balances or synthetic PnL.</span>
    </td>
  </tr>
</table>

### A complete, deliberately scoped protocol interface

| Capability | What FxAeon provides |
| --- | --- |
| Positions | Read ETH/BTC long and short positions; open, increase, reduce, close, and adjust leverage |
| Borrow | Deposit collateral and mint fxUSD; repay debt and withdraw collateral |
| fxSAVE | Read balances/configuration, deposit assets, queue or execute redemptions, and claim completed withdrawals |
| Bridge | Quote and build Ethereum ↔ Base LayerZero routes with source-receipt and destination-GUID verification |
| Live USD context | Timestamp- and confidence-validated asset prices across forms, pickers, Portfolio, Earn, positions, and the wallet profile; display-only and never an execution input |
| Wallet profile | Privy embedded wallets or browser-injected EVM wallets, supported-asset balances, live USD totals, and dedicated activity—without a custody server |
| Recovery | Reload-safe pending transaction and bridge journals in a dedicated Activity view, always revalidated against chain data |
| Interface | Compact mobile-first controls, polished token pickers, a real leverage slider, and one-tap official light/dark theming |

The immutable public surface contains exactly 15 SDK methods. [`fx-scope.lock.json`](fx-scope.lock.json) and the scope verifier prevent protocol internals, unsupported routes, or backend authority from silently entering the product.

Token and network marks use maintained AladdinDAO/SmolDapp assets (with local SVG fallbacks), so fxUSD, fxSAVE, ETH, WETH, stETH, wstETH, USDC, USDT, BTC, Ethereum, and Base remain recognizable even when an asset host is unavailable.

### Why the design matters

- **Web and Telegram parity.** Users can launch the full app in a modern browser or inside Telegram; Telegram is an enhanced host, not a requirement.
- **Self-custodial execution.** Privy or the connected external wallet remains the only signing authority. FxAeon never accepts a private key.
- **Official planning path.** Protocol reads and unsigned transaction plans come from the pinned <code>@aladdindao/fx-sdk</code> package.
- **Chain-authoritative state.** Ethereum, Base, receipts, and matching LayerZero events establish financial truth—not a database or browser cache.
- **Price context without price authority.** DefiLlama prices refresh every 30 seconds, fail closed when stale or low-confidence, and are isolated from SDK planning, validation, simulation, and signing.
- **Inspectable transaction review.** Targets, selectors, values, approvals, chains, nonces, and route order are validated before wallet confirmation.
- **Static delivery.** The production artifact is a deterministic Cloudflare Pages export with no application server, Worker, queue, or privileged runtime.

## Security by construction

Every write follows the same guarded lifecycle:

1. build a fresh plan from current wallet, chain, and form inputs;
2. bind it to the selected sender and supported network;
3. validate destinations, selectors, calldata shape, value, approvals, nonce, and order;
4. simulate the ordered calls when supported;
5. show a human-readable and raw transaction review;
6. request a visible wallet confirmation for each step;
7. wait for a successful, fingerprint-matching receipt before continuing;
8. wait one additional block and reread authoritative protocol state.

A rejection, revert, timeout, provider inconsistency, or nonce drift stops the route. Bridge source confirmation is never presented as destination delivery.

> [!IMPORTANT]
> FxAeon is unaudited application software for financial transactions. Review the transaction details shown by your wallet and use the software at your own risk. See [`SECURITY.md`](SECURITY.md) and [`docs/security.md`](docs/security.md) for the complete security model.

## Architecture

```mermaid
flowchart LR
    WEB[Modern web browser] --> APP
    TG[Telegram Mini App] --> APP[Next.js static application]
    APP --> PRIVY[Privy wallet boundary]
    APP --> SDK["Pinned official f(x) SDK"]
    APP --> VIEM[Viem public clients]
    APP -. display only .-> USD[Validated USD price feed]
    SDK --> ETH[Ethereum]
    VIEM --> ETH
    VIEM --> BASE[Base]
    ETH <--> LZ[LayerZero]
    BASE <--> LZ
```

| Layer | Responsibility |
| --- | --- |
| Interface | Responsive web/Telegram navigation, forms, transaction review, recovery, and accessible states |
| Wallet boundary | Authentication, wallet selection, chain switching, and explicit transaction prompts |
| SDK façade | The exact 15-method official capability contract |
| Policy and runner | Plan binding, validation, simulation, serialization, receipts, and authoritative refresh |
| Chain clients | Restricted Ethereum/Base RPC reads, simulations, receipts, and bridge-event verification |
| Price context | Read-only USD display values with timestamp/confidence validation; never used by execution policy |
| Hosting | Pure static assets with generated CSP hashes and reviewed network destinations |

Read the detailed runtime and state-ownership model in [`docs/architecture.md`](docs/architecture.md).

## Quick start

### Requirements

- Node.js 22
- pnpm 11.19.0 through Corepack

### Install and run

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
cp apps/mini-app/.env.example apps/mini-app/.env.local
pnpm dev
```

Open <http://localhost:3000> in a browser. Telegram is optional for local development; use a Telegram test launch only when validating host-specific viewport, theme, haptic, or seamless-login behavior.

### Public build configuration

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Optional public Privy application identifier; omit it to use an injected browser wallet |
| `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` | Origin-restricted Ethereum browser endpoint |
| `NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL` | Origin-restricted Base browser endpoint |
| `NEXT_PUBLIC_TELEGRAM_APP_URL` | Secondary Telegram launch link; browser entry does not depend on it |

Every `NEXT_PUBLIC_*` value is embedded in the browser bundle. Never place a private key, Telegram bot token, Privy secret, authorization key, or unrestricted provider credential in client configuration. Without Privy, FxAeon connects directly to the wallet extension through EIP-1193; signing still happens in that wallet and no fallback server is involved.

See [`SETUP.md`](SETUP.md) for provider restrictions, protected deployment variables, fork-test configuration, and Cloudflare Pages deployment.

## Verification

```bash
pnpm verify
```

The release gate includes:

- exact SDK scope and route-boundary verification;
- ESLint and strict TypeScript checks;
- unit and adversarial money-path tests;
- seeded route and wallet-runner chaos campaigns;
- high-severity production dependency audit;
- static Next.js export and CSP generation;
- bundle-size and forbidden-telemetry inspection; and
- Playwright coverage against the built artifact.

For additional commands:

```bash
pnpm test:chaos   # deterministic mutation and failure-injection campaigns
pnpm test:anvil   # protected, operator-supplied Ethereum mainnet fork
pnpm test:stress  # chaos plus the protected Anvil gate
pnpm test:e2e     # browser and Telegram-sized static-artifact coverage
```

Anvil uses disposable local accounts and snapshots. Its provider URL is supplied only at invocation time and is never committed, printed, or forwarded to the application test process.

The manual **Protected Anvil mainnet fork** workflow runs a heavier 64-iteration campaign by default using the origin-restricted Ethereum Alchemy URL already stored in the protected GitHub environment. It never exposes that URL to the static application artifact or job output.

## Repository structure

```text
apps/mini-app/       Next.js web and Telegram application
brand/               Repository and product identity assets
docs/                Architecture, SDK scope, security, testing, and roadmap
patches/             Reviewed patch for the pinned official f(x) SDK
scripts/             Scope, environment, CSP, bundle, and fork verification
fx-scope.lock.json   Immutable public SDK capability contract
```

## Documentation

| Guide | Purpose |
| --- | --- |
| [`SETUP.md`](SETUP.md) | Local development, public configuration, testing, and deployment |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contribution workflow, scope rules, and pull-request expectations |
| [`docs/architecture.md`](docs/architecture.md) | Runtime boundaries, transaction lifecycle, and state ownership |
| [`docs/sdk-scope.md`](docs/sdk-scope.md) | Exact official SDK capability contract |
| [`docs/security.md`](docs/security.md) | Threats, controls, supply chain, and residual trust |
| [`docs/testing.md`](docs/testing.md) | Release gates, fork testing, and acceptance matrix |
| [`docs/roadmap.md`](docs/roadmap.md) | Release posture and deliberately deferred work |
| [`SECURITY.md`](SECURITY.md) | Private vulnerability reporting |

## Contributing

Focused security, accessibility, test, and official-capability improvements are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md), preserve the client-only trust boundary, and run `pnpm verify` before opening a pull request.

## License

FxAeon is available under the [MIT License](LICENSE).
