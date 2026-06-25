/**
 * Health monitor tests — on-chain reads as source of truth.
 *
 * The old monitor read `prisma.position`, a table nothing ever wrote, so it
 * could never alert. These tests pin the ported behavior: positions come
 * from the chain, alert levels derive from on-chain leverage, read failures
 * are surfaced (never treated as "no positions"), and messages don't invent
 * data (no fabricated liquidation price).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@fxaeon/db";
import { HEALTH_LEVELS } from "@fxaeon/shared";

const getPositionsMock = vi.fn();
vi.mock("../src/fx/index", () => ({
  createFxSdk: vi.fn(() => ({})),
  getPositions: (...a: unknown[]) => getPositionsMock(...a),
}));

const notifyMock = vi.fn().mockResolvedValue("sent");
vi.mock("../src/notifications/notify", () => ({
  notify: (...a: unknown[]) => notifyMock(...a),
}));

import {
  healthMonitor,
  classifyHealth,
  formatHealthMessage,
} from "../src/notifications/health-monitor";

const USER = { id: "u1", telegramId: "123456", walletAddress: "0xAbCd0000000000000000000000000000000012" };

// leverage → debtRatio = 1 − 1/lev → health = debtRatio / 0.95
function chainPos(leverage: number, positionId = 7) {
  return {
    positionId,
    rawColls: 10n ** 18n,
    rawDebts: 5000n * 10n ** 18n,
    currentLeverage: leverage,
    lsdLeverage: leverage,
    rawCollsToken: "wstETH",
    rawDebtsToken: "fxUSD",
    rawCollsDecimals: 18,
    rawDebtsDecimals: 18,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  notifyMock.mockResolvedValue("sent");
});

describe("classifyHealth", () => {
  it("maps thresholds: safe → null, ≥WARNING → warning, ≥URGENT → urgent", () => {
    expect(classifyHealth(0.5)).toBeNull();
    expect(classifyHealth(HEALTH_LEVELS.WARNING - 0.001)).toBeNull();
    expect(classifyHealth(HEALTH_LEVELS.WARNING)).toBe("warning");
    expect(classifyHealth(HEALTH_LEVELS.URGENT - 0.001)).toBe("warning");
    expect(classifyHealth(HEALTH_LEVELS.URGENT)).toBe("urgent");
    expect(classifyHealth(1.2)).toBe("urgent"); // past liquidation threshold
  });

  it("refuses to classify non-finite health", () => {
    expect(classifyHealth(NaN)).toBeNull();
    expect(classifyHealth(Infinity)).toBeNull();
  });
});

describe("formatHealthMessage", () => {
  const pos = { market: "wstETH", side: "long" as const, positionId: 7, leverage: 12, health: 0.965 };

  it("urgent message names the position and real health, no invented numbers", () => {
    const msg = formatHealthMessage("urgent", pos);
    expect(msg).toContain("URGENT");
    expect(msg).toContain("wstETH LONG #7");
    expect(msg).toContain("96.5%");
    expect(msg).not.toContain("liq. price"); // the old fabricated field
  });

  it("warning message uses the warning header", () => {
    expect(formatHealthMessage("warning", pos)).toContain("Approaching the Rebalance Line");
  });
});

describe("healthMonitor.check — on-chain reads", () => {
  it("alerts urgent for high-leverage positions, bypassing nothing itself", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([USER] as never);
    getPositionsMock.mockResolvedValue([]); // other market/side combos
    getPositionsMock.mockResolvedValueOnce([chainPos(12)]); // health ≈ 0.965 → urgent

    await healthMonitor.check();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    const call = notifyMock.mock.calls[0][0];
    expect(call.kind).toBe("health_urgent");
    expect(call.userId).toBe("u1");
    expect(call.message).toContain("URGENT");
  });

  it("alerts warning level with the pref-gated kind", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([USER] as never);
    getPositionsMock.mockResolvedValue([]);
    getPositionsMock.mockResolvedValueOnce([chainPos(6)]); // health ≈ 0.877 → warning

    await healthMonitor.check();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0].kind).toBe("health");
  });

  it("stays silent for healthy positions", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([USER] as never);
    getPositionsMock.mockResolvedValue([]);
    getPositionsMock.mockResolvedValueOnce([chainPos(3)]); // health ≈ 0.70 → safe

    await healthMonitor.check();

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("never alerts off failed reads — failures are not 'no positions'", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([USER] as never);
    getPositionsMock.mockRejectedValue(new Error("RPC down"));

    await healthMonitor.check();

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("one user's failure doesn't block the next user's alerts", async () => {
    const user2 = { ...USER, id: "u2", telegramId: "654321", walletAddress: "0xBbBb0000000000000000000000000000000034" };
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([USER, user2] as never);
    // user1: all 4 combos reject; user2: first combo urgent, rest empty
    getPositionsMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([chainPos(12)])
      .mockResolvedValue([]);

    await healthMonitor.check();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0].userId).toBe("u2");
  });
});
