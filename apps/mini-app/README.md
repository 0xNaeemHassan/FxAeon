# FxAeon web and Telegram app

This package is the official f(x) SDK experience for modern browsers and Telegram Mini Apps. It is a responsive Next.js 15 static export; both launch surfaces share the same wallet boundary, SDK adapter, transaction policy, recovery journal, and protocol UI. Reads, planning, simulation, and explicit signing happen in the browser, with no FxAeon API server or delegated signer.

## Commands

Run workspace commands from the repository root:

```bash
pnpm dev
pnpm verify
pnpm typecheck
pnpm lint
pnpm test
pnpm test:chaos
pnpm build
pnpm check:bundle
pnpm test:e2e
```

From this directory, the package-level equivalents are available through its `package.json` scripts.

## Environment

Every `NEXT_PUBLIC_*` value is exposed in the browser bundle and fixed at build time. The supported variables are documented in [`.env.example`](.env.example); none is a signing secret. Configure separate, domain-restricted Ethereum and Base RPC endpoints and the allowed Privy origins before a real-wallet test.

The app supports exactly Ethereum (chain ID `1`) and Base (chain ID `8453`). Unavailable provider or wallet data is shown as unavailable rather than inferred.

Wagmi and TanStack Query share standard wallet-balance reads across screens and refresh them after verified transaction receipts. They reuse the configured RPC clients and require no additional subscription or API key. Privy/the injected wallet remains the signing authority; official f(x) SDK planning, simulation, and receipt safeguards are unchanged. See [shared wallet data](../../docs/architecture.md#shared-wallet-data) for cache and session boundaries.

## Launch surfaces

- **Web:** open the deployed origin or `http://localhost:3000`; connect through email, an external EVM wallet, or Telegram authentication.
- **Telegram:** open the same static build as a Mini App for seamless Telegram authentication, native theme/viewport integration, haptics, and host navigation. The official bridge script loads in the document head, but bridge failure is non-blocking: the protocol routes and browser/Telegram login fallbacks remain usable.

Telegram enhances the host experience but is never required to access the protocol interface.

The Positions route uses a compact portfolio list and persistent management ticket. Every verified ETH/BTC long/short row exposes Manage and Close directly; Close is a dedicated full-exit mode with receive-asset selection, a destructive review action, fresh SDK planning, simulation, ordered approvals, receipt tracking, and post-confirmation balance/position refresh.

## Output and deployment

- Development output: `apps/mini-app/.next/`
- Production output: `apps/mini-app/dist/`

Cloudflare Pages serves the static `dist/` directory. The root workflow runs a frozen installation, validates the production environment, and completes the release verification gate before deployment. No Cloudflare Function, Worker, container, bot webhook, database, or Redis service is required.
