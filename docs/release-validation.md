# Release validation record

## Historical source and test evidence

The comprehensive CI and local fork evidence below was collected for pull request [#208](https://github.com/fxaeon/FxAeon/pull/208), source commit:
`ae59fe17a89c22f2728cac381b81f1d6889deb99`. It records validation of that candidate; it does not claim that the full suite was rerun against the later release.

All four required GitHub checks passed for that source commit. Client CI reported 499 unit tests passed with 4 fork tests skipped, 172 main-browser tests, 7 Borrow tests, 1 Move test, 2 Positions tests, 25 overlay tests, and 5 state-lab tests. The log contained no retry or flaky markers.

## Local fork verification

`pnpm test:anvil:all` exited 0 with 4/4 tests passing and no skips across protocol, Earn, and stress coverage. Protocol and Earn manifests were verified.

`pnpm test:anvil:browser` exited 0 and its redacted browser-proof manifest was verified. The browser proof exercised the four supported ETH/BTC long/short positions, opened and closed positions, ownership and external-position discovery, borrowing fxUSD against an existing position, browser-driven fxSAVE deposit execution, wallet balance refresh, and close receipts in History. It verified pre-confirm instant and after-cooldown withdrawal reviews, including selected-share calldata, plus transaction values, gas fees, and quote-expiry handling. Actual fxSAVE withdrawal and claim execution are covered by the separate Earn Anvil suite above. The disposable Ethereum mainnet-fork snapshot was reverted after the browser run.

These are local fork results, not live-mainnet transactions or production checks. The fork-browser proof does not execute bridge delivery on Base or native Telegram wallet handoff. The Move review was recorded as unavailable in the proof manifest.

## Visual evidence

The 64-view, 101-frame product gallery was captured from a local production-placeholder export with read-only illustrative balances and a connected test-wallet shim. All frames were visually reviewed. It documents rendered UI; it does not prove live balances or production performance. The APY display used the public feed; Trade's 24-hour change remained a skeleton because the fixture lacked a Coinbase ticker value.

The separate Anvil review gallery contains pre-confirm screenshots from actual app flows on the disposable Ethereum fork. The three linked examples are baseline captures at 393×852 and scrollTop 0 with no reported overflow; the full manifest also records scrolled review coverage. Screenshots were captured before requesting a wallet signature. They show the abbreviated disposable fork account only; no private wallet identity or secrets are included.

- [ETH long close review](review/assets/eth-long-close-review-anvil-20260930-mobile.png)
- [Earn instant withdrawal review](review/assets/earn-instant-withdrawal-review-anvil-20260930-mobile.png)
- [Earn after-cooldown withdrawal review](review/assets/earn-after-cooldown-withdrawal-review-anvil-20260930-mobile.png)

The source evidence and manifests are in the ignored local `artifacts/anvil/browser-proof.json`, `artifacts/anvil/protocol-proof.json`, `artifacts/anvil/earn-proof.json`, and `artifacts/anvil/browser/reviews/run-20260930T041648Z/manifest.json`.

## Latest deployed release

The later release merged as `d66a7f7cd658b32fc947bd70ddefa06bc1bf3a96` after PR [#215](https://github.com/fxaeon/FxAeon/pull/215) compacted the mobile header while preserving 44px control targets, and PR [#216](https://github.com/fxaeon/FxAeon/pull/216) made Telegram bot metadata synchronization idempotent. Production [deployment run 36720447137](https://github.com/fxaeon/FxAeon/actions/runs/36720447137) succeeded: the gas oracle returned a valid public snapshot, expected public wallet configuration was present, and Telegram bot metadata and Mini App menu synchronization succeeded. A separate connected-browser check verified the compact production header. The local release record is `artifacts/refinement/header-compact-20260930/release-verified.json`.

This later deployment evidence does not rerun or extend the PR #208 unit, browser, Anvil, or visual-gallery results. Those remain evidence for commit `ae59fe1`. Neither record establishes live cross-chain delivery on Base, native Telegram wallet handoff, or production performance.

## Release boundary

The fork and UI results above describe commit `ae59fe1`; the later production checks describe merge `d66a7f7`. They are separate evidence records with different scopes.

See [testing](testing.md), [browser test gates](browser-test-gates.md), and [visual review](review/README.md) for test scope and screenshot provenance.
