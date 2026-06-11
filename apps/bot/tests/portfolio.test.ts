/**
 * W-18 portfolio tests: on-chain reads as source of truth, fixed risk meter
 * orientation, per-position Close flow (ownership gate, idempotency,
 * honesty on failure), TP/SL hint.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@fxbot/db";

const getPositionsMock = vi.fn();
const quoteClosePositionMock = vi.fn();
vi.mock("../src/fx/index", () => ({
  createFxSdk: vi.fn(() => ({})),
  createPublicClientForUser: vi.fn(() => ({})),
  getPositions: (...a: unknown[]) => getPositionsMock(...a),
  quoteClosePosition: (...a: unknown[]) => quoteClosePositionMock(...a),
}));

const executeRouteMock = vi.fn();
vi.mock("../src/core/txExecutor", () => ({
  executeRoute: (...a: unknown[]) => executeRouteMock(...a),
}));

import { portfolioCommand, getRiskBar } from "../src/commands/portfolio";
import { fetchOnChainPositions, deriveDebtRatio, findUserPosition } from "../src/core/portfolio";
import { handleClosePrompt, handleCloseConfirm, handleTpSlHint } from "../src/handlers/positionActions";

const USER = {
  id: "user-1",
  telegramId: "123456",
  walletAddress: "0xAbCd000000000000000000000000000000001234",
  privyWalletId: "wallet-1",
  slippageBps: 50,
  mevProtection: "off",
};

// 3x long wstETH: 1 wstETH collateral, 5000 fxUSD debt.
const CHAIN_POS = {
  positionId: 7,
  rawColls: 10n ** 18n,
  rawDebts: 5000n * 10n ** 18n,
  currentLeverage: 3,
  lsdLeverage: 3,
  rawCollsToken: "wstETH",
  rawDebtsToken: "fxUSD",
  rawCollsDecimals: 18,
  rawDebtsDecimals: 18,
};

function mockCtx(callbackData?: string) {
  return {
    from: { id: 123456 },
    me: { username: "TestBot" },
    message: { text: "/portfolio" },
    callbackQuery: callbackData ? { data: callbackData } : undefined,
    reply: vi.fn().mockResolvedValue({}),
    editMessageText: vi.fn().mockResolvedValue(true),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
  } as any;
}

const lastEdit = (ctx: any): string =>
  ctx.editMessageText.mock.calls[ctx.editMessageText.mock.calls.length - 1][0];

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.user.findUnique as any).mockResolvedValue(USER);
  getPositionsMock.mockResolvedValue([]);
  quoteClosePositionMock.mockResolvedValue({
    positionId: 7,
    slippage: 0.5,
    routes: [{ routeType: "FxRoute", leverage: 0, executionPrice: "2500", colls: "0", debts: "0", txs: [{ to: "0x1", data: "0x", value: 0n }] }],
  });
  executeRouteMock.mockResolvedValue({ ok: true, deduped: false, recordId: "r1", status: "confirmed", hashes: ["0xclosehash"] });
});

describe("risk meter orientation (was inverted)", () => {
  it("low debt ratio is HEALTHY, near-liquidation is CRITICAL", () => {
    expect(getRiskBar(0.1)).toContain("HEALTHY");
    expect(getRiskBar(0.9)).toContain("WARNING");
    expect(getRiskBar(0.99)).toContain("CRITICAL");
  });

  it("deriveDebtRatio: lev = coll/equity ⇒ ratio = 1 − 1/lev", () => {
    expect(deriveDebtRatio(1)).toBe(0);
    expect(deriveDebtRatio(2)).toBeCloseTo(0.5);
    expect(deriveDebtRatio(4)).toBeCloseTo(0.75);
  });
});

describe("on-chain portfolio reads", () => {
  it("reads every market × side and maps fields", async () => {
    getPositionsMock.mockImplementation((_sdk: unknown, _addr: string, market: string, side: string) =>
      Promise.resolve(market === "wstETH" && side === "long" ? [CHAIN_POS] : [])
    );
    const { positions, failures } = await fetchOnChainPositions({} as any, USER.walletAddress);
    expect(getPositionsMock).toHaveBeenCalledTimes(4); // 2 markets × 2 sides
    expect(failures).toEqual([]);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ market: "wstETH", side: "long", positionId: 7, collateral: 1, debt: 5000, leverage: 3 });
  });

  it("skips zero-collateral (closed) slots", async () => {
    getPositionsMock.mockResolvedValue([{ ...CHAIN_POS, rawColls: 0n }]);
    const { positions } = await fetchOnChainPositions({} as any, USER.walletAddress);
    expect(positions).toHaveLength(0);
  });

  it("surfaces partial read failures instead of pretending empty", async () => {
    getPositionsMock.mockImplementation((_s: unknown, _a: string, market: string, side: string) =>
      market === "WBTC" && side === "short" ? Promise.reject(new Error("rpc down")) : Promise.resolve([])
    );
    const { failures } = await fetchOnChainPositions({} as any, USER.walletAddress);
    expect(failures).toEqual(["WBTC short"]);

    const ctx = mockCtx();
    await portfolioCommand(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("Couldn't read: WBTC short");
  });

  it("/portfolio renders positions with Close/TP-SL buttons", async () => {
    getPositionsMock.mockImplementation((_s: unknown, _a: string, market: string, side: string) =>
      Promise.resolve(market === "wstETH" && side === "long" ? [CHAIN_POS] : [])
    );
    const ctx = mockCtx();
    await portfolioCommand(ctx);
    const [text, opts] = ctx.reply.mock.calls[0];
    expect(text).toContain("wstETH LONG 3.00x");
    expect(text).toContain("HEALTHY");
    const flat = JSON.stringify(opts.reply_markup);
    expect(flat).toContain("pc_0_l_7");
    expect(flat).toContain("pt_0_l");
  });
});

describe("close flow", () => {
  beforeEach(() => {
    getPositionsMock.mockImplementation((_s: unknown, _a: string, market: string, side: string) =>
      Promise.resolve(market === "wstETH" && side === "long" ? [CHAIN_POS] : [])
    );
  });

  it("prompt re-reads the chain and shows a confirm button", async () => {
    const ctx = mockCtx("pc_0_l_7");
    await handleClosePrompt(ctx);
    expect(lastEdit(ctx)).toContain("Close wstETH LONG #7");
    expect(JSON.stringify(ctx.editMessageText.mock.calls[0][1].reply_markup)).toMatch(/pcc_0_l_7_[0-9a-f]{8}/);
  });

  it("prompt is honest when the position no longer exists", async () => {
    const ctx = mockCtx("pc_0_l_99");
    await handleClosePrompt(ctx);
    expect(lastEdit(ctx)).toContain("not found on-chain");
  });

  it("confirm executes a full close with a scoped idempotency key", async () => {
    const ctx = mockCtx("pcc_0_l_7_aabbccdd");
    await handleCloseConfirm(ctx);
    expect(quoteClosePositionMock).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: 7, amountWei: CHAIN_POS.rawColls, isClosePosition: true })
    );
    const call = executeRouteMock.mock.calls[0][0];
    expect(call.idempotencyKey).toBe("close:user-1:wstETH:long:7:aabbccdd");
    expect(call.type).toBe("close_long");
    expect(lastEdit(ctx)).toContain("0xclosehash");
  });

  it("ownership gate: forged positionId for another wallet's position is a no-op", async () => {
    const found = await findUserPosition({} as any, USER.walletAddress, "wstETH", "long", 1234);
    expect(found).toBeUndefined();
    const ctx = mockCtx("pcc_0_l_1234_aabbccdd");
    await handleCloseConfirm(ctx);
    expect(executeRouteMock).not.toHaveBeenCalled();
    expect(lastEdit(ctx)).toContain("Nothing was sent");
  });

  it("executor failure is reported without inventing success", async () => {
    executeRouteMock.mockResolvedValue({ ok: false, deduped: false, recordId: "r1", status: "failed", error: "simulation failed at tx 0: execution reverted" });
    const ctx = mockCtx("pcc_0_l_7_aabbccdd");
    await handleCloseConfirm(ctx);
    expect(lastEdit(ctx)).toContain("NOT sent");
    expect(lastEdit(ctx)).not.toContain("Position closed");
  });

  it("malformed callback data is rejected", async () => {
    const ctx = mockCtx("pcc_9_x_7");
    await handleCloseConfirm(ctx);
    expect(executeRouteMock).not.toHaveBeenCalled();
  });
});

describe("TP/SL hint", () => {
  it("points to /auto with the position's market and side", async () => {
    const ctx = mockCtx("pt_0_l");
    await handleTpSlHint(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("/auto tp wstETH long");
  });
});
