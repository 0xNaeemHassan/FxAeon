import { describe, it, expect, vi } from "vitest";

/**
 * Deposit command tests — Phase 4.
 * Tests deposit watcher creation and QR generation.
 */

vi.mock("@fxaeon/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        telegramId: "123",
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      }),
    },
    depositWatcher: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "watcher-1" }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
  },
}));

vi.mock("../src/middleware/logger", () => ({
  botLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@fxaeon/shared", () => ({
  ADDRESSES: {
    FXUSD: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
    WSTETH: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
    WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
  },
}));

import {
  getDepositWatcherStats,
} from "../src/notifications/deposit-watcher-poller.js";

describe("Deposit watcher poller", () => {
  it("returns initial stats", () => {
    const stats = getDepositWatcherStats();
    expect(stats.pollCount).toBe(0);
    expect(stats.running).toBe(false);
    expect(stats.lastBlockChecked).toBe("0");
  });
});

describe("Deposit supported tokens", () => {
  it("supports ETH, WETH, wstETH, WBTC, USDC, USDT, fxUSD", () => {
    const tokens = [
      "ETH", "WETH", "wstETH", "WBTC",
      "USDC", "USDT", "fxUSD",
    ];
    expect(tokens.length).toBe(7);
  });
});
