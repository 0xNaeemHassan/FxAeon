# Release verification

The release process is intentionally layered. Credential-free checks run on every change; a local-fork gate is opt-in because it needs an operator-supplied provider endpoint.

## Automated gates

- `pnpm verify`: aggregate release gate covering scope, lint, types, unit tests, the seeded chaos campaign, high-severity production dependency audit, static build, bundle budget, and built-artifact Playwright tests.
- `pnpm verify:scope`: exact 15-method SDK contract, installed SDK patch and wallet dependency compatibility, allowed routes, and no active backend/delegated-signing imports.
- `pnpm typecheck` and `pnpm lint`: strict client compilation and static checks.
- `pnpm test`: transaction normalization, validation, approval, nonce, lock, journal, receipt ordering, and failure-stop tests.
- `pnpm test:chaos`: seeded property-style route and runner campaigns. It mutates sender, chain, target, selector, value, operation, nonce, and route shape, then injects wallet rejection, on-chain reverts, and receipt-RPC outages. Set `FX_CHAOS_SEED`, `FX_CHAOS_ITERATIONS`, or `FX_CHAOS_RUNNER_ITERATIONS` to reproduce or expand a campaign.
- `pnpm test:anvil`: opens and verifies one real ETH long, ETH short, BTC long, and BTC short through the official SDK in a single protected mainnet-fork snapshot.
- `pnpm test:anvil:stress`: runs only the fast randomized snapshot and dummy ordered-route transport campaign against a protected fork.
- `pnpm test:anvil:all`: runs the real protocol proof and transport stress against one fork process.
- `pnpm test:anvil:browser`: builds the local-fork app, opens ETH/BTC long/short positions through the mobile browser's review/confirmation UI, checks the resulting contract state and position surfaces, and captures the populated UI before restoring its snapshot. This is a separate gate from the Node-runner proof.
- `pnpm test:stress`: runs the credential-free chaos campaign and then the protected dummy-route fork stress. It does not replace the real protocol proof.
- `pnpm test:e2e`: browser entry without Telegram, official-route and mobile/Telegram viewport navigation, semantic landmarks, 44px controls, no horizontal overflow at 320/360/375/390/412/430px, honest disconnected state, deterministic current-price and market-history validation, and absence of backend traffic.
- `pnpm build`: browser-only static export with no Node runtime.
- `pnpm check:bundle`: checks total, JavaScript, gzip, and largest-asset budgets and scans the export for forbidden telemetry and server artifacts.

## Installed dependency verification

After changing a dependency patch, verify the installed code as well as the
lockfile. An incremental install can retain an unpatched transitive package
even when its lockfile records the patch hash. The scope gate checks both SDK
module formats and exercises WalletConnect's query decoder; a missing patch
fails before build or execution. Recover with a clean frozen dependency
install, then rerun `pnpm verify`. Do not repair `node_modules` manually or
bypass the installed-patch checks. CI starts from a clean checkout.

`test/sdk-debt-ratio-packing.test.ts` also executes the installed SDK's pure
packing helper in both module formats. It checks exact 60-bit round trips,
representative limits, and invalid inputs. This protects against a rounded
packed integer silently changing the on-chain minimum. The protected Anvil
workflow runs the installed-dependency and packing checks before any route.

## Anvil fork testing

`pnpm test:anvil` starts a disposable local Anvil fork of Ethereum mainnet, safely funds an unlocked account with fork-only USDC impersonation, and uses the official SDK plus the production route validator/runner to open all four ETH/BTC long/short positions before tearing the node down. It requires Foundry's `anvil` binary (or an executable path in `ANVIL_BIN`) and a fresh, restricted provider endpoint supplied at invocation time. Set `ANVIL_FORK_URL` explicitly, or let the runner use `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` as its reviewed Ethereum fallback:

```powershell
$env:ANVIL_FORK_URL = (Get-Secret FXAEON_ANVIL_FORK_URL -AsPlainText)
pnpm test:anvil
```

The upstream endpoint is consumed only by the Anvil parent process: the harness redacts it from output and removes provider, Telegram, wallet, Privy, and deployment credentials from the test child environment. `ANVIL_FORK_BLOCK` pins a reproducible block, `ANVIL_PORT` selects the local port (default `8547`), `FX_ANVIL_POSITION_USDC` adjusts the Node protocol fixture amount, and `FX_ANVIL_ITERATIONS` applies only to the separate stress suite. The protocol proof re-reads all four positions after creation to prove simultaneous ownership and nonzero collateral/debt, reverts its root snapshot, and atomically writes a validated manifest under `artifacts/anvil/protocol-proof.json`. The manifest includes public pool addresses, local transaction hashes, position IDs, block numbers, and raw state; it excludes the upstream endpoint, provider credential, donor address, and Anvil signer material.

The parent rejects occupied loopback ports before starting Anvil or removing an old proof manifest. Port values must be decimal integers from `1024` through `65535`; browser and Anvil ports must differ. Local readiness requests are bounded, reject redirects, and verify both Ethereum chain ID and the Anvil client identity. Handled interruptions stop this run's owned process trees and do not start subsequent children.

For the protected GitHub environment, dispatch `.github/workflows/anvil-fork.yml` from `main`. It installs pinned Foundry `v1.8.1` through a commit-pinned official action and exposes the protected `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` secret only to the harness as `ANVIL_FORK_URL`. This workflow revision runs the Node four-position proof, transport stress (64 iterations by default), and the separate mobile browser gate; it installs Chromium before the browser step. Evidence under `artifacts/anvil/` is retained for 14 days. Supply `fork_block` at dispatch time, or configure the non-secret protected `ANVIL_FORK_BLOCK` variable, to make release evidence reproducible. The README badge filters to the latest completed `workflow_dispatch` run on `main`. All three suites must succeed for this workflow revision to be green; an older green run without the browser step is not browser-execution evidence.

Keep `pnpm verify` credential-free. Run this fork gate only in a protected local or CI secret context, and rotate any credential that has appeared in chat, shell history, or logs.

### Browser position acceptance

Install the Playwright Chromium runtime once, then run the dedicated gate with the same restricted upstream fork endpoint:

```powershell
pnpm --dir apps/mini-app exec playwright install chromium
$env:ANVIL_FORK_URL = (Get-Secret FXAEON_ANVIL_FORK_URL -AsPlainText)
pnpm test:anvil:browser
```

`FX_FORK_BROWSER_PORT` selects its loopback web server (default `4325`). The gate uses a disposable Anvil account funded with fork-only USDC. A test-side EIP-1193 adapter forwards the application's wallet transaction requests to that local node; it is not shipped as a product signer and cannot connect to the upstream provider. Position-ID discovery is adapted because public indexers cannot observe fork-local blocks. Planning, review, simulation, transaction execution, receipts, ownership, collateral, and debt are not replaced with fixture values.

The expected evidence is `artifacts/anvil/browser-proof.json`, review/confirmation screenshots, and populated documentation captures under `artifacts/anvil/browser/docs/`. A successful manifest must declare browser-driven execution and snapshot restoration. Presence of screenshots, a built harness, or a passing Node-runner test alone is not a browser gate pass. Inspect a successful run for the current commit before reporting this gate complete. Wallet-drawer checks on Earn and Move verify access to protocol exposure, not fxSAVE deposits or cross-chain bridge execution.

## Capability acceptance

| Flow | Required cases |
| --- | --- |
| positions | ETH/BTC × long/short; empty and multiple positions; provider read failure |
| open/increase | supported inputs; new/existing ID; approval/no approval; route alternatives |
| reduce/close | partial/full; NFT approval/no approval; stale position |
| leverage | increase/decrease; bounds; nonce drift |
| deposit/mint | deposit-only, mint-only, combined, existing/new long position |
| repay/withdraw | repay-only, withdraw-only, combined, exact debt |
| fxSAVE reads | config, zero/nonzero balance, no pending/queued/claimable redemption |
| fxSAVE deposit | USDC, fxUSD, fxUSD base-pool input |
| fxSAVE withdrawal | direct base-pool, queued, instant USDC/fxUSD |
| fxSAVE claim | cooldown incomplete and complete |
| bridge | both directions, fxUSD/fxSAVE, self/custom recipient, signer-safe refund, exact Ethereum approval, insufficient fee, delayed/reloaded destination verification, dust-adjusted sends, matching LayerZero source/destination GUID |

Every transaction case must prove chain and parameter correctness, visible plan and simulation, explicit approval per step, preserved order, successful receipt before continuation, failure-stop behavior, one additional block, and a fresh authoritative read.

Mainnet-fork impersonation or protocol-supported safe simulation is required for money-path integration tests. Production user funds are never a fixture. Current Chrome, Firefox, Safari, and Edge plus Telegram Android, iOS, Desktop, and Web must pass the applicable manual interaction checks before production promotion.

The browser suite deliberately keeps accessibility checks dependency-light: route landmarks, labels, keyboard-visible focus, target sizing, and overflow are asserted directly. A full axe scan and real-device Telegram pass remain promotion-time checks when those environments are available.

## Documentation captures

The standard capture command covers the landing page, Trade workspace, token picker, Move, login, disconnected Portfolio, and 390 × 844 mobile Trade/Portfolio views. Mobile Portfolio uses the official light theme; the other standard views use official dark. Start the static export locally, then run `pnpm docs:screenshots` in another terminal. `FX_SCREENSHOT_BASE_URL` can select a different loopback HTTP origin; it defaults to `http://localhost:4321`.

```powershell
pnpm build
node apps/mini-app/e2e/serve.mjs
# In another terminal:
pnpm docs:screenshots
```

Display prices and CoinGecko history are unmodified external data by default. Unavailable providers produce the application's honest unavailable states. For deterministic design regression only, set `FX_SCREENSHOT_MARKET_DATA=fixture`; every resulting image is visibly labelled **Illustrative prices & charts**, and the capture report records that mode. Synthetic display data is never execution, oracle, PnL, or return evidence.

For populated positions, prefer the browser gate's staged captures: it reuses the four positions that the UI just opened, without rebuilding the app or opening a second fixture. Alternatively, `pnpm docs:screenshots:positions` starts a disposable fork and creates all four positions through the production Node runner before capturing. The latter verifies rendered fork state, not browser transaction execution. Both paths use exact, validated fork-local position discovery and a read-only capture wallet identity. See [Fork-backed position screenshots](position-screenshot-fixture.md) for controls, outputs, provenance, staging, and snapshot cleanup.

Review the generated image files and capture report before promoting them into `docs/assets/`. The report records rendered IDs, viewports, image hashes, and whether display data was external or illustrative. A successful capture is evidence for those images; do not assume previously checked-in screenshots share a newer run's provenance.

Capture checks compare document and Chromium viewport offsets before and after each frame and reject displaced headers or navigation. The compact [standard screenshot manifest](fixtures/standard-screenshot-manifest.json) records the committed images and hashes; the full local capture report retains scroll measurements.
