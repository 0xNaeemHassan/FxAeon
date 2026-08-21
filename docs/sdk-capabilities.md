# f(x) SDK capability matrix

FxAeon depends on `@aladdindao/fx-sdk` **1.0.5**. The installed package's TypeScript declarations are the authoritative SDK surface for this repository. An SDK method is not an end-user feature until FxAeon has supplied validation, identity binding, signer policy, simulation, idempotency, receipt tracking, UI, and tests.

The package exposes 15 public methods. All 15 are called by current server source; the rows below split overloaded methods by mode or chain so release status is not hidden behind a single check mark.

## SDK 1.0.5 methods

| SDK method/capability | FxAeon integration | User surface | Status |
|---|---|---|---|
| `getPositions` | Reads all wstETH/WBTC long/short combinations and normalizes token units | Telegram + Mini App portfolio | Live |
| `increasePosition` with `positionId=0` | Server quote and execution wrappers | Telegram + Mini App Trade | Live |
| `increasePosition` with existing `positionId` | Re-reads wallet ownership and current leverage before building | Mini App Positions | Live |
| `reducePosition` partial | Ownership read plus side/market-specific reduction-unit conversion | Telegram position card + Mini App Positions | Live |
| `reducePosition` full close | Standard manual, Mini App, and automation close path | Telegram, Mini App Positions, `/auto` worker | Live |
| `adjustPositionLeverage` | Fresh ownership read and existing-position route | Telegram position card + Mini App Positions | Live |
| `depositAndMint` | New/existing long collateral position through common executor | `/mint`, `/borrow`, Mini App Borrow | Live |
| `repayAndWithdraw` | Existing wallet-owned long-position route; Telegram repays only, while Mini App can combine repay and collateral release | `/repay`, Mini App Borrow | Live |
| `getFxSaveConfig` | Protocol totals, assets/share, cooldown, and instant-exit fee | `/save`, Mini App Earn | Live read |
| `getFxSaveBalance` | Shares/assets | `/save`, Mini App portfolio | Live read |
| `getFxSaveRedeemStatus` | Pending/cooldown state | `/save`, Mini App portfolio | Live read |
| `getFxSaveClaimable` | Claimability and receive preview | `/save claim`, `/claim`, Mini App Earn | Live read |
| `getRedeemTx` | Matured redemption transaction | Telegram + Mini App Earn | Live |
| `depositFxSave` with fxUSD | Ordered transaction route | Telegram + Mini App Earn | Live |
| `depositFxSave` with USDC | Ordered transaction route | Telegram + Mini App Earn | Live |
| `depositFxSave` with `fxUSDBasePool` | Ordered transaction route | Mini App Earn | Live |
| `withdrawFxSave` queued to fxUSD/USDC | `requestRedeem` cooldown route | Telegram + Mini App Earn | Live |
| `withdrawFxSave` instant to fxUSD/USDC | Instant router route with live protocol terms | Telegram + Mini App Earn | Live |
| `withdrawFxSave` to `fxUSDBasePool` | Direct fxSAVE ERC-4626 `redeem`; immediate Base Pool shares, no cooldown/claim | Mini App Earn | Live |
| `getBridgeQuote`, chain 1 → 8453 | Source-chain LayerZero quote | `/bridge`, Mini App Move | Live quote |
| `buildBridgeTx`, chain 1 → 8453 | ERC-20 approval when required, then OFT send | `/bridge` confirmation + Mini App Move | Operator-gated |
| `getBridgeQuote`, chain 8453 → 1 | Base-source LayerZero quote through `BASE_RPC_URL` | Mini App Move | Live quote when Base RPC is configured |
| `buildBridgeTx`, chain 8453 → 1 | Single Base OFT send; chain-scoped policy/executor | Mini App Move | Operator-gated |

The installed SDK does **not** expose FXN locking, gauge voting, reward claiming, limit-order signing/relay, TWAP, trailing stops, DCA, or batch execution as `FxSdk` methods.

## User-facing token matrix

The backend validates symbols, addresses, and decimals from `packages/shared/src/protocolTokens.ts`; the browser cannot submit an arbitrary token address.

| Workflow | wstETH market | WBTC market |
|---|---|---|
| Open/increase input | ETH, WETH, stETH, wstETH, USDC, USDT, fxUSD | WBTC, USDC, USDT, fxUSD |
| Long reduce/close output | ETH, WETH, stETH, wstETH, USDC, USDT, fxUSD | WBTC, USDC, USDT, fxUSD |
| Short reduce/close output | ETH, WETH, wstETH, USDC, USDT, fxUSD | WBTC, USDC, USDT, fxUSD |
| Deposit-and-mint collateral | ETH, WETH, stETH, wstETH | WBTC |
| Repay-and-withdraw output | ETH, WETH, stETH, wstETH | WBTC |

fxSAVE deposit and redemption support fxUSD, USDC, and `fxUSDBasePool`. fxUSD/USDC expose queued and instant modes; Base Pool output is a separate immediate direct ERC-4626 redemption, despite being represented to SDK 1.0.5 with `instant: false`. Bridge quote/build code supports 18-decimal fxUSD and fxSAVE between chain 1 and chain 8453, always to the same user wallet in current UI/API. Broadcast remains disabled by default and should not be described as production-ready until both directions have funded source-chain and destination-delivery evidence.

## FxAeon features outside `FxSdk`

| Capability | Implementation | Status |
|---|---|---|
| Limit-order EIP-712 prepare/submit/status/cancel data | Local viem wrapper around verified f(x) contracts and official relay | HTTP primitives only; no user signing UI |
| Price alerts | Database + CoinGecko poller + Telegram notification gate | Live, off-chain |
| Stop-loss/take-profit | Database + CoinGecko poller + standard full-close route | Live, off-chain trigger |
| Position-health warnings | SDK position reads + notification worker | Live, off-chain monitoring |
| fxUSD arbitrage signal | Market/NAV comparison | Read/notify only; no automatic trade |
| Wallet withdrawals | Native/ERC-20 transactions with intent-scoped recipient policy | Live |
| Speed up/cancel | EIP-1559 nonce replacement | Live when replacement metadata exists |
| PnL estimate | Observation snapshots + spot price | Informational estimate |

## Meaning of status

- **Live** means a current route reaches real reads or the central transaction executor.
- **Live quote** means a read-only SDK quote is wired; its dependent source-chain RPC must be configured.
- **Operator-gated** means source exists but normal deployments refuse broadcast until the disabled-by-default execution gate is explicitly enabled.
- **HTTP primitives only** means backend building blocks exist but there is no supported end-user workflow.
- **Not exposed/integrated** means the product must not imply completion.

For a money-moving capability to become live, require all of the following:

1. strict user input and token-unit validation;
2. Telegram-user or authenticated Mini App identity binding;
3. expiring intent/confirmation where interaction is asynchronous;
4. server-side route construction from current state;
5. verified contract targets and signer-policy coverage;
6. fail-closed ordered-route simulation;
7. server-derived fees and idempotent broadcast;
8. receipt/state persistence and honest partial-route recovery;
9. user-visible unavailable/failure/retry states;
10. unit, end-to-end, and mainnet-fork coverage appropriate to the risk.

See [Known gaps](GAPS.md) for the work still needed to make the product a complete mobile SDK gateway.
