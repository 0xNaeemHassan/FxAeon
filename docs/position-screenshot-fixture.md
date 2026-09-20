# Fork-backed position screenshots

FxAeon's populated position screenshots come from real f(x) protocol state on
a disposable Ethereum Anvil fork: one ETH long, ETH short, BTC long, and BTC
short. The four promoted screenshots were captured by the successful browser
gate on 20 September 2026 at block `25965421`; the capture report and hashes
are recorded in [`position-screenshot-manifest.json`](fixtures/position-screenshot-manifest.json).
The execution proof is `artifacts/anvil/browser-proof.json`. The screenshots
show fork state, not production balances.

The manifest maps the landing desktop frame `portfolio-preview.png` to the
all-four-position `fxaeon-positions.png` capture and `portfolio-mobile.png` to
`fxaeon-positions-mobile.png`; it records and validates both alias hashes.

The preferred execution path is `pnpm test:anvil:browser`, which opens those
positions through the application's guarded action details, final
rebuild/simulation, and wallet confirmation controls before capturing them. Its
browser proof verifies execution, receipts, all four direct closes, and snapshot
restoration.

The standalone `pnpm docs:screenshots:positions` command instead invokes the
same production SDK wrapper and transaction runner in Node. It can generate
captures that prove rendered fork state, not browser transaction execution.
The manifest records which path produced each promoted capture; the current
manifest identifies the browser gate.

The fork-local blocks do not exist in Goldsky's public index. For the protected
browser proof, the harness preloads actual historical `ownerOf` storage slots
for all four pools through read-only multicall batches of 128 before the browser
build and asserts `forkOwnerStoragePreloaded: true`. This avoids a cold-fork
storage timeout in the direct discovery fallback; it is functional test setup,
not a cold-provider performance benchmark or fabricated position data. The
application still performs its real `balanceOf`, index, owner, and accounting
checks. The SDK reads position and pool accounting state from contracts on the
local fork; fixture creation independently verifies NFT ownership and nonzero
collateral/debt. Product code, SDK position objects, contract balances, and
transaction results are not mocked.

The promoted browser captures use illustrative display prices and chart history
so an external chart outage cannot prevent capture. Each image visibly
identifies this fixture mode. Position ownership, accounting, and transaction
execution still come from the local fork. Illustrative prices are never oracle,
execution-price, PnL, or return evidence. The standalone capture command
defaults to unmodified external display data; those observations are taken at
capture time, not the fork's historical block.

The lower-level capture helper can also reuse positions opened by the browser
acceptance test. Before that test restores its snapshot, it supplies the same
validated four-position manifest and the still-running local app origin to
`scripts/capture_docs_screenshots.mjs`. No screenshot-mode rebuild is needed:
the capture helper injects a read-only wallet identity into its fresh browser
contexts, and the existing local-fork build performs the contract reads. That
identity exposes only account discovery and chain ID; transaction submission,
message signing, and other wallet methods reject. The manifest may declare
`executionSurface` as `browser` or `node-runner`; the capture report records
this source declaration without treating it as independent execution proof.

## Run

Provide a restricted Ethereum Alchemy URL through the environment. To capture
positions opened through the app, install Chromium and run the browser gate:

```powershell
pnpm --dir apps/mini-app exec playwright install chromium
pnpm test:anvil:browser
```

Inspect `artifacts/anvil/browser-proof.json`, the capture report under
`artifacts/anvil/browser/docs/`, and the committed manifest before promoting
images into `docs/assets/` or `apps/landing/assets/`.
For the standalone Node-runner fixture:

```powershell
$env:ANVIL_FORK_URL = '<restricted Ethereum mainnet RPC URL>'
pnpm docs:screenshots:positions
```

Optional controls:

- `ANVIL_BIN`: explicit Anvil executable path.
- `ANVIL_FORK_BLOCK`: decimal block number for an exactly repeatable fork.
- `ANVIL_PORT`: local fork port (default `8550`).
- `FX_SCREENSHOT_PORT`: local static-site port (default `4322`).
- `FX_SCREENSHOT_POSITION_USDC`: USDC supplied to each position (default
  `1000`).
- `FX_SCREENSHOT_ANVIL_RPC_URL`: use an already-running credential-free local
  Ethereum Anvil fork instead of starting a new one. Use an exclusive,
  disposable node, not one shared with other tests: the command snapshots
  before funding and restores the entire node to that state after capture.
  Only an HTTP loopback origin (`127.0.0.1` or `localhost`) with an explicit
  unprivileged port is accepted; paths, credentials, redirects, queries, and
  fragments are rejected.
- `FX_SCREENSHOT_MARKET_DATA=fixture`: opt into synthetic display-only prices
  and chart history for design regression work. Every resulting image is
  visibly labelled **Illustrative prices & charts**, and the manifest records
  this mode. It must not be presented as real market or execution evidence.

The command writes:

- `docs/assets/fxaeon-portfolio-positions.png`
- `docs/assets/fxaeon-positions.png`
- `docs/assets/fxaeon-trade-connected.png`
- `docs/assets/fxaeon-positions-mobile.png`
- `docs/fixtures/position-screenshot-manifest.json`

The retained manifest contains the public pool addresses, fork-minted position
IDs, fixture assertions, and capture report. The report records the execution
surface, exact rendered position keys, viewport, image SHA-256 hashes,
market-data mode, and observed discovery groups. When the manifest records
`executionSurface` as `browser`, the screenshot report is linked to the separate browser proof; the
manifest alone proves which UI states rendered, not transaction execution.
Fixture assertions are written only after contract checks pass. Browser capture
claims are added only after capture completes and the node snapshot is restored.

Outputs are staged in a unique temporary directory. Publishing happens only
after all four screenshots validate and snapshot restoration succeeds, so a
failed run cannot pass by finding old images. The retained manifest omits the
upstream RPC URL, transaction hashes, donor account, signer material, and raw
position balances. Private manifests and staged outputs are removed during
normal cleanup. The fixture generator refuses standalone invocation; use the
orchestration command so cleanup surrounds every state-changing step.

Normal failures and handled termination signals trigger restoration, including
for externally supplied nodes. A forced process kill or host failure cannot
guarantee cleanup; discard the disposable node in that case. Do not point the
command at a node whose state another process is using.

These screenshots use conceptual interaction patterns such as populated
portfolio states and immediately legible position cards. They do not copy
Jumper code, assets, branding, or GPL-licensed implementation material.
