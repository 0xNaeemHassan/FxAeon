import assert from "node:assert/strict";
import test from "node:test";
import { balanceMapForResult, usdCentsForTokenBalance } from "../src/components/wallet-balance-cache";

// Cache concurrency/isolation regressions now exercise the actual wagmi +
// TanStack implementation in wagmi-wallet-queries.test.ts.

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
