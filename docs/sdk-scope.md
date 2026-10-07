# Official SDK scope contract

FxAeon exposes a deliberately narrow, reviewable surface from the official f(x) SDK. The references below are the pinned upstream snapshots used to define that surface:

- `AladdinDAO/fx-sdk-skill` — commit `e2c4a6085950a40f238bda1c9159305f6c8acf1f`
- `AladdinDAO/fx-sdk` — commit `53c0b9805a169e75ad375c92c241e1292b66405f`
- Installed package `@aladdindao/fx-sdk@1.0.5`, plus the reviewed short-pool correction, diagnostic-log removal, exact debt-ratio packing fix, chain-bound shared RPC transport support, and independent pool-view read scheduling in `patches/@aladdindao__fx-sdk@1.0.5.patch`

The debt-ratio packing fix is a local correction, not a claim that the pinned
upstream commit contains it. The SDK combines two 60-bit integer limits into
one calldata field. Decimal arithmetic with its default precision can round
that combined integer and change the lower limit. The patch uses exact
`BigInt` packing, rejects invalid bounds, and preserves the requested limits
without widening slippage or changing global decimal precision. Regression
tests execute the installed helper in both ESM and CommonJS bundles.

The pinned contract references decode the minimum from bits 0–59 and the
maximum from bits 60–119 and enforce an inclusive range:
[long V2](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/periphery/facets/PositionOperateFlashLoanFacetV2.sol#L249-L255),
[short](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/periphery/facets/ShortPositionOperateFlashLoanFacet.sol#L287-L293),
and [60-bit decoder](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/common/codec/WordCodec.sol#L31-L41).
Zero and equal limits remain representable; this patch does not change the
contracts' separate full-close handling.

## Review preparation timing

The local SDK patch removes the unconditional 500 ms sleep after the final
chunk of `batchedMulticall`. It retains the original 50-call chunk size,
500 ms pause between chunks, result order, and failure placeholders. This is
a local scheduling correction, not a change to quote arithmetic, calldata,
nonce order, slippage, or the locked method surface. Both installed ESM and
CommonJS bundles have deterministic timing regression coverage. Subsequent
quote-search iterations may start sooner, so live RPC rate-limit behavior
still needs verification before release.

Embedded-wallet fee preparation gives the optional same-origin oracle a
200 ms head start, then tries the already-supported chain-native fee history
concurrently. Only a fully validated snapshot can win; a late source cannot
replace the reviewed snapshot. Existing quote expiry, fee ceilings, chain
verification, and final transaction simulations remain unchanged. Base uses
only its own RPC.

## Pool read scheduling

The local patch starts pool data, rate, and oracle view reads together, then
consumes their outcomes in the original order. Every rejection is observed
immediately; an early pool failure still returns without waiting for slower
siblings. Already-started reads finish under the existing transport limits.
The converter's nonpayable buy and sell simulations remain sequential, after
the views, and retain their separate execution contexts.

The installed SDK's viem 2.43.1 can combine the rate and oracle views into one
automatic multicall, alongside the explicit pool-data multicall. No read is
cached or removed, and no new atomic-block guarantee is implied: calls use
`latest`, so changing chain state can produce different values than a serial
schedule. Review validation and final transaction simulation remain required.
See the [controlled benchmark](performance/sdk-pool-read-waterfall.md) for
mock conditions and limitations; these are not live-provider latency claims.

## Protocol fee review data

The local SDK patch also preserves `PoolConfiguration.getPoolFeeRatio` results
already fetched during planning. It adds no RPC calls and changes no transaction
amounts, routes, calldata or signatures. The app validates the four raw ratios
(supply, withdraw, borrow, repay; precision `1e9`) and binds them to the quoted
pool and action router. Position operations use Router_Diamond's schedule;
Borrow operations use FxMintRouter's schedule. Missing or invalid metadata is
not interpreted as a zero fee.

Review shows the applicable **protocol fee rate**. A rate is not a fee amount:
flash-loan/conversion amounts cannot be replaced with the user's input balance.
For `depositAndMint`, when borrowing is the only charged leg, the exact reviewed
mint amount is the fee base and the app calculates `floor(amount * ratio / 1e9)`
in fxUSD units. This fee is deducted from the borrowed amount. Other cases show
rates until their chargeable amounts can be independently bound. Network gas,
DEX conversion costs and retained slippage are separate from this fee.

Source references at contracts commit `5e198e93657db008a57129e7eea21a996618f17f`:
[fee schedule](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/PoolConfiguration.sol#L258),
[long fee arithmetic](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/PoolManager.sol#L902),
[short fee arithmetic](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/short/ShortPoolManager.sol#L710),
and [mint amount forwarding](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/periphery/facets/PositionOperateFacet.sol#L128).

Rebalance/liquidation prices are not yet integrated. They require the pool's
live thresholds, oracle denomination, funding and band accounting; the documented
global LTV values must not be hardcoded. Neither the pinned SDK nor inspected
contracts exposes a per-position rebalancing opt-out. Extending read-only review
calculations is separate from introducing new transaction primitives.

## Locked public surface

The active product exposes exactly these 15 methods:

```text
getPositions
increasePosition
reducePosition
adjustPositionLeverage
depositAndMint
repayAndWithdraw
getBridgeQuote
buildBridgeTx
getFxSaveBalance
getFxSaveConfig
getFxSaveRedeemStatus
getFxSaveClaimable
getRedeemTx
depositFxSave
withdrawFxSave
```

Internal SDK files, aggregators, contracts, or experiments are not product capabilities. Adding a sixteenth method, custom trading primitive, scheduler, alert, analytics system, or protocol reimplementation requires an explicit scope decision; it must never enter through a routine dependency update.

Application reads pass through `apps/mini-app/src/lib/fx/readFacade.ts`, which
exposes only the approved read subset above. It applies a 12-second deadline
and rejects malformed SDK/indexer position records before they reach product
state. Product routes must not import `getFxSdk` for reads; write planners may
continue using the SDK adapter through the service boundary.

The app-owned position fallback is read-only code, not a sixteenth SDK method.
It reads the canonical pool `balanceOf` before the SDK index, keeps the index
as a fast path, and when its IDs are incomplete scans at most 4,096 `ownerOf`
IDs in batches of 128 with two concurrent batches under the shared 12-second
deadline. Its 128-entry cache stores candidate IDs only; ownership and
accounting are rechecked on every reuse. `canonicalPositionReader.ts` hydrates
fallback IDs using the pinned SDK 1.0.5 pool configuration, rate/FxRoute quotes,
and 18-decimal position accounting. BTC quotes compare both SDK FxRoute paths
and select the greatest output independently for buying and selling. Regression
coverage checks route selection and single-route failure. Protected browser
fork tests exercise all four market/side groups; their procedure and evidence
are described in [`testing.md`](testing.md). A fork harness may preload actual historical
`ownerOf` storage read-only before the browser build to avoid cold-fork
storage delay; this is functional setup, not a provider-performance benchmark.
All writes remain on the official SDK methods above.

## Capability matrix

This matrix is the implementation contract for the locked surface. “Refresh” means a new read from the official SDK and chain after the action; local storage is never a source of financial truth.

| Method | Product action | Chain | Read/write | Required inputs | SDK output | Signing and route behavior | Expected refresh |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `getPositions` | View ETH/BTC long/short positions | Ethereum | Read | wallet, market, side | Position records with raw collateral/debt, leverage, and token metadata | No signing | Reload positions when Portfolio/Positions opens or after a position action |
| `increasePosition` | Open or add to a position | Ethereum | Write | market, side, position ID, wallet, leverage, input token, amount, slippage, reviewed route target | One or more ordered SDK routes | Each approval/action is explicitly signed; later steps wait for the prior receipt | Read positions after the canonical receipt |
| `reducePosition` | Reduce or close a position | Ethereum | Write | market, side, position ID, wallet, output token, amount, close flag, slippage, reviewed route target | One or more ordered SDK routes with minimum-output data | Ordered per-step wallet approval; stop on rejection, revert, timeout, or nonce drift | Read positions after the canonical receipt |
| `adjustPositionLeverage` | Change position leverage | Ethereum | Write | market, side, position ID, wallet, target leverage, slippage, reviewed route target | One or more ordered SDK routes | Explicit wallet approval for every returned step | Read positions after the canonical receipt |
| `depositAndMint` | Add long collateral and mint fxUSD | Ethereum | Write | market, position ID, wallet, collateral token, deposit amount, mint amount | Ordered transaction array with route details | Exact token approval when returned, then action; no later submission before receipt | Read positions after the canonical receipt |
| `repayAndWithdraw` | Repay fxUSD and/or withdraw long collateral | Ethereum | Write | market, position ID, wallet, repay amount, withdrawal amount, withdrawal token | Ordered transaction array with route details | Exact repayment approval when returned, then action; failure stops the route | Read positions after the canonical receipt |
| `getBridgeQuote` | Preview Ethereum/Base bridge fee | Ethereum or Base source | Read | source/destination chain, token key or reviewed OFT, amount, recipient, source RPC | Native and LayerZero token fee | No signing; quote is informational until a fresh route is built | Requote whenever bridge inputs or source RPC change |
| `buildBridgeTx` | Build a cross-chain bridge send | Ethereum or Base source | Write plan | source/destination chain, token, amount, recipient, optional refund address, source RPC | One source send transaction plus quote | Ethereum may prepend one exact approval; every step is signed in order; destination is separately GUID-verified | Read source receipt, then verify destination delivery from matching LayerZero events |
| `getFxSaveBalance` | View the wallet's fxSAVE shares/assets | Ethereum | Read | wallet | Share balance and optional underlying assets | No signing | Reload after every fxSAVE write and on Earn/Portfolio open |
| `getFxSaveConfig` | View fxSAVE vault details | Ethereum | Read | none | Supply, assets, cooldown, fee ratios, and threshold | No signing | Reload with the other Earn reads |
| `getFxSaveRedeemStatus` | View pending redemption/cooldown | Ethereum | Read | wallet | Pending shares, cooldown, redeemable time, completion flag | No signing | Reload after withdrawal/claim and on Earn open |
| `getFxSaveClaimable` | View claimable redemption preview | Ethereum | Read | wallet | Cooldown status plus fxUSD/USDC receive preview when available | No signing | Reload after withdrawal/claim and on Earn open |
| `getRedeemTx` | Claim a completed fxSAVE redemption | Ethereum | Write plan | wallet, optional receiver | Ordered redemption transaction array | Explicit wallet approval; only offered after canonical cooldown state is complete | Reload balance, redeem status, and claimable state after the canonical receipt |
| `depositFxSave` | Deposit USDC, fxUSD, or base-pool shares | Ethereum | Write | wallet, input token, amount, optional slippage | Ordered transaction array | Exact input-token approval when required, then action; each step is signed | Reload fxSAVE balance/status after the canonical receipt |
| `withdrawFxSave` | Queue or instantly redeem fxSAVE shares | Ethereum | Write | wallet, output token, share amount, optional instant flag and slippage | Ordered transaction array | Explicit approval/action steps; queued paths remain pending until canonical claim state | Reload balance, redeem status, and claimable state after the canonical receipt |

The matrix describes what the app can safely represent, not an independent protocol implementation. Raw calldata, contract addresses, and route fingerprints remain available only in the review disclosure for informed signing and recovery.
