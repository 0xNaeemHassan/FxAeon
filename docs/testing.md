# Testing

Run commands from the repository root. The release gate is:

```powershell
pnpm verify
```

It checks SDK scope and architecture, builds/tests the landing site, runs lint
and source tests, audits production dependencies, builds the static app, then
checks types, bundle and secrets, built-browser behavior, and landing-browser
behavior. `.github/workflows/ci.yml` runs this gate on pushes and pull requests.

Useful focused checks:

| Command | Coverage |
| --- | --- |
| `pnpm test` | App unit, contract, and seeded chaos tests; fork-dependent cases skip without a fork |
| `pnpm test:chaos` | Deterministic lifecycle, ordering, and recovery stress |
| `pnpm test:e2e` | Playwright against the static app build |
| `pnpm test:landing` | Standalone landing static contracts |
| `pnpm test:landing:browser` | Landing behavior, theme, viewport, accessibility, and network checks |
| `pnpm typecheck` | App and fork-harness TypeScript |
| `pnpm audit --prod --audit-level=high` | Runtime dependency audit |

For local Playwright runs, Chromium may be installed with:

```powershell
pnpm --dir apps/mini-app exec playwright install chromium
```

## Protected Ethereum fork tests

Fork tests use disposable local Anvil nodes, test accounts, and an operator-
provided Ethereum RPC endpoint. They interact with protocol state on a local
fork; they do not send transactions using production funds. Keep the endpoint
restricted and out of source control.

```powershell
$env:ANVIL_FORK_URL = '<restricted Ethereum RPC URL>'
pnpm test:anvil:all
pnpm test:anvil:browser
```

`pnpm test:anvil:all` runs protocol, fxSAVE lifecycle, and stress suites.
`pnpm test:anvil:browser` exercises position actions through the browser. The
protected manual workflow `.github/workflows/anvil-fork.yml` runs these gates
and uploads redacted proof manifests; it requires the protected Ethereum RPC
secret and Foundry/Anvil.

## Screenshot evidence

`pnpm docs:screenshots` refreshes standard UI captures using external display
data. The checked-in `docs/fixtures/standard-screenshot-manifest.json` records
the capture context, routes, viewports, and hashes. Those screenshots document
rendered states; they are not transaction evidence.

`pnpm docs:screenshots:positions` and the browser fork fixture have separate
manifests. The current populated-position screenshots were captured during the
browser fork proof at a pinned block; see
[`position-screenshot-fixture.md`](position-screenshot-fixture.md). Their
position state is fork-backed, while displayed prices and charts are visibly
labelled illustrative data. Neither screenshots nor manifests replace test
assertions.

No browser emulation establishes native Telegram authentication, wallet
handoff, or a real bridge transfer. Keep those claims separate from automated
browser and fork results.
