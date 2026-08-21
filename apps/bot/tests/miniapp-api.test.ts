/**
 * Mini App API tests: initData verification (the auth boundary) and the
 * /me, /onboard, /settings endpoints over a real express listener.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import { prisma } from "@fxaeon/db";

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
  isPositiveDecimalString: (value: string | null | undefined) =>
    typeof value === "string" && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && /[1-9]/.test(value),
}));
vi.mock("../src/market/coingecko", () => ({
  getSpotPrices: vi.fn().mockResolvedValue({ stale: true, prices: {} }),
  getMarketOverview: vi.fn().mockResolvedValue({ stale: true, markets: [] }),
}));

import {
  buildMiniSavingsSnapshot,
  createMiniAppRouter,
  valuePendingSaveAssets,
  verifyInitData,
} from "../src/api/miniapp";

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

  it("rejects malformed auth fields even when the payload is correctly signed", () => {
    expect(verifyInitData(makeInitData({ id: 0 }), BOT_TOKEN)).toBeNull();
    expect(verifyInitData(makeInitData({ id: Number.MAX_SAFE_INTEGER + 1 }), BOT_TOKEN)).toBeNull();
    expect(
      verifyInitData(makeInitData(TG_USER, { authDate: 1.5 }), BOT_TOKEN)
    ).toBeNull();
    const valid = makeInitData(TG_USER);
    expect(verifyInitData(valid.replace(/hash=[^&]+/, "hash=zz"), BOT_TOKEN)).toBeNull();
  });

  it("passes start_param through", () => {
    const v = verifyInitData(makeInitData(TG_USER, { startParam: "ref_ABCD1234" }), BOT_TOKEN);
    expect(v!.startParam).toBe("ref_ABCD1234");
  });
});

describe("Mini App fxSAVE snapshot", () => {
  const redeemAllOverview = {
    shares: "0",
    sharesWei: 0n,
    assets: null,
    fxUsd: "0",
    usdc: "0",
    redeem: {
      hasPendingRedeem: true,
      pendingShares: "12.5",
      redeemableAt: 2_000_000_000,
      isCooldownComplete: false,
      cooldownHours: 24,
    },
  };

  it("retains redeem-all claim state and includes the exact two-asset preview value", () => {
    const snapshot = buildMiniSavingsSnapshot(
      redeemAllOverview,
      { fxUsd: "10", usdc: "2" },
      { FXUSD: 1.01, USDC: 0.99 }
    );

    expect(snapshot.savings).toMatchObject({
      shares: "0",
      pendingRedeem: true,
      pendingShares: "12.5",
      pendingAssets: { fxUsd: "10", usdc: "2" },
    });
    expect((snapshot.savings as { valueUsd: number }).valueUsd).toBeCloseTo(12.08, 8);
    expect(snapshot.savingsUsd).toBeCloseTo(12.08, 8);
  });

  it("keeps claim state but makes portfolio value incomplete when its preview is unavailable", () => {
    const snapshot = buildMiniSavingsSnapshot(
      redeemAllOverview,
      null,
      { FXUSD: 1, USDC: 1 }
    );

    expect(snapshot.savings).toMatchObject({
      shares: "0",
      pendingRedeem: true,
      pendingShares: "12.5",
      valueUsd: null,
    });
    expect(snapshot.savingsUsd).toBeNull();
  });

  it("does not require a price for a zero-valued preview leg", () => {
    expect(valuePendingSaveAssets(
      { fxUsd: "8", usdc: "0" },
      { FXUSD: 1 }
    )).toBe(8);
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
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(r.headers.get("vary")).toContain("Authorization");
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

  it("GET /bridge-state reports disabled and unknown chains instead of fake zeroes", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
      telegramId: "777000111",
      walletAddress: "0xAbCd000000000000000000000000000000001234",
    } as any);
    const r = await fetch(`${base}/bridge-state`, { headers: auth });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      enabled: false,
      ethereum: {
        chainId: 1,
        known: false,
        native: null,
        assets: { fxUSD: null, fxSAVE: null },
      },
      base: {
        chainId: 8453,
        known: false,
        native: null,
        assets: { fxUSD: null, fxSAVE: null },
      },
    });
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
      mevProtection: "flashbots",
       
    } as any);
    const r = await fetch(`${base}/settings`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ language: "es", slippageBps: 75, mevProtection: "on" }),
    });
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.mevProtection).toBe("on");
    expect(vi.mocked(prisma.user.update).mock.calls[0][0]).toEqual({
      where: { telegramId: "777000111" },
      data: { language: "es", slippageBps: 75, mevProtection: "flashbots" },
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

  it("POST /action/execute refuses raw params or nonce without a server quote ticket", async () => {
    const r = await fetch(`${base}/action/execute`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        params: { kind: "save_claim" },
        nonce: "client-chosen",
      }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("BAD_QUOTE_TICKET");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("POST /action/execute rejects an unknown fee tier instead of silently changing it", async () => {
    const r = await fetch(`${base}/action/execute`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: "T".repeat(43), feeTier: "turbo" }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("BAD_FEE_TIER");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
