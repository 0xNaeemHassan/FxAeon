# Release validation record

## Verified source candidate

Pull request [#208](https://github.com/0xNaeemHassan/FxAeon/pull/208) source commit:
`ae59fe17a89c22f2728cac381b81f1d6889deb99`.

All four required GitHub checks passed for that source commit. Client CI reported 499 unit tests passed with 4 fork tests skipped, 172 main-browser tests, 7 Borrow tests, 1 Move test, 2 Positions tests, 25 overlay tests, and 5 state-lab tests. The log contained no retry or flaky markers.

## Local fork verification

`pnpm test:anvil:all` exited 0 with 4/4 tests passing and no skips across protocol, Earn, and stress coverage. Protocol and Earn manifests were verified.

`pnpm test:anvil:browser` exited 0 and its redacted browser-proof manifest was verified. The browser proof exercised the four supported ETH/BTC long/short positions, opened and closed positions, ownership and external-position discovery, borrowing fxUSD against an existing position, fxSAVE deposit and withdrawal paths, wallet balance refresh, and close receipts in History. It checked reviewed calldata, transaction values, gas fees, selected withdrawal shares, and quote-expiry handling. The disposable Ethereum mainnet-fork snapshot was reverted after the run.

These are local fork results, not live-mainnet transactions or production checks. The fork-browser proof does not execute bridge delivery on Base or native Telegram wallet handoff. The Move review was recorded as unavailable in the proof manifest.

## Visual evidence

The 64-view, 101-frame product gallery was captured from a local production-placeholder export with read-only illustrative balances and a connected test-wallet shim. All frames were visually reviewed. It documents rendered UI; it does not prove live balances or production performance. The APY display used the public feed; Trade's 24-hour change remained a skeleton because the fixture lacked a Coinbase ticker value.

The separate Anvil review gallery contains pre-confirm screenshots from actual app flows on the disposable Ethereum fork. Each is 393×852 at scrollTop 0 with no reported overflow. Screenshots were captured before requesting a wallet signature. They show the abbreviated disposable fork account only; no private wallet identity or secrets are included.

- [ETH long close review](review/assets/eth-long-close-review-anvil-20260930-mobile.png)
- [Earn instant withdrawal review](review/assets/earn-instant-withdrawal-review-anvil-20260930-mobile.png)
- [Earn after-cooldown withdrawal review](review/assets/earn-after-cooldown-withdrawal-review-anvil-20260930-mobile.png)

The source evidence and manifests are in the ignored local `artifacts/anvil/browser-proof.json`, `artifacts/anvil/protocol-proof.json`, `artifacts/anvil/earn-proof.json`, and `artifacts/anvil/browser/reviews/run-20260930T041648Z/manifest.json`.

## Release boundary

The results above apply to source commit `ae59fe1`. A docs-only follow-up is being prepared; its CI checks are pending. No merge, release, production deployment, live cross-chain delivery, or production-performance result is claimed.

See [testing](testing.md), [browser test gates](browser-test-gates.md), and [visual review](review/README.md) for test scope and screenshot provenance.
