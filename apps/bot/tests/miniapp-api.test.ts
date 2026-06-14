/**
 * Mini App API tests: initData verification (the auth boundary) and the
 * /me, /onboard, /settings endpoints over a real express listener.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import { prisma } from "@fxbot/db";

// Mock privy + funding before importing the router (onboarding path).
const getUserWalletMock = vi.fn();
const createPrivyUserMock = vi.fn();
const getUserByTelegramUserIdMock = vi.fn();
vi.mock("../src/core/privy", () => ({
  getPrivy: () => ({ getUserByTelegramUserId: getUserByTelegramUserIdMock }),
  createPrivyUser: (...a: unknown[]) => createPrivyUserMock(...a),
  getUserWallet: (...a: unknown[]) => getUserWalletMock(...a),
}));
vi.mock("../src/core/funding", () => ({
  getFundingState: vi.fn().mockResolvedValue({ known: false }),
  describeFunding: () => "",
}));

import { verifyInitData, createMiniAppRouter } from "../src/api/miniapp";

const BOT_TOKEN = "12345:TEST-TOKEN";

/** Build a signed initData string exactly like Telegram does. */
function makeInitData(
  user: Record<string, unknown>,
  { authDate = Math.floor(Date.now() / 1000), startParam }: { authDate?: number; startParam?: string } = {},
  token = BOT_TOKEN
): string {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(user));
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAE-test");
  if (startParam) params.set("start_param", startParam);
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

const TG_USER = { id: 777000111, first_name: "Naeem", username: "tester" };

describe("verifyInitData", () => {
  it("accepts a correctly signed payload and extracts the user", () => {
    const v = verifyInitData(makeInitData(TG_USER), BOT_TOKEN);
    expect(v).not.toBeNull();
    expect(v!.telegramId).toBe("777000111");
    expect(v!.username).toBe("tester");
  });

  it("rejects a tampered payload (user swapped after signing)", () => {
    const initData = makeInitData(TG_USER);
    const tampered = initData.replace("777000111", "999999999");
    expect(verifyInitData(tampered, BOT_TOKEN)).toBeNull();
  });

  it("rejects a payload signed with a different bot token", () => {
    const initData = makeInitData(TG_USER, {}, "999:OTHER-TOKEN");
    expect(verifyInitData(initData, BOT_TOKEN)).toBeNull();
  });

  it("rejects stale auth_date (replay window)", () => {
    const old = Math.floor(Date.now() / 1000) - 7 * 60 * 60;
    const initData = makeInitData(TG_USER, { authDate: old });
    expect(verifyInitData(initData, BOT_TOKEN)).toBeNull();
  });

  it("rejects empty / garbage / missing hash", () => {
    expect(verifyInitData("", BOT_TOKEN)).toBeNull();
    expect(verifyInitData("not=even&close=true", BOT_TOKEN)).toBeNull();
    expect(verifyInitData("a".repeat(5000), BOT_TOKEN)).toBeNull();
  });

  it("passes start_param through", () => {
    const v = verifyInitData(makeInitData(TG_USER, { startParam: "ref_ABCD1234" }), BOT_TOKEN);
    expect(v!.startParam).toBe("ref_ABCD1234");
  });
});

describe("miniapp router", () => {
  let server: Server;
  let base: string;
  const sendMessage = vi.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(
      "/api/v1/miniapp",
      createMiniAppRouter({
        botToken: BOT_TOKEN,
        sendMessage,
        miniAppUrl: "https://example.test",
      })
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/v1/miniapp`;
  });

  afterAll(() => server?.close());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const auth = { Authorization: `tma ${makeInitData(TG_USER)}` };

  it("401s without auth header", async () => {
    const r = await fetch(`${base}/me`);
    expect(r.status).toBe(401);
  });

  it("401s with forged initData", async () => {
    const r = await fetch(`${base}/me`, {
      headers: { Authorization: `tma ${makeInitData(TG_USER, {}, "999:WRONG")}` },
    });
    expect(r.status).toBe(401);
  });

  it("GET /me → onboarded:false for unknown user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    const r = await fetch(`${base}/me`, { headers: auth });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ onboarded: false });
  });

  it("GET /me → full state for onboarded user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
      telegramId: "777000111",
      walletAddress: "0xAbCd000000000000000000000000000000001234",
      referralCode: "ABCD2345",
      language: "en",
      slippageBps: 50,
      mevProtection: "off",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const r = await fetch(`${base}/me`, { headers: auth });
    const body = await r.json();
    expect(body.onboarded).toBe(true);
    expect(body.walletAddress).toBe("0xAbCd000000000000000000000000000000001234");
    // Positions are read ON-CHAIN now (the old prisma.position table was
    // never written). With no RPC in tests the read fails soft:
    expect(body.positions).toEqual([]);
    expect(body.positionsKnown).toBe(false);
    expect(body.funding).toEqual({ known: false });
    // The fxSAVE (stability pool) read also fails soft with no RPC: no holding
    // is invented, and the total stays unclaimed rather than partial.
    expect(body.savingsKnown).toBe(false);
    expect(body.savings).toBeNull();
    expect(body.summary.savingsUsd).toBeNull();
    expect(body.summary.totalValueUsd).toBeNull();
  });

  it("POST /onboard links the USER's wallet and mirrors it into the chat", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    getUserByTelegramUserIdMock.mockResolvedValueOnce(null);
    createPrivyUserMock.mockResolvedValueOnce({ id: "privy-1" });
    // The wallet is READ from the user's Privy account — never created here.
    getUserWalletMock.mockResolvedValueOnce({
      id: "w1",
      address: "0xAbCd000000000000000000000000000000001234",
      imported: false,
      delegated: true,
    });
    vi.mocked(prisma.user.create).mockResolvedValueOnce({
      id: "u1",
      telegramId: "777000111",
      walletAddress: "0xAbCd000000000000000000000000000000001234",
      referralCode: "NEWCODE2",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const r = await fetch(`${base}/onboard`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.created).toBe(true);
    expect(body.walletAddress).toBe("0xAbCd000000000000000000000000000000001234");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = sendMessage.mock.calls[0];
    expect(chatId).toBe("777000111");
    expect(text).toContain("Wallet created");
    expect(opts.reply_markup.remove_keyboard).toBe(true);
  });

  it("POST /onboard returns 409 NO_WALLET until Mini App setup is finished", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    getUserByTelegramUserIdMock.mockResolvedValueOnce(null);
    createPrivyUserMock.mockResolvedValueOnce({ id: "privy-1" });
    getUserWalletMock.mockResolvedValueOnce(null);
    const r409 = await fetch(`${base}/onboard`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r409.status).toBe(409);
    expect((await r409.json()).error.code).toBe("NO_WALLET");
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("POST /onboard is idempotent for existing users (no chat spam)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
      telegramId: "777000111",
      walletAddress: "0xAbCd000000000000000000000000000000001234",
      referralCode: "ABCD2345",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const r = await fetch(`${base}/onboard`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await r.json();
    expect(body.created).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("POST /settings validates and persists fields", async () => {
    vi.mocked(prisma.user.update).mockResolvedValueOnce({
      language: "es",
      slippageBps: 75,
      mevProtection: "on",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const r = await fetch(`${base}/settings`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ language: "es", slippageBps: 75, mevProtection: "on" }),
    });
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(vi.mocked(prisma.user.update).mock.calls[0][0]).toEqual({
      where: { telegramId: "777000111" },
      data: { language: "es", slippageBps: 75, mevProtection: "on" },
    });
  });

  it("POST /settings rejects garbage-only payloads", async () => {
    const r = await fetch(`${base}/settings`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ slippageBps: 99999, mevProtection: "lol", language: "<script>" }),
    });
    expect(r.status).toBe(400);
  });
});
