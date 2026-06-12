/**
 * Onboarding tests (user-owned wallets): referral parsing/codes, server-side
 * wallet LINKING (the user creates/imports the wallet in the Mini App; the
 * backend only reads it from Privy), idempotency, untrusted payload handling,
 * /start keyboard, and the web_app_data handler.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@fxbot/db";

// Mock privy core BEFORE importing modules under test.
const getUserWalletMock = vi.fn();
const createPrivyUserMock = vi.fn();
const getUserByTelegramUserIdMock = vi.fn();
vi.mock("../src/core/privy", () => ({
  getPrivy: () => ({ getUserByTelegramUserId: getUserByTelegramUserIdMock }),
  createPrivyUser: (...a: unknown[]) => createPrivyUserMock(...a),
  getUserWallet: (...a: unknown[]) => getUserWalletMock(...a),
}));

// Funding reads hit RPC — stub to "unknown" so copy stays balance-free.
vi.mock("../src/core/funding", async () => {
  const actual = await vi.importActual<typeof import("../src/core/funding")>(
    "../src/core/funding"
  );
  return {
    ...actual,
    getFundingState: vi.fn().mockResolvedValue({ known: false }),
  };
});

import {
  generateReferralCode,
  parseReferralPayload,
  onboardUser,
} from "../src/core/onboarding";
import { describeFunding } from "../src/core/funding";
import { handleWebAppData } from "../src/handlers/walletConnect";
import { startCommand } from "../src/commands/start";
import { tEn } from "./helpers/i18n";

// What getUserWallet returns: the USER's own embedded wallet, read from Privy.
const WALLET = { id: "wallet-id-1", address: "0xAbCd000000000000000000000000000000001234", imported: false, delegated: true };

describe("referral code utils", () => {
  it("generates 8-char codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateReferralCode();
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/);
    }
  });

  it("generates distinct codes (CSPRNG, not Math.random)", () => {
    const codes = new Set(Array.from({ length: 100 }, generateReferralCode));
    expect(codes.size).toBeGreaterThan(95);
  });

  it("parses ref_ payloads case-insensitively", () => {
    expect(parseReferralPayload("/start ref_abcd1234")).toBe("ABCD1234");
    expect(parseReferralPayload("/start ref_XYZ234")).toBe("XYZ234");
  });

  it("rejects malformed payloads", () => {
    expect(parseReferralPayload("/start")).toBeUndefined();
    expect(parseReferralPayload("/start ref_")).toBeUndefined();
    expect(parseReferralPayload("/start ref_a b")).toBeUndefined();
    expect(parseReferralPayload("/start notref_AAAA")).toBeUndefined();
    expect(parseReferralPayload("/start ref_<script>")).toBeUndefined();
  });
});

describe("onboardUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ id: "new-user-id", ...data })
    );
    getUserByTelegramUserIdMock.mockResolvedValue(null);
    createPrivyUserMock.mockResolvedValue({ id: "privy-user-1" });
    getUserWalletMock.mockResolvedValue(WALLET);
  });

  it("is idempotent: existing DB user short-circuits (sync only, no create)", async () => {
    (prisma.user.findUnique as any).mockResolvedValueOnce({
      id: "u1", telegramId: "123", walletAddress: WALLET.address, referralCode: "AAAA2222",
      privyUserId: "privy-user-1", privyWalletId: "wallet-id-1", walletDelegated: true, walletImported: false,
    });
    const res = await onboardUser("123");
    expect(res.status).toBe("existing");
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("links the USER's wallet + db row for new users (never creates one)", async () => {
    const res = await onboardUser("123");
    expect(res.status).toBe("linked");
    expect(createPrivyUserMock).toHaveBeenCalledWith("123");
    // Read-only: the wallet comes FROM the user's Privy account.
    expect(getUserWalletMock).toHaveBeenCalledWith("privy-user-1");
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          telegramId: "123",
          privyUserId: "privy-user-1",
          privyWalletId: "wallet-id-1",
          walletAddress: WALLET.address,
          walletDelegated: true,
          walletImported: false,
        }),
      })
    );
    if (res.status === "linked") expect(res.user.walletAddress).toBe(WALLET.address);
  });

  it("returns no_wallet (and writes nothing) until the user finishes Mini App setup", async () => {
    getUserWalletMock.mockResolvedValue(null);
    const res = await onboardUser("123");
    expect(res.status).toBe("no_wallet");
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("reuses an existing Privy user instead of importing", async () => {
    getUserByTelegramUserIdMock.mockResolvedValue({ id: "privy-existing" });
    await onboardUser("123");
    expect(createPrivyUserMock).not.toHaveBeenCalled();
    expect(getUserWalletMock).toHaveBeenCalledWith("privy-existing");
  });

  it("writes the referral when the code resolves to a real user", async () => {
    (prisma.user.findUnique as any).mockImplementation(({ where }: any) => {
      if (where.referralCode === "GOODCODE") {
        return Promise.resolve({ id: "referrer-id", referralCode: "GOODCODE" });
      }
      return Promise.resolve(null);
    });
    (prisma as any).referral = { create: vi.fn().mockResolvedValue({}) };

    const res = await onboardUser("123", "GOODCODE");
    expect(res.referrerCode).toBe("GOODCODE");
    expect((prisma as any).referral.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ referrerId: "referrer-id", refereeId: "new-user-id" }),
      })
    );
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ referredBy: "referrer-id" }),
      })
    );
  });

  it("unknown referral codes never block onboarding", async () => {
    (prisma as any).referral = { create: vi.fn() };
    const res = await onboardUser("123", "NOSUCHCD");
    expect(res.status).toBe("linked");
    expect(res.referrerCode).toBeUndefined();
    expect((prisma as any).referral.create).not.toHaveBeenCalled();
  });

  it("fails closed when the Privy wallet read fails (no db row)", async () => {
    getUserWalletMock.mockRejectedValue(new Error("privy down"));
    await expect(onboardUser("123")).rejects.toThrow("privy down");
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe("handleWebAppData", () => {
  const makeCtx = (data: unknown) =>
    ({
      from: { id: 123456 },
      message: { web_app_data: { data: typeof data === "string" ? data : JSON.stringify(data) } },
      reply: vi.fn(),
      t: tEn,
    }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.user.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ id: "new-user-id", ...data })
    );
    getUserByTelegramUserIdMock.mockResolvedValue(null);
    createPrivyUserMock.mockResolvedValue({ id: "privy-user-1" });
    getUserWalletMock.mockResolvedValue(WALLET);
  });

  it("onboards on a valid wallet_connected payload", async () => {
    const ctx = makeCtx({ type: "wallet_connected", address: "0xclient", privyUserId: "spoofed" });
    await handleWebAppData(ctx);
    // Server-side resolution: client-supplied privyUserId is ignored.
    expect(getUserWalletMock).toHaveBeenCalledWith("privy-user-1");
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Wallet created"),
      expect.objectContaining({ reply_markup: { remove_keyboard: true } })
    );
    // The SERVER wallet address is announced, not the client-claimed one.
    expect((ctx.reply as any).mock.calls[0][0]).toContain(WALLET.address);
    expect((ctx.reply as any).mock.calls[0][0]).not.toContain("0xclient");
  });

  it("ignores malformed JSON silently", async () => {
    const ctx = makeCtx("{not json");
    await handleWebAppData(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(getUserWalletMock).not.toHaveBeenCalled();
  });

  it("ignores unexpected payload types", async () => {
    const ctx = makeCtx({ type: "trade_executed", amount: "1" });
    await handleWebAppData(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("rejects referral codes with invalid characters", async () => {
    const ctx = makeCtx({ type: "wallet_connected", referral: "bad code!" });
    await handleWebAppData(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(getUserWalletMock).not.toHaveBeenCalled();
  });

  it("asks the user to finish Mini App setup when no wallet exists yet", async () => {
    getUserWalletMock.mockResolvedValue(null);
    const ctx = makeCtx({ type: "wallet_connected" });
    await handleWebAppData(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("isn't finished yet"),
      expect.anything()
    );
  });

  it("replies honestly when the wallet link fails", async () => {
    getUserWalletMock.mockRejectedValue(new Error("privy down"));
    const ctx = makeCtx({ type: "wallet_connected" });
    await handleWebAppData(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Wallet linking failed"),
      expect.anything()
    );
  });

  it("tells already-onboarded users they are set up", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u1", telegramId: "123456", walletAddress: "0xAbCd000000000000000000000000000000005678", referralCode: "AAAA2222",
      privyUserId: "privy-user-1", privyWalletId: "wallet-id-1", walletDelegated: true, walletImported: false,
    });
    const ctx = makeCtx({ type: "wallet_connected" });
    await handleWebAppData(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("already set up"),
      expect.anything()
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe("startCommand (W-16)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.user.findUnique as any).mockResolvedValue(null);
  });

  it("shows a reply-keyboard Set-Up-Wallet web_app button to new users", async () => {
    const ctx = { from: { id: 1 }, message: { text: "/start" }, reply: vi.fn(), t: tEn } as any;
    await startCommand(ctx);
    const [, opts] = (ctx.reply as any).mock.calls[0];
    const btn = opts.reply_markup.keyboard[0][0];
    expect(btn.text).toContain("Set Up Wallet");
    expect(btn.web_app.url).toMatch(/\/login$/);
  });

  it("threads the referral code into the login url", async () => {
    const ctx = { from: { id: 1 }, message: { text: "/start ref_GOODCODE" }, reply: vi.fn(), t: tEn } as any;
    await startCommand(ctx);
    const [text, opts] = (ctx.reply as any).mock.calls[0];
    expect(text).toContain("GOODCODE");
    expect(opts.reply_markup.keyboard[0][0].web_app.url).toContain("ref=GOODCODE");
  });

  it("greets returning users without the create-wallet keyboard", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u1", walletAddress: "0xAbCd000000000000000000000000000000005678",
    });
    (prisma.position.count as any).mockResolvedValue(2);
    const ctx = { from: { id: 1 }, message: { text: "/start" }, reply: vi.fn(), t: tEn } as any;
    await startCommand(ctx);
    const [text, opts] = (ctx.reply as any).mock.calls[0];
    expect(text).toContain("Welcome back");
    expect(text).toContain("2 active positions");
    expect(opts.reply_markup).toEqual({ remove_keyboard: true });
  });
});

describe("describeFunding", () => {
  it("says nothing when balances are unknown (no fabricated numbers)", () => {
    expect(describeFunding({ known: false })).toBe("");
  });

  it("shows the empty state for unfunded wallets", () => {
    const s = describeFunding({ known: true, funded: false, eth: "0", wstEth: "0", wbtc: "0" });
    expect(s).toContain("wallet is empty");
    expect(s).toContain("/deposit");
  });

  it("lists only non-zero balances for funded wallets", () => {
    const s = describeFunding({ known: true, funded: true, eth: "1.5", wstEth: "0", wbtc: "0.25" });
    expect(s).toContain("1.5 ETH");
    expect(s).toContain("0.25 WBTC");
    expect(s).not.toContain("wstETH");
  });
});
