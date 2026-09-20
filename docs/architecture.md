# Architecture

FxAeon ships two separate static sites. The Next.js app is used on the web and
as a Telegram Mini App. The independent landing site contains no wallet or
protocol integration.

```mermaid
flowchart LR
  B[Browser or Telegram] --> A[Static Next.js app]
  A --> S[Locked official f(x) SDK]
  A --> R[Public Ethereum and Base RPC]
  A --> P[Display-only market data]
  A --> W[Selected user wallet]
  S --> E[Ethereum]
  W --> E
  W --> BASE[Base]
  E <--> L[LayerZero]
  BASE <--> L
```

## Boundaries

- `apps/mini-app/src/lib/fx/` adapts the official SDK, validates reviewed
  transaction policy, and executes ordered requests through the selected
  wallet. The immutable method list is in [`../fx-scope.lock.json`](../fx-scope.lock.json).
- `apps/mini-app/src/lib/wallet/` handles the configured Privy wallet or an
  explicitly selected injected EVM wallet. It has no server signer.
- `apps/mini-app/src/lib/web3/` and `WalletDataProvider` share public native and
  token-balance reads. Alchemy Data API results can broaden display discovery;
  canonical RPC reads remain authoritative for supported assets.
- `portfolioValuation.ts` reconciles fresh canonical balances with expanded
  discovery and calculates a nonduplicated known-priced subtotal;
  `addressPresentation.ts` keeps compact wallet-address display consistent.
- `apps/mini-app/src/lib/` price and chart modules validate third-party display
  data. USD estimates and charts are never transaction inputs.
- `apps/landing/` builds independently to a static `dist/` directory.

Protocol reads, planning, and transaction execution run in the client. The only
server endpoint is the optional Pages Function at `/api/gas`, a read-only
Ethereum gas-price fallback. It cannot plan a protocol action or establish
financial state. There is no account database, delegated signer, or background
executor.

## Transaction lifecycle

The action review builds and simulates a route for the current input. While the
user reviews it, an idle refresh may replace the displayed summary. A review is
usable for up to 30 seconds and is bound to the selected wallet session and
signing-relevant inputs. The action executes that displayed route; the runner
rechecks policy and simulates immediately before each wallet request. If the
route is stale or the intent changed, the app refreshes the review and asks the
user to act again. There is no hidden confirm-time route substitution.

Every step requires wallet approval. The next step waits for the prior
transaction's receipt and canonical check. Rejection, revert, timeout, reorg, or
nonce mismatch stops the route. The app stores a scoped resume hint just before
the wallet request; a hint is not proof of submission. Hashes, receipts,
position ownership, and protocol state are revalidated from the selected chain.
Bridge source confirmation and destination delivery are tracked separately by
matching LayerZero messages.

## Source of truth

| Data | Authority |
| --- | --- |
| Positions, collateral, debt, and leverage | Ethereum through the official SDK and required canonical reads |
| fxSAVE balance, vault state, cooldown, and claimability | Ethereum through the official SDK |
| Bridge source and destination status | Ethereum/Base receipts and matching LayerZero events |
| Sender and signing permission | The currently selected wallet |
| Standard wallet balances | Chain-probed public RPC reads |
| Expanded token discovery | Partial display metadata; never treated as proof of balance |
| USD prices and charts | Validated display feeds; never used to plan or sign |
| Theme, slippage, and recovery hints | Local device storage; reread or revalidated before use |

Positions, Borrow, and Earn are Ethereum-based. Move supports the reviewed
`fxUSD` and `fxSAVE` routes between Ethereum and Base; Base is not a positions or
fxSAVE ledger.

Portfolio distinguishes unavailable data from zero. It shows a full USD total
only when all applicable values are available; when some prices are missing it
can show a known priced subtotal with an incomplete-state cue. Estimated
position value is collateral value minus debt when validated inputs are
available; it is not P&L, ROI, health, or liquidation value.

## User data

There is no account database. Local records are scoped recovery hints, not
financial truth or cross-device history. Unsigned drafts contain form values,
not executable calldata; they are kept separate from submitted transaction
records. See [`security.md`](security.md) for trust assumptions and
[`sdk-scope.md`](sdk-scope.md) for the protocol boundary.
