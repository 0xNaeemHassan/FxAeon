# Product visual review

## Current working-tree captures

The gallery at `artifacts/refinement/generated/run-20260927T025408Z/` records
the UI before the final commit. Its manifest lists 55 route/theme/viewport
views and 86 PNG frames; all 86 frames received manual visual review. The mobile
baseline is exactly 393×852 CSS pixels, with official, dark, and light themes.
Coverage includes Portfolio, Trade, Borrow, Earn, Move, Positions, History,
More, Settings, Receive, Docs, Privacy, and Login. Three official-theme desktop
views cover Portfolio, the wallet profile, and Trade at 1440×1000.

These are source-built UI fixtures, not healthy live balance evidence. The
capture harness used an EIP-1193 test-wallet shim without an RPC/backend
connection, so chain balances are unavailable; deterministic market values
are labelled illustrative. The 27 state-lab frames show generic UI stages, not
flow-specific quotes, transactions, or receipts. No confirmation, signature,
or chain mutation was invoked. Move's centered route panel is intentional. The
separate built-app browser suite passed 155/155 checks, including action
clearance.

The release record must be updated against the final commit; this gallery does
not establish final-commit evidence.

## Historical build4 references

The images below are retained only as before references. They do not show the
current styling. Their session requested 393×852, but Chrome reported a
394-pixel CSS width and a 393.6-pixel visual viewport; they are not evidence at
the exact current baseline.

| Surface | Historical capture |
| --- | --- |
| Portfolio balance summary and assets | [Portfolio](assets/portfolio.png) |
| Wallet profile and identity | [Wallet profile](assets/wallet-profile.png) |
| Wallet asset detail | [Wallet asset](assets/wallet-asset.png) |
| Move route | [Move](assets/move.png) |
| Transaction review | [Trade review](assets/trade-review.png) |

Rendered screenshots do not establish transaction submission or confirmation.
