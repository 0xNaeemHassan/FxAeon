# Implemented inventory

This file is a navigation aid, not proof that the entire product goal is complete. Current capability status and missing work live in [SDK capability matrix](sdk-capabilities.md) and [Known gaps](GAPS.md).

## Present in current source

- User-created/imported Privy embedded wallet onboarding with optional revocable session signer.
- Telegram initData-authenticated Mini App account API.
- Live on-chain funding, position, fxSAVE, market, and portfolio reads with explicit completeness flags.
- New wstETH/WBTC long/short opens in Telegram and Mini App.
- Existing-position increase plus full/partial close and leverage adjustment in the Mini App; Telegram exposes close/reduce/adjust.
- Deposit-and-mint plus repay-and-withdraw SDK flows in Telegram and Mini App.
- fxSAVE fxUSD/USDC/Base-Pool deposit; queued or instant fxUSD/USDC withdrawal; direct ERC-4626 redemption to Base Pool shares; queued-redemption status and claim.
- Intent-scoped ETH/ERC-20 wallet withdrawals.
- Two-minute wallet-bound Mini App frozen-plan tickets plus a central per-user-idempotent signer-policy/simulation/fee/broadcast executor with an all-step hash/status journal.
- Flashbots private broadcast option without silent public fallback.
- Price alerts, health warnings, deposit detection, off-chain TP/SL, and arb signals.
- Pending transaction speed-up/cancel.
- Limit-order backend primitives and operator-gated bidirectional Ethereum/Base bridge.
- Eight bot/Mini App locale catalogs with parity tests on cataloged strings; several new protocol screens and deep error states remain hardcoded English.
- Static Mini App functional and visual Playwright coverage.
- Docker, Render, Cloudflare Pages, migration, backup, smoke, quality, fork, and address-verification workflows/scripts. Their existence is not evidence that external credentials, restore drills, or funded integrations have been verified.

## Verification entry points

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @fxaeon/mini-app test:e2e
node scripts/gen-signer-policy.mjs --check
```

External/fork checks require credentials and tools:

```bash
ALCHEMY_RPC_URL='https://...' node scripts/verify-addresses.mjs
FORK_BACKEND_RPC_URL='https://...' pnpm --filter @fxaeon/bot test:fork
```

Record actual command output, environment, date, skipped tests, and deployed integration evidence in the release artifact. Do not copy an old test count into a new completion claim.
