# Product visual review

## Current candidate gallery

Current candidate: `dad36853a3616c6666534dfc39c00647b6b1d9e3`; all four GitHub
checks passed. Its Client CI passed 496 unit tests (4 skipped), 165
main-browser tests, 6 Borrow tests, 25 overlay tests, 5 state-lab tests, and
14 landing states, with no Playwright retries. The `artifacts/refinement/generated/run-20260930T015019Z/`
gallery contains 64 views and 101 frames at mobile and desktop sizes, captured from a
local production-placeholder export. It uses a connected test-wallet shim and
read-only illustrative balances with ready-empty positions; no private or live
wallet captures are included. The displayed APY comes from the public feed.
Trade's 24-hour change remains a skeleton because the fixture has no Coinbase
ticker value. These images show UI states, not live balances, transaction
behavior, or production performance.

Selected current screenshots:

- [Portfolio](assets/portfolio-20260930-mobile.png)
- [Wallet profile](assets/wallet-profile-20260930-mobile.png)
- [ETH wallet detail](assets/wallet-eth-detail-20260930-mobile.png)
- [Trade input](assets/trade-input-20260930-mobile.png)
- [Earn instant withdrawal](assets/earn-instant-withdrawal-20260930-mobile.png)
- [Move from Ethereum to Base](assets/move-ethereum-base-20260930-mobile.png)

The current presentation uses a borderless Portfolio and Wallet hierarchy with
a single address in the header. Trade, Earn instant and queued withdrawal,
Borrow, and Move show their primary action in the baseline view; Move is
centered. Only optional vault details continue below Earn's baseline action.
All 101 frames have been visually reviewed.

The previous fork-browser run on `337fd1e` opened all four position types, then
failed on a stale Close button locator. The corrected `dad3685` Anvil run
reached the close review, then failed because its CTA was hidden under the
bottom navigation. An uncommitted follow-up batch is being focused-tested; full
gates have not been rerun. No release or merge pass is claimed. See
[release validation](../release-validation.md) for gate status.

Earlier screenshots remain historical references; they are not promoted as
current evidence.
