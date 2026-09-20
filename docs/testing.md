# Release verification

The release process is intentionally layered. Credential-free checks run on every change; a local-fork gate is opt-in because it needs an operator-supplied provider endpoint.

## Current evidence boundary

The final browser fork proof is recorded in
`artifacts/anvil/browser-proof.json` at block `25965421`. It is a browser-driven
proof of four coexisting ETH/BTC long and short positions, external discovery,
account/ownership isolation, the existing-long borrow handoff, all four direct
closes, and snapshot restoration. The final successful retry is logged in
`%TEMP%/fxaeon-final-browser-fork-retry.log`; the proof manifest was validated.

The final all-suite Anvil run passed `4/4` tests with no failures or skips in
`280.6` seconds. It covered the position protocol proof, fxSAVE Earn lifecycle,
and both stress campaigns. Its log is `%TEMP%/fxaeon-final-all-fork.log`; the
validated protocol and Earn manifests are `artifacts/anvil/protocol-all-proof.json`
and `artifacts/anvil/earn-proof.json`. The browser-fork retry also passed: four
positions were opened and closed, the existing ETH long was used for the fxUSD
borrow handoff, index-lag recovery and account isolation were verified, viewport
checks completed, and the snapshot was restored. That browser proof is separate
from the Node-runner test count above.

The four promoted documentation captures were rendered during the browser gate
and are recorded in `docs/fixtures/position-screenshot-manifest.json` with
`executionSurface: browser`. They use visibly labelled illustrative display
prices/charts, while position ownership and accounting come from the fork. The
standalone `pnpm docs:screenshots:positions` command is a separate Node-runner
capture path; it proves rendered fork state, not browser transaction execution.

Final verification passed on PR `#193` head
`064229b6fb6640f9d16087ab48da13e85b05f356`: all six CI checks passed, including
Client CI's full `pnpm verify` with exit code `0` and built-artifact browser
E2E. The earlier local aggregate counted `380` source/unit checks (`376` passed,
`4` skipped); its initial browser attempt reached `108/109` and exited `1` on
stale-preview test scheduling. After test-only scheduling hardening, the
focused harness passed `3/3` across two workers and the complete browser suite
passed `109/109` in 5.8 minutes; see
`%TEMP%/fxaeon-final-109-e2e-identity.log`. Full and production dependency
audits report zero known vulnerabilities. Two pre-existing high-severity
development-dependency findings were resolved by updating `js-yaml` to `4.3.2`
and Miniflare's nested `sharp` to `0.35.4`. Final lint passed with zero warnings.
Native Privy and Telegram flows, device-specific wallet behavior, and bridge
destination delivery remain unverified.

The strengthened current-development check with Privy configured passed on
`localhost:4321`: `/`, `/trade`, and `/positions` rendered with the saved light
preference and remained stable for three seconds after the visible Connect
wallet control appeared. It reported no hydration warnings or page errors, and
the Trade token picker opened. With Privy configured, server rendering can show
the existing “Loading FxAeon” shell until the provider chunk mounts; this is a
provider-loading state, not an authentication gate. The check did not exercise
Privy sign-in, email or Telegram authentication, or wallet signing, and is
separate from the credential-free aggregate run.

## Automated gates

- `pnpm verify`: aggregate release gate covering scope, lint, contract checks (including live public configuration), types, unit tests, the seeded chaos campaign, strict high-severity production dependency audit, static build, bundle budget, and built-artifact Playwright tests. Registry failures are not ignored.

The verification build overrides local Privy/RPC and fork settings with
`scripts/e2e_build_env.mjs`, so `.env.local` cannot change deterministic browser
fixtures. Use a separate normal build to inspect configured Privy authentication;
its allowed origins must include the preview host. Mocked login tests do not
prove email delivery, native Telegram authentication, or external-wallet handoffs.

- `pnpm verify:scope`: exact 15-method SDK contract, installed SDK patch and wallet dependency compatibility, allowed routes, and no active backend/delegated-signing imports.
- `pnpm verify:architecture`: credential-free source boundary check. Direct SDK imports are limited to the audited façade/display adapters, and app-layer worker authority (`new Worker`, `SharedWorker`, service-worker registration, or `importScripts`) is rejected.
- `pnpm typecheck` and `pnpm lint`: strict client compilation and static checks.
- `pnpm test`: transaction normalization, validation, approval, nonce, lock, journal, receipt ordering, and failure-stop tests.
- `pnpm --dir apps/mini-app exec tsx --test test/live-market.test.ts test/market-data.test.ts test/coalesced-read.test.ts test/wallet-assets.test.ts test/realtime-chain.test.ts test/wallet-demand.test.ts`: deterministic market-feed, coalesced-retry, route-demand, and wallet-pulse checks, including malformed/stale Coinbase ticks, candle fallback, monotonic updates, reconnect backoff, concurrent-read sharing, informational-route coldness, exact indexed balances, duplicate assets, partial networks, and reviewed WebSocket URL handling.
- `pnpm test:chaos`: seeded property-style route and runner campaigns. It mutates sender, chain, target, selector, value, operation, nonce, and route shape, then injects wallet rejection, on-chain reverts, and receipt-RPC outages. Set `FX_CHAOS_SEED`, `FX_CHAOS_ITERATIONS`, or `FX_CHAOS_RUNNER_ITERATIONS` to reproduce or expand a campaign.
- `pnpm test:anvil`: opens and verifies one real ETH long, ETH short, BTC long, and BTC short through the official SDK, then deposits collateral and borrows real fxUSD against the existing ETH long while proving its ID is preserved and both debt and wallet balance increase, all in a single protected mainnet-fork snapshot.
- `pnpm test:anvil:earn`: exercises real fxSAVE deposits, instant and queued withdrawals, cooldown/claim, and direct base-pool paths with disposable fork funds.
- `pnpm test:anvil:stress`: runs only the fast randomized snapshot and dummy ordered-route transport campaign against a protected fork.
- `pnpm test:anvil:all`: runs the real position proof, transport stress, and Earn proof serially against one fork process.
- `pnpm test:anvil:browser`: builds the local-fork app, opens ETH/BTC long/short positions through the mobile browser's inline action-details, final-rebuild/simulation, and wallet-confirmation UI, exercises in-place wallet account switching/disconnect and real fxUSD borrowing against the existing ETH long, captures the populated UI, then fully closes all four positions through their direct Close controls and verifies zeroed pool accounting before restoring its snapshot. This is a separate gate from the Node-runner proof.
- `pnpm test:telegram:contract` and `pnpm test:live-public-config:contract`: verify the protected Telegram metadata/menu synchronization contract, including empty default commands, fixed-host/URL validation, bounded write/readback mismatch handling, and the deployed-wallet-route probe contract. They do not call the live Telegram or deployment APIs.
- `pnpm test:stress`: runs the credential-free chaos campaign and then the protected dummy-route fork stress. It does not replace the real protocol proof.
- `pnpm test:e2e`: browser entry and Portfolio workspace navigation, official-route and mobile/Telegram viewport navigation, semantic landmarks, 44px controls, no horizontal overflow at 320/360/375/390/412/430px, honest disconnected state, deterministic current-price and market-history validation, in-card wallet/action continuation, and absence of FxAeon application-backend traffic. The fixture allows reviewed public data hosts; the optional same-origin `/api/gas` function is not enabled in credential-free E2E.
- `pnpm build`: browser-only static export with no Node runtime.
- `pnpm check:bundle`: checks total, JavaScript, gzip, and largest-asset budgets and scans the export for forbidden telemetry and server artifacts.

### Wallet-data regression checks

The public balance layer uses pinned Wagmi `3.7.7` and TanStack Query `5.102.8`; it does not replace wallet selection/signing, transaction simulation, the runner, or official SDK protocol reads. Run its targeted checks without a build, browser, provider credential, or fork:

```powershell
pnpm --dir apps/mini-app exec tsx --test test/wagmi-wallet-queries.test.ts test/wallet-data-refresh.test.ts test/wallet-assets.test.ts test/transaction-progress.test.ts test/recovery.test.ts
```

`wagmi-wallet-queries.test.ts` exercises the actual read-only configuration, standard native/ERC-20 multicalls, exact large balances, partial token failures, RPC-chain mismatch rejection, canonical Move source addresses, query deduplication, account/session/target-chain isolation, and canceled-read protection. The configuration has no connectors, discovery, persistent Wagmi storage, or automatic reconnect; it reuses the existing RPC clients and needs no new service.

`wallet-assets.test.ts` covers partial known USD subtotals, stale-value exclusion,
pending reads, unknown values, and confirmed zero balances. The Portfolio shows
the known subtotal while inputs are incomplete, labels a total only when all
applicable values are known, and keeps a real zero distinct from unavailable
data.

`wallet-data-refresh.test.ts` checks receipt-only invalidation for success/reverts and partially completed routes, including the fallback when `postConfirmRead` did not run. It rejects signature-only and mismatched account/chain/hash/transaction evidence, joins duplicate completion/fallback refreshes, contains cache errors, and groups/deduplicates authoritative recovery receipts. `transaction-progress.test.ts` and `recovery.test.ts` separately protect immediate explorer links, unknown-versus-reverted states, and full recovery verification.

These targeted tests do not prove the final release gates or browser lifecycle behavior. Built-artifact browser checks must still cover account/network switching with reads in flight, one foreground watcher per active chain, WebSocket-to-polling fallback, hidden/offline shutdown, 60-second balance fallback, focus/online resume, and available-balance updates after receipt confirmation. Run the full credential-free and protected-fork gates for the final revision before reporting release verification complete.

`pnpm lint` includes `apps/mini-app/test` and treats unused test variables as errors (underscore-prefixed fixtures are the explicit escape hatch). `test/transaction-state.test.ts` protects the shared conservative reset defaults used by every transaction flow; the page-level handlers also remount the review state on context changes.

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

The upstream endpoint is consumed only by the Anvil parent process: the harness redacts it from output and removes provider, Telegram, wallet, Privy, and deployment credentials from the test child environment. Anvil uses a one-second interval (`ANVIL_BLOCK_TIME`, a positive value up to 60 seconds) so the runner can observe mined receipt blocks promptly across protocol, Earn, stress, and browser suites; this is harness timing only and does not weaken receipt identity or reorg checks. `ANVIL_FORK_BLOCK` pins a reproducible block, `ANVIL_PORT` selects the local port (default `8547`), `FX_ANVIL_POSITION_USDC` adjusts the Node protocol fixture amount, and `FX_ANVIL_ITERATIONS` applies only to the separate stress suite. The protocol proof re-reads all four positions after creation to prove simultaneous ownership and nonzero collateral/debt, then adds collateral and borrows real fxUSD against the existing ETH long while proving its position ID is preserved and both debt and wallet balance increase. It reverts its root snapshot and atomically writes a validated manifest under `artifacts/anvil/protocol-proof.json`. The manifest includes public pool addresses, local transaction hashes, position IDs, block numbers, and raw state; it excludes the upstream endpoint, provider credential, donor address, and Anvil signer material.

The parent rejects occupied loopback ports before starting Anvil or removing an old proof manifest. Port values must be decimal integers from `1024` through `65535`; browser and Anvil ports must differ. Local readiness requests are bounded, reject redirects, and verify both Ethereum chain ID and the Anvil client identity. Handled interruptions stop this run's owned process trees and do not start subsequent children.

For the protected GitHub environment, dispatch `.github/workflows/anvil-fork.yml` from `main`. It installs pinned Foundry `v1.8.1` through a commit-pinned official action and exposes the protected `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` secret only to the harness as `ANVIL_FORK_URL`. This workflow revision runs the Node four-position proof, fxSAVE Earn lifecycle, transport stress (64 iterations by default), and the separate mobile browser gate; it installs Chromium before the browser step. Evidence under `artifacts/anvil/` is retained for 14 days. Supply `fork_block` at dispatch time, or configure the non-secret protected `ANVIL_FORK_BLOCK` variable, to make release evidence reproducible. The README badge filters to the latest completed `workflow_dispatch` run on `main`. All four suites must succeed for this workflow revision to be green; an older green run without the Earn or browser steps is not evidence for those gates.

Keep `pnpm verify` credential-free. Run this fork gate only in a protected local or CI secret context, and rotate any credential that has appeared in chat, shell history, or logs.

### Browser position acceptance

Install the Playwright Chromium runtime once, then run the dedicated gate with the same restricted upstream fork endpoint:

```powershell
pnpm --dir apps/mini-app exec playwright install chromium
$env:ANVIL_FORK_URL = (Get-Secret FXAEON_ANVIL_FORK_URL -AsPlainText)
pnpm test:anvil:browser
```

`FX_FORK_BROWSER_PORT` selects its loopback web server (default `4325`). The gate uses a disposable Anvil account funded with fork-only USDC. A test-side EIP-1193 adapter forwards the application's wallet transaction requests to that local node; it is not shipped as a product signer and cannot connect to the upstream provider. Position-ID discovery is adapted because public indexers cannot observe fork-local blocks. Planning, inline action details, final route rebuild, simulation, transaction execution, receipts, ownership, collateral, and debt are not replaced with fixture values.

The cold-fork discovery check minted position `2015` on a fork initialized at
block `25965421`, then verified its wallet ownership and canonical state
`[789341530584454531, 1010126146524469153200]`, before the direct scan reached
the production 12-second deadline. The browser harness therefore preloads
actual historical `ownerOf` slots for all four pools through read-only
multicall batches of 128 and asserts `forkOwnerStoragePreloaded: true` before
the browser build. This is functional fork setup, not a cold-provider
performance benchmark or fabricated position data.

The browser proof artifact is `artifacts/anvil/browser-proof.json`; the run also
produces action-detail/confirmation screenshots, `positions-all-closed.png`,
and populated documentation captures under `artifacts/anvil/browser/docs/`.
The successful manifest declares browser-driven execution and snapshot
restoration. It records receipt-backed cards, direct Close routes, refreshed
output balances, and the closed state after on-chain accounting reaches zero.
Presence of screenshots, a built harness, or a passing Node-runner test alone
is not a browser gate pass. Wallet-drawer checks on Earn and Move verify access
to protocol exposure; fxSAVE has its own `test:anvil:earn` gate and
`artifacts/anvil/earn-proof.json` manifest.

See [post-transaction UX](post-transaction-ux.md) for the pinned Jumper, LI.FI, Uniswap, Curve, and Aave code/live-surface study behind these acceptance checks.

The browser gate also compares the USDC amount displayed in the token picker with the fork's `balanceOf` before each trade and close, then checks the available amount again after confirmation. Before trading, it switches between two disposable local accounts, disconnects, and reconnects without reloading to prove that the shared wallet-data cache cannot show another session's balances. The alternate account is read-only; only the funded local account can submit a trade. Every resulting position card must expose its current USD position-value label; it does not represent P&L or ROI, and Long/Short colors indicate direction. External display-price availability is not fabricated to make the test pass; precise valuation math and partial-price failure cases have separate deterministic unit/browser tests.

## Capability acceptance

`wallet-recovery-trigger.test.ts` covers cross-tab journal-key routing, bounded terminal-history selection, same-tick and overlapping trigger coalescing, receipt-only refresh, and idempotent terminal storage writes. `wallet-session.spec.ts` exercises injected-wallet account changes and disconnects through the rendered drawer and History view.

| Flow | Required cases |
| --- | --- |
| positions | ETH/BTC × long/short; empty and multiple positions; provider read failure |
| open/increase | supported inputs; new/existing ID; approval/no approval; route alternatives |
| reduce/close | partial/full; NFT approval/no approval; stale position |
| leverage | increase/decrease; bounds; nonce drift |
| deposit/mint | deposit-only, mint-only, combined, new long position, and real fxUSD borrowing against an existing long with debt/balance increases and position-ID preservation |
| repay/withdraw | repay-only, withdraw-only, combined, exact debt |
| fxSAVE reads | config, zero/nonzero balance, no pending/queued/claimable redemption; zero-share reads normalize omitted SDK underlying conversion to exact zero while nonzero missing conversions stay unavailable |
| fxSAVE deposit | USDC, fxUSD, fxUSD base-pool input |
| fxSAVE withdrawal | direct base-pool, queued, instant USDC/fxUSD |
| fxSAVE claim | cooldown incomplete and complete |
| bridge | both directions, fxUSD/fxSAVE, self/custom recipient, signer-safe refund, exact Ethereum approval, insufficient fee, delayed/reloaded destination verification, dust-adjusted sends, matching LayerZero source/destination GUID |

Every transaction case must prove chain and parameter correctness, visible plan and simulation, explicit approval per step, preserved order, a successful canonical receipt before continuation, failure-stop/reorg behavior, and a fresh authoritative read. Browser cases also assert the shared Edit → Live preview → final rebuild/simulation → Awaiting signature → Submitted → Confirming → Confirmed/Failed flow, with the final control visible above fixed navigation and material changes requiring another explicit action. A test that needs deeper receipt depth or an extra block must opt in explicitly.

Mainnet-fork impersonation or protocol-supported safe simulation is required for money-path integration tests. Production user funds are never a fixture. Current Chrome, Firefox, Safari, and Edge plus Telegram Android, iOS, Desktop, and Web must pass the applicable manual interaction checks before production promotion.

The browser suite deliberately keeps accessibility checks dependency-light: route landmarks, labels, keyboard-visible focus, target sizing, and overflow are asserted directly. A full axe scan and real-device Telegram pass remain promotion-time checks when those environments are available.

## Documentation captures

The standard capture command covers app home, Trade, token picker, Move, the standalone login setup screen, the compatibility Portfolio route, Docs, and 390 × 844 mobile Trade/Portfolio views. Normal wallet connection, account switching, and disconnect remain in-place app-shell flows; the login capture is a dedicated setup-state reference. Mobile Portfolio uses the light theme; the other standard views use the Official violet theme. Start the static export locally, then run `pnpm docs:screenshots` in another terminal. `FX_SCREENSHOT_BASE_URL` can select a different loopback HTTP origin; it defaults to `http://localhost:4321`.

```powershell
pnpm build
node apps/mini-app/e2e/serve.mjs
# In another terminal:
pnpm docs:screenshots
```

The capture helper waits for configured login readiness and visible candle
pixels, reports app runtime errors separately from external quote failures, and
excludes the development toolbar only after page assertions. The nine promoted
captures were completed on 20 September 2026, each in a fresh page and browser
context, using live external display data. The standard manifest records zero
page, console, external-fallback, unclassified-console, and discovery errors.
The images document rendered UI states; no wallet transaction was submitted.
The landing's connected-position aliases are separate browser-fork evidence.

Display prices and CoinGecko history are unmodified external data by default. Unavailable providers produce the application's honest unavailable states. For deterministic design regression only, set `FX_SCREENSHOT_MARKET_DATA=fixture`; every resulting image is visibly labelled **Illustrative prices & charts**, and the capture report records that mode. Synthetic display data is never execution, oracle, PnL, or return evidence.

For populated positions, the browser gate's staged captures are the browser
execution evidence. Alternatively, `pnpm docs:screenshots:positions` starts a
disposable fork and creates all four positions through the production Node
runner before capturing. The latter verifies rendered fork state, not browser
transaction execution. Both paths use exact, validated fork-local position
discovery and a read-only capture wallet identity. See [Fork-backed position
screenshots](position-screenshot-fixture.md) for controls, outputs, provenance,
staging, and snapshot cleanup.

Review the generated image files and capture report before promoting them into `docs/assets/`. The report records rendered IDs, viewports, image hashes, and whether display data was external or illustrative. A successful capture is evidence for those images; do not assume previously checked-in screenshots share a newer run's provenance.

Capture checks compare document and Chromium viewport offsets before and after each frame and reject displaced headers or navigation. They also assert that product-route primary actions and wallet-action rails are above fixed navigation at supported phone and desktop sizes. `/docs` and an expanded mobile Trade chart are intentionally scrollable; the full local capture report retains those scroll measurements. The compact [standard screenshot manifest](fixtures/standard-screenshot-manifest.json) records the committed images and hashes.
