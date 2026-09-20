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
                                  ├── Alchemy Data API (display-only wallet discovery)
                                  │     └── Ethereum/Base token metadata, prices, and logos
                                  ├── Alchemy foreground WebSockets
                                  │     └── newHeads + wallet-filtered ERC-20 transfers
                                  └── Coinbase public market feeds
                                        ├── ETH/BTC ticks
                                        └── candle history with CoinGecko fallback
                                  └── Viem public clients
                                        ├── Alchemy Ethereum (chain 1)
                                        └── Alchemy Base (chain 8453)
                                                   │
                                                   ▼
                                         Ethereum / Base / LayerZero
```

There is no FxAeon application backend or server-side wallet authority. The ordinary web app and Telegram Mini App are equal launch surfaces over the same static artifact. A deployment may expose one optional, read-only Pages Function at `/api/gas`; it proxies only the fixed Ethereum gas-oracle request and cannot sign, plan protocol transactions, or establish financial state. Telegram adds host-specific authentication, theme, viewport, haptic, and navigation integration; it is not a wallet-authority boundary or a requirement. Privy supplies identity and wallet ownership when configured; a plain browser can instead connect an injected EIP-1193 wallet after an explicit user action. The public web entry introduces the product, and the app workspace opens Portfolio directly. Wallet connection, account switching, and disconnect stay in the app shell. `/login` is a standalone setup screen, not a prerequisite for ordinary navigation. A selected address is never accepted from a query parameter, Telegram user record, or local storage. Positions, Borrow, and fxSAVE remain Ethereum-authoritative; Move is the supported `fxUSD`/`fxSAVE` bridge between Ethereum and Base.

## Module boundaries

- `src/lib/fx/sdk.ts` owns the single Ethereum `FxSdk` instance. This is intentional because the upstream SDK caches its first RPC client globally.
- `src/lib/fx/service.ts` normalizes only official SDK results into reviewable ordered plans. Plans are rebuilt on demand and invalidated when wallet, network, or inputs change.
- `src/lib/fx/validation.ts` and the transaction policy reject malformed senders, chains, destinations, selectors, values, approvals, and nonces.
- `src/lib/fx/runner.ts` simulates, requests one signature per step, records submitted → included → confirming → confirmed, rechecks receipt block identity at one canonical confirmation by default, stops on failure/reorg, and triggers an authoritative reread immediately after confirmation.
- `src/lib/fx/readFacade.ts` is the application-owned read boundary for the approved SDK subset. Each SDK/indexer read has a 12-second deadline; position records are shape-checked, and normal discovery verifies every ID with canonical pool `ownerOf` before display.
- `src/app/trade/directPositionDiscovery.ts` reads each pool's canonical NFT `balanceOf` before the SDK index. An incomplete fast result falls back to at most 4,096 `ownerOf` candidates in batches of 128 with two concurrent batches under the shared 12-second deadline; its 128-entry cache stores candidate IDs only and rechecks current ownership. A cold-fork check reached that deadline after a canonical mint/owner read; browser owner storage preloading is read-only functional setup, not a provider-performance claim.
- `src/app/trade/canonicalPositionReader.ts` is a read-only adapter for the pinned SDK 1.0.5 pool config, rate/FxRoute quotes, and 18-decimal position accounting. It is used only to hydrate IDs found by the bounded fallback; its 10/10 unit coverage does not establish fork parity until the pending protected run.
- `src/lib/wallet/` is a narrow Privy/EIP-1193 adapter. It has no server credential or delegated authority.
- `src/lib/fx/config.ts` accepts only the reviewed HTTPS Alchemy host and `/v2/<key>` path for Ethereum or Base. Explicit local-fork builds accept localhost URLs only; `clients.ts` probes `eth_chainId` at financial planning, signing, and recovery boundaries before treating the endpoint as the expected chain.
- `WalletDataProvider.tsx` and `src/lib/web3/` share standard native/ERC-20 balance reads through pinned Wagmi `3.7.7` and TanStack Query `5.102.8`. They reuse the existing Viem public clients, not another wallet or RPC service. Alchemy Data discovery broadens the asset list but never overrides an exact canonical read.
- `src/lib/prices.ts` validates token quotes independently, rejects stale/low-confidence values, and uses bounded, cached single-contract CoinGecko fallback requests with adaptive rate-limit retry/backoff for missing current prices. Normal market context has no source badge or duplicate spot/chart price; provenance is kept in technical documentation rather than in the action surface. `src/lib/positionValuation.ts` retains exact accounting units for estimated position value and owned-token value. These helpers are not imported by the SDK façade, validation policy, or transaction runner.
- `src/lib/fxSaveUnits.ts` keeps the SDK's fxSAVE share/base-pool-share units explicit and normalizes the SDK's omitted underlying conversion for a verified zero-share balance to exact `0n`; a missing conversion for nonzero shares remains unavailable.
- `src/lib/marketData.ts` validates keyless CoinGecko history, rejects malformed, sparse, stale, or future-skewed series, and bounds chart density. `src/lib/liveMarket.ts` adds anchored Coinbase ticks and candles with strict freshness checks and fallback. These feeds are display-only and remain separate from transaction planning.

The keyless CoinGecko contract-price endpoint returned HTTP 400 / error 10012
for a multi-address request during local browser verification on September 13,
2026; a single fxUSD address returned HTTP 200. The authenticated
[API reference](https://docs.coingecko.com/demo/reference/simple-token-price)
has different limits. The fallback uses one address per request, deduplicates
ETH/WETH, caches results for one minute, and shares an eight-second request
budget. A provider failure stops the remaining requests; HTTP 429 also honors
`Retry-After` with a minimum two-minute backoff.
- `ActionReview.tsx` is the common user-visible, route-stable in-card state machine from read-only live preview through receipt confirmation. With valid connected inputs it prepares debounced facts without opening the wallet; the primary action performs a final rebuild and simulation before each wallet step. A material route change returns updated details inline and requires another explicit action. The component exposes human-readable facts and raw transaction disclosure before the wallet prompt, and keeps the final action rail above fixed navigation. Any long details scroll inside the review surface; the product page itself does not require scrolling to reach its primary action.
- `src/lib/transactionState.ts` defines conservative empty/25%-fraction/2x defaults for transaction form resets. Positions, Borrow, Trade, Earn, and Move call their local context-change handlers when a wallet, chain, market, side, position, token, bridge direction/mode, or recipient identity changes. Those handlers clear dependent inputs and remount `ActionReview`, so a prepared route cannot survive an identity change.
- `src/lib/telegram.ts` treats Telegram as an optional host adapter and passes signed launch data only to Privy's authentication flow. The official bridge loads before application scripts as Telegram specifies, while bridge absence never gates public routes. Configured builds open Privy's enabled login methods in both browser and Telegram contexts; seamless Telegram authentication additionally requires dashboard enablement. Provider readiness queues the user's intent, but a missing Telegram payload does not block email or external-wallet login. Builds without Privy retain explicit EIP-6963 browser-wallet discovery and provider selection.
- Transaction details are route-stable in-card surfaces: the details body can scroll internally while the wallet-action rail remains visible above app navigation. `components/review/` owns focus containment, progress announcements, execution-result copy, and Telegram-aware explorer links; route forms remain orchestration only. Documentation and an expanded mobile Trade chart are the intentional scrollable exceptions.

## Deployment topology

FxAeon has two independent Cloudflare Pages projects. `fxaeon-landing` serves
the wallet-free marketing site from `apps/landing/dist` at
[fxaeon.xyz](https://fxaeon.xyz/). The existing `fxaeon` project serves the static Next.js
financial app from `apps/mini-app/dist` at [fxaeon.com](https://fxaeon.com/),
with `/portfolio` retained as a compatibility route. The financial workflow
waits for the native Pages deployment check, validates the deployment's public
Privy configuration, and then synchronizes the Telegram menu to
`https://fxaeon.com/`. The landing site has no Privy or wallet configuration and
must not share the financial project's deployment variables or Pages project.

## External integration evidence

The integration boundaries below are based on the provider and protocol references inspected for this revision. They describe what an integration may return, not an authority granted to that integration.

- **Alchemy wallet discovery:** the [Tokens By Wallet endpoint](https://www.alchemy.com/docs/data/portfolio-apis/portfolio-api-endpoints/portfolio-api-endpoints/get-tokens-by-address) accepts a wallet plus network list and can return native/ERC-20 balances, metadata, logos, and prices. Its multichain response can be HTTP 200 with top-level `error.partialErrors`, and an individual token can carry its own `error`. `walletAssets.ts` therefore treats the response as partial discovery data, validates each wallet/network/address/balance, allowlists Alchemy logo URLs, and merges exact canonical RPC reads for supported assets. It never turns a missing or failed indexed row into zero.
- **Alchemy realtime:** Alchemy documents `eth_subscribe` over `wss://` for [`newHeads`](https://www.alchemy.com/docs/reference/newheads) and topic-filtered [`logs`](https://www.alchemy.com/docs/reference/logs), and recommends [narrow filters and small subscription payloads](https://www.alchemy.com/docs/reference/subscription-api). `realtimeChain.ts` uses one foreground subscription set per active chain for block heads and wallet-filtered ERC-20 `Transfer` logs. Events only trigger a bounded foreground refresh; receipts and canonical reads remain authoritative, including when `newHeads` reports a reorganization.
- **Etherscan gas fallback:** the [Gas Oracle API](https://docs.etherscan.io/api-reference/endpoint/gasoracle) is API v2 and requires `chainid`, `module=gastracker`, and `action=gasoracle`. The optional `/api/gas` Pages Function fixes those values to Ethereum (`chainid=1`), keeps the API key in a Pages Secret, parses the decimal Gwei recommendation into bounded wei, and may return a short-lived stale cache during an upstream outage. It is display-only; per-transaction `eth_estimateGas` and the configured chain RPC are still required for route estimates, and Base has no Etherscan fallback.
- **f(x) SDK:** the [official `fx-sdk-agent` reference](https://github.com/AladdinDAO/fx-sdk/blob/main/skills/fx-sdk-agent/SKILL.md) documents the 15 supported methods, one reusable `FxSdk`, ordered `txs`, receipt waits between steps, and a post-route block before rereading state. FxAeon keeps those method and ordering constraints, then applies its stricter reviewed-route validation and one-confirmation runner by default; deeper confirmation depth is an explicit option. The read-only canonical position adapter is app code, not an additional public SDK method; all writes remain on the official SDK path. The [official f(x) protocol docs](https://fxprotocol.gitbook.io/fx-docs) remain protocol context; they do not replace the pinned SDK or client validation boundary.
- **Telegram deployment boundary:** `scripts/sync_telegram_bot.mjs` talks only to the fixed `https://api.telegram.org` host, validates the Mini App URL against the approved HTTPS FxAeon origins without credentials, ports, queries, or fragments, clears the default command list because no command handler exists, and performs bounded writes followed by exact readbacks. A timeout, API failure, or readback mismatch stops synchronization; the bot token remains a protected deployment secret.

## State ownership

| State | Authoritative source |
| --- | --- |
| Positions, collateral, debt, and leverage | Ethereum through the official SDK, with bounded canonical pool/rate/quote reads for direct discovery fallback |
| fxSAVE configuration, balance, cooldown, and claimability | Ethereum through the official SDK |
| Bridge source confirmation and LayerZero delivery | Matching `OFTSent`/`OFTReceived` GUIDs on Ethereum/Base |
| Selected address and signing permission | Privy wallet or explicitly connected browser wallet |
| Native/ERC-20 wallet balances | Exact chain-probed public RPC reads through Wagmi; TanStack Query is an in-memory cache, not authority |
| Expanded wallet asset discovery | Alchemy Data API metadata/prices are display-only and partial; canonical reads win for supported tokens |
| Display-only USD prices | Validated DefiLlama current snapshot, cached single-contract CoinGecko requests for missing current token quotes, plus validated ETH/BTC history; never execution authority |
| Official, neutral-dark, and light themes and slippage preset | Versioned local storage |
| Pending hashes and bridge recheck context | Local recovery hint, revalidated from receipts and matching bridge events |
| Unsigned review drafts | Wallet/chain/action-scoped local hint containing validated form inputs only; never executable calldata and never a cross-device promise |
| Receipt-backed position IDs awaiting SDK discovery | Wallet-scoped receipt hints, revalidated against the canonical pool's mint event, receipt/block, and current NFT owner |

No application-owned persistent state remains, so no database is justified. Local storage can help restore a pending view after reload, but it cannot establish a financial fact.

Receipt-backed pending-position cards contain no financial values until SDK hydration. At most 12 are retained per wallet for reload recovery, with a 24-hour restore lifetime. After receipt, block, and ownership checks, a card identifies the market, side, and position ID, keeps position value, collateral, and debt in loading states, and links to the transaction while SDK discovery runs. The shared position provider attempts only the affected official SDK market/side, uses bounded foreground retries, and rejects late responses from superseded sessions or timed-out batches; no unsupported explicit-ID SDK API or production indexer override is used.

## Shared wallet data

Wagmi is a public-data integration only: no connectors, injected-provider discovery, persistent Wagmi storage, automatic reconnect, SSR connection hydration, or wallet-network synchronization is enabled. It introduces no paid service or new RPC endpoint. Privy/the explicit browser adapter still owns the selected account and all signing; the official SDK still owns protocol reads and unsigned transaction plans.

Before each balance batch, the reader probes the existing endpoint with `eth_chainId`. Native balance uses the standard public balance read; ERC-20 `balanceOf` calls use a shared multicall with per-token failure results. Raw balances remain exact `bigint` values. Missing reads stay unavailable instead of becoming zero. Move uses the canonical token addresses for the explicitly selected Ethereum/Base source.

Cache keys include the selected account, its wallet-network session, and the target read chain. Account/network changes cancel and remove old-session queries; cancellation checks prevent late responses from repopulating that session. Consumers share queries rather than creating a balance request per card. Each active chain gets one foreground Alchemy WebSocket for `newHeads` and wallet-filtered ERC-20 transfers. When the socket is unavailable, bounded foreground polling keeps the surface current; background interval polling and hidden/offline sockets are disabled. Focus/online resume performs a stale refresh.

Asset and position demand is route- and consumer-driven. Portfolio owns expanded assets, pulse, and positions; Trade, Borrow, and Positions own pulse and positions; Earn and Move own only exact reads. Shell, History, settings, docs, QR, and other informational routes keep those feeds cold. The global wallet profile registers expanded-assets, pulse, and positions demand only while its drawer is open, so opening it remains useful without making a closed informational route poll. Market history/candle reads use a 90-second in-memory cache, share concurrent requests by market/range, and retry only after a visible/online foreground signal when stale or unavailable; collapsed mobile charts do not start a read.

`ActionReview` invalidates the affected original wallet/chain alongside the existing post-confirm callback. Only a matching, included success/revert receipt permits invalidation; signatures and hashes alone do not. Partial routes refresh too because approvals and gas can change balances. If confirmation waiting prevents the callback, receipt evidence can still invalidate the wallet cache without calling the page's protocol completion callback early. Refresh failures never rewrite transaction outcomes. The recovery coordinator accepts only receipt-verified reconciler results, groups by original chain, and deduplicates receipt events; local journal status cannot trigger a financial-state update.

History and recent-history reads use the same receipt-backed refresh gate. It presents Signature required, Submitted, Confirming, Completed, Failed, and Cancelled states. A signature-required draft reopens the exact wallet/chain/action-scoped review without storing private keys or executable calldata; restoring it never signs automatically. A journal change from another tab rechecks bounded terminal history, while ordinary focus/online recovery remains pending-only. Connecting a wallet or refreshing facts never opens a transaction prompt by itself. Overlapping triggers coalesce, and repeating an unchanged terminal result does not write another storage event. Account changes discard pending UI responses and close account-owned overlays.

## Deliberate exclusions

The product has no active service worker, Web Worker, runtime feature-flag service, or telemetry pipeline. Trade may keep one short-lived, session-local in-memory route prefetch to make inline action facts feel immediate; it is keyed to the exact wallet, inputs, bounds, slippage, and block, is never persisted, and is always rebuilt and simulated before signing. The Telegram provider unregisters a legacy `/sw.js` from older builds so a stale offline financial client cannot continue serving navigation; it never caches current protocol state.

The dependency graph may contain `ioredis` through third-party browser adapters and `workerd` through development-only Wrangler tooling. FxAeon does not import either, opens no Redis connection, and deploys no Worker runtime.

Privy's optional hCaptcha dependency remains available for authentication, but its loader is replaced at the webpack boundary with a no-telemetry script loader. No hCaptcha-owned Sentry client or DSN is shipped in the static app.

The launch UI is English-only. A locale may return only when the complete retained interface is translated and reviewed, including transaction review and recovery states.

## Transaction lifecycle

1. The page stays in **Edit** until its inputs are valid. With a connected wallet, it may request a debounced, read-only official SDK read or transaction plan for inline **Live preview** facts; this never opens a wallet.
2. The client binds the preview to the selected wallet address, supported chain, and current form inputs.
3. The primary action performs a final route rebuild and validates target, selector, native value, approvals, nonce, and ordered route shape against current state.
4. The route is simulated when the provider supports the ordered call set. If material terms changed from the inline facts, the updated details stay in place and require another explicit action.
5. After that explicit action succeeds, the wallet enters **Awaiting signature**; every wallet step remains a visible, explicit approval. Connecting, History restoration, and refreshes never open a transaction prompt by themselves.
6. After broadcast the runner records **Submitted**, then **Included** and **Confirming**, rechecks the receipt and block head until one canonical confirmation by default, and only then permits the next route step or **Confirmed** terminal state. Deeper confirmation depth and an extra post-read block are explicit options. Reorgs return the step to pending/unverified; rejection and revert produce **Failed**, while a user-aborted local draft can be **Cancelled**.
7. The page rereads chain/SDK state and reconciles or clears its recovery journal.

Broadcast hashes become explorer links during step execution, before receipt completion. Each link retains its original chain/account context; approval and action states are separate. A receipt-backed position card can appear with its mint ID before SDK discovery finishes; position value and details remain loading until the SDK supplies them. See the [post-transaction code study](post-transaction-ux.md).

Position management is a responsive master-detail workspace. The compact list preserves scannability and USD context; every row has a direct full-close entry, while Add, Reduce, Close, and Leverage remain distinct modes. Full close uses the SDK's close intent rather than disguising it as a 100% slider value. The common `ActionReview` boundary still rebuilds and simulates a fresh route before presenting approvals or opening the wallet.

Any rejection, revert, timeout, nonce drift, provider outage, or bridge-delivery mismatch produces an explicit unavailable/error state. The client never substitutes fabricated zeroes, PnL, liquidation values, transaction success, or bridge completion. If a display-price feed is unavailable or invalid, its USD label or chart degrades to an explicit unavailable state while on-chain amounts remain exact.

Transaction forms are fail-closed across identity changes: values entered for one account, chain, position, market, token, or route direction are never silently reused for another. Context switches clear amounts and route-specific fields, restore conservative defaults, invalidate any prepared review, and leave the user to make an explicit new selection.
