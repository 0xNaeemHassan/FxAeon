# Product visual review

## Historical source candidate and validation

The gallery and full CI summary below describe PR [#208](https://github.com/0xNaeemHassan/FxAeon/pull/208), source commit `ae59fe17a89c22f2728cac381b81f1d6889deb99`. All four required GitHub checks passed for that candidate. Client CI reported 499 unit tests passed (4 fork tests skipped), 172 main-browser tests, 7 Borrow tests, 1 Move test, 2 Positions tests, 25 overlay tests, and 5 state-lab tests, with no retry or flaky markers.

The local Anvil suite passed 4/4 protocol, Earn, and stress tests without skips. The Anvil browser proof passed, its redacted manifest was verified, and the disposable fork snapshot was reverted. Browser coverage includes fxSAVE deposit execution and instant/after-cooldown withdrawal review with selected-share calldata; actual fxSAVE withdrawal and claim execution are covered by the separate Earn Anvil suite. See [release validation](../release-validation.md) for covered flows and evidence boundaries. These test results are historical evidence for `ae59fe1`; they were not rerun for the later release.

## Latest deployed release

The later release merged as `d66a7f7cd658b32fc947bd70ddefa06bc1bf3a96`, including PR [#215](https://github.com/0xNaeemHassan/FxAeon/pull/215) for the compact mobile header and PR [#216](https://github.com/0xNaeemHassan/FxAeon/pull/216) for idempotent Telegram metadata synchronization. [Deployment run 36720447137](https://github.com/0xNaeemHassan/FxAeon/actions/runs/36720447137) succeeded and its job logs record a valid public gas snapshot, expected public wallet configuration, and successful Telegram metadata and Mini App menu synchronization. A separate connected-browser check verified the compact production header. This deployment record does not extend the PR #208 test or visual-gallery evidence. See [release validation](../release-validation.md) for the evidence boundary.

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

A separate gallery was captured from actual app flows against a disposable local Ethereum mainnet fork. The three linked examples are baseline captures at 393×852 and scrollTop 0 with no overflow reported; the full manifest also records scrolled review coverage. Screenshots were taken before requesting a wallet signature. Trade, Borrow, Earn, and all four position-close review screens were manually inspected. The captures show only an abbreviated disposable Anvil account; they contain no private wallet identity or secrets.

- [ETH long close review](assets/eth-long-close-review-anvil-20260930-mobile.png)
- [Earn instant withdrawal review](assets/earn-instant-withdrawal-review-anvil-20260930-mobile.png)
- [Earn after-cooldown withdrawal review](assets/earn-after-cooldown-withdrawal-review-anvil-20260930-mobile.png)

The manifest records unavailable Move bridge reviews because this proof uses an Ethereum fork only. The gallery does not establish live-mainnet state, Base delivery, Telegram wallet handoff, or production performance. Earlier baseline UI captures remain illustrative rather than transaction evidence.
