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

The local SDK patch replaces the unconditional 500 ms sleep after each chunk
of `batchedMulticall` with pacing: a chunk starts only once 500 ms have passed
since the previous chunk ended, including a chunk from an earlier call. A
quote search, which calls `batchedMulticall` up to ten times in a row, keeps
the original spacing between every request; a one-off read no longer sleeps
after its last chunk. It retains the 50-call chunk size, result order, and
failure placeholders. This is a local scheduling correction, not a change to
quote arithmetic, calldata, nonce order, slippage, or the locked method
surface. Both installed ESM and CommonJS bundles have deterministic timing
regression coverage.

Embedded-wallet fee preparation gives the optional same-origin oracle a
200 ms head start, then tries the already-supported chain-native fee history
concurrently. Only a fully validated snapshot can win; a late source cannot
replace the reviewed snapshot. When an approval outlives the quote, the
signing-time refresh re-prices from the reviewed snapshot's own source, since
the oracle and the RPC compute tips differently. Existing quote expiry, fee ceilings, chain
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

## Position brake

Position cards show how far the market can move before a position reaches its
pool's rebalance point, the f(x) "liquidation brake". This is app-owned
read-only code (`apps/mini-app/src/app/trade/positionBrakeReader.ts`), not a
sixteenth SDK method: it signs nothing and adds no transaction primitive. The
fx-sdk 1.0.5 bundle contains these pool views without exporting them, so the
app keeps a minimal ABI that a unit test compares with the bundle.

While a card is shown, each verified position refresh (each Ethereum block
while realtime updates run, and on focus) makes one multicall of every
position's `getPositionDebtRatio(id)` and each pool oracle's `getPrice()`, so
ratios and prices come from the same block. Each pool's `getRebalanceRatios()`,
`getLiquidateRatios()` and `priceOracle()` are read from the pool and cached
for 60 seconds. No threshold, oracle address or documented LTV is hardcoded.
Facts at contracts commit `5e198e93657db008a57129e7eea21a996618f17f`:

- `getPositionDebtRatio` returns rawDebts / (anchor price × rawColls) with 1e18
  precision, and 0 without collateral
  ([PositionLogic.sol](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/pool/PositionLogic.sol#L45-L52)).
  Its `getPosition` applies the tick tree's rebalance and redeem ratios and the
  debt and collateral indexes
  ([#L27-L43](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/pool/PositionLogic.sol#L27-L43)).
  Funding is folded into the collateral index only when the pool next updates
  it ([long](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/pool/AaveFundingPool.sol#L96-L118),
  [short](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/short/ShortPool.sol#L104-L127)).
- The thresholds are the first values of `getRebalanceRatios()` and
  `getLiquidateRatios()` (1e18); the second values are bonus ratios (1e9)
  ([PoolStorage.sol](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/pool/PoolStorage.sol#L360-L390)).
- Rebalancing and liquidation compare a tick's debt ratio at the oracle's
  minimum price and act once it is at or above the threshold
  ([rebalance](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/pool/BasePool.sol#L203-L226),
  [batch rebalance](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/pool/BasePool.sol#L267-L302),
  [liquidate](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/pool/BasePool.sol#L335-L367)).
  A rebalance brings the tick back to the rebalance ratio
  ([#L539-L556](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/pool/BasePool.sol#L539-L556)).
  The card rescales the anchor-priced ratio by anchor / minimum price, rounded
  up, which is never looser. Mainnet reads on 9 October 2026 put that factor
  between 1.000003 and 1.0022 across the four pools.
- Oracle prices use the pool's own units (1e18). ETH long collateral is
  accounted in stETH, scaled from wstETH by the PoolManager's rate provider
  ([PoolManager.sol](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/core/PoolManager.sol#L1053-L1063)),
  and priced as Curve's stETH/ETH EMA × Chainlink ETH/USD
  ([StETHPriceOracle.sol](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/price-oracle/StETHPriceOracle.sol#L34-L42)).
  Short pools hold fxUSD and owe the volatile asset, so their inverse oracles
  quote debt per dollar and their minimum is the inverse of the maximum USD
  price ([InverseWstETHPriceOracle.sol](https://github.com/AladdinDAO/fx-protocol-contracts/blob/5e198e93657db008a57129e7eea21a996618f17f/contracts/price-oracle/InverseWstETHPriceOracle.sol#L22-L32)).

With r the rescaled ratio and R and L the pool's rebalance and liquidation
ratios, a long reaches the rebalance point after a fall of 1 − r/R and a short
after a rise of R/r − 1; liquidation uses L. The live market quote taken when r
is read anchors the price at that point (P × r/R for a long, P × R/r for a
short), and the distance is recomputed from the current live quote, so the bar
fill and line move between chain reads. Percentages round down to whole
percent, showing the smaller distance, and prices round toward today's price.
A position without debt shows no brake. Reaching R, on chain or by the live
estimate, shows "At the rebalance point"; reaching L, "At the liquidation
point". A failed first read shows no line or marker; a later failed refresh
keeps the last read for at most two minutes. Without a fresh live quote the
line keeps the distance measured at the read and names no price.

Every figure is an estimate (≈). The oracle (Chainlink and on-chain spot
sources, the stETH/ETH and WBTC/BTC pegs, the wstETH rate) and the Coinbase
quote differ; a pool acts on a tick's combined ratio, which can differ slightly
from the position's own (ticks are 0.15% apart); and funding accrues between
pool updates. Neither the pinned SDK nor inspected contracts exposes a
per-position rebalancing opt-out. Extending read-only review calculations is
separate from introducing new transaction primitives.

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
