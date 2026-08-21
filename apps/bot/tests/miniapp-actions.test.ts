import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@fxaeon/db", () => ({
  prisma: {
    actionQuoteTicket: {
      findUnique: dbMocks.findUnique,
      updateMany: dbMocks.updateMany,
    },
  },
}));

import {
  buildMiniActionQuote,
  executeMiniAction,
  validateMiniActionBody,
} from "../src/core/miniappActions";

describe("validateMiniActionBody", () => {
  beforeEach(() => {
    dbMocks.findUnique.mockReset();
    dbMocks.updateMany.mockReset();
  });
  const valid = [
    { kind: "position_open", market: "wstETH", side: "long", inputToken: "ETH", amount: "0.25", leverage: 3 },
    { kind: "position_open", market: "WBTC", side: "short", inputToken: "USDC", amount: "50", leverage: 2 },
    { kind: "position_increase", market: "wstETH", side: "long", positionId: 7, inputToken: "stETH", amount: "1" },
    { kind: "position_reduce", market: "WBTC", side: "short", positionId: 8, outputToken: "fxUSD", fractionBps: 2_500 },
    { kind: "position_adjust", market: "wstETH", side: "long", positionId: 9, leverage: 4.2 },
    { kind: "mint", market: "wstETH", positionId: 0, depositToken: "WETH", depositAmount: "1", mintAmount: "1000" },
    { kind: "mint", market: "WBTC", positionId: 2, depositToken: "WBTC", depositAmount: "0.01", mintAmount: "300" },
    { kind: "repay_withdraw", market: "wstETH", positionId: 3, repayAmount: "0", withdrawToken: "stETH", withdrawAmount: "0.2" },
    { kind: "repay_withdraw", market: "WBTC", positionId: 4, repayAmount: "all", withdrawToken: "WBTC", withdrawAmount: "0" },
    { kind: "save_deposit", tokenIn: "USDC", amount: "12.345678" },
    { kind: "save_deposit", tokenIn: "fxUSDBasePool", amount: "4" },
    { kind: "save_withdraw", tokenOut: "fxUSD", shares: "all", instant: true },
    { kind: "save_withdraw", tokenOut: "fxUSDBasePool", shares: "1", instant: false },
    { kind: "save_claim" },
    { kind: "bridge", token: "fxUSD", amount: "10", direction: "ethereum_to_base" },
    { kind: "bridge", token: "fxSAVE", amount: "2", direction: "base_to_ethereum" },
  ] as const;

  it.each(valid)("accepts $kind", (body) => {
    expect(validateMiniActionBody(body)).toMatchObject({ ok: true });
  });

  it.each([
    [{ kind: "position_open", market: "WBTC", side: "long", inputToken: "ETH", amount: "1", leverage: 2 }, "BAD_OPEN"],
    [{ kind: "position_open", market: "wstETH", side: "short", inputToken: "ETH", amount: "1e3", leverage: 2 }, "BAD_OPEN"],
    [{ kind: "position_reduce", market: "wstETH", side: "short", positionId: 1, outputToken: "stETH", fractionBps: 5000 }, "BAD_REDUCE"],
    [{ kind: "position_reduce", market: "wstETH", side: "long", positionId: 1, outputToken: "ETH", fractionBps: 99 }, "BAD_REDUCE"],
    [{ kind: "position_adjust", market: "wstETH", side: "short", positionId: 1, leverage: 5.1 }, "BAD_LEVERAGE"],
    [{ kind: "mint", market: "WBTC", positionId: 0, depositToken: "WETH", depositAmount: "1", mintAmount: "1" }, "BAD_MINT"],
    [{ kind: "repay_withdraw", market: "wstETH", positionId: 1, repayAmount: "0", withdrawToken: "ETH", withdrawAmount: "0" }, "BAD_REPAY"],
    [{ kind: "save_deposit", tokenIn: "USDC", amount: "0.0000001" }, "BAD_SAVE_DEPOSIT"],
    [{ kind: "save_withdraw", tokenOut: "fxUSDBasePool", shares: "1", instant: true }, "BAD_SAVE_WITHDRAW"],
    [{ kind: "bridge", token: "fxUSD", amount: "1", direction: "arbitrum" }, "BAD_BRIDGE"],
    [{ kind: "unknown" }, "BAD_ACTION"],
  ] as const)("rejects malformed intent %#", (body, code) => {
    expect(validateMiniActionBody(body)).toMatchObject({ ok: false, code });
  });

  it("rejects prototype/array/null payloads without throwing", () => {
    expect(validateMiniActionBody(null)).toMatchObject({ ok: false, code: "BAD_ACTION" });
    expect(validateMiniActionBody([])).toMatchObject({ ok: false, code: "BAD_ACTION" });
    expect(validateMiniActionBody("position_open")).toMatchObject({ ok: false, code: "BAD_ACTION" });
  });

  it("fails closed before signer/RPC work when bridge execution is disabled", async () => {
    const previous = process.env.BRIDGE_EXECUTION_ENABLED;
    process.env.BRIDGE_EXECUTION_ENABLED = "false";
    try {
      const walletAddress = "0x0000000000000000000000000000000000000001";
      dbMocks.findUnique.mockResolvedValue({
        id: "ticket-bridge-disabled",
        userId: "u1",
        walletAddress,
        actionKind: "bridge",
        expiresAt: new Date(Date.now() + 60_000),
        data: {
          version: 2,
          kind: "bridge",
          params: { kind: "bridge", token: "fxUSD", amount: "1", direction: "ethereum_to_base" },
          walletAddress,
          txType: "bridge_eth_to_base",
          chainId: 1,
          txs: [{ to: "0x0000000000000000000000000000000000000002", data: "0x1234", value: "1" }],
          maxFeeCostWei: { slow: "1", market: "1", fast: "1" },
          intentScopedBridge: {
            sourceChainId: 1,
            tokenAddress: "0x0000000000000000000000000000000000000003",
            oftTarget: "0x0000000000000000000000000000000000000002",
            amount: "1000000000000000000",
          },
        },
      });
      const result = await executeMiniAction(
        {
          id: "u1",
          privyUserId: "privy-1",
          walletAddress,
          privyWalletId: "wallet-1",
          walletDelegated: true,
          walletImported: false,
          slippageBps: 50,
          mevProtection: "off",
        },
        "ticket-bridge-disabled",
        "market"
      );
      expect(result).toEqual({
        ok: false,
        code: "BRIDGE_EXECUTION_DISABLED",
        message: expect.stringContaining("paused"),
      });
    } finally {
      if (previous === undefined) delete process.env.BRIDGE_EXECUTION_ENABLED;
      else process.env.BRIDGE_EXECUTION_ENABLED = previous;
    }
  });

  it("does not build or simulate a bridge quote while the kill switch is off", async () => {
    const previous = process.env.BRIDGE_EXECUTION_ENABLED;
    process.env.BRIDGE_EXECUTION_ENABLED = "false";
    try {
      await expect(buildMiniActionQuote(
        {
          id: "u1",
          privyUserId: "privy-1",
          walletAddress: "0x0000000000000000000000000000000000000001",
          privyWalletId: "wallet-1",
          walletDelegated: true,
          walletImported: false,
          slippageBps: 50,
          mevProtection: "off",
        },
        { kind: "bridge", token: "fxUSD", amount: "1", direction: "ethereum_to_base" }
      )).rejects.toThrow(/paused/i);
    } finally {
      if (previous === undefined) delete process.env.BRIDGE_EXECUTION_ENABLED;
      else process.env.BRIDGE_EXECUTION_ENABLED = previous;
    }
  });
});
