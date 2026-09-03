import assert from "node:assert/strict";
import test from "node:test";
import { balanceMapForResult, createWalletBalanceReader, usdCentsForTokenBalance } from "../src/components/wallet-balance-cache";
import type { WalletBalancesResult } from "../src/lib/fx/balances";

const emptyResult = (): WalletBalancesResult => ({ balances: [], failedTokens: [] });

test("wallet balance reader deduplicates concurrent reads", async () => {
  const calls: string[] = [];
  let resolveRead: ((result: WalletBalancesResult) => void) | undefined;
  const pending = new Promise<WalletBalancesResult>((resolve) => { resolveRead = resolve; });
  const reader = createWalletBalanceReader(async (address) => {
    calls.push(address);
    return pending;
  });

  const first = reader.read("0xAbC");
  const second = reader.read("0xabc");
  assert.strictEqual(first, second);
  resolveRead!(emptyResult());
  await first;
  assert.deepEqual(calls, ["0xAbC"]);
});

test("wallet balance reader expires cached results without mixing wallets", async () => {
  let now = 1_000;
  const calls: string[] = [];
  const reader = createWalletBalanceReader(async (address) => {
    calls.push(address);
    return emptyResult();
  }, () => now, 15_000);

  await reader.read("0xone");
  now += 14_999;
  await reader.read("0xONE");
  await reader.read("0xtwo");
  now += 2;
  await reader.read("0xone");
  assert.deepEqual(calls, ["0xone", "0xtwo", "0xone"]);
});

test("wallet balance reader retries after a failed read", async () => {
  let attempts = 0;
  const reader = createWalletBalanceReader(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("rpc unavailable");
    return emptyResult();
  });

  await assert.rejects(reader.read("0xfail"), /rpc unavailable/);
  await reader.read("0xfail");
  assert.equal(attempts, 2);
});

test("forced refresh supersedes an older pending read", async () => {
  const resolvers: Array<(result: WalletBalancesResult) => void> = [];
  const reader = createWalletBalanceReader((address) => new Promise((resolve) => {
    assert.equal(address, "0xpending");
    resolvers.push(resolve);
  }));
  const oldRead = reader.read("0xpending");
  const freshRead = reader.read("0xpending", true);
  resolvers[1](emptyResult());
  await freshRead;
  resolvers[0]({ balances: [{ key: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, amountWei: 1n }], failedTokens: [] });
  await oldRead;
  const cached = await reader.read("0xpending");
  assert.deepEqual(cached.balances, []);
});

test("clearing a pending read prevents its stale result from returning", async () => {
  let calls = 0;
  let resolveRead: ((result: WalletBalancesResult) => void) | undefined;
  const reader = createWalletBalanceReader(() => {
    calls += 1;
    return new Promise((resolve) => { resolveRead = resolve; });
  });
  const pending = reader.read("0xcleared");
  reader.clear("0xcleared");
  resolveRead!(emptyResult());
  await pending;
  const fresh = reader.read("0xcleared");
  resolveRead!(emptyResult());
  await fresh;
  assert.equal(calls, 2);
});

test("balance map preserves successful zero and per-token failures", () => {
  const map = balanceMapForResult({
    balances: [{ key: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18, amountWei: 0n }],
    failedTokens: ["USDC"],
  });
  assert.deepEqual(map.ETH, { status: "ready", amount: "0" });
  assert.equal(map.USDC?.status, "unavailable");
  assert.equal(map.USDC?.amount, undefined);
});

test("token balance valuation distinguishes zero, missing quote, and valid quote", () => {
  assert.equal(usdCentsForTokenBalance({ status: "ready", amount: "0" }, "USDC", {}), 0n);
  assert.equal(usdCentsForTokenBalance({ status: "ready", amount: "2" }, "USDC", {}), null);
  assert.equal(usdCentsForTokenBalance({ status: "ready", amount: "2" }, "USDC", { USDC: 1.25 }), 250n);
  assert.equal(usdCentsForTokenBalance({ status: "loading" }, "USDC", { USDC: 1.25 }), null);
  assert.equal(usdCentsForTokenBalance({ status: "disconnected" }, "USDC", { USDC: 1.25 }), null);
  assert.equal(usdCentsForTokenBalance({ status: "unavailable" }, "ETH", { ETH: 2400 }), null);
});

test("owned USD value preserves exact large quantities and rejects malformed balances", () => {
  assert.equal(usdCentsForTokenBalance({ status: "ready", amount: "9007199254740993.01" }, "USDC", { USDC: 1 }), 900719925474099301n);
  assert.equal(usdCentsForTokenBalance({ status: "ready", amount: ".001" }, "ETH", { ETH: 2400 }), 240n);
  for (const amount of ["-1", "NaN", "1e9", "Infinity", "", "0x10"]) {
    assert.equal(usdCentsForTokenBalance({ status: "ready", amount }, "USDC", { USDC: 1 }), null);
  }
});
