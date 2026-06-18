import { defineConfig } from "vitest/config";

/**
 * Anvil mainnet-fork integration suite (Phase 4 — the live-chain pass that
 * tests/tx-executor.test.ts defers to). Kept in its own config so the fast,
 * fully-mocked unit suite (`pnpm test`) never depends on a fork being up.
 *
 * Run it with a fork available:
 *   anvil --fork-url $MAINNET_RPC_URL --port 8545        # or let globalSetup start it
 *   pnpm --filter @fxaeon/bot test:fork
 *
 * The globalSetup auto-starts anvil when FORK_BACKEND_RPC_URL/MAINNET_RPC_URL
 * is set and foundry is installed; otherwise the suite self-skips.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/fork/**/*.fork.test.ts"],
    // No global setupFiles: the fork suite installs its own real-chain prisma
    // and Privy seams inline (it must NOT inherit the unit suite's mocks).
    globalSetup: ["tests/fork/globalSetup.ts"],
    // Real chain round-trips + receipt polling are slow relative to unit tests.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Forked pool so env exported by globalSetup is inherited by workers, and a
    // hung RPC call can never wedge the whole runner. One fork: the suite shares
    // a single anvil instance and runs its cases sequentially.
    pool: "forks",
    fileParallelism: false,
    retry: 0,
  },
});
