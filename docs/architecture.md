# Architecture

## Runtime

```text
Telegram / browser
       │
       ▼
Next.js static export on Cloudflare Pages
       │
       ├── Privy React client
       │     └── user-owned wallet + explicit confirmation
       ├── pinned official f(x) SDK
       │     └── reads + ordered unsigned transaction plans
       └── Viem public clients
             ├── Alchemy Ethereum (chain 1)
             └── Alchemy Base (chain 8453)
```

There is no FxAeon server process. Telegram is a launcher, not a trusted wallet-authority boundary. Privy supplies identity and wallet ownership; a selected wallet address is never accepted from a query parameter, Telegram user record, or local storage.

## Client modules

- `src/lib/fx/sdk.ts` owns the single Ethereum `FxSdk` instance. This is intentional because the upstream SDK caches its first RPC client globally.
- `src/lib/fx/service.ts` normalizes only official SDK results into reviewable ordered plans.
- `src/lib/fx/validation.ts` and the transaction policy reject malformed senders, chains, destinations, selectors, values, approvals, and nonces.
- `src/lib/fx/runner.ts` simulates, requests one signature per step, awaits each receipt, stops on failure, waits another block, and triggers an authoritative reread.
- `src/lib/wallet` is a narrow Privy adapter. It has no server credential or delegated authority.
- `ActionReview.tsx` is the common user-visible state machine from planning through receipt.

## State ownership

| State | Authority |
|---|---|
| positions, collateral, debt, leverage | Ethereum via official SDK |
| fxSAVE config, balance, cooldown, claim | Ethereum via official SDK |
| bridge source receipt and LayerZero delivery | matching `OFTSent` / `OFTReceived` GUIDs on Ethereum/Base |
| selected address and signing permission | Privy wallet |
| theme and slippage preset | versioned local storage |
| pending hashes and bridge recheck context | local recovery hint, revalidated from receipts and matching LayerZero GUID events |

No application-owned persistent state remains, so no database is justified.

The launch UI is English-only. FxAeon does not expose the previous partial
locale selector because mixed-language transaction and review screens are not
an acceptable financial UX; a locale may return only when the complete
retained interface is translated and reviewed.

## Failure behavior

RPC, Goldsky, Privy, and bridge outages render an unavailable/error state. The
client uses the audited native FxRoute path and does not depend on a generic
quote aggregator. It never renders a fabricated zero, price, PnL, liquidation
value, transaction success, or bridge delivery claim.
