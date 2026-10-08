# FxAeon landing

Standalone, dependency free static landing page for `fxaeon.xyz`. The page is intentionally independent from the financial app and sends product links to `https://fxaeon.com/` (the Portfolio app).

## Preview and build

```sh
cd apps/landing
npm run build
npm run serve
```

The build copies the static site to `dist/`; the server previews it at `http://localhost:4173` (or `PORT`). Any static host can deploy the contents of `dist/`. Build-time assets are checked in, so building needs Node.js but no installed package dependencies. The four static feature icons are generated from the app's pinned Lucide components and license; the landing test suite verifies them against those workspace dependencies. The Telegram QR code is drawn during the build by `qr.mjs` from the launcher URL, and the tests compare that encoder module for module with the app's pinned `qrcode.react`. Every file under `assets/` must be referenced by the page, its styles, or its metadata; the tests fail on an unreferenced one.

From the repository root, use `pnpm build:landing` and `pnpm preview:landing`.
For Cloudflare Pages set the root directory to `apps/landing`, build command
to `node build.mjs`, and output directory to `dist`. Attach only `fxaeon.xyz`
to this project; `fxaeon.com` belongs to the financial app project.
The Wrangler config pins the Pages build image to Node `22.23.2` and sets
`SKIP_DEPENDENCY_INSTALL=true`; the standalone build uses the checked-in SVGs
and must remain independent of `node_modules`. Keep these build controls in
`wrangler.toml` instead of duplicating them in dashboard variables. Set the Pages build watch
include path to `apps/landing/*` (leave excludes empty) so changes elsewhere in
the monorepo do not start another landing build.

Set `NEXT_PUBLIC_TELEGRAM_APP_URL` at build time to the bot or named mini-app
launcher (`https://t.me/<bot>[/<app>]`, optionally with `?startapp=...`).

The header, footer, finale, and favicon use the application's vector mark; the supplied banner remains unchanged for social previews. The Telegram CTA uses `https://t.me/FxAeonBot`.

The header is the brand, the theme toggle, the device's action (from 560 px, where it fits), and a Menu pill at every width. The menu is a native modal `<dialog>` (`showModal()`, so the browser traps focus, makes the page inert, and closes it on Escape) that grows out of the pill as a clip-path circle, or fades under reduced motion. It repeats the header bar, so its Close pill sits exactly where the Menu pill was, and holds the page's sections in a ruled list (Features unfolds to the four screens), the bot's QR code and the web app on desktop or "Open in Telegram" on phones, and links to Telegram, GitHub, and the docs. Without script there is no Menu pill.

The actions follow the device, by CSS media queries alone. A wide screen with a fine pointer (`(hover: hover) and (pointer: fine) and (min-width: 861px)`) leads with "Open web app" and shows the QR code beside "Open in Telegram"; phones, tablets, and narrow windows lead with Telegram. There, each section's button opens its screen in the Mini App with a start parameter (`https://t.me/FxAeonBot?startapp=trade`), which the app maps to a route through a fixed list, and the web page stays as the quieter second link. Telegram opens `startapp` links in the bot's Main Mini App, so the bot needs one configured in BotFather (Bot Settings, Configure Mini App).

The page is three files: `index.html` (content and HTML renderings of the app with example values), `styles.css`, and two scripts. "How f(x) Protocol works" explains the split, the brake, the peg, and the stability pool with instruments whose numbers are arithmetic on a stated premise or the f(x) docs' published table; "What runs when you tap" lists the fifteen SDK methods locked in `docs/sdk-scope.md`, and the static tests keep both in step with those sources. `script.js` loads in `<head>` so the saved theme (`fxaeon-theme`) applies before the first paint, then runs the menu, theme transition, chapters, reveals, and pointer response. `aurora.js` draws the WebGL aurora; without WebGL, with Save-Data, or under reduced motion the CSS still frame remains. Both run under the strict CSP in `_headers`: no inline code or styles, and no network access.

`npm test` checks the markup, policy, motion rules, and build; `pnpm test:landing:browser` (from the root, after a build) checks every theme at eight widths, including text contrast measured against the painted aurora, then the menu at 320, 390, and 1280 px in both themes (focus trap, Escape and focus return, scroll lock, section links landing below the header, contrast, no horizontal overflow) and once with motion, then the device-aware actions on phones, a tablet, and a desktop, and that the hero leaves the phone mockup's top edge on a 360–430 px phone's first screen.
