# Product behavior

FxAeon is a static browser and Telegram Mini App for managing f(x) positions,
fxUSD borrowing, fxSAVE, and supported Ethereum/Base transfers. The app's
product actions use the pinned official SDK and the selected wallet. See
[`architecture.md`](architecture.md) for transaction and data ownership.

## Main areas

- **Portfolio** is the account overview for wallet assets and positions. It
  keeps wallet value separate from position equity and treats partial or
  unavailable data differently from a confirmed zero balance.
- **Trade and Positions** cover ETH/BTC long and short positions. Trade keeps
  the entered amount when its chart expands; position management keeps the
  selected position bound to the reviewed action.
- **Borrow** supports adding collateral and borrowing fxUSD, repaying debt,
  withdrawing collateral, and the available combined actions.
- **Earn** supports fxSAVE deposits, queued or instant withdrawals, and a
  claim when the on-chain redemption is ready.
- **Move** supports reviewed fxUSD and fxSAVE routes between Ethereum and
  Base. Source confirmation and destination delivery have separate statuses.
- **Activity, Settings, and More** provide transaction history and recovery,
  preferences and wallet controls, and links to the remaining app areas.

## Reviews and mobile layout

Product actions show a review of the current amount, wallet, and route before
execution. A changed or expired review must be refreshed and accepted again;
each transaction step still requires wallet approval. USD estimates and charts
are display context only and do not determine transaction amounts.

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
