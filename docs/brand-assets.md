# FxAeon brand and theme guide

This guide covers FxAeon product, landing, documentation, and social exports.
Use the supplied X profile and banner masters for social artwork and the app
SVG mark for product surfaces. Keep the product name, protocol attribution,
and financial state clear.

## Asset inventory

### Product and landing

| Asset | Location | Use | Status |
| --- | --- | --- | --- |
| FxAeon application mark | [public/icon.svg](../apps/mini-app/public/icon.svg) | App shell, favicon, compact product identity | Current runtime source |
| f(x) protocol mark | [public/brand/fx-official-mark.svg](../apps/mini-app/public/brand/fx-official-mark.svg) | Optional f(x) Protocol attribution | Repository artwork; not referenced by the current landing or footer |
| Supplied landing/OG banner | [public/landing/fxaeon-banner.png](../apps/mini-app/public/landing/fxaeon-banner.png) | Root Open Graph/Twitter image | Current runtime metadata; not a visible landing hero |
| Landing identity | [fxaeon-mark.svg](../apps/landing/assets/fxaeon-mark.svg) | Landing header, footer, favicon | Exact application mark paths; no social-profile background |
| Dimensional mark | [fxaeon-sculpture.webp](../apps/landing/assets/fxaeon-sculpture.webp) | Supporting landing artwork | Generated from the application mark; compressed transparent WebP |
| Desktop positions capture | [portfolio-preview.png](../apps/landing/assets/portfolio-preview.png) | Landing product frame | Alias of `fxaeon-positions.png`; all four browser-fork positions; illustrative display data |
| Mobile positions capture | [portfolio-mobile.png](../apps/landing/assets/portfolio-mobile.png) | Landing phone frame | Alias of `fxaeon-positions-mobile.png`; all four browser-fork positions; illustrative display data |

The independent landing site lives in `apps/landing`. Its visible identity uses
the application mark; the supplied banner is reserved for social metadata.
Its `assets/tokens/eth.png`, `wbtc.png`, `fxusd.svg`, `usdc.png`, and
`fxsave.svg` are exact copies of the matching app token marks; `assets/chains/`
contains exact copies of the app's Ethereum and Base marks.
The protocol logo must never stand in for FxAeon. The dimensional mark is
supporting artwork, with its generation prompt in
[landing-art-prompt.md](landing-art-prompt.md). Product captures must come from
the app, with test-wallet values identified as illustrative. The supplied banner
is preserved unchanged and is not recreated in CSS.

### Token and network marks

Supported wallet and network marks are checked into the app so the picker
does not depend on a live image request. The PNG files are the 128 × 128
responses from the maintained [SmolDapp token and chain asset CDN](https://assets.smold.app/),
which is the AladdinDAO asset source already used by the app. The f(x) marks
are copied from the [AladdinDAO asset repository](https://github.com/AladdinDAO/aladdin-assets).

| Local files | Marks | Upstream source |
| --- | --- | --- |
| [public/token-icons/eth.png](../apps/mini-app/public/token-icons/eth.png), `weth.png`, `steth.png`, `wsteth.png`, `wbtc.png`, `frax.png`, `usdc.png`, `usdt.png`, `fxn.png` | ETH, WETH, stETH, wstETH, WBTC/BTC, FRAX, USDC, USDT, FXN | SmolDapp token asset endpoint (`/api/token/1/<address>/logo-128.png`) |
| [public/token-icons/fxusd.svg](../apps/mini-app/public/token-icons/fxusd.svg), [fxsave.svg](../apps/mini-app/public/token-icons/fxsave.svg) | fxUSD, fxSAVE | AladdinDAO `aladdin-assets/images/branding` |
| [public/chain-icons/ethereum.png](../apps/mini-app/public/chain-icons/ethereum.png), [base.png](../apps/mini-app/public/chain-icons/base.png) | Ethereum (1), Base (8453) | SmolDapp chain asset endpoint (`/api/chain/<chainId>/logo-128.png`) |

The Ethereum token addresses used for the vendored SmolDapp files are ETH
`0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`, WETH
`0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`, stETH
`0xae7ab96520de3a18e5e111b5eaab095312d7fe84`, wstETH
`0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0`, WBTC
`0x2260fac5e5542a773aa44fbcfedf7c193bc2c599`, FRAX
`0x853d955acef822db058eb8505911ed77f175b99e`, USDC
`0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`, USDT
`0xdac17f958d2ee523a2206206994597c13d831ec7`, and FXN
`0x365accfca291e7d3914637abf1f7635db165bb09`.

The checked-in SVGs contain no scripts or external references. Unknown token
symbols use the runtime initials fallback and are never presented as an
official mark. These assets are third-party protocol/network marks; they are
separate from FxAeon branding and are not used to imply ownership or value.

### Social masters

| Asset | Location | Dimensions | Use |
| --- | --- | --- | --- |
| Supplied X banner master | [fxaeon-x-banner-2172x724.png](assets/social/fxaeon-x-banner-2172x724.png) | 2172 × 724 | Source for X/profile-header exports |
| Supplied X profile master | [fxaeon-x-logo-pfp-1254x1254.png](assets/social/fxaeon-x-logo-pfp-1254x1254.png) | 1254 × 1254 | Source for square and circular profile exports |

These files are preserved unchanged from the supplied Downloads package. Keep
banner copy and the logo in the central safe band, and keep the profile mark in
the central 80% diameter for circular crops. Export variants from these masters;
do not redraw the mark.

### Documentation evidence

The standard UI set is in [assets/](assets/) and listed in
[standard-screenshot-manifest.json](fixtures/standard-screenshot-manifest.json).
These captures predate the current domain split and polish pass, so they are
reference artwork rather than current release evidence:

- `fxaeon-web.png` — public landing, 1440 × 900
- `fxaeon-trade.png`, `fxaeon-token-picker.png`, `fxaeon-bridge.png`, and `fxaeon-login.png` — desktop app states, 1440 × 900
- `fxaeon-portfolio.png` and `fxaeon-docs.png` — desktop app states, 1440 × 900
- `fxaeon-trade-mobile.png` and `fxaeon-portfolio-mobile.png` — mobile states, 390 × 844

The four populated position images (`fxaeon-portfolio-positions.png`,
`fxaeon-positions.png`, `fxaeon-trade-connected.png`, and
`fxaeon-positions-mobile.png`) were refreshed by the browser gate at block
`25965421`. The matching [position manifest](fixtures/position-screenshot-manifest.json)
records browser-driven execution, the rendered IDs, hashes, and visibly labelled
illustrative display prices/charts. The landing desktop and mobile aliases both
use the all-four-position browser capture (`fxaeon-positions.png` and
`fxaeon-positions-mobile.png`). These images show fork state, not production
balances or actual market-price evidence; the
landing hero wash and card direction passed visual review after 14 theme/width
states with unchanged contrast minima. The latest standard recapture stopped
without promotion after saving five views (web, Trade, token picker, bridge,
and login). Portfolio's two-sparkline readiness timed out after 60 seconds on a
reused page, though a fresh isolated page displayed both charts without runtime
errors. Existing standard images and their manifest remain unchanged and
predate the current domain split. The landing's connected-position aliases are
separate, current browser-fork captures.

## Theme system

The app uses a 4px spacing rhythm and the Inter variable font. Prefer the
semantic CSS tokens in `apps/mini-app/src/app/globals.css` for new work.

| Role | Official theme | Dark theme | Light theme |
| --- | --- | --- | --- |
| Canvas | `#100e18` | `#090a0c` | `#f7f5fb` |
| Raised surface | `#15121e` | `#0e1013` | `#ffffff` |
| Primary text | `#f7f5fc` | `#f5f7fa` | `#251b35` |
| Muted text | `#b1a9bf` | `#a7b0bb` | `#71637f` |
| Accent | `#b9a0ff` | `#b9a0ff` | `#7341c8` |
| Success | `#53d5a0` | `#53d5a0` | `#128354` |
| Danger | `#ff5368` | `#ff5368` | `#c92b49` |
| Warning | `#f2b84b` | `#f2b84b` | `#90630c` |

Official is the default app palette. Dark is the neutral low-light variant;
light supports daylight and mobile use. The landing has a coordinated dark and
light theme controlled by its header theme button and saved on the device. Both
themes preserve clear contrast across the hero, product showcase, feature cards,
and closing panel: dark uses charcoal `#0d0b14`, lilac highlights, and paper
text; light uses pale lilac `#e8def7`, paper `#fbf9ff`, dark ink `#191225`, and
violet `#8060d6` for large display text. Lavender `#b89cf8` remains the primary
dark-theme accent. Keep the protocol mark separate from the FxAeon mark.

Landing headings use a system sans-serif stack, moderate tracking, and enough
line height to keep letterforms apart. The desktop hero header stays transparent
over the hero artwork. On mobile, the dimensional mark layers behind the
headline; retain the text scrim, contrast, and stacking order so the words and
actions remain readable. The product screenshot is larger on mobile; desktop
can pair the broad view with a phone view. Keep words, artwork, and controls
readable independently. Motion is limited to brief entrance and interaction
feedback, with reduced-motion support and visible no-JavaScript content. Avoid
repeating capability labels as decoration.

Use spacing tokens `--space-1` through `--space-6` and `--space-8` (4, 8, 12,
16, 20, 24, and 32px), plus the existing radius and elevation tokens. Keep
controls at least 44px tall.

## Typography and layout

- Use Inter and tabular numerals for prices and amounts.
- Use existing display classes for page titles and keep financial values legible.
- Keep body copy at 15–16px where space allows; labels and metadata have a 12px
  floor.
- The app shell uses 16px inline padding and a 52px header. Landing sections
  use the existing 1180px outer frame and 1000px reading frame.
- Pair the wordmark text with the mark; do not add a second wordmark to captures
  or social crops.

## Logo and safe-area rules

Use `public/icon.svg` or `FxLogo` for product UI. If future copy needs an f(x)
Protocol mark, use `fx-official-mark.svg`. Keep clear space around each mark
equal to at least the mark's short bar height.

For social work, start from the supplied masters in `assets/social/`. Test the
3:1 banner crop, and keep profile artwork centered and legible at 40px. Avoid
unrequested token logos, protocol marks, or price claims.

## Motion and accessibility

Use the existing 120ms and 180ms durations for small transitions and the spring
easing for deliberate surface movement. Honor `prefers-reduced-motion: reduce`.

Every interactive control needs a visible keyboard focus state, a 44px touch
target, and an accessible name. Pair state colors with text, preserve
forced-colors outlines, and label charts and meaningful token icons.

## Brand language and financial semantics

Use concrete action labels such as “Open ETH long,” “Borrow fxUSD,” and
“Connect wallet.” Avoid unverified claims about returns, liquidity, safety, or
execution speed.

Purple is the product accent and primary action color. Green means a confirmed
positive or completed state; red means a negative or failed state; amber means
attention or an incomplete read. These colors describe state and never replace
the words that explain it.

Display prices and charts are market observations, not execution quotes or
protocol-state proof. Keep that distinction in captures and retain fork
provenance. Do not add balances, positions, yield, or performance metrics to
brand assets.

## Export checklist

1. Start from a supplied master or manifest-backed UI capture.
2. Check theme, crop, 44px controls, contrast, and reduced motion.
3. Confirm that displayed balances, prices, and transaction states are observed
   data or clearly labelled illustrations.
4. Record dimensions, source, date, and provenance.

The previous 1500 × 500 banner and 1000 × 1000 profile files were superseded
by the supplied masters above and removed from this repository. The generated
navy social artwork is retired; only the supplied profile and banner are
approved social raster masters. No runtime code references the social masters;
they are maintained for export and review.
