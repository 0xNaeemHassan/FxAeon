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

There is no FxAeon server process. The ordinary web app and Telegram Mini App are equal launch surfaces over the same static artifact. Telegram adds host-specific authentication, theme, viewport, haptic, and navigation integration; it is not a wallet-authority boundary or a requirement. Privy supplies identity and wallet ownership when configured; a plain browser can instead connect an injected EIP-1193 wallet after an explicit user action. A selected address is never accepted from a query parameter, Telegram user record, or local storage.

## Module boundaries

- `src/lib/fx/sdk.ts` owns the single Ethereum `FxSdk` instance. This is intentional because the upstream SDK caches its first RPC client globally.
- `src/lib/fx/service.ts` normalizes only official SDK results into reviewable ordered plans. Plans are rebuilt on demand and invalidated when wallet, network, or inputs change.
- `src/lib/fx/validation.ts` and the transaction policy reject malformed senders, chains, destinations, selectors, values, approvals, and nonces.
- `src/lib/fx/runner.ts` simulates, requests one signature per step, awaits each receipt, stops on failure, waits one additional block, and triggers an authoritative reread.
- `src/lib/wallet/` is a narrow Privy/EIP-1193 adapter. It has no server credential or delegated authority.
- `src/lib/prices.ts` validates token quotes independently, rejects stale/low-confidence values, and uses a bounded, cached CoinGecko fallback for missing current prices. `src/lib/positionValuation.ts` retains exact accounting units for estimated USD equity and owned-token value. These helpers are not imported by the SDK façade, validation policy, or transaction runner.
- `src/lib/marketData.ts` validates keyless CoinGecko ETH/BTC history, rejects malformed, sparse, stale, or future-skewed series, and bounds chart density. It is display-only and remains separate from transaction planning.
- `ActionReview.tsx` is the common user-visible state machine from plan review through receipt confirmation.
- `src/lib/telegram.ts` treats Telegram as an optional host adapter and passes signed launch data only to Privy's authentication flow.

## State ownership

| State | Authoritative source |
| --- | --- |
| Positions, collateral, debt, and leverage | Ethereum through the official SDK |
| fxSAVE configuration, balance, cooldown, and claimability | Ethereum through the official SDK |
| Bridge source confirmation and LayerZero delivery | Matching `OFTSent`/`OFTReceived` GUIDs on Ethereum/Base |
| Selected address and signing permission | Privy wallet or explicitly connected browser wallet |
| Display-only USD prices | Validated DefiLlama current snapshot plus validated CoinGecko ETH/BTC history; never execution authority |
| Official light/dark theme and slippage preset | Versioned local storage |
| Pending hashes and bridge recheck context | Local recovery hint, revalidated from receipts and matching bridge events |
| Newly confirmed position IDs awaiting index discovery | Wallet-scoped receipt hints, revalidated against the canonical pool's mint event, receipt/block, and current NFT owner |

No application-owned persistent state remains, so no database is justified. Local storage can help restore a pending view after reload, but it cannot establish a financial fact.

Confirmed-position hints contain no financial values. At most 12 are retained per wallet for reload recovery, with a 24-hour restore lifetime. They remain hidden until chain/receipt/ownership verification succeeds. The shared position provider attempts only the affected official SDK market/side, uses bounded foreground retries, and rejects late responses from superseded sessions or timed-out batches. The normal SDK position replaces the temporary **Details updating** card; no unsupported explicit-ID SDK API or production indexer override is used.

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

Any rejection, revert, timeout, nonce drift, provider outage, or bridge-delivery mismatch produces an explicit unavailable/error state. The client never substitutes fabricated zeroes, PnL, liquidation values, transaction success, or bridge completion. If a display-price feed is unavailable or invalid, its USD label or chart degrades to an explicit unavailable state while on-chain amounts remain exact.
