# Product visual review

## Current candidate gallery

Candidate source commit: `624f725`; all four GitHub checks passed for that
commit. The gas-clock correction described below is being verified separately.

Local gallery: `artifacts/refinement/generated/run-20260930T015019Z/`
contains 64 views and 101 PNG frames at 393×852 mobile and 1440×1000 desktop.
The capture used the local production-placeholder export with read-only gallery
fixtures. It reported no page or console errors. The gallery is visual evidence
only: its balances are illustrative, its positions are ready-empty, and it
does not establish live RPC behavior, transaction submission, or production
performance. Earlier images remain historical references until the current
fork-browser proof is complete.

The reviewed before-and-after is concrete: the earlier 2026-09-27 gallery
predates the current presentation; the 2026-09-30 candidate shows a borderless
Portfolio and Wallet hierarchy with a single address in the header. Trade,
Earn instant and queued withdrawal, Borrow, and Move each show their primary
action in the baseline view. Move is centered. Only the optional vault-details
section extends below Earn's baseline action. Across all 101 frames, 75 Portfolio, Wallet, form, theme,
and state-lab frames and the 26 remaining requested frames were reviewed.

One Trade 24-hour change is shown as a skeleton because the deterministic
fixture has no Coinbase ticker value. This is a known fixture limitation and
does not demonstrate a production loading defect. The only failed request in
the capture was a localhost prefetch aborted when its browser context closed;
there were no page or console errors.

The 2026-09-30 Anvil browser run failed because the Gas fee row disappeared
after the quote-expiry probe. The gas-cost cache had captured the original
`Date.now` function before the browser fake clock was installed, leading to
repeated estimate refreshes. The cache default now calls live `Date.now()`;
focused gas tests pass 18/18. Full `pnpm verify` is rerunning, and the Anvil
browser proof will rerun afterward. No pass is claimed for the rerun. See
[release validation](../release-validation.md) for current gate status.

## Historical references

Earlier galleries and captures remain as before-state evidence. They do not
establish the current release gates or production behavior.
