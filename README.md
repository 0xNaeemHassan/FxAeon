# FxAeon

FxAeon is the official f(x) SDK experience delivered as a polished Telegram Mini App. It is a static, client-first interface: the SDK reads protocol state and prepares transaction plans, Privy asks the connected wallet to approve each transaction, and Ethereum/Base remain the source of truth.

FxAeon is not a separate trading platform. The repository contains no application API, bot runtime, delegated signer, automation engine, database, Redis service, custom indexer, price oracle, or off-chain portfolio ledger.

## Architecture

```text
Telegram launcher
       │
       ▼
Cloudflare Pages static Mini App
       │
       ├── Privy: authentication, wallet selection, explicit prompts
       ├── @aladdindao/fx-sdk: official reads and transaction plans
       └── Viem: Alchemy RPC, simulation, receipts, post-confirmation reads
                    │
                    ▼
          Ethereum / Base / LayerZero
```

The active product exposes exactly the 15 methods locked in [`fx-scope.lock.json`](fx-scope.lock.json): position reads and management, deposit/mint, repay/withdraw, Ethereum↔Base bridge planning, and the complete fxSAVE read/deposit/withdraw/claim surface.

## Quick start

Requirements: Node.js 22 and pnpm 11.19.0.

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
Copy-Item apps/mini-app/.env.example apps/mini-app/.env.local
pnpm dev
```

Configure a public Privy application ID and domain-restricted Ethereum and Base browser RPC endpoints. Every `NEXT_PUBLIC_*` value is embedded in the browser bundle; never put a Telegram bot token, Privy secret, authorization key, private key, or unrestricted provider credential in the client environment.

For the full setup and deployment procedure, see [`SETUP.md`](SETUP.md).

## Verification

```bash
pnpm verify
pnpm test:e2e
```

The aggregate gate verifies the locked scope, lint, types, unit tests, production dependency audit, static build, bundle budget, and built-artifact end-to-end tests. `pnpm test:chaos` adds deterministic route and runner mutation campaigns. `pnpm test:anvil` is an explicit, opt-in local-fork test and never consumes credentials from the repository.

`verify:production-env` is the deployment-only configuration gate. It rejects missing or placeholder values, unexpected RPC hosts or URL shapes, malformed Telegram launcher URLs, and malformed Cloudflare account IDs before a production build is deployed.

## Transaction safety

For every SDK transaction route, FxAeon:

1. binds the plan to the selected Privy address and expected chain;
2. validates transaction shape, target, selector, value, approvals, nonce, and order;
3. simulates the ordered calls before exposing the approval action;
4. opens a visible wallet confirmation for each step;
5. waits for a successful receipt before sending the next step;
6. stops immediately on rejection, revert, timeout, or nonce drift; and
7. waits one additional block and rereads authoritative state.

Local storage contains preferences plus a non-authoritative recovery journal of submitted hashes and the minimum bridge facts needed to re-run LayerZero GUID verification after a reload. Every fact is revalidated against chain receipts and events; local storage never proves a balance, permission, receipt, or bridge delivery.

## Deployment

The release artifact is `apps/mini-app/dist`, a pure static export. The manual Cloudflare Pages workflow uses a protected production environment, runs the complete verification gate, and deploys only that directory. It creates no Worker, Function, server, database, queue, or scheduled process.

## Documentation

- [`SETUP.md`](SETUP.md) — local development and static deployment
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution rules and review checklist
- [`docs/architecture.md`](docs/architecture.md) — runtime boundaries and state ownership
- [`docs/sdk-scope.md`](docs/sdk-scope.md) — the pinned 15-method capability contract
- [`docs/security.md`](docs/security.md) — controls, threat model, and residual trust
- [`docs/testing.md`](docs/testing.md) — release gates, fork tests, and acceptance coverage
- [`docs/roadmap.md`](docs/roadmap.md) — release posture and deliberately deferred work
- [`SECURITY.md`](SECURITY.md) — private vulnerability reporting

## License

MIT
