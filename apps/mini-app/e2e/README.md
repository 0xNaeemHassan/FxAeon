# Mini App E2E

The Playwright suite runs against the real static export and a tiny local file
server. It uses empty Privy/RPC configuration, so tests cover mobile routing,
Telegram viewport behavior, accessibility, unavailable states, and the
client-first boundary without touching a wallet or production chain.

## Run

```bash
pnpm test:e2e
pnpm test:e2e -- --update-snapshots
```

`e2e/serve.mjs` builds `dist/` when needed and serves clean Cloudflare-style
routes. For a previously verified export, set `E2E_BUILD=0` to reuse the build
(the CI workflow does this after its one explicit build). Server-process reuse
is separate and explicit through `E2E_REUSE_SERVER=1`; release verification
never opts in, so it cannot accidentally test a stale local process. The suite
must not require an HTTP API or intercept backend endpoints.
