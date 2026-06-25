# Anvil mainnet-fork integration test — the bot's money path

This is the Phase-4 live-chain pass that the fully-mocked unit suite
(`tests/tx-executor.test.ts`) defers to. It exercises the **exact sanctioned
broadcast path** — `executeRoute` in `src/core/txExecutor.ts` — end to end
against real Ethereum mainnet state served by an [Anvil](https://book.getfoundry.sh/anvil/)
fork:

```
idempotency → signer-policy allow-list → eth_simulateV1 (fail-closed)
  → EIP-1559 fees from real feeHistory → broadcast → receipt watch
```

## What is real vs substituted

**Real (production code, real RPC):**
- The viem `PublicClient` talks to the fork — `simulateCalls` (eth_simulateV1),
  `getFeeHistory`, `getTransactionCount`, `getTransactionReceipt`.
- `simulateRoute`, `signerPolicy`, `fees`, `txState`, `broadcast.ts` and
  `txExecutor.ts` are the real modules. Nothing in the money path is stubbed.
- Transactions are actually signed and mined. The happy path **moves real WETH**
  on the fork and reads the resulting balance back from chain state.

**Substituted (and only this):**
- `@fxaeon/db` prisma → an in-memory `TxRecord` store, so idempotency and the
  persisted state machine behave exactly as in prod without a database.
- `src/core/privy.js` → the broadcast seam signs+sends with a funded Anvil dev
  key instead of Privy's hosted wallet API. `broadcast.ts` (the real send logic
  that builds the EIP-1559 tx) is untouched.

## Running it

The suite **self-skips (green)** when no fork is reachable, so it is safe to
include in any CI matrix.

```bash
# Option A — let the suite start anvil for you (needs foundry on PATH):
export FORK_BACKEND_RPC_URL="https://<your-mainnet-rpc>"   # Alchemy/Infura/public node
pnpm --filter @fxaeon/bot test:fork

# Option B — bring your own fork:
anvil --fork-url "$MAINNET_RPC_URL" --port 8545
FORK_RPC_URL=http://127.0.0.1:8545 pnpm --filter @fxaeon/bot test:fork
```

### Environment

| Var | Purpose |
|---|---|
| `FORK_RPC_URL` | Address of an already-running fork to use (default `http://127.0.0.1:8545`). |
| `FORK_BACKEND_RPC_URL` / `MAINNET_RPC_URL` | Upstream mainnet RPC `globalSetup` forks from when starting anvil itself. |
| `FORK_PORT` | Port for the auto-started anvil (default `8545`). |
| `SIGNER_POLICY_MODE` | Pinned to `enforce` by the test so the allow-list assertions are meaningful. |

## Cases

1. Fork sanity — real mainnet fork at `chainId 1`, recent block height.
2. Every f(x) registry target the money path touches has live mainnet bytecode
   (the signer-policy allow-list is derived from this registry).
3. `getEip1559Fees` derives clamped, sane fees from the fork's real `feeHistory`.
4. **Happy path** — policy → simulate → fees → broadcast → confirmed, with the
   audited state-machine sequence and **real on-chain WETH settlement**.
5. **Idempotency** — a repeated key dedupes and never broadcasts twice.
6. **Fail-closed** — a route that fails `eth_simulateV1` is never broadcast.
7. **Signer policy** — a non-registry target is rejected before simulate/broadcast.
