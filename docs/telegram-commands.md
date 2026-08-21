# Telegram command reference

Commands are registered in `apps/bot/src/main.ts`. A command can be registered without offering on-chain execution, so every row includes an explicit status.

- **Live**: reaches a current read or transaction path.
- **Gated**: implemented, but broadcast requires an operator flag.
- **Preview**: validates/displays intent but does not create the advertised on-chain object.
- **Unavailable**: responds honestly that execution is not shipped.

Most money-moving commands require onboarding, active bot-trading delegation, sufficient ETH for gas, a working Ethereum RPC, and an explicit confirmation. Automation is the exception: arming the rule is explicit, then its worker may execute later.

## Wallet and account

| Command | Status | Behavior |
|---|---|---|
| `/start` | Live | Onboard/reconnect and handle trade deep links |
| `/deposit` | Live | Show Ethereum address/QR and enable one-shot deposit detection |
| `/withdraw` | Live | Guided ETH/ERC-20 withdrawal |
| `/withdraw <amount> <token> <address>` | Live | Strict withdrawal preview; token is ETH, fxUSD, wstETH, WBTC, or USDC |
| `/settings` | Live | Show language, slippage, MEV, oracle, staleness, and local intent-parser settings |
| `/settings lang <locale>` | Live | `en`, `zh-CN`, `ko`, `ja`, `ru`, `es`, `tr`, or `pt` |
| `/settings slippage <percent>` | Live | More than 0% and at most 2% |
| `/settings mev on\|off` | Live | Flashbots private broadcast or public broadcast |
| `/settings oracle <0.1-5.0>` | Live | Store oracle-divergence alert threshold in percent |
| `/settings staleness <10-1440>` | Live | Store Chainlink staleness threshold in minutes |
| `/settings ai on\|off` | Live | Enable/disable the local rule-based natural-language parser; no external AI model call |
| `/security` | Live | Delegation/policy state, revoke entry, and data export |
| `/refer` | Live | Invite link and linked-account count; no reward or payout is offered |
| `/help` | Live | In-bot command summary |

## Leveraged positions

| Command/action | Status | Behavior |
|---|---|---|
| `/trade` | Live | Guided market → side → leverage → native amount flow |
| `/trade <market> <long\|short> <leverage>x <amount>` | Live | Example: `/trade wstETH long 3x 0.25` |
| `/longBTC`, `/longETH`, `/shortBTC`, `/shortETH` | Live | Asset/side-specific guided flows |
| `/longBTC 0.005 2x` | Live | Strict shortcut; ETH shortcuts use wstETH amounts |
| `/close`, `/closeBTC`, `/closeETH` | Live | Find on-chain positions and enter close confirmation |
| `/portfolio` | Live | On-chain positions, estimated PnL, recent closes, and action buttons |
| `/positions`, `/pnl`, `/wallet` | Live aliases | Portfolio view |
| `/balance`, `/position` | Live | Portfolio-oriented summaries |
| Position **Reduce** | Live | Close 25%, 50%, or 75% |
| Position **Leverage** | Live | Adjust to an available target leverage |
| Position **TP/SL** | Live handoff | Show matching `/auto` syntax |
| Increase an existing position | Mini App handoff | Use **Trade → Positions → Add**; chat has no dedicated callback |

Trade and shortcut amounts are market-native: wstETH for wstETH and WBTC for WBTC. Fiat, plain ETH-as-wstETH, and alternate token suffixes are rejected.

## Borrowing and fxSAVE

| Command | Status | Behavior |
|---|---|---|
| `/mint <collateral> <fxUSD> [market]` | Live | Deposit collateral and mint fxUSD; market defaults to wstETH |
| `/borrow ...` | Live alias | Same parser and action as `/mint` |
| `/repay` | Live read | List long positions with fxUSD debt |
| `/repay <market> <position-id> <amount\|all>` | Live | Repay some/all fxUSD debt; collateral release is available in Mini App Borrow |
| `/save` or `/earn` | Live read | Show fxSAVE pool/wallet/position state |
| `/save <amount> [usdc]` | Live | Quick fxSAVE deposit |
| `/save deposit <amount> [usdc]` | Live | Deposit fxUSD or USDC |
| `/save withdraw <shares\|all> [instant]` | Live | Queued or instant redemption; the numeric unit is fxSAVE shares |
| `/redeem <shares\|all> [instant]` | Live alias | Entry to fxSAVE withdrawal; the numeric unit is fxSAVE shares |
| `/save claim` or `/claim` | Live | Claim a matured queued redemption |

## Orders, bridge, and governance

| Command | Status | Behavior |
|---|---|---|
| `/limit <open\|close> <market> <long\|short> at <price>` | Preview | Validates/displays a trigger; no order is signed or submitted |
| `/orders` | Live read | Lists limit orders known to the database/relay path |
| `/bridge ETH Base <amount> <fxUSD\|fxSAVE>` | Gated | Ethereum-source LayerZero quote; broadcast needs `BRIDGE_EXECUTION_ENABLED=true` and both source RPCs |
| Base → Ethereum bridge | Mini App, gated | Use **Move → To Ethereum**; requires the same flag plus `BASE_RPC_URL` |
| `/lock <amount> <duration>` | Unavailable | Explains that FXN locking execution is not shipped |
| `/vote` | Unavailable | Explains that gauge voting is not shipped |
| Gauge/referral reward claim | Unavailable | `/claim` is fxSAVE redemption only |

## Monitoring and automation

| Command | Status | Behavior |
|---|---|---|
| `/price` | Live | Cached CoinGecko market table with stale labeling |
| `/gas` | Live | Etherscan gas oracle when configured, with RPC fallback |
| `/alert <asset> > <price>` | Live | One-shot price-above alert |
| `/alert <asset> < <price>` | Live | One-shot price-below alert |
| `/alert <asset> +10%` | Live | One-shot 24-hour percentage alert |
| `/alerts` | Live | List/delete active alerts; maximum 10 |
| `/arb [on\|off]` | Live signal | fxUSD NAV/market signal and opt-in notifications; no arbitrage transaction |
| `/auto sl <market> <side> <price>` | Live | One-shot full-close stop-loss rule |
| `/auto tp <market> <side> <price>` | Live | One-shot full-close take-profit rule |
| `/auto` | Live | List/delete active or paused rules; maximum 10 active |
| `/history` | Live | Last ten executor records with Etherscan links |
| `/speedup` | Conditional | Replace latest recorded pending transaction with bumped fees |
| `/cancel` | Conditional | Replace latest recorded pending transaction with a zero-value self-send |

Workers are off-chain services. Their timing, availability, and fill price are not guaranteed.
