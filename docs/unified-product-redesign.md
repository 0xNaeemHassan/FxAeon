# Unified product redesign

Implementation branch: `feat/unified-product-redesign`. The pull request is a draft until the release checks below are completed. Do not merge or deploy solely because typecheck succeeds.

## Component ownership

- `ProductUI`: product headings, surfaces, product navigation, metric rows, notices, disclosures, grouped rows and choice cards.
- `AmountField`: decimal entry, balance metadata, inset percentage actions, token selection slot and secondary USD valuation. `ProtocolForm` re-exports it for existing callers.
- `AssetPresentation`: token/network identity, compact quantities and the same asset-row hierarchy for Portfolio and the account drawer. Full precision stays available.
- `AccountControls`: verified-name account entry and session controls.
- `AppearancePreference`: one Official/Dark/Light selector shared by preferences; More links to it rather than duplicating it.
- `ActionReview.reviewBeforeSign`: explicit review before any execution request on redesigned product pages. Existing transaction guards and final confirmation remain in charge.

## Navigation and value rules

Portfolio is the account overview. The account drawer is a short account check with a fixed identity header and one scrolling content area. More is a directory. Settings owns preferences and wallet-management entry points.

Portfolio value separates wallet assets and position equity. fxSAVE wallet shares are not counted again through their underlying assets. Pending transfers and withdrawal claims are excluded from the shown breakdown. Partial and unavailable values are not confirmed zero balances. Display-only price validation never supplies a stablecoin peg or authorizes a transaction.

Trade keeps the ETH/BTC switch. Expanding the mobile chart moves the intact ticket down rather than compressing it. Amount fields preserve exact token strings; dollar displays do not drive transaction amounts. Native ETH Max is route-aware.

Earn has Deposit and Withdraw. Claim is contextual and existing claim deep links remain supported. Withdrawal methods use actual configuration, not fabricated fees or waiting periods. Borrow has new-position and current-position views, four management actions and preserved combined operations. A disappeared selected position cannot silently turn into a new loan.

## Verification before release

Run the repository verification commands from the root package scripts, followed by the complete Playwright suite. Pay particular attention to:

1. Shared amount layout at 360px and 390px, long decimal values, zero/disconnected/unavailable balances and native-fee reserve failures.
2. Trade chart expansion without ticket shrinkage and without resetting the entered amount.
3. Deposit, both withdrawal methods, empty/pending/ready claims and claim deep links.
4. All borrowing management actions, combined operations, restored drafts, disappearing positions and account changes during Max estimation.
5. Portfolio repeated refreshes, partial and expired quotes, actual zero balances and account/network isolation.
6. Drawer focus containment, always-reachable Close, expanded exact-quantity rows and return focus.
7. Settings unsaved/saved/storage-failure states, persistence without erasing other preferences, and all three appearances.
8. Review before signing, rejection, approval versus execution, confirmed results, and bridge source confirmation versus destination delivery.

The initial implementation passed application typechecks at several checkpoints. Those results do not establish that the final browser suite is passing. Consult the PR's latest verification report and workflow conclusions for the exact revision. No production transaction or deployment is part of this redesign task.
