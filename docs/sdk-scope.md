# Official SDK scope contract

Authoritative upstream snapshots:

- `AladdinDAO/fx-sdk-skill` `e2c4a6085950a40f238bda1c9159305f6c8acf1f`
- `AladdinDAO/fx-sdk` `53c0b9805a169e75ad375c92c241e1292b66405f`
- installed package `@aladdindao/fx-sdk@1.0.5` plus the exact upstream short-pool correction in `patches/@aladdindao__fx-sdk.patch`

The active public contract is exactly:

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

Internal SDK files, aggregators, contracts, or experiments are not product capabilities. Adding a sixteenth method, custom trading primitive, scheduler, alert, analytics system, or protocol reimplementation requires a new scope decision; it must never enter through a routine SDK update.

