/**
 * W-17 trade UX tests: ladder navigation, signed confirm flow (tamper/expiry/
 * dedupe), cancel, and /start trade deep links.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@fxbot/db";

const quoteOpenPositionMock = vi.fn();
vi.mock("../src/fx/index", () => ({
  createFxSdk: vi.fn(() => ({})),
  createPublicClientForUser: vi.fn(() => ({})),
  collateralDecimals: vi.fn(() => 18),
  quoteOpenPosition: (...a: unknown[]) => quoteOpenPositionMock(...a),
}));

const executeRouteMock = vi.fn();
vi.mock("../src/core/txExecutor", () => ({
  executeRoute: (...a: unknown[]) => executeRouteMock(...a),
}));

// Funding reads hit RPC from /start's returning-user path — stub them.
vi.mock("../src/core/funding", () => ({
  getFundingState: vi.fn().mockResolvedValue({ known: false }),
  describeFunding: vi.fn().mockReturnValue(""),
}));

import {
  handleLadderCallback,
  handleConfirmCallback,
  handleCancelCallback,
  buildPreview,
} from "../src/handlers/tradeActions";
import { createTradeIntent } from "../src/core/tradeIntent";
import { startCommand } from "../src/commands/start";
import { tEn } from "./helpers/i18n";

const USER = {
  id: "user-1",
  telegramId: "123456",
  walletAddress: "0xAbCd000000000000000000000000000000001234",
  privyWalletId: "wallet-1",
  slippageBps: 50,
  mevProtection: "off",
};

function mockCtx(callbackData?: string, messageText?: string) {
  return {
    from: { id: 123456 },
    me: { username: "TestBot" },
    message: messageText ? { text: messageText } : undefined,
    callbackQuery: callbackData ? { data: callbackData } : undefined,
    reply: vi.fn().mockResolvedValue({}),
    t: tEn,
    editMessageText: vi.fn().mockResolvedValue(true),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
  } as any;
}

const lastEdit = (ctx: any): string =>
  ctx.editMessageText.mock.calls[ctx.editMessageText.mock.calls.length - 1][0];

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.user.findUnique as any).mockResolvedValue(USER);
  quoteOpenPositionMock.mockResolvedValue({
    positionId: 0,
    slippage: 0.5,
    routes: [{ routeType: "FxRoute", leverage: 3, executionPrice: "2500", colls: "1", debts: "2", txs: [{ to: "0x1", data: "0x", value: 0n }] }],
  });
  executeRouteMock.mockResolvedValue({
    ok: true,
    deduped: false,
    recordId: "rec-1",
    status: "confirmed",
    hashes: ["0xhash1"],
  });
});

describe("ladder navigation", () => {
  it("market tap shows side selection on the same message", async () => {
    const ctx = mockCtx("tl_s_0");
    await handleLadderCallback(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(lastEdit(ctx)).toContain("long or short");
  });

  it("amount tap renders a signed preview with a Confirm button", async () => {
    const ctx = mockCtx("tl_p_0_l_30_500000");
    await handleLadderCallback(ctx);
    expect(lastEdit(ctx)).toContain("Trade Preview");
    expect(lastEdit(ctx)).toContain("0.5 wstETH");
    const keyboard = ctx.editMessageText.mock.calls[0][1].reply_markup;
    const flat = JSON.stringify(keyboard);
    expect(flat).toContain("tc_t1_");
    expect(flat).toContain("t.me/TestBot?start=t1_");
  });

  it("preview without a connected wallet hides Confirm and points to /start", async () => {
    (prisma.user.findUnique as any).mockResolvedValue(null);
    const ctx = mockCtx("tl_p_0_l_30_500000");
    await handleLadderCallback(ctx);
    expect(lastEdit(ctx)).toContain("/start");
    expect(JSON.stringify(ctx.editMessageText.mock.calls[0][1].reply_markup)).not.toContain("tc_t1_");
  });
});

describe("confirm flow", () => {
  const intent = { market: "wstETH" as const, side: "long" as const, leverage: 3, amount: 0.5 };

  it("executes via executeRoute with a nonce-derived idempotency key", async () => {
    const token = createTradeIntent(intent);
    const ctx = mockCtx(`tc_${token}`);
    await handleConfirmCallback(ctx);
    expect(executeRouteMock).toHaveBeenCalledTimes(1);
    const call = executeRouteMock.mock.calls[0][0];
    expect(call.idempotencyKey).toMatch(/^trade:user-1:[0-9a-f]{10}$/);
    expect(call.walletId).toBe("wallet-1");
    expect(call.type).toBe("open_long");
    expect(lastEdit(ctx)).toContain("0xhash1");
  });

  it("rejects tampered tokens without executing", async () => {
    const token = createTradeIntent(intent);
    const parts = token.split("_");
    parts[3] = "70";
    const ctx = mockCtx(`tc_${parts.join("_")}`);
    await handleConfirmCallback(ctx);
    expect(executeRouteMock).not.toHaveBeenCalled();
    expect(lastEdit(ctx)).toContain("invalid");
  });

  it("rejects expired tokens honestly", async () => {
    const token = createTradeIntent(intent, -60_000);
    const ctx = mockCtx(`tc_${token}`);
    await handleConfirmCallback(ctx);
    expect(executeRouteMock).not.toHaveBeenCalled();
    expect(lastEdit(ctx)).toContain("expired");
  });

  it("reports dedupe instead of pretending a second trade happened", async () => {
    executeRouteMock.mockResolvedValue({ ok: true, deduped: true, recordId: "rec-1", status: "confirmed", hashes: ["0xhash1"] });
    const ctx = mockCtx(`tc_${createTradeIntent(intent)}`);
    await handleConfirmCallback(ctx);
    expect(lastEdit(ctx)).toContain("duplicate");
  });

  it("requires a fully onboarded wallet", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ ...USER, privyWalletId: null });
    const ctx = mockCtx(`tc_${createTradeIntent(intent)}`);
    await handleConfirmCallback(ctx);
    expect(executeRouteMock).not.toHaveBeenCalled();
    expect(lastEdit(ctx)).toContain("/start");
  });

  it("surfaces executor failure without inventing success", async () => {
    executeRouteMock.mockResolvedValue({ ok: false, deduped: false, recordId: "rec-1", status: "failed", error: "simulation failed at tx 1: TRANSFER_FROM_FAILED" });
    const ctx = mockCtx(`tc_${createTradeIntent(intent)}`);
    await handleConfirmCallback(ctx);
    // W-19: raw errors are classified into actionable copy with
    // broadcast-state honesty (sim failure ⇒ nothing was sent).
    expect(lastEdit(ctx)).toContain("NOT sent");
    expect(lastEdit(ctx)).toContain("insufficient balance");
    expect(lastEdit(ctx)).not.toContain("Position opened");
  });

  it("cancel edits the message and sends nothing", async () => {
    const ctx = mockCtx("tx_cancel");
    await handleCancelCallback(ctx);
    expect(executeRouteMock).not.toHaveBeenCalled();
    expect(lastEdit(ctx)).toContain("cancelled");
  });
});

describe("/start trade deep links", () => {
  it("signed t1_ payload renders a preview for existing users", async () => {
    const token = createTradeIntent({ market: "wstETH", side: "long", leverage: 3, amount: 0.5 });
    const ctx = mockCtx(undefined, `/start ${token}`);
    await startCommand(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("Trade Preview");
  });

  it("expired t1_ payload gets an honest expiry message", async () => {
    const token = createTradeIntent({ market: "wstETH", side: "long", leverage: 3, amount: 0.5 }, -60_000);
    const ctx = mockCtx(undefined, `/start ${token}`);
    await startCommand(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("expired");
  });

  it("tq_ Mini App payload is re-validated server-side", async () => {
    const ctx = mockCtx(undefined, "/start tq_0_l_30_500000");
    await startCommand(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("Trade Preview");

    const bad = mockCtx(undefined, "/start tq_0_l_990_500000"); // 99x leverage
    await startCommand(bad);
    expect(bad.reply.mock.calls[0][0]).toContain("Invalid trade parameters");
  });
});

describe("buildPreview", () => {
  it("keeps confirm callback_data within Telegram's 64-byte limit", () => {
    const { keyboard } = buildPreview(
      { market: "WBTC", side: "short", leverage: 2.5, amount: 0.005 },
      USER,
      "TestBot"
    );
    const rows = (keyboard as any).inline_keyboard as Array<Array<{ callback_data?: string }>>;
    for (const row of rows) {
      for (const btn of row) {
        if (btn.callback_data) {
          expect(Buffer.byteLength(btn.callback_data)).toBeLessThanOrEqual(64);
        }
      }
    }
  });
});
