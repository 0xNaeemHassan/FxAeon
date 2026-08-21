# User guide

FxAeon combines a Telegram chat interface with an embedded mobile Mini App. The execution wallet is a Privy embedded Ethereum wallet associated with the user's Telegram-linked Privy account. FxAeon stores its public address and delegation status; wallet creation, import, export, and key protection are handled by Privy.

## Before using funds

- FxAeon is not a bank, broker, custodian, or investment adviser.
- The application has not received an independent security audit.
- Current protocol actions use Ethereum mainnet unless the bridge flow explicitly names Base.
- Leveraged positions can be rebalanced or liquidated. FxAeon permits 1.1x to 7x long leverage and 1.1x to 3x short leverage.
- Quotes, PnL, gas, health, yield, and market data can change or become unavailable.
- An explicit confirmation is required for interactive transactions, but enabled automation can later execute a close when its threshold is crossed.
- Protocol contracts, oracles, bridges, Privy, RPC providers, relays, Telegram, and market-data providers remain external trust dependencies.

## Onboard a wallet

1. Open the Telegram bot and send `/start`.
2. Open **Set Up Wallet**.
3. Continue with Telegram in the Mini App.
4. Create a new embedded wallet or import an existing private key through Privy's client flow.
5. Optionally enable bot trading by granting the configured session signer.
6. Let the Mini App link the resulting wallet to the Telegram account.

The backend resolves the embedded wallet from Privy's Telegram-linked user record. Merely linking an external wallet as a login identity does not make that wallet the chat execution wallet.

### Bot-trading permission

The session-signer grant lets FxAeon's backend ask Privy to sign an allowed transaction without opening a wallet prompt for every action. It is required for chat execution, Mini App execution, automation, and transaction replacement.

Revoke it in **Settings → Wallet** whenever it is not needed. Revocation blocks new signing requests; it cannot undo a transaction already broadcast or a protocol action already confirmed.

## Fund the wallet

Use `/deposit`, **Move → Receive**, or **More → Receive assets** to copy the wallet address or display a QR code.

- Verify the entire address in the sending wallet.
- The receive screen is labeled for Ethereum. The same EVM address exists on Base, but always select and verify the intended network in the sending application.
- Keep ETH for gas, including token approvals.
- Deposit detection watches ETH, fxUSD, wstETH, WBTC, USDC, USDT, and WETH, but detection support does not mean every asset is valid collateral for every action.
- Telegram trade shortcuts use market-native units only: wstETH for the wstETH market and WBTC for WBTC. The Mini App also exposes the SDK-supported input-token matrix and labels the selected unit explicitly.

## Open a leveraged position

Use the Mini App **Trade** tab, bare `/trade` for a guided chat flow, or strict syntax:

```text
/trade wstETH long 3x 0.25
/trade WBTC short 2x 0.005
```

In Telegram syntax the final number is native collateral, not ETH, USD, or a generic token value. In the Mini App, choose the input asset explicitly. Review market, side, leverage, token/amount, slippage, route output, gas tier, and MEV mode.

In the Mini App, the backend builds, policy-checks, and simulates the exact route before review, then freezes that wallet-bound plan behind an opaque ticket for two minutes. Confirmation sends only that ticket and the chosen named fee tier; the server rechecks policy and simulates the frozen plan rather than silently substituting a new quote. The ticket ID is the idempotency key, so a double tap can only resolve the same transaction record. Chat confirmations instead reconstruct their action from the signed server intent.

After confirmation the executor enforces the UTC-day logical-action cap, derives fees, broadcasts each dependent step only after the previous receipt, and persists every step hash/status. `broadcast` means the result is still unknown, `partial` means an earlier step landed but a later one could not be broadcast, and `cancelled` means a same-nonce cancellation is known mined. Review every Activity hash before retrying a non-confirmed route.

## Manage a position

Use the Mini App **Positions** screen, `/portfolio`, `/positions`, or an asset close command. The Mini App supports add, reduce/close, and leverage adjustment. Telegram position cards provide:

- **Reduce**: close 25%, 50%, or 75% of the selected position.
- **Close**: close the full position.
- **Leverage**: adjust the target leverage through the SDK's existing-position route.
- **TP/SL**: open the matching `/auto` instructions.
- **Refresh**: read positions again from chain.

When adding to a position, the backend verifies that the position belongs to the authenticated wallet and preserves the SDK-reported current leverage. For partial reductions it converts the requested percentage into the units expected by that position type; a full close uses the SDK's close flag.

PnL is an estimate based on the first stored observation and available spot prices. It is not tax or accounting data. The portfolio hero values supported wallet tokens, position equity, and fxSAVE redeemable assets; it does not discover arbitrary ERC-20 holdings outside the supported registry. If any supported positive balance is unpriced or a required balance/position/savings read is incomplete, FxAeon shows the total as unavailable rather than dropping that component. fxUSD cash, position debt/collateral, and fxSAVE underlying require the live `FXUSD` feed; FxAeon does not assume a $1 peg.

## Borrow fxUSD

Use **More → Borrow fxUSD** in the Mini App for new or existing borrowing positions, or use Telegram to deposit collateral and mint fxUSD:

```text
/mint 1 1500 wstETH
/borrow 1 1500 wstETH
```

The market argument is optional and defaults to wstETH. Repay a specific long position:

```text
/repay wstETH 123 all
/repay WBTC 456 500
```

The Mini App also supports repay-only, collateral-withdraw-only, or combined repay-and-release actions on a selected wallet-owned long position. Minting creates debt and liquidation/rebalance risk. Read the preview and current protocol state; FxAeon does not calculate a safe borrowing plan for you.

## Use fxSAVE

Open the Mini App **Earn** tab or the Telegram dashboard with `/save` or `/earn`.

```text
/save 1000
/save deposit 500 usdc
/save withdraw 250
/save withdraw all instant
/save claim
```

- A numeric `/save withdraw` or `/redeem` amount is fxSAVE shares, not the expected fxUSD output. A normal withdrawal requests a queued redemption; claim it after the protocol cooldown with `/claim` or `/save claim`.
- An instant withdrawal uses the SDK's instant route and may include protocol fees and slippage.
- `/redeem <amount|all> [instant]` is another entry to withdrawal.
- The Mini App exposes fxUSD, USDC, and `fxUSDBasePool`. fxUSD/USDC can use queued or instant withdrawal. Selecting `fxUSDBasePool` with the non-instant mode calls the vault's ERC-4626 `redeem` directly and receives Base Pool shares immediately; it is not a queued request, has no cooldown, and does not need a later claim. Telegram commands expose fxUSD and USDC only.

Do not treat displayed pool values or yield as guaranteed.

## Withdraw assets

Use the guided `/withdraw` flow or strict syntax:

```text
/withdraw 0.1 ETH 0xRecipient
/withdraw 250 fxUSD 0xRecipient
```

Supported assets are ETH, fxUSD, wstETH, WBTC, and USDC. The recipient is stored in a short-lived, Telegram-user-bound server intent and passed to the signer policy as the only allowed external destination for that action.

Transfers are irreversible. Verify the address and network independently. FxAeon rejects a withdrawal to the same execution wallet because it has no effect.

## Alerts and automation

One-shot price alerts:

```text
/alert btc > 65000
/alert eth < 1500
/alert fxn +10%
/alerts
```

One-shot full-close automation:

```text
/auto sl wstETH long 2500
/auto tp WBTC short 60000
/auto
```

Automation is an off-chain polling service, not an on-chain conditional order. A rule depends on the bot process, database, fresh market data, RPC, wallet delegation, route availability, simulation, and timely Ethereum inclusion. Crossing a threshold does not guarantee a fill at that price. Rules apply to every matching position and close the full matching position through the same execution engine as a manual close.

## Limit orders and unsupported strategies

`/limit open|close ... at <price>` is a **preview only**. It validates and explains the intended trigger but does not ask the wallet to sign typed data, submit an order, or arm an off-chain rule. `/orders` can list order records already known to the backend. Authenticated maker-bound HTTP primitives exist for future integration, but they are not an end-user signing workflow.

FXN locking, veFXN/gauge voting, governance reward claims, TWAP, trailing stops, DCA, batch execution, and automated arbitrage transactions are not shipped. `/lock` and `/vote` return an unavailable explanation; `/claim` means only a matured fxSAVE redemption. `/arb` is an informational signal/notification, not an automatic trade.

## Bridge

```text
/bridge ETH Base 100 fxUSD
/bridge ETH Base 25 fxSAVE
```

The Mini App **Move** tab exposes fxUSD and fxSAVE in both Ethereum→Base and Base→Ethereum directions. FxAeon uses the SDK's LayerZero V2 OFT route and always sends to the same wallet address on the destination chain. Ethereum-source routes may need an ERC-20 approval before the OFT send; Base-source routes are a single OFT send.

Bridge broadcast is disabled by default. Setting `BRIDGE_EXECUTION_ENABLED=true` and configuring both Ethereum and Base RPC URLs removes the application gate, but does **not** prove production readiness. Operators should keep it off until both directions have funded source-chain fork/live evidence and the exact OFT target, Ethereum allowance, refund address, native fee/value, and destination delivery have been observed. Each enabled direction is built, policy-checked, simulated, fee-derived, signed, and receipted on its source chain. That source-chain receipt proves only submission to LayerZero; it does not guarantee an arrival time or destination-chain delivery. Telegram exposes only Ethereum→Base; Base→Ethereum is Mini App-only.

## Review history and pending transactions

- `/history` lists recent executor records and transaction links.
- Mini App **More → Activity** lists the authenticated wallet's recent executor records, every persisted route-step hash, and its receipt-derived status.
- `/speedup` replaces the latest recorded, still-pending transaction at the same nonce with higher EIP-1559 fees.
- `/cancel` attempts a zero-value self-send at that nonce.

Replacement is best-effort. A transaction already mined cannot be canceled, and a replacement may race the original.

## Disconnect and recover

- Export or manage the embedded wallet only through Privy's protected wallet controls.
- Revoke bot trading in Mini App settings.
- `/security` displays the stored delegation and configured signer-policy mode.
- Independently verify balances and transactions on Etherscan.
- If account data is incomplete, retry from a fresh Telegram launch and consult [Operations and troubleshooting](operations.md).
