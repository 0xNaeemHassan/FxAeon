# Product visual review

## Current source candidate

Candidate source commit: `ae59fe17a89c22f2728cac381b81f1d6889deb99`. All four required GitHub checks passed. Client CI reported 499 unit tests passed (4 fork tests skipped), 172 main-browser tests, 7 Borrow tests, 1 Move test, 2 Positions tests, 25 overlay tests, and 5 state-lab tests, with no retry or flaky markers.

The local Anvil suite passed 4/4 protocol, Earn, and stress tests without skips. The Anvil browser proof passed, its redacted manifest was verified, and the disposable fork snapshot was reverted. See [release validation](../release-validation.md) for covered flows and release boundaries. A docs-only follow-up commit is being prepared; its CI remains pending.

## Product gallery

The 64-view, 101-frame gallery was captured from a local production-placeholder export with a connected test-wallet shim and read-only illustrative balances. It documents rendered UI only. APY used the public feed, while Trade's 24-hour change remained a skeleton because the fixture lacked a Coinbase ticker value. All 101 frames were visually reviewed.

Selected mobile screenshots:

- [Portfolio](assets/portfolio-20260930-mobile.png)
- [Wallet profile](assets/wallet-profile-20260930-mobile.png)
- [ETH wallet detail](assets/wallet-eth-detail-20260930-mobile.png)
- [Trade input](assets/trade-input-20260930-mobile.png)
- [Earn instant withdrawal](assets/earn-instant-withdrawal-20260930-mobile.png)
- [Move from Ethereum to Base](assets/move-ethereum-base-20260930-mobile.png)

The portfolio and wallet views use a borderless hierarchy with one address in the header. Trade, Earn instant and queued withdrawal, Borrow, and Move show their primary action in the baseline view; Move is centered. Optional vault details continue below Earn's baseline action.

## Actual pre-confirm review captures

A separate gallery was captured from actual app flows against a disposable local Ethereum mainnet fork. Captures are 393×852 at scrollTop 0 with no overflow reported, taken before requesting a wallet signature. Trade, Borrow, Earn, and all four position-close review screens were manually inspected. The captures show only an abbreviated disposable Anvil account; they contain no private wallet identity or secrets.

- [ETH long close review](assets/eth-long-close-review-anvil-20260930-mobile.png)
- [Earn instant withdrawal review](assets/earn-instant-withdrawal-review-anvil-20260930-mobile.png)
- [Earn after-cooldown withdrawal review](assets/earn-after-cooldown-withdrawal-review-anvil-20260930-mobile.png)

The manifest records unavailable Move bridge reviews because this proof uses an Ethereum fork only. The gallery does not establish live-mainnet state, Base delivery, Telegram wallet handoff, or production performance. Earlier baseline UI captures remain illustrative rather than transaction evidence.
