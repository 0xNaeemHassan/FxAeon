# Official SDK scope contract

FxAeon exposes a deliberately narrow, reviewable surface from the official f(x) SDK. The references below are the pinned upstream snapshots used to define that surface:

- `AladdinDAO/fx-sdk-skill` — commit `e2c4a6085950a40f238bda1c9159305f6c8acf1f`
- `AladdinDAO/fx-sdk` — commit `53c0b9805a169e75ad375c92c241e1292b66405f`
- Installed package `@aladdindao/fx-sdk@1.0.5`, plus the reviewed short-pool correction, diagnostic-log removal, and exact debt-ratio packing fix in `patches/@aladdindao__fx-sdk.patch`

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

## Capability matrix

This matrix is the implementation contract for the locked surface. “Refresh” means a new read from the official SDK and chain after the action; local storage is never a source of financial truth.

| Method | Product action | Chain | Read/write | Required inputs | SDK output | Signing and route behavior | Expected refresh |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `getPositions` | View ETH/BTC long/short positions | Ethereum | Read | wallet, market, side | Position records with raw collateral/debt, leverage, and token metadata | No signing | Reload positions when Portfolio/Positions opens or after a position action |
| `increasePosition` | Open or add to a position | Ethereum | Write | market, side, position ID, wallet, leverage, input token, amount, slippage, audited route target | One or more ordered SDK routes | Each approval/action is explicitly signed; later steps wait for the prior receipt | Read positions after the route and next block |
| `reducePosition` | Reduce or close a position | Ethereum | Write | market, side, position ID, wallet, output token, amount, close flag, slippage, audited route target | One or more ordered SDK routes with minimum-output data | Ordered per-step wallet approval; stop on rejection, revert, timeout, or nonce drift | Read positions after the route and next block |
| `adjustPositionLeverage` | Change position leverage | Ethereum | Write | market, side, position ID, wallet, target leverage, slippage, audited route target | One or more ordered SDK routes | Explicit wallet approval for every returned step | Read positions after the route and next block |
| `depositAndMint` | Add long collateral and mint fxUSD | Ethereum | Write | market, position ID, wallet, collateral token, deposit amount, mint amount | Ordered transaction array with route details | Exact token approval when returned, then action; no later submission before receipt | Read positions after the route and next block |
| `repayAndWithdraw` | Repay fxUSD and/or withdraw long collateral | Ethereum | Write | market, position ID, wallet, repay amount, withdrawal amount, withdrawal token | Ordered transaction array with route details | Exact repayment approval when returned, then action; failure stops the route | Read positions after the route and next block |
| `getBridgeQuote` | Preview Ethereum/Base bridge fee | Ethereum or Base source | Read | source/destination chain, token key or reviewed OFT, amount, recipient, source RPC | Native and LayerZero token fee | No signing; quote is informational until a fresh route is built | Requote whenever bridge inputs or source RPC change |
| `buildBridgeTx` | Build a cross-chain bridge send | Ethereum or Base source | Write plan | source/destination chain, token, amount, recipient, optional refund address, source RPC | One source send transaction plus quote | Ethereum may prepend one exact approval; every step is signed in order; destination is separately GUID-verified | Read source receipt, then verify destination delivery from matching LayerZero events |
| `getFxSaveBalance` | View the wallet's fxSAVE shares/assets | Ethereum | Read | wallet | Share balance and optional underlying assets | No signing | Reload after every fxSAVE write and on Earn/Portfolio open |
| `getFxSaveConfig` | View fxSAVE vault details | Ethereum | Read | none | Supply, assets, cooldown, fee ratios, and threshold | No signing | Reload with the other Earn reads |
| `getFxSaveRedeemStatus` | View pending redemption/cooldown | Ethereum | Read | wallet | Pending shares, cooldown, redeemable time, completion flag | No signing | Reload after withdrawal/claim and on Earn open |
| `getFxSaveClaimable` | View claimable redemption preview | Ethereum | Read | wallet | Cooldown status plus fxUSD/USDC receive preview when available | No signing | Reload after withdrawal/claim and on Earn open |
| `getRedeemTx` | Claim a completed fxSAVE redemption | Ethereum | Write plan | wallet, optional receiver | Ordered redemption transaction array | Explicit wallet approval; only offered after canonical cooldown state is complete | Reload balance, redeem status, and claimable state after the route and next block |
| `depositFxSave` | Deposit USDC, fxUSD, or base-pool shares | Ethereum | Write | wallet, input token, amount, optional slippage | Ordered transaction array | Exact input-token approval when required, then action; each step is signed | Reload fxSAVE balance/status after the route and next block |
| `withdrawFxSave` | Queue or instantly redeem fxSAVE shares | Ethereum | Write | wallet, output token, share amount, optional instant flag and slippage | Ordered transaction array | Explicit approval/action steps; queued paths remain pending until canonical claim state | Reload balance, redeem status, and claimable state after the route and next block |

The matrix describes what the app can safely represent, not an independent protocol implementation. Raw calldata, contract addresses, and route fingerprints remain available only in the review disclosure for informed signing and recovery.
