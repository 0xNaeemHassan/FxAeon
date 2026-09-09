# FxAeon web and Telegram app

This package is the official f(x) SDK experience for modern browsers and Telegram Mini Apps. It is a responsive Next.js 15 static export; both launch surfaces share the same wallet boundary, SDK adapter, transaction policy, recovery journal, and protocol UI. Reads, planning, simulation, and explicit signing happen in the browser, with no FxAeon API server or delegated signer. The root route opens Portfolio directly; there is no landing page between the user and the app.

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

- **Web:** open the deployed origin or `http://localhost:3000`; Portfolio is the first screen. Connect through Privy or an external EVM wallet and keep the selected product form in place.
- **Telegram:** open the same static build as a Mini App for Telegram authentication, native theme/viewport integration, haptics, and host navigation. If the bridge or Privy bootstrap is still settling, a Connect wallet click is queued and the wallet flow opens automatically when ready; users are not blocked by a bootstrap message or misdirected to browser-wallet discovery.

Telegram enhances the host experience but is never required to access the protocol interface.

The protected production deploy also synchronizes the @FxAeonBot metadata and
default Mini App menu after a successful Pages publish. The bot token stays in
GitHub Actions secrets and is never a `NEXT_PUBLIC_*` value or part of the
static artifact. A Telegram launch with a delayed bridge keeps the app usable
while bootstrap completes; a launch outside Telegram’s Mini App context asks
the user to reopen it from the bot menu. An ordinary browser uses its explicit
injected EIP-1193 wallet path when Privy is not configured.

## Product flow

Disconnected product pages remain useful. Trade, Positions, Earn, Borrow, and
Move keep their inputs editable and put **Connect wallet** on the primary
action. After connection, the same draft continues to preview and review; it
does not restart or navigate to a separate connection page. Each write follows
one visible sequence: edit → live preview → review → awaiting signature →
submitted → confirming → confirmed, failed, or cancelled. Reviews stay in the
same route and main card, with the final action rail above the fixed navigation.

History is the sole transaction-history surface and includes signature-required,
submitted, confirming, completed, failed, and cancelled entries. Unsigned
review drafts are local, scoped to the wallet, chain, and action, and never
contain executable calldata or promise cross-device recovery. Hash-backed
records are rechecked against the selected chain before they become terminal.

Product routes are intentionally compact enough to complete without page
scrolling at supported phone and desktop sizes. Documentation and an expanded
mobile Trade chart may scroll internally because their reading surface is
larger by design; transaction reviews keep their confirmation controls visible.

The Positions route uses a compact portfolio list and persistent management ticket. Every verified ETH/BTC long/short row exposes Manage and Close directly; Close is a dedicated full-exit mode with receive-asset selection, a destructive review action, fresh SDK planning, simulation, ordered approvals, receipt tracking, and post-confirmation balance/position refresh.

## Output and deployment

- Development output: `apps/mini-app/.next/`
- Production output: `apps/mini-app/dist/`

Cloudflare Pages serves the static `dist/` directory. The release workflow runs a frozen installation, validates the public build configuration, completes the release verification gate, waits for the Pages deployment, verifies the live public Privy configuration, and then synchronizes the bot metadata/menu. No Cloudflare Function, Worker, container, bot webhook, database, or Redis service is required.
