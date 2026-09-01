# Release verification

The release process is intentionally layered. Credential-free checks run on every change; a local-fork gate is opt-in because it needs an operator-supplied provider endpoint.

## Automated gates

- `pnpm verify`: aggregate release gate covering scope, lint, types, unit tests, the seeded chaos campaign, high-severity production dependency audit, static build, bundle budget, and built-artifact Playwright tests.
- `pnpm verify:scope`: exact 15-method SDK contract, reviewed upstream patch, allowed routes, and no active backend/delegated-signing imports.
- `pnpm typecheck` and `pnpm lint`: strict client compilation and static checks.
- `pnpm test`: transaction normalization, validation, approval, nonce, lock, journal, receipt ordering, and failure-stop tests.
- `pnpm test:chaos`: seeded property-style route and runner campaigns. It mutates sender, chain, target, selector, value, operation, nonce, and route shape, then injects wallet rejection, on-chain reverts, and receipt-RPC outages. Set `FX_CHAOS_SEED`, `FX_CHAOS_ITERATIONS`, or `FX_CHAOS_RUNNER_ITERATIONS` to reproduce or expand a campaign.
- `pnpm test:stress`: runs the credential-free chaos campaign and then the protected Anvil fork gate.
- `pnpm test:e2e`: browser entry without Telegram, official-route and mobile/Telegram viewport navigation, semantic landmarks, 44px controls, no horizontal overflow at 320/360/375/390/412/430px, honest disconnected state, and absence of backend traffic.
- `pnpm build`: browser-only static export with no Node runtime.
- `pnpm check:bundle`: checks total, JavaScript, gzip, and largest-asset budgets and scans the export for forbidden telemetry and server artifacts.

## Anvil fork testing

`pnpm test:anvil` starts a disposable local Anvil fork of Ethereum mainnet, runs the integration route campaign, and tears the node down. It requires Foundry's `anvil` binary (or an executable path in `ANVIL_BIN`) and a fresh, restricted provider endpoint supplied at invocation time. Set `ANVIL_FORK_URL` explicitly, or let the runner use `NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL` as its reviewed Ethereum fallback:

```powershell
$env:ANVIL_FORK_URL = (Get-Secret FXAEON_ANVIL_FORK_URL)
pnpm test:anvil
```

The endpoint is never written to the repository, forwarded to the app test process, or printed by the harness. `ANVIL_FORK_BLOCK` pins a reproducible block, `ANVIL_PORT` selects the local port, and `FX_ANVIL_ITERATIONS` controls randomized snapshot/revert and ordered-route iterations. The integration suite uses only unlocked disposable Anvil accounts and reverts each snapshot; it never uses production wallet keys or sends a mainnet transaction.

Keep `pnpm verify` credential-free. Run this fork gate only in a protected local or CI secret context, and rotate any credential that has appeared in chat, shell history, or logs.

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

## Real-position documentation captures

The checked-in position screenshot is read from a disposable Ethereum fork, not a demo fixture. To reproduce it locally, start Anvil with a restricted fork URL and build the explicitly opt-in screenshot mode:

```powershell
$env:ANVIL_FORK_URL = (Get-Secret FXAEON_ANVIL_FORK_URL)
$env:NEXT_PUBLIC_FX_SCREENSHOT_MODE = "1"
$env:NEXT_PUBLIC_FX_ANVIL_RPC_URL = "http://127.0.0.1:8547"
$env:NEXT_PUBLIC_FX_SCREENSHOT_WALLET_ADDRESS = "0xYourRealPositionOwner"

anvil --fork-url $env:ANVIL_FORK_URL --host 127.0.0.1 --port 8547 --chain-id 1 --accounts 20 --balance 10000
pnpm build
pnpm --dir apps/mini-app start
```

Open `/positions` on the local server and wait for the official SDK reads to settle before capturing. The screenshot provider is read-only, accepts only localhost, rejects transaction requests, and is gated behind `NEXT_PUBLIC_FX_SCREENSHOT_MODE`; normal builds remain wallet-connected and production-safe.
