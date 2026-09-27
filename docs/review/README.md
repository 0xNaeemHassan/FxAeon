# Product visual review

## Latest reviewed working-tree captures

The latest gallery is
`artifacts/refinement/generated/run-20260927T071112Z/`. Its manifest lists 63
route/theme/viewport views and 103 PNG frames at 393×852 mobile and 1440×1000
desktop viewports. Root and the form-art reviewer manually inspected the
Portfolio, wallet profile, main forms, Settings, More, Receive, History, and
all Docs sections; no material clipping was found. The gallery includes
Portfolio, Trade, Borrow, Earn, Move, Positions, History, More, Settings,
Receive, Docs, Privacy, and Login.

These are source-built UI fixtures, not healthy live balance evidence. The
capture harness used an EIP-1193 test-wallet shim without an RPC/backend
connection, so chain balances are unavailable; deterministic market values
are labelled illustrative. The state-lab frames show generic UI stages, not
flow-specific quotes, transactions, or receipts. No confirmation, signature,
or chain mutation was invoked. Move's centered route panel is intentional. The
separate built-app browser suite passed 163/163 checks. A distinct protected
Anvil browser proof is still pending: its first attempt opened all four
ETH/BTC long/short positions, then failed because the existing-position Borrow
review CTA did not fit at 393×852. The layout correction and proof rerun are
pending; this gallery is not final-candidate evidence.

See [`../release-validation.md`](../release-validation.md) for revision-specific
validation status. This gallery documents rendered UI only and does not
establish transaction submission or confirmation.

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
