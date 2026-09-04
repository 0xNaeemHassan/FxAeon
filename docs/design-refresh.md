# FxAeon experience refresh

The interface is a focused, wallet-owned workspace for f(x) Protocol. This pass changes presentation and interaction hierarchy, not the transaction engine or supported capability surface.

## Reference study

Live interfaces were inspected on 3 September 2026. Designs are independently implemented; no third-party frontend code, logos, or brand assets are imported.

| Reference | Observed pattern | FxAeon application |
| --- | --- | --- |
| [Jumper](https://jumper.xyz/) | A focused action card; token selection replaces the working surface; responsive network disclosure; consistent settings rows | Grouped trade ticket, searchable asset sheet, on-demand account panel, quieter settings |
| [Jumper source](https://github.com/jumperexchange/jumper-exchange) | Explicit geometry and typography tokens; structured drawer navigation; loading-state geometry; mobile/desktop test coverage | Shared surface tokens, semantic controls, consistent skeletons, responsive regression checks |
| [UP33](https://up33.xyz/trade) | Restrained light surfaces; amount and token identity in one control; concise navigation | Real light theme, integrated asset/amount input, reduced navigation chrome |
| [Aerodrome](https://aerodrome.finance/swap) | A narrow task card within a spacious desktop canvas; clear token identity and one primary action | Focused Earn/Borrow/Move flows and legible token choices |
| [Etherex](https://www.etherex.finance/trade) | Strong brand contrast; nearby slippage control; concise asset/quote hierarchy | Distinct lavender identity, progressive slippage and transaction details |

### Connected-wallet observations

Jumper was also inspected with the user's empty burner wallet. The user approved the MetaMask connection; no message, token approval, or transaction was signed. The connected state exposed:

- A right-side wallet panel with a quiet backdrop, balance first, and compact address/copy/explorer actions.
- Real quote alternatives even when the wallet cannot fund the swap, with the insufficiency stated separately from quote availability.
- A narrower review surface: input/output amounts lead, then recipient, route, network cost, price impact, slippage, minimum received, and exchange rate.
- History skeletons with the same geometry as loaded activity, followed by a concise empty state for the burner wallet.

These are interaction references, not capability promises. FxAeon continues to use only routes and review facts returned by its supported SDK. It does not import Jumper's providers or fabricate comparable route choices.

The same burner connection was checked in the local FxAeon preview, UP33, and Etherex. Etherex returned an actual quote while clearly disabling submission for insufficient funds. Aerodrome reached a separate sign-in/disclaimer after connection; that additional consent/signature step was not performed. UP33’s documentation was inspected directly in the browser: the guide index, constrained reading width, and section anchors informed FxAeon’s independently written `/docs` surface. No live-chain transaction or message was signed during this reference study.

## Design contract

- A quiet violet-black canvas; pale lavender actions; warm white light theme.
- 24px principal cards, 16px inputs, pill-shaped primary actions and token selectors.
- Inter with tabular financial figures. Large values are reserved for real financial state; addresses and raw details retain monospace.
- Space establishes groups before borders. No page-wide grid, decorative accent strips, invented charts, or fake financial richness.
- Desktop is composed for its available width. Trade places market context beside its ticket; Portfolio groups overview and secondary state. Single-task flows stay focused.
- Mobile uses the same logical reading order, a stable safe-area-aware bottom navigation, and controls of at least 44px.
- Drawers and pickers are explicit user actions, trap focus, support Escape, restore focus, and never appear merely because a wallet connected.
- Long-running and ambiguous transaction states remain distinct. No automatic repeat submissions.
- Quotes, oracle values, balances, leverage bounds, approvals, and execution always retain their existing sources and safeguards.

## Release acceptance

The refresh is not accepted merely because it builds. Evidence must cover:

1. All 12 application routes, plus the requested read-only guide: landing, login setup, portfolio, trade, positions, earn, borrow, move, more, settings, activity, receive, docs. The normal web flow uses in-place wallet controls from Portfolio; `/login` is retained as a standalone setup surface. Adding documentation does not expand the 15-method transaction surface.
2. Official violet, neutral-dark, and light themes, including portaled token/wallet surfaces and saved first paint.
3. Mobile widths 320–430px, tablet, and desktop composition; no overflow, clipped text, or covered actions.
4. Disconnected, loading, unavailable, empty, populated, validation-error, and review states where reproducible.
5. Token search/selection, keyboard navigation, chart range/disclosure, theme changes, wallet profile, and recovery navigation.
6. Scope guard, lint, type checks, complete unit/chaos tests, dependency audit, static export, bundle budgets, and built browser tests.
7. Fresh browser/fork evidence for transaction review, signing boundaries, confirmation, and post-confirmation position discovery when the interface changes affect these flows.
8. Refreshed documentation captures with truthful provenance. Old screenshots and earlier green runs are baseline evidence, not proof of this redesign.

Production deployment and merging remain separate release actions.

## Verified local evidence — 3 September 2026

- The complete local `pnpm verify` gate passed: scope guard (15 SDK methods, 13 routes), lint, type checks, dependency audit, static export/CSP, bundle limits, 170 unit/security tests, and 47 browser tests. Coverage includes owned-quantity USD precision, in-place wallet connect/disconnect and account switching, disconnected token pickers at 320px, and keyboard/touch behavior for leverage controls. Three protected fork tests are intentionally skipped by the ordinary gate and were run separately below.
- `pnpm test:anvil:all` passed all three suites at Ethereum block `25893155`: 100 snapshot/revert iterations, 100 ordered-route stress iterations, and the real four-position protocol proof including an existing-long fxUSD borrow. The provider URL is excluded from the evidence.
- `pnpm test:anvil:browser` passed on the same block. Actual app controls prepared, reviewed in the modal sheet, simulated, and confirmed ETH/BTC long and short positions; it also exercised in-place account switching/disconnect and real fxUSD borrowing against the existing ETH long, verifying ownership, nonzero collateral/debt, preserved position ID, delayed discovery, cross-workspace reads, available USDC before each trade, post-confirmation balance refresh, and position USD labels before snapshot restoration. Only disposable fork funds were used. The final picker value layout and slider centering are presentation-only follow-ups covered by the final ordinary gate.
- The audit capture profile is configured for all 13 routes in all three themes at 390×844 and 1440×1000 (78 captures per run). The follow-up USD/balance layout sweep uses visibly labelled illustrative market data for deterministic layout inspection only; it is not published financial evidence. Automated responsive checks additionally cover 320, 360, 375, 412, and 430px widths. Reference-browser/device behavior is not implied by headless coverage.
- Nine standard documentation screens and four populated fork screens were refreshed. Populated screenshot hashes and redacted source-proof provenance are recorded in [`position-screenshot-manifest.json`](fixtures/position-screenshot-manifest.json). External display prices were not intercepted; unavailable prices remain visibly unavailable.
- Existing picker/slider close-ups were inspected at 320, 390, and 1280px in the Official and light themes. The slider track crosses the thumb center, its input stays 44px tall, and picker rows fit without overflow and restore focus on dismissal. The approved burner wallet was rechecked in the normal Chrome preview: each verified zero quantity displays its own `$0.00` worth rather than the token's market quote.

Reproducible local reports are retained under ignored `artifacts/design-refresh/` and `artifacts/anvil/`. These are local verification results for the working tree, not a claim that this redesign has been merged, deployed, or passed CI on a published commit. Remaining release work is review/promotion, the protected workflow on the release commit, and broader real-device Telegram/mobile checks.

### Position values and available balances

Shared position cards and Borrow summaries show estimated net equity (collateral USD less debt USD), with both legs visible. Calculations retain bigint accounting units and the SDK's returned decimals until rounding to cents. These are display estimates, not P&L, liquidation values, or close quotes.

Trade, position management, Earn, Borrow, and canonical Move token choices show the selected wallet's available balances, with the USD worth of that owned quantity underneath rather than the unit token price. Jumper's [`BalanceStackItem`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/components/composite/BalanceCard/components/BalanceStackItem.tsx) and [`SingleTokenAmount`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/components/composite/TokenAmount/components/SingleTokenAmount.tsx) informed the identity-left, two-line-value-right structure; FxAeon puts quantity first as requested. Loading, unavailable, and verified zero remain distinct. Confirmed actions refresh balances; wallet/source-chain changes invalidate old results. Canonical Move reads Ethereum's underlying token or Base's OFT as appropriate. Advanced custom OFTs make no unsupported balance claim.

Price validation is independent per token. A delayed fxUSD quote no longer hides fresh ETH/BTC prices; missing quotes receive one bounded, batched CoinGecko fallback with adaptive rate-limit retry/backoff. Current-price context has no source badge, while the chart keeps a concise CoinGecko attribution link. Neither feed affects transaction planning, and no stablecoin peg is invented.

Leverage and position-reduction sliders share explicit track/thumb dimensions. WebKit's top-aligned thumb is offset by half their height difference, keeping the track through the circle's center without reducing the 44px touch target. Firefox retains its native centering with the same border-box thumb size.
