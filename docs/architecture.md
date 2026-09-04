# Architecture

## Runtime data flow

```text
Modern browser ─┐
                ├──▶ Next.js static export on Cloudflare Pages
Telegram Mini ──┘                 │
                                  ├── Privy React client (optional)
                                  │     └── user-owned wallet + explicit confirmation
                                  ├── injected EIP-1193 wallet (browser fallback)
                                  ├── pinned official f(x) SDK
                                  │     └── reads + ordered unsigned plans
                                  ├── Wagmi + TanStack Query
                                  │     └── shared public wallet-balance reads/cache
                                  ├── validated USD display feeds
                                  │     ├── DefiLlama current prices; stale/confidence guards
                                  │     └── CoinGecko ETH/BTC history; range/freshness guards
                                  └── Viem public clients
                                        ├── Alchemy Ethereum (chain 1)
                                        └── Alchemy Base (chain 8453)
                                                   │
                                                   ▼
                                         Ethereum / Base / LayerZero
```

There is no FxAeon server process. The ordinary web app and Telegram Mini App are equal launch surfaces over the same static artifact. Telegram adds host-specific authentication, theme, viewport, haptic, and navigation integration; it is not a wallet-authority boundary or a requirement. Privy supplies identity and wallet ownership when configured; a plain browser can instead connect an injected EIP-1193 wallet after an explicit user action. The normal web flow opens Portfolio and keeps wallet connection, account switching, and disconnect in the app shell; `/login` is a standalone setup screen, not a prerequisite for ordinary navigation. A selected address is never accepted from a query parameter, Telegram user record, or local storage.

## Module boundaries

- `src/lib/fx/sdk.ts` owns the single Ethereum `FxSdk` instance. This is intentional because the upstream SDK caches its first RPC client globally.
- `src/lib/fx/service.ts` normalizes only official SDK results into reviewable ordered plans. Plans are rebuilt on demand and invalidated when wallet, network, or inputs change.
- `src/lib/fx/validation.ts` and the transaction policy reject malformed senders, chains, destinations, selectors, values, approvals, and nonces.
- `src/lib/fx/runner.ts` simulates, requests one signature per step, awaits each receipt, stops on failure, waits one additional block, and triggers an authoritative reread.
- `src/lib/wallet/` is a narrow Privy/EIP-1193 adapter. It has no server credential or delegated authority.
- `WalletDataProvider.tsx` and `src/lib/web3/` share standard native/ERC-20 balance reads through pinned Wagmi `3.7.7` and TanStack Query `5.102.8`. They reuse the existing Viem public clients, not another wallet or RPC service.
- `src/lib/prices.ts` validates token quotes independently, rejects stale/low-confidence values, and uses one bounded, batched, cached CoinGecko fallback with adaptive rate-limit retry/backoff for missing current prices. Current-price UI has no source badge; chart history retains its separate attribution. `src/lib/positionValuation.ts` retains exact accounting units for estimated USD equity and owned-token value. These helpers are not imported by the SDK façade, validation policy, or transaction runner.
- `src/lib/fxSaveUnits.ts` keeps the SDK's fxSAVE share/base-pool-share units explicit and normalizes the SDK's omitted underlying conversion for a verified zero-share balance to exact `0n`; a missing conversion for nonzero shares remains unavailable.
- `src/lib/marketData.ts` validates keyless CoinGecko ETH/BTC history, rejects malformed, sparse, stale, or future-skewed series, and bounds chart density. It is display-only and remains separate from transaction planning.
- `ActionReview.tsx` is the common user-visible review-sheet state machine from plan review through receipt confirmation. It exposes the route's human-readable facts and raw transaction disclosure before each wallet step.
- `src/lib/telegram.ts` treats Telegram as an optional host adapter and passes signed launch data only to Privy's authentication flow. The official bridge loads before application scripts as Telegram specifies, while bridge absence never gates public routes or wallet login; late bridge availability is bound progressively by `TelegramProvider`.

## State ownership

| State | Authoritative source |
| --- | --- |
| Positions, collateral, debt, and leverage | Ethereum through the official SDK |
| fxSAVE configuration, balance, cooldown, and claimability | Ethereum through the official SDK |
| Bridge source confirmation and LayerZero delivery | Matching `OFTSent`/`OFTReceived` GUIDs on Ethereum/Base |
| Selected address and signing permission | Privy wallet or explicitly connected browser wallet |
| Native/ERC-20 wallet balances | Chain-probed public RPC reads through Wagmi; TanStack Query is an in-memory cache, not authority |
| Display-only USD prices | Validated DefiLlama current snapshot, batched CoinGecko fallback for missing current token quotes, plus validated ETH/BTC history; never execution authority |
| Official, neutral-dark, and light themes and slippage preset | Versioned local storage |
| Pending hashes and bridge recheck context | Local recovery hint, revalidated from receipts and matching bridge events |
| Newly confirmed position IDs awaiting index discovery | Wallet-scoped receipt hints, revalidated against the canonical pool's mint event, receipt/block, and current NFT owner |

No application-owned persistent state remains, so no database is justified. Local storage can help restore a pending view after reload, but it cannot establish a financial fact.

Confirmed-position hints contain no financial values. At most 12 are retained per wallet for reload recovery, with a 24-hour restore lifetime. They remain hidden until chain/receipt/ownership verification succeeds. The shared position provider attempts only the affected official SDK market/side, uses bounded foreground retries, and rejects late responses from superseded sessions or timed-out batches. The normal SDK position replaces the temporary **Details updating** card; no unsupported explicit-ID SDK API or production indexer override is used.

## Shared wallet data

Wagmi is a public-data integration only: no connectors, injected-provider discovery, persistent Wagmi storage, automatic reconnect, SSR connection hydration, or wallet-network synchronization is enabled. It introduces no paid service or new RPC endpoint. Privy/the explicit browser adapter still owns the selected account and all signing; the official SDK still owns protocol reads and unsigned transaction plans.

Before each balance batch, the reader probes the existing endpoint with `eth_chainId`. Native balance uses the standard public balance read; ERC-20 `balanceOf` calls use a shared multicall with per-token failure results. Raw balances remain exact `bigint` values. Missing reads stay unavailable instead of becoming zero. Move uses the canonical token addresses for the explicitly selected Ethereum/Base source.

Cache keys include the selected account, its wallet-network session, and the target read chain. Account/network changes cancel and remove old-session queries; cancellation checks prevent late responses from repopulating that session. Consumers share queries rather than creating a balance request per card. One foreground block watcher per actively observed chain polls every 12 seconds; active balance queries also have a 60-second fallback and stale-data refresh on focus/online resume. Background interval polling is disabled.

`ActionReview` invalidates the affected original wallet/chain alongside the existing post-confirm callback. Only a matching, included success/revert receipt permits invalidation; signatures and hashes alone do not. Partial routes refresh too because approvals and gas can change balances. If the following-block wait prevents the callback, receipt evidence can still invalidate the wallet cache without calling the page's protocol completion callback early. Refresh failures never rewrite transaction outcomes. The recovery coordinator accepts only receipt-verified reconciler results, groups by original chain, and deduplicates receipt events; local journal status cannot trigger a financial-state update.

Activity and recent-activity reads use the same receipt-backed refresh gate. A journal change from another tab rechecks bounded terminal history, while ordinary focus/online recovery remains pending-only. Overlapping triggers coalesce, and repeating an unchanged terminal result does not write another storage event. Account changes discard pending UI responses and close account-owned overlays.

## Deliberate exclusions

The product has no active service worker, Web Worker, runtime feature-flag service, telemetry pipeline, or speculative-plan cache. The Telegram provider unregisters a legacy `/sw.js` from older builds so a stale offline financial client cannot continue serving navigation; it never caches current protocol state.

The dependency graph may contain `ioredis` through third-party browser adapters and `workerd` through development-only Wrangler tooling. FxAeon does not import either, opens no Redis connection, and deploys no Worker runtime.

Privy's optional hCaptcha dependency remains available for authentication, but its loader is replaced at the webpack boundary with a no-telemetry script loader. No hCaptcha-owned Sentry client or DSN is shipped in the static app.

The launch UI is English-only. A locale may return only when the complete retained interface is translated and reviewed, including transaction review and recovery states.

## Transaction lifecycle

1. A page requests an official SDK read or transaction plan.
2. The client binds the result to the selected wallet address, supported chain, and current form inputs.
3. Validation checks target, selector, native value, approvals, nonce, and ordered route shape.
4. The route is simulated when the provider supports the ordered call set.
5. The user reviews the plan and approves each wallet step visibly.
6. The runner waits for a successful receipt before continuing, then waits one additional block.
7. The page rereads chain/SDK state and reconciles or clears its recovery journal.

Broadcast hashes become explorer links during step execution, before receipt completion. Each link retains its original chain/account context; approval and action states are separate. A confirmed position can appear by its verified mint ID before index discovery finishes, without claiming collateral/debt/valuation before the SDK supplies them. See the [post-transaction code study](post-transaction-ux.md).

Position management is a responsive master-detail workspace. The compact list preserves scannability and USD context; every row has a direct full-close entry, while Add, Reduce, Close, and Leverage remain distinct modes. Full close uses the SDK's close intent rather than disguising it as a 100% slider value. The common `ActionReview` boundary still rebuilds and simulates a fresh route before presenting approvals or opening the wallet.

Any rejection, revert, timeout, nonce drift, provider outage, or bridge-delivery mismatch produces an explicit unavailable/error state. The client never substitutes fabricated zeroes, PnL, liquidation values, transaction success, or bridge completion. If a display-price feed is unavailable or invalid, its USD label or chart degrades to an explicit unavailable state while on-chain amounts remain exact.
