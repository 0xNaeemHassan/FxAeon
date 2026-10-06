# FxAeon design contract

FxAeon presents onchain actions as a calm, precise workspace: one decision per surface, numbers as the hero, and violet reserved for intent. Prioritize clear transaction context, readable balances, and obvious next steps over decoration. Product screens use the "Aeon" system described below; the public landing page sets the brand on an aurora field around HTML renderings of the app. Its phones and review show example values, never live data, and assistive technology hears them described as examples.

## Principles

1. **One surface per decision.** Depth comes from tone (`--bg` → `--surface` → `--surface-2` → `--surface-3`), not from boxes nested inside boxes. A raised control inside a card takes the next tone up instead of a border.
2. **Numbers lead.** Amounts and totals are large, tight, and tabular; units, cents, and labels recede.
3. **Violet means intent.** The accent marks the primary action, focus, the active selection, and the market's price line. Long and short use their semantic green and red; success, warning, and danger communicate state only.
4. **Motion explains state.** Every animation corresponds to a real change: a surface opening, a selection moving, a receipt confirming. Nothing loops for decoration, and financial values never count or roll on refresh.
5. **Honest states.** Unknown, unavailable, or stale data stays distinguishable from zero, and placeholders reserve the final geometry.

## Tokens

`apps/mini-app/src/app/globals.css` is the single source of truth for every live token in the Official, Dark, and Light themes. `src/lib/theme.ts` only holds the preview and host-chrome colors used by the appearance swatches and Telegram; it never writes tokens inline.

| Group | Tokens | Use |
| --- | --- | --- |
| Surfaces | `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--hairline`, `--line` | Canvas, cards, inner panels, selected and pressed states, optional separators |
| Text | `--text`, `--mut`, `--mut-2` | Primary, secondary (≥5.5:1), tertiary (≥4.5:1) on `--surface` and `--surface-2` in every theme |
| Intent | `--mint` (the accent, violet), `--mint-bright`, `--mint-dim`, `--on-accent` | Primary action, focus, active selection |
| State | `--success`, `--warn`, `--danger` and their `-dim` tints; `--long`, `--short` | Status and position side only |
| Overlay | `--scrim`, `--glass`, `--glass-strong`, `--elevation-1/2`, `--ring-inset` | Sheets, the navigation dock, floating panels |

Type follows one scale: `--fs-micro` 11, `--fs-caption` 12, `--fs-small` 13, `--fs-body` 15, `--fs-title` 17, `--fs-heading` 22, `--fs-display` 28, `--fs-amount` 38, and `--fs-hero` 44 (px). Inter with tabular figures; large figures use weight 500–600 with `--tracking-figure`.

Geometry uses the 4px rhythm and `--radius-xs` 8, `--radius-sm` 12, `--radius-md` 16 (amount panels, inner tiles), `--radius-lg` 24 (cards), and `--radius-xl` 28 (sheets, hero). Controls keep at least a 44px target; primary actions are 52px. Preserve visible keyboard focus and contrast in every theme.

| Role | Contract |
| --- | --- |
| Related controls | 8–10px gap |
| Cards | 16–20px padding; 24px radius |
| Sections | 18–20px separation |
| Segmented controls | Tinted container with a sliding thumb (`data-thumb`, `--seg-index`, `--seg-count`) |
| Navigation | Floating dock on phones whose highlight travels between routes; pill navigation on desktop |
| Charts | One 2px accent line over a fading fill, no grid, recessive axes; a crosshair reads exact values. Candlesticks stay one tap away. Sparklines take the direction color of their 24h change |

## Motion

| Tier | Tokens | Use |
| --- | --- | --- |
| Press | `--dur-press` 90ms | Compress on press (`scale(.97–.98)`), release on `--ease-spring` |
| Feedback | `--dur-fast` 140ms | Color, hover, chevrons |
| Content | `--dur-base` 220ms, `--ease-out` | Disclosures, status changes, route fades |
| Spatial | `--dur-slow` 340ms, `--ease-spring` | Thumbs, the dock highlight, the result mark |
| Sheets | `--dur-sheet` 420ms, `--ease-sheet` | Bottom sheets and anchored panels |

Exits are faster than entrances. Route content fades in once with opacity only, so tested geometry never shifts and fixed descendants keep their containing block. Related sheet/backdrop and disclosure/chevron effects start together. Transaction motion follows actual state changes, never a timer pretending a transaction progressed: a wallet prompt's status icon breathes only while the wallet waits, and a confirmed receipt draws its check once. Reduced motion removes travel, staggers, and loops.

## Layout baseline

At 393 × 852, healthy default forms and collapsed reviews must show their complete primary action above bottom navigation. Expanded details, errors, enlarged text, and shorter viewports may scroll naturally. Never hide facts, shrink tap targets, or clip content to satisfy this baseline. Amount fields keep the label and shortcuts above the amount and token; the available balance sits beneath the token.

## Interaction and content

Show the amount, asset, network, fees, minimum output, and other signing-relevant details before wallet approval. Reviews lead with the amount at stake and name the network; exact route data stays one disclosure away. Preserve explicit review and clear pending, success, and error states. A status names the exact request the wallet is showing (for example "Approve fxUSD (step 1 of 2)"). Wherever people verify an address (Receive, the Send review, a connected wallet), show it whole in reading groups of four with the first and last groups emphasized, and keep it copyable as one exact string; shortened forms such as `0x930f…98b9` belong only in compact chrome. Keep confirmation text factual and concise; do not imply an execution, return, endorsement, or protocol guarantee that the app has not established.

Forms keep labels attached to their controls, errors close to the affected field, and the primary action easy to find. A not-yet-actionable primary action reads as neutral, never as a dimmed accent. Disclosures may keep secondary detail collapsed, but their summaries must still communicate the relevant state. Notices show the state they announce. Icons supplement accessible names rather than replacing them.

## Public landing page

The landing page (fxaeon.xyz) is the brand's stage: dark first, with a light theme, an aurora field, editorial type, and the real product rendered in HTML. Keep the Telegram action primary and the web app secondary, and describe only supported Trade, Earn, Borrow, Move, and protocol behavior in the Docs' reviewed wording.

| Element | Contract |
| --- | --- |
| Aurora | `aurora.js` draws curtains of light in raw WebGL at a fraction of screen resolution and at most 30 frames a second. They hang high above the hero, dim through the middle of the page, and settle behind the finale. The CSS gradient beneath is the still frame and the fallback. Curtain colors are capped so text keeps WCAG AA on the brightest frame; `scripts/verify_landing_browser.mjs` measures contrast against the painted pixels |
| Phones | HTML screens in the app's Official theme, with a status bar and its tab bar. Illustrations are `role="img"` with labels that call them examples, and contain no controls |
| Chapters | From 960px one pinned phone follows the chapter at the middle of the screen: its screen slides in from the side it comes from and its tab highlight travels. Narrower screens stack a phone inside each chapter |
| Motion | Arrivals settle within a few seconds. Loops are slow and confined to ambient regions (`data-ambient`). Reduced motion shows every section in place, removes transitions, and holds one aurora frame |
| Policy | No inline styles or scripts, no network requests, no runtime dependencies. States that wait for script are gated on `:root[data-js]`, so the page is complete without it |
