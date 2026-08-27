# Release verification

## Automated gates

- `pnpm verify`: aggregate release gate; runs every gate below, including the built static-export Playwright suite, plus the high-severity production dependency audit and bundle budget.
- `pnpm verify:scope`: exact 15-method SDK class, upstream patch, allowed routes, and no active backend/delegated-signing imports.
- `pnpm typecheck` and `pnpm lint`: strict client compile and static checks.
- `pnpm test`: transaction normalization, validation, approval, nonce, lock, journal, receipt ordering, and failure-stop tests.
- `pnpm test:e2e`: mobile/Telegram viewport navigation, honest disconnected state, accessibility, and absence of backend traffic.
- `pnpm build`: browser-only static export with no Node runtime.

## Capability acceptance

| Flow | Required cases |
|---|---|
| positions | ETH/BTC × long/short; empty and multiple positions; Goldsky/RPC failure |
| open/increase | supported inputs; new/existing ID; approval/no approval; route alternatives |
| reduce/close | partial/full; NFT approval/no approval; stale position |
| leverage | increase/decrease; bounds; nonce drift |
| deposit/mint | deposit-only, mint-only, combined, existing/new long position |
| repay/withdraw | repay-only, withdraw-only, combined, exact debt |
| fxSAVE reads | config, zero/nonzero balance, no pending/queued/claimable redeem |
| fxSAVE deposit | USDC, fxUSD, fxUSD base-pool input |
| fxSAVE withdrawal | direct base-pool, queued, instant USDC/fxUSD |
| fxSAVE claim | cooldown incomplete and complete |
| bridge | both directions, fxUSD/fxSAVE, self/custom recipient, signer-safe refund, exact Ethereum approval, insufficient fee, delayed/reloaded destination verification, dust-adjusted sends, matching LayerZero source/destination GUID |

Every transaction case must prove the correct chain and parameters, visible plan and simulation, explicit approval per step, preserved order, successful receipt before continuation, failure-stop behavior, one additional block, and a fresh authoritative read.

Mainnet-fork impersonation or protocol-supported safe simulation is required for money-path integration tests. Production user funds are never a test fixture. Telegram Android, iOS, Desktop, and Web must pass manual interaction checks before a production promotion.
