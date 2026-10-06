# FxAeon design contract

FxAeon presents onchain actions as a calm, precise workspace: one decision per surface, numbers as the hero, and violet reserved for intent. Prioritize clear transaction context, readable balances, and obvious next steps over decoration. Product screens use the "Aeon" system described below; the public landing page uses warm paper and ink around a dark, illustrative portfolio preview. The landing preview is static and its displayed balances are examples, not live data.

## Principles

1. **One surface per decision.** Depth comes from tone (`--bg` → `--surface` → `--surface-2` → `--surface-3`), not from boxes nested inside boxes. A raised control inside a card takes the next tone up instead of a border.
2. **Numbers lead.** Amounts and totals are large, tight, and tabular; units, cents, and labels recede.
3. **Violet means intent.** The accent marks the primary action, focus, the active selection, and the market's price line. Long and short use their semantic green and red; success, warning, and danger communicate state only.
4. **Alive, never misleading.** The canvas breathes behind every route on slow, offset loops; controls answer every hover and press; figures that change (prices, totals) roll to their new digits. Motion never fakes progress: transaction motion follows actual state, figures roll only when the value really changes and never count up from zero on load, and reduced motion removes loops, travel, and rolling.
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
| Charts | One 2px accent line over a fading fill, no grid, recessive axes; a crosshair reads exact values. Axis and crosshair times are in the viewer's time zone. Candlesticks stay one tap away. Sparklines take the direction color of their 24h change and draw in once |
| Headline figures | Portfolio and wallet totals stand on the canvas without a card: label, figure, actions directly beneath, a slow light behind the figure |
| Primary actions | Name what is still missing ("Enter an amount", "Borrow at most 0.6032 fxUSD") instead of sitting silently disabled. Enabled ones lift and catch one sheen on hover and compress on press |
| Settings | One gear per action card, at the right of its first row; quiet at the defaults, with a chip once something differs. Slippage presets plus a custom value up to 2%, and network speed; changes save at once for every open form |
| Page continuation | After the main action a page keeps going: live facts, how it works, questions, and risk notes, written from reviewed Docs and protocol copy and centered to the action's measure |

## Motion

| Tier | Tokens | Use |
| --- | --- | --- |
| Press | `--dur-press` 90ms | Compress on press (`scale(.97–.98)`), release on `--ease-spring` |
| Feedback | `--dur-fast` 140ms | Color, hover, chevrons |
| Content | `--dur-base` 220ms, `--ease-out` | Disclosures, status changes, route fades |
| Spatial | `--dur-slow` 340ms, `--ease-spring` | Thumbs, the dock highlight, the result mark |
| Sheets | `--dur-sheet` 420ms, `--ease-sheet` | Bottom sheets and anchored panels |

Exits are faster than entrances. Route content fades in once with opacity only, so tested geometry never shifts and fixed descendants keep their containing block. The living canvas (`body::before/::after`) drifts on 42s and 56s loops with transform only; sections below the main action rise in once as they are scrolled to. Related sheet/backdrop and disclosure/chevron effects start together. Transaction motion follows actual state changes, never a timer pretending a transaction progressed: a wallet prompt's status icon breathes only while the wallet waits, and a confirmed receipt draws its check once. Reduced motion removes travel, staggers, and loops.

## Layout baseline

Layouts are fluid at every phone width and height, never tuned to a few devices; check a sweep from 320 to 480px wide (including 412 × 818 Android Chrome) rather than one size. A form's primary action is never hidden behind the tab bar: it rests in the form when its place is on screen and otherwise rides just above the navigation (`StickyAction`). Center a stage only when its content fits, so nothing is stranded above the scroll top. Never hide facts, shrink tap targets, or clip content to fit. Amount fields keep the label and shortcuts above the amount and token, and the available balance beneath the token; the amount figure sizes to its own field width, stepping long exact values down to a 14px floor before they scroll.

## Interaction and content

Show the amount, asset, network, fees, minimum output, and other signing-relevant details before wallet approval. Reviews lead with the amount at stake and name the network; exact route data stays one disclosure away. Preserve explicit review and clear pending, success, and error states. A status names the exact request the wallet is showing (for example "Approve fxUSD (step 1 of 2)"). Wherever people verify an address (Receive, the Send review, a connected wallet), show it whole in reading groups of four with the first and last groups emphasized, and keep it copyable as one exact string; shortened forms such as `0x930f…98b9` belong only in compact chrome. Keep confirmation text factual and concise; do not imply an execution, return, endorsement, or protocol guarantee that the app has not established.

History says what each transaction did in plain words ("Swapped FXN + wstETH for ETH"): past tense once it is confirmed, the plain action while it is pending or after it failed. Amounts show five significant digits, truncated, with the exact value in a tooltip and a copyable line in the detail. A token outside FxAeon's canonical list always carries an "Unverified" marker, is never priced, and transactions that only brought such tokens stay behind a "Show unverified" toggle.

Forms keep labels attached to their controls, errors close to the affected field, and the primary action easy to find. A not-yet-actionable primary action reads as neutral, never as a dimmed accent. Disclosures may keep secondary detail collapsed, but their summaries must still communicate the relevant state. Notices show the state they announce. Icons supplement accessible names rather than replacing them.

## Public landing page

The landing page is a distinct brand surface: warm neutral paper, near-black editorial type, violet emphasis, and a restrained dark product illustration. Keep the Telegram action primary and the web app secondary. Describe only supported Trade, Earn, Borrow, Move, and protocol behavior. Maintain the responsive composition, theme toggle, keyboard navigation, and reduced-motion behavior when editing it.
