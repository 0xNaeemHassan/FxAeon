import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  findUserPosition: vi.fn(),
  quoteReduce: vi.fn(),
  quoteAdjust: vi.fn(),
  reductionAmount: vi.fn(),
  executeRoute: vi.fn(),
  findUser: vi.fn(),
}));

vi.mock("@fxaeon/db", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => mocks.findUser(...args) } },
}));

vi.mock("../src/core/callbackKeys.js", () => ({
  storeCallbackPayload: vi.fn(() => "storednonce"),
  consumeCallbackPayload: (...args: unknown[]) => mocks.consume(...args),
}));

vi.mock("../src/core/portfolio.js", () => ({
  findUserPosition: (...args: unknown[]) => mocks.findUserPosition(...args),
}));

vi.mock("../src/fx/index.js", () => ({
  createFxSdk: vi.fn(() => ({ sdk: true })),
  createPublicClientForUser: vi.fn(() => ({ client: true })),
  getSdkReductionAmountWei: (...args: unknown[]) => mocks.reductionAmount(...args),
  mevModeForUser: vi.fn((mode: string) => (mode === "flashbots" ? "flashbots" : "off")),
  quoteClosePosition: (...args: unknown[]) => mocks.quoteReduce(...args),
  quoteAdjustPositionLeverage: (...args: unknown[]) => mocks.quoteAdjust(...args),
}));

vi.mock("../src/core/delegation.js", () => ({
  requireDelegatedWallet: vi.fn().mockResolvedValue({ ok: true, walletId: "wallet-1" }),
}));

vi.mock("../src/core/txExecutor.js", () => ({
  executeRoute: (...args: unknown[]) => mocks.executeRoute(...args),
}));

vi.mock("../src/handlers/tradeActions.js", () => ({
  statusLine: vi.fn((state: string) => state),
}));

vi.mock("../src/middleware/logger.js", () => ({
  botLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  handleExecuteAdjustLeverage,
  handleExecuteReduce,
} from "../src/handlers/positionCardActions.js";

const USER = {
  id: "user-1",
  telegramId: "123",
  walletAddress: "0x1111111111111111111111111111111111111111",
  privyUserId: "privy-1",
  privyWalletId: "wallet-1",
  walletDelegated: true,
  walletImported: false,
  slippageBps: 50,
  mevProtection: "flashbots",
};

const POSITION = {
  market: "wstETH",
  side: "long",
  positionId: 42,
  collateral: 1,
  rawCollateral: 1_000n,
  rawDebt: 600n,
  collateralToken: "wstETH",
  debt: 500,
  debtToken: "fxUSD",
  leverage: 3,
  debtRatio: 2 / 3,
  health: 0.7,
};

function context(data: string) {
  return {
    from: { id: 123 },
    callbackQuery: { data },
    editMessageText: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("position card execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUser.mockResolvedValue(USER);
    mocks.findUserPosition.mockResolvedValue(POSITION);
    mocks.quoteReduce.mockResolvedValue({ routes: [{ txs: [{ to: USER.walletAddress, data: "0x", value: 0n }] }] });
    mocks.quoteAdjust.mockResolvedValue({ routes: [{ txs: [{ to: USER.walletAddress, data: "0x", value: 0n }] }] });
    mocks.reductionAmount.mockResolvedValue(250n);
    mocks.executeRoute.mockResolvedValue({ ok: true, deduped: false, hashes: ["0xabc"] });
  });

  it("quotes and executes the exact selected reduction percentage", async () => {
    mocks.consume.mockReturnValue({
      action: "pa_do_reduce",
      market: "wstETH",
      side: "long",
      positionId: 42,
      sizeBps: 2_500,
    });
    const ctx = context("pa_dored_nonce1");

    await handleExecuteReduce(ctx);

    expect(mocks.quoteReduce).toHaveBeenCalledWith(
      expect.objectContaining({ amountWei: 250n, isClosePosition: false, positionId: 42 })
    );
    expect(mocks.reductionAmount).toHaveBeenCalledWith(
      expect.objectContaining({ rawCollateralWei: 1_000n, rawDebtWei: 600n, fractionBps: 2_500 })
    );
    expect(mocks.executeRoute).toHaveBeenCalledWith(
      expect.objectContaining({ type: "reduce_position", mev: "flashbots" })
    );
    expect(ctx.editMessageText.mock.calls.at(-1)?.[0]).toContain("Position reduced");
  });

  it("uses the centralized SDK-unit calculation for a short reduction", async () => {
    mocks.consume.mockReturnValue({
      action: "pa_do_reduce",
      market: "wstETH",
      side: "short",
      positionId: 42,
      sizeBps: 5_000,
    });
    mocks.findUserPosition.mockResolvedValue({ ...POSITION, side: "short", rawDebt: 800n });
    mocks.reductionAmount.mockResolvedValue(500n);

    await handleExecuteReduce(context("pa_dored_short"));

    expect(mocks.reductionAmount).toHaveBeenCalledWith(
      expect.objectContaining({ side: "short", rawDebtWei: 800n, fractionBps: 5_000 })
    );
    expect(mocks.quoteReduce).toHaveBeenCalledWith(
      expect.objectContaining({ side: "short", amountWei: 500n })
    );
  });

  it("rejects a mismatched callback action before quoting", async () => {
    mocks.consume.mockReturnValue({
      action: "pa_do_adjust",
      market: "wstETH",
      side: "long",
      positionId: 42,
      sizeBps: 2_500,
    });
    const ctx = context("pa_dored_nonce2");

    await handleExecuteReduce(ctx);

    expect(mocks.quoteReduce).not.toHaveBeenCalled();
    expect(ctx.editMessageText.mock.calls.at(-1)?.[0]).toContain("invalid");
  });

  it("quotes and executes a bounded leverage adjustment", async () => {
    mocks.consume.mockReturnValue({
      action: "pa_do_adjust",
      market: "wstETH",
      side: "long",
      positionId: 42,
      targetLeverage: 5,
    });
    const ctx = context("pa_doadj_nonce3");

    await handleExecuteAdjustLeverage(ctx);

    expect(mocks.quoteAdjust).toHaveBeenCalledWith(
      expect.objectContaining({ leverage: 5, positionId: 42, slippagePercent: 0.5 })
    );
    expect(mocks.executeRoute).toHaveBeenCalledWith(
      expect.objectContaining({ type: "adjust_leverage" })
    );
    expect(ctx.editMessageText.mock.calls.at(-1)?.[0]).toContain("Leverage adjusted");
  });
});
