# Design critique: FxAeon against Uniswap and Jumper (October 2026)

**Sessions.** On 2026-10-07 I studied app.uniswap.org (swap, at 375×812 and at desktop width) and jumper.xyz (welcome and widget) live in a browser. I compared both with fxaeon.com, as deployed that day, at the same sizes.

**Scope.** This complements [frontend-research-uniswap-balancer.md](frontend-research-uniswap-balancer.md) and [frontend-research-jumper-curve.md](frontend-research-jumper-curve.md). Those documents cover data and transaction-engineering patterns. This one covers interaction and visual craft.

**Since then.** The pull request that recorded this critique (#261) also shipped both fixes below: the market header reads the scrubbed bar, and the wallet chip rings while a step is pending, with a short notice when it settles.

## What the benchmarks do well

| Pattern | Uniswap | Jumper | FxAeon today |
| --- | --- | --- | --- |
| **One header row** for the form's mode and its settings | Swap/Limit/Buy/Sell tabs, chart icon and gear share one row. | Swap & Bridge/Private/Gas tabs and gear share one row. | Since #244, Trade's title, Positions and the gear share one row. Earn and Borrow carry the gear in their tab row. |
| **Two tonal boxes**, a big number and a token chip on the right | Sell and Buy boxes with 36px+ figures, USD beneath, and the chip on the right. A flip button straddles the boxes. | Same, with Send and Receive. | Amount surfaces follow this exactly, and the figure scales down per digit. |
| **Shape-exact loading** | Skeleton bars sit only where values land. | The widget's skeleton has the final layout (tabs, boxes, flip, button row) and fades in place. | The static export paints the full layout first, with skeletons only where values land. There is no layout shift on load. |
| **Soft disabled action** | A tinted, low-contrast "Get started" or "Connect wallet". | A solid violet "Connect wallet" plus a wallet icon button. | "Enter an amount" is a disabled tint, and Connect is the primary action. |
| **Empty choice made easy** | An empty Buy box offers four quick-pick token icons. | n/a | Trade's input assets are few, and the market switch is a segmented control, so no change is needed. |
| **Numbers that move** | The live price ticks in place. | Welcome stats count up on arrival. | Prices roll digit by digit (`RollingFigure`), and the Portfolio total animates. |
| **A chart you can read with a finger** | Scrubbing the token chart swaps the headline price and change for the hovered point, and release returns to live. | n/a | Gap. The Trade chart has a crosshair, but the header keeps the live price while you scrub. |
| **Pending transactions never disappear** | A pending swap rings the account button. A toast announces confirmation from any page, and the activity tab updates. | Execution steps stay visible, with per-step status. | Gap. ActionReview shows every step while open. Once you leave it, only History tells you something is still pending, and confirmation is silent. |

## Critique of FxAeon

1. **Scrubbing should explain the past, not just mark it.** A crosshair without a readout makes users read the axis label under their thumb.
   - **Fix:** the market header becomes the readout while scrubbing (price, change from the range start, and time), with no rolling animation so it tracks the finger. Releasing restores the live price.
2. **In-flight money needs an ambient signal.** Leaving a review after signing is common on phones, especially in Telegram where the wallet prompt is modal.
   - **Fix:** the wallet chip carries a quiet ring while this wallet has pending transactions, with an accessible "pending" count.
   - **Fix:** confirmation surfaces as a short, polite announcement on any page, linking to History. A review that is still open shows its own result instead, so nothing is announced twice.
3. **What already holds up.** The layout discipline matches both benchmarks: one header row, tonal boxes, shape-exact loading, and 44px targets at every width. Per the owner's direction, further density gains come from smaller parts in the same layout, not new arrangements.

## Not adopted

- **Jumper's count-up stats.** FxAeon's figures are balances, not marketing counters. Animating them up from zero would misstate a value mid-animation.
- **Uniswap's quick-pick token row.** Trade, Earn and Borrow have at most a handful of reviewed assets, which the existing selectors already show.
