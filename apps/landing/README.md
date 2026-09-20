# FxAeon landing

Standalone, dependency free static landing page for `fxaeon.xyz`. The page is intentionally independent from the financial app and sends product links to `https://fxaeon.com/` (the Portfolio app).

## Preview and build

```sh
cd apps/landing
npm run build
npm run serve
```

The build copies the static site to `dist/`; the server previews it at `http://localhost:4173` (or `PORT`). Any static host can deploy the contents of `dist/`.

From the repository root, use `pnpm build:landing` and `pnpm preview:landing`.
For Cloudflare Pages set the root directory to `apps/landing`, build command
to `node build.mjs`, and output directory to `dist`. Attach only `fxaeon.xyz`
to this project; `fxaeon.com` belongs to the financial app project.

Set `NEXT_PUBLIC_TELEGRAM_APP_URL` at build time to the bot or named mini-app
launcher (`https://t.me/<bot>[/<app>]`, optionally with `?startapp=...`).

The header, footer and favicon use the application's vector mark. The hero is a compressed dimensional interpretation of that mark; the supplied banner remains unchanged for social previews. Artwork provenance is in `docs/landing-art-prompt.md`. The Telegram CTA uses `https://t.me/FxAeonBot`.
