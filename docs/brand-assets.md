# Brand assets

Use the FxAeon mark for product identity and protocol/token marks only to
identify their assets. Do not imply that an asset mark is the FxAeon brand.

## Sources and use

| Asset | Source | Use |
| --- | --- | --- |
| FxAeon application mark | `apps/mini-app/public/icon.svg` | App icon and product identity |
| Landing mark | `apps/landing/assets/fxaeon-mark.svg` | Landing header, footer, finale, and favicon; its paths match the app mark |
| Landing sculpture | `apps/landing/assets/fxaeon-sculpture.webp` | Supporting artwork derived from the FxAeon mark, not used by the current landing page; source prompt in [`landing-art-prompt.md`](landing-art-prompt.md) |
| Token and chain marks | `apps/mini-app/public/token-icons/` and `chain-icons/` | Vendored token/network identity; the landing copies use the same app files |
| Supplied social banner and profile image | [`assets/social/`](assets/social/) | Social exports; keep the supplied masters unchanged |
| App social-preview image | `apps/mini-app/public/landing/fxaeon-banner.png` | Open Graph/Twitter metadata, not the visible landing hero |

The token/chain marks come from the SmolDapp asset CDN and AladdinDAO assets.
Unknown token symbols use the app's text fallback instead of being presented as
official artwork.

## Theme and layout

The app supports official dark, neutral dark, and light appearance modes. The
landing site has coordinated dark and light modes. Use existing semantic
tokens in the app and landing stylesheets instead of adding a parallel color
palette.

The landing header is transparent over the aurora, with a soft sky scrim that
keeps its links legible on any frame, and gains a blurred surface once the page
scrolls. Respect reduced-motion preferences and the footer's motion control.
When changing the aurora, overlays, typography, colors, or theme behavior,
rerun `pnpm test:landing:browser` (it measures text contrast against the
painted aurora) and review both themes on mobile and desktop.

## Screenshots

Standard app screenshots are listed with routes, viewports, capture context,
and hashes in [`fixtures/standard-screenshot-manifest.json`](fixtures/standard-screenshot-manifest.json).
They show rendered UI with live external display data; no transaction was
submitted.

Populated position screenshots are separate. Their
[`position-screenshot-manifest.json`](fixtures/position-screenshot-manifest.json)
is authoritative for the browser-fork provenance, pinned block, verified
ETH/BTC long/short positions, captures, and restored snapshot state. Displayed
prices and charts are illustrative and visibly labelled. The landing page
renders app screens in HTML/CSS with example values labelled Example; it does
not embed the populated position screenshots. Those screenshots document a test fixture,
not production balances or market-price evidence.
