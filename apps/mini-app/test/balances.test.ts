import assert from "node:assert/strict";
import test from "node:test";
import { FX_TOKENS } from "../src/lib/fx/tokens";
import { readWalletBalancesFromClient } from "../src/lib/fx/balances";
import type { FxPublicClient } from "../src/lib/fx/types";

const wallet = "0x930f0000000000000000000000000000000098b9";

function clientFor(readContract: (address: string) => Promise<bigint>): Pick<FxPublicClient, "getBalance" | "readContract"> {
  return {
    getBalance: async () => 1_250_000_000_000_000_000n,
    readContract: async ({ address }: { address: string }) => readContract(address),
  } as unknown as Pick<FxPublicClient, "getBalance" | "readContract">;
}

test("reads native ETH and every supported ERC-20 without USD assumptions", async () => {
  const result = await readWalletBalancesFromClient(wallet, clientFor(async (address) => (
    address.toLowerCase() === FX_TOKENS.USDC.address.toLowerCase() ? 42_500_000n : 0n
  )));

  assert.deepEqual(result.failedTokens, []);
  assert.equal(result.balances.length, Object.keys(FX_TOKENS).length);
  assert.equal(result.balances.find((balance) => balance.key === "ETH")?.amountWei, 1_250_000_000_000_000_000n);
  assert.equal(result.balances.find((balance) => balance.key === "USDC")?.amountWei, 42_500_000n);
});

test("keeps successful token balances visible when one contract read fails", async () => {
  const result = await readWalletBalancesFromClient(wallet, clientFor(async (address) => {
    if (address.toLowerCase() === FX_TOKENS.USDT.address.toLowerCase()) throw new Error("provider timeout");
    return 0n;
  }));

  assert.deepEqual(result.failedTokens, ["USDT"]);
  assert.ok(result.balances.some((balance) => balance.key === "USDC"));
});

test("fails closed when no supported balance read succeeds", async () => {
  await assert.rejects(
    () => readWalletBalancesFromClient(wallet, {
      getBalance: async () => { throw new Error("RPC offline"); },
      readContract: async () => { throw new Error("RPC offline"); },
    } as unknown as Pick<FxPublicClient, "getBalance" | "readContract">),
    /RPC offline/,
  );
});
