# Architecture

## Runtime data flow

```text
Telegram / browser
       │
       ▼
Next.js static export on Cloudflare Pages
       │
       ├── Privy React client
       │     └── user-owned wallet and explicit confirmation
       ├── pinned official f(x) SDK
       │     └── protocol reads and ordered unsigned plans
       └── Viem public clients
             ├── Alchemy Ethereum (chain 1)
             └── Alchemy Base (chain 8453)
                    │
                    ▼
              Ethereum / Base / LayerZero
```

There is no FxAeon server process. Telegram is a launch surface, not a wallet-authority boundary. Privy supplies identity and wallet ownership; a selected wallet address is never accepted from a query parameter, Telegram user record, or local storage.

## Module boundaries

- `src/lib/fx/sdk.ts` owns the single Ethereum `FxSdk` instance. This is intentional because the upstream SDK caches its first RPC client globally.
- `src/lib/fx/service.ts` normalizes only official SDK results into reviewable ordered plans. Plans are rebuilt on demand and invalidated when wallet, network, or inputs change.
- `src/lib/fx/validation.ts` and the transaction policy reject malformed senders, chains, destinations, selectors, values, approvals, and nonces.
- `src/lib/fx/runner.ts` simulates, requests one signature per step, awaits each receipt, stops on failure, waits one additional block, and triggers an authoritative reread.
- `src/lib/wallet/` is a narrow Privy adapter. It has no server credential or delegated authority.
- `ActionReview.tsx` is the common user-visible state machine from plan review through receipt confirmation.
- `src/lib/telegram.ts` handles launch-context presentation and passes signed Telegram data only to Privy's authentication flow.

## State ownership

| State | Authoritative source |
| --- | --- |
| Positions, collateral, debt, and leverage | Ethereum through the official SDK |
| fxSAVE configuration, balance, cooldown, and claimability | Ethereum through the official SDK |
| Bridge source confirmation and LayerZero delivery | Matching `OFTSent`/`OFTReceived` GUIDs on Ethereum/Base |
| Selected address and signing permission | Privy wallet |
| Theme and slippage preset | Versioned local storage |
| Pending hashes and bridge recheck context | Local recovery hint, revalidated from receipts and matching bridge events |

No application-owned persistent state remains, so no database is justified. Local storage can help restore a pending view after reload, but it cannot establish a financial fact.

## Deliberate exclusions

The product has no active service worker, Web Worker, runtime feature-flag service, telemetry pipeline, or speculative-plan cache. The Telegram provider unregisters a legacy `/sw.js` from older builds so a stale offline financial client cannot continue serving navigation; it never caches current protocol state.

The dependency graph may contain `ioredis` through third-party browser adapters and `workerd` through development-only Wrangler tooling. FxAeon does not import either, opens no Redis connection, and deploys no Worker runtime.

Privy's optional hCaptcha dependency remains available for authentication, but its loader is replaced at the webpack boundary with a no-telemetry script loader. No hCaptcha-owned Sentry client or DSN is shipped in the static app.

The launch UI is English-only. A locale may return only when the complete retained interface is translated and reviewed, including transaction review and recovery states.

## Transaction lifecycle

1. A page requests an official SDK read or transaction plan.
2. The client binds the result to the selected Privy address, supported chain, and current form inputs.
3. Validation checks target, selector, native value, approvals, nonce, and ordered route shape.
4. The route is simulated when the provider supports the ordered call set.
5. The user reviews the plan and approves each wallet step visibly.
6. The runner waits for a successful receipt before continuing, then waits one additional block.
7. The page rereads chain/SDK state and reconciles or clears its recovery journal.

Any rejection, revert, timeout, nonce drift, provider outage, or bridge-delivery mismatch produces an explicit unavailable/error state. The client never substitutes fabricated zeroes, prices, PnL, liquidation values, transaction success, or bridge completion.
