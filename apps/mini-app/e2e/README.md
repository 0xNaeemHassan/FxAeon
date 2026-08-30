# Mini App end-to-end tests

The Playwright suite runs against the real static export and a small local file server. It uses empty Privy and RPC configuration, so it covers mobile routing, Telegram viewport behavior, accessibility, unavailable states, and the client-only boundary without touching a wallet or production chain.

## Run the suite

From the repository root:

```bash
pnpm test:e2e
```

To update snapshots intentionally:

```bash
pnpm test:e2e -- --update-snapshots
```

## Artifact behavior

`e2e/serve.mjs` builds `dist/` when needed and serves clean Cloudflare-style routes. Set `E2E_BUILD=0` to reuse an already verified export; CI uses this after its single explicit build. Set `E2E_REUSE_SERVER=1` only for local iteration when reusing a known-good process. Release verification leaves it disabled so stale servers cannot hide a build issue.

The suite must not require an HTTP API, intercept backend endpoints, or use production credentials.
