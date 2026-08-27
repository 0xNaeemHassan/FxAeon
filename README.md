# FxAeon

FxAeon is the official f(x) SDK experience in a polished Telegram Mini App. It is a static, client-first interface: the SDK reads protocol state and plans transactions, Privy asks the user to approve every transaction, and Ethereum/Base remain the source of truth.

FxAeon is deliberately not a separate trading platform. It has no automation engine, delegated signer, bot runtime, backend API, database, Redis, price oracle, custom indexer, or off-chain portfolio ledger.

## Architecture

```text
Telegram launcher
       │
       ▼
Cloudflare Pages static Mini App
       │
       ├── Privy: authentication, selected wallet, explicit prompts
       ├── @aladdindao/fx-sdk: official reads and transaction plans
       └── Viem: Alchemy RPC, simulation, receipts, post-confirm reads
                    │
                    ▼
          Ethereum / Base / LayerZero
```

The active product exposes exactly the 15 methods locked in [`fx-scope.lock.json`](./fx-scope.lock.json): position reads and management, deposit/mint, repay/withdraw, Ethereum↔Base bridge planning, and the complete fxSAVE read/deposit/withdraw/claim surface.

## Run locally

Requirements: Node 22 and pnpm 11.19.0.

```bash
cp apps/mini-app/.env.example apps/mini-app/.env.local
pnpm install
pnpm dev
```

The root package declares the same Node/pnpm versions used by CI. With Corepack,
`corepack enable` is enough to expose the pinned pnpm version on supported Node
installations.

Configure a public Privy app ID and domain-restricted Alchemy Ethereum/Base browser endpoints. Every `NEXT_PUBLIC_*` value is shipped to the browser; never place a Telegram bot token, Privy secret, authorization key, or unrestricted credential there.

## Verify

```bash
pnpm verify:scope
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm check:bundle
```

`verify:scope` fails if the installed SDK surface differs from the 15-method contract, an unsupported route returns, or active Mini App source regains backend/delegated-signing dependencies.

`verify:production-env` is the deployment-only configuration gate. It rejects
missing/placeholder values, unexpected Alchemy hosts or URL shapes, malformed
Telegram launcher URLs, and malformed Cloudflare account IDs before a production
build is allowed to deploy.

## Transaction safety

For every SDK transaction route FxAeon:

1. binds the plan to the selected Privy address and expected chain;
2. validates transaction shape, target, selector, value, approvals, and nonce;
3. simulates the ordered calls before exposing the approval action;
4. opens a visible wallet confirmation for each step;
5. waits for a successful receipt before sending the next step;
6. stops immediately on rejection, revert, timeout, or nonce drift;
7. waits one additional block and rereads authoritative state.

Local storage contains preferences plus a non-authoritative recovery journal of submitted hashes and the minimum bridge facts needed to re-run LayerZero GUID verification after a reload. Every fact is revalidated against chain receipts/events; local storage never proves a balance, permission, receipt, or bridge delivery.

## Deployment

The production artifact is `apps/mini-app/dist`, a pure static export. The Cloudflare workflow is manual and uses a protected `production` environment. It creates no Worker, Function, server, database, queue, or scheduled process.

See [`docs/architecture.md`](./docs/architecture.md), [`docs/security.md`](./docs/security.md), and [`docs/testing.md`](./docs/testing.md).

## License

MIT
