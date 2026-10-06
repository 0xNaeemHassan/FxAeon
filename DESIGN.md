# FxAeon design contract

FxAeon presents onchain actions as a calm, precise workspace: one decision per surface, numbers as the hero, and violet reserved for intent. Prioritize clear transaction context, readable balances, and obvious next steps over decoration. Product screens use the "Aeon" system described below; the public landing page uses warm paper and ink around a dark, illustrative portfolio preview. The landing preview is static and its displayed balances are examples, not live data.

## Principles

1. **One surface per decision.** Depth comes from tone (`--bg` → `--surface` → `--surface-2` → `--surface-3`), not from boxes nested inside boxes. A raised control inside a card takes the next tone up instead of a border.
2. **Numbers lead.** Amounts and totals are large, tight, and tabular; units, cents, and labels recede.
3. **Violet means intent.** The accent marks the primary action, focus, the active selection, and the market's price line. Long and short use their semantic green and red; success, warning, and danger communicate state only.
4. **Motion explains state.** Every animation corresponds to a real change: a surface opening, a selection moving, a receipt confirming. Nothing loops for decoration, and financial values never count or roll on refresh.
5. **Honest states.** Unknown, unavailable, or stale data stays distinguishable from zero, and placeholders reserve the final geometry. A placeholder announces what it is waiting for ("Loading fxSAVE APY") and only says "unavailable" once a read has failed.

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
| Charts | One 2px accent line over a fading fill, no grid, recessive axes; a crosshair reads exact values. Axis and crosshair times are in the viewer's time zone. Candlesticks stay one tap away. Sparklines take the direction color of their 24h change |

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

The landing page is a distinct brand surface: warm neutral paper, near-black editorial type, violet emphasis, and a restrained dark product illustration. Keep the Telegram action primary and the web app secondary. Describe only supported Trade, Earn, Borrow, Move, and protocol behavior. Maintain the responsive composition, theme toggle, keyboard navigation, and reduced-motion behavior when editing it.
