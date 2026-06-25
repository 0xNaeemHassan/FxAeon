/**
 * /speedup & /cancel command glue — wallet gating, "nothing to do" copy, and
 * that a confirm tap routes to executeReplacement with the right kind.
 * Chain + Privy + executeReplacement are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@fxaeon/db";

const executeReplacementMock = vi.fn();
vi.mock("../src/core/txReplace.js", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, executeReplacement: (...a: unknown[]) => executeReplacementMock(...a) };
});
vi.mock("../src/fx/index.js", () => ({
  createPublicClientForUser: () => ({}),
  mevModeForUser: (m: string) => (m === "flashbots" ? "flashbots" : "off"),
}));
vi.mock("../src/core/delegation.js", () => ({
  requireDelegatedWallet: vi.fn(async () => ({ ok: true, walletId: "wal-1" })),
}));

import {
  speedUpCommand,
  cancelTxCommand,
  handleTxControlCallback,
  __clearTxControlsForTests,
} from "../src/commands/txControl.js";

const PENDING = {
  hash: "0xabcdef0000000000000000000000000000000000000000000000000000000000",
  nonce: 7,
  to: "0x1111111111111111111111111111111111111111",
  data: "0xdead",
  value: "0",
  gasLimit: "600000",
  maxFeePerGas: (30_000_000_000n).toString(),
  maxPriorityFeePerGas: (2_000_000_000n).toString(),
};

function ctxWith(text: string, replies: string[], data?: string) {
  return {
    from: { id: 42 },
    message: { text },
    callbackQuery: data ? { data } : undefined,
    reply: vi.fn(async (t: string) => void replies.push(t)),
    editMessageText: vi.fn(async (t: string) => void replies.push(t)),
    answerCallbackQuery: vi.fn(async () => undefined),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  __clearTxControlsForTests();
  (prisma.user as unknown as Record<string, unknown>) = {
    findUnique: vi.fn(async () => ({
      id: "user-1",
      telegramId: "42",
      walletAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      mevProtection: "off",
    })),
  };
  (prisma.txRecord as unknown as Record<string, unknown>) = {
    findMany: vi.fn(async () => [{ id: "rec-1", status: "broadcast", data: { pending: PENDING } }]),
  };
});

describe("/speedup & /cancel", () => {
  it("tells the user when there is nothing to replace", async () => {
    (prisma.txRecord as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany = vi.fn(async () => []);
    const out: string[] = [];
    await speedUpCommand(ctxWith("/speedup", out));
    expect(out[0]).toMatch(/Nothing to speed up/i);
    expect(executeReplacementMock).not.toHaveBeenCalled();
  });

  it("previews a replaceable tx with a Confirm button", async () => {
    const out: string[] = [];
    await cancelTxCommand(ctxWith("/cancel", out));
    expect(out[0]).toMatch(/Cancel pending transaction/i);
    expect(out[0]).toMatch(/Nonce: 7/);
  });

  it("confirm tap calls executeReplacement with the chosen kind", async () => {
    executeReplacementMock.mockResolvedValue({ ok: true, kind: "speedup", hash: "0xbeef", status: "confirmed" });
    const out: string[] = [];
    // Start → capture the generated control id from the keyboard payload.
    const startCtx = ctxWith("/speedup", out);
    let captured = "";
    startCtx.reply = vi.fn(async (_t: string, opts: { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } }) => {
      captured = opts?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data ?? "";
    }) as never;
    await speedUpCommand(startCtx);
    expect(captured).toMatch(/^tx_/);

    await handleTxControlCallback(ctxWith("", out, captured));
    expect(executeReplacementMock).toHaveBeenCalledTimes(1);
    expect(executeReplacementMock.mock.calls[0][0]).toMatchObject({ recordId: "rec-1", kind: "speedup", walletId: "wal-1" });
    expect(out[out.length - 1]).toMatch(/Sped up/i);
  });

  it("rejects a confirm tap from a different telegram user", async () => {
    const out: string[] = [];
    const startCtx = ctxWith("/cancel", out);
    let captured = "";
    startCtx.reply = vi.fn(async (_t: string, opts: { reply_markup?: { inline_keyboard: { callback_data: string }[][] } }) => {
      captured = opts?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data ?? "";
    }) as never;
    await cancelTxCommand(startCtx);

    const otherUser = ctxWith("", out, captured);
    (otherUser as { from: { id: number } }).from = { id: 999 };
    await handleTxControlCallback(otherUser);
    expect(executeReplacementMock).not.toHaveBeenCalled();
    expect(out[out.length - 1]).toMatch(/expired or is invalid/i);
  });
});
