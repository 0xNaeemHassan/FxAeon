# Product behavior

FxAeon is a static browser and Telegram Mini App for managing f(x) positions,
fxUSD borrowing, fxSAVE, and supported Ethereum/Base transfers. The app's
product actions use the pinned official SDK and the selected wallet. See
[`architecture.md`](architecture.md) for transaction and data ownership.

## Main areas

- **Portfolio** is the account overview for wallet assets and positions. It
  keeps wallet value separate from position equity and treats partial or
  unavailable data differently from a confirmed zero balance.
- **Trade and Positions** cover ETH/BTC long and short positions. Trade's
  leverage slider is drawn as the position's split between debt and the
  trader's share. A connected, complete ticket previews the estimated
  collateral, debt and protocol fee rate of the route its review would open;
  those are the review's own figures, and any input change clears them. Trade
  keeps the entered amount when its chart expands. A confirmed open is titled
  after the action, such as "Opened ETH Long", and shows the new position as
  its row.
- **Position rows** are compact and borderless: market and side, leverage,
  position number and value, the split between debt and the holder's share,
  and a line saying how far the price can move before the pool rebalances the
  position, read live from the pool (see
  [Position brake](sdk-scope.md#position-brake)). Portfolio, Trade and
  Positions list the same rows. On a phone a row opens that position with its
  details and Add, Reduce, Leverage and Close (and Borrow against for a long);
  "All positions", browser Back and Telegram Back return to the list. Wide
  screens keep the list beside the selected position. Position management
  keeps the selected position bound to the reviewed action. ETH long
  collateral reads in stETH, the unit the pool records (see
  [Collateral units](sdk-scope.md#collateral-units)).
- **Borrow** asks for collateral first, then shows the fxUSD it can support
  and the loan-to-value against the pool's limit as amounts change. It
  supports adding collateral and borrowing fxUSD, repaying debt, withdrawing
  collateral, and the available combined actions.
- **Earn** supports fxSAVE deposits from fxUSD, USDC or fxSP, queued or
  instant withdrawals, and a claim when the on-chain redemption is ready.
- **Move** supports reviewed fxUSD and fxSAVE routes between Ethereum and
  Base. Source confirmation and destination delivery have separate statuses.
- **History, Settings, and More** provide transaction history and recovery,
  preferences and wallet controls, and links to the remaining app areas.
  History titles name positions as their rows do.

## Reviews and mobile layout

Product actions show a review of the current amount, wallet, and route before
execution. A changed or expired review must be refreshed and accepted again;
each transaction step still requires wallet approval. USD estimates and charts
are display context only and do not determine transaction amounts.

Reviews show what is signed exactly: entered amounts, approvals and enforced
minimums. Estimates carry "≈", and cost estimates round up. The gas fee
maximum is the fee the wallet must fund for every step; when the wallet holds
less, the review says so before anything is signed, naming the network and,
once the fee is fully estimated, the ETH to add. A route with several wallet
requests says so before the first one.

At the compact 393×852 viewport, Trade, Borrow, Earn, and Move keep their
primary review action visible above the mobile navigation without starting in
a scrolled state. Amount shortcuts and other compact controls retain touch
targets of at least 44px; primary actions use a 48px minimum height. Responsive
behavior is covered by the production browser suite and the focused compact
layout spec in `apps/mini-app/e2e/specs`.

## Scope

Portfolio estimates, local drafts, and cached or discovered wallet data do not
establish protocol state. The product has no transaction backend, delegated
signer, or database. It makes no API or protocol-schema change to present these
flows. See [`security.md`](security.md), [`sdk-scope.md`](sdk-scope.md), and
[`testing.md`](testing.md) for the relevant boundaries and checks.
