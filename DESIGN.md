# FxAeon design contract

FxAeon presents onchain actions as a compact, calm workspace. Prioritize clear transaction context, readable balances, and obvious next steps over decoration. Product screens use neutral layered surfaces with a violet accent; the public landing page uses warm paper and ink around a dark, illustrative portfolio preview. The landing preview is static and its displayed balances are examples, not live data.

## Product palette and geometry

`apps/mini-app/src/app/globals.css` defines the product color roles for the Official, Dark, and Light themes: `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--text`, `--mut`, `--line`, and `--mint` (the legacy accent token, currently violet). Use these roles instead of adding isolated colors for shared UI. Success, warning, and danger colors communicate state only. Theme choice data lives in `src/lib/theme.ts`; appearance swatches derive their colors from that same theme configuration.

Use the existing 4px spacing rhythm and radius tokens (`--radius-sm`, `--radius-md`, `--radius-lg`). Keep borders and elevation restrained; reserve stronger elevation for overlays and transaction review. Controls should have at least a 44px target, with primary actions generally 48px or taller. Preserve visible keyboard focus, reduced-motion support, and contrast in every theme.

| Role | Contract |
| --- | --- |
| Related controls | 8px gap |
| Cards | 12–16px padding; 16px radius for form surfaces |
| Sections | 20px separation |
| Compact controls / sheets | 10px / 24px radius |
| Type | Inter; tabular figures for balances and amounts; existing shared heading and amount styles |
| Motion | 120–180ms for feedback; respect `prefers-reduced-motion` |

At 393 × 852, healthy default forms and collapsed reviews must show their complete primary action above bottom navigation. Expanded details, errors, enlarged text, and shorter viewports may scroll naturally. Never hide facts, shrink tap targets, or clip content to satisfy this baseline. Amount fields keep the label and shortcuts above the amount and token; the available balance sits beneath the token.

## Interaction and content

Show the amount, asset, network, fees, minimum output, and other signing-relevant details before wallet approval. Preserve explicit review and clear pending, success, and error states. Unknown, unavailable, or stale financial data must remain distinguishable from zero. Keep confirmation text factual and concise; do not imply an execution, return, endorsement, or protocol guarantee that the app has not established.

Forms should keep labels attached to their controls, errors close to the affected field, and the primary action easy to find. Disclosures may keep secondary detail collapsed, but their summaries must still communicate the relevant state. Icons supplement accessible names rather than replacing them.

## Public landing page

The landing page is a distinct brand surface: warm neutral paper, near-black editorial type, violet emphasis, and a restrained dark product illustration. Keep the Telegram action primary and the web app secondary. Describe only supported Trade, Earn, Borrow, Move, and protocol behavior. Maintain the responsive composition, theme toggle, keyboard navigation, and reduced-motion behavior when editing it.
