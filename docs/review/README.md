# Product visual review

## Latest captured gallery

[`artifacts/refinement/generated/run-20260927T121703Z/`](../artifacts/refinement/generated/run-20260927T121703Z/)
contains 64 views and 104 PNG frames at 393×852 mobile and 1440×1000 desktop.
The frames were collectively visually audited, including Docs, Privacy, Login,
and all state-lab themes/stages. Root also inspected disconnected Earn,
Portfolio, and wallet states in Official and Light themes, plus three
fork-backed transaction reviews and their CTA fit.

This gallery predates the later glyph change. Two focused tests passed for that
change, but refreshed screenshots and final screenshot promotion remain
pending. The latest protected browser attempt opened/reloaded all four
positions and passed Borrow, then failed at Earn because a strict selector
matched both a visible primary fact and a hidden advanced duplicate. The
selector now filters to visible rows without weakening the assertion; a full
retry is pending. See
[`../release-validation.md`](../release-validation.md).

The gallery uses fixture prices, Goldsky responses, and a test-wallet shim. The
preview lacks RPC environment values, and the local configured-Privy build
requires user authentication. These images establish rendered UI only, not
healthy live balances, transaction submission, or confirmation. No signature
or chain mutation was performed.

A separate user-authenticated check on local build `4321` completed healthy
live balance and network reads. Portfolio values remained visible during
refresh and controls re-enabled when reads finished. There were zero open
positions; History showed the opening and closed events for the same position.
This spot-check is not part of the gallery or a release gate. Public evidence
omits wallet identity, balances, and screenshots.

## Historical references

Earlier galleries and captures are retained as before-state evidence. They do
not establish the current release gates or production behavior.
