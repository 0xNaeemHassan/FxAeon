/**
 * /alert — parsing, trigger predicate, poller one-shot semantics, and the
 * portfolio USD estimator that rides the same CoinGecko snapshot.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@fxaeon/db";
import { parseAlertArgs, describeAlert, alertCommand, MAX_ACTIVE_ALERTS } from "../src/commands/alert.js";
import {
  shouldTrigger,
  formatAlertMessage,
  priceAlertPoller,
  type AlertRecord,
} from "../src/notifications/price-alert-poller.js";
import { positionUsd } from "../src/commands/portfolio.js";
import { clearMarketCache, type MarketRow } from "../src/market/coingecko.js";
import type { OnChainPosition } from "../src/core/portfolio.js";

function row(symbol: string, priceUsd: number, change24hPct: number | null = 0): MarketRow {
  return { symbol, data: { priceUsd, marketCapUsd: null, change24hPct, change7dPct: null } };
}

function marketsBody(entries: Array<{ id: string; current_price: number; pct24?: number }>) {
  return entries.map((e) => ({
    id: e.id,
    current_price: e.current_price,
    market_cap: 1,
    price_change_percentage_24h_in_currency: e.pct24 ?? 0,
    price_change_percentage_7d_in_currency: 0,
  }));
}

describe("parseAlertArgs", () => {
  it("parses absolute above/below thresholds (with $, commas, no-space)", () => {
    expect(parseAlertArgs(["btc", ">", "65000"])).toEqual({ kind: "above", symbol: "BTC", threshold: 65000 });
    expect(parseAlertArgs(["eth", "<", "$1,500"])).toEqual({ kind: "below", symbol: "ETH", threshold: 1500 });
    expect(parseAlertArgs(["fxn", ">12.5"])).toEqual({ kind: "above", symbol: "FXN", threshold: 12.5 });
  });

  it("parses signed 24h percent thresholds", () => {
    expect(parseAlertArgs(["btc", "+10%"])).toEqual({ kind: "pct", symbol: "BTC", threshold: 10 });
    expect(parseAlertArgs(["eth", "-5%"])).toEqual({ kind: "pct", symbol: "ETH", threshold: -5 });
    expect(parseAlertArgs(["eth", "-5", "%"])).toEqual({ kind: "pct", symbol: "ETH", threshold: -5 });
  });

  it("rejects unknown symbols, unsigned percents, and garbage with human messages", () => {
    expect(typeof parseAlertArgs(["doge", ">", "1"])).toBe("string");
    expect(typeof parseAlertArgs(["btc", "5%"])).toBe("string"); // sign required
    expect(typeof parseAlertArgs(["btc", ">", "-5"])).toBe("string");
    expect(typeof parseAlertArgs(["btc"])).toBe("string");
    expect(typeof parseAlertArgs([])).toBe("string");
  });

  it("describes alerts in plain language", () => {
    expect(describeAlert({ symbol: "BTC", kind: "above", threshold: 65000 })).toContain("above");
    expect(describeAlert({ symbol: "ETH", kind: "pct", threshold: -5 })).toContain("-5%");
    expect(describeAlert({ symbol: "ETH", kind: "pct", threshold: 5 })).toContain("+5%");
  });
});

describe("shouldTrigger", () => {
  const above: AlertRecord = { id: "1", userId: "u", symbol: "BTC", kind: "above", threshold: 65000 };
  const below: AlertRecord = { id: "2", userId: "u", symbol: "ETH", kind: "below", threshold: 1500 };
  const pctUp: AlertRecord = { id: "3", userId: "u", symbol: "FXN", kind: "pct", threshold: 10 };
  const pctDown: AlertRecord = { id: "4", userId: "u", symbol: "FXN", kind: "pct", threshold: -5 };

  it("fires above/below only when crossed (inclusive)", () => {
    expect(shouldTrigger(above, row("BTC", 64999))).toBeNull();
    expect(shouldTrigger(above, row("BTC", 65000))).toBe(65000);
    expect(shouldTrigger(below, row("ETH", 1501))).toBeNull();
    expect(shouldTrigger(below, row("ETH", 1499.5))).toBe(1499.5);
  });

  it("fires pct alerts in the signed direction only", () => {
    expect(shouldTrigger(pctUp, row("FXN", 14, 12))).toBe(14);
    expect(shouldTrigger(pctUp, row("FXN", 14, 9))).toBeNull();
    expect(shouldTrigger(pctUp, row("FXN", 14, -12))).toBeNull();
    expect(shouldTrigger(pctDown, row("FXN", 11, -6))).toBe(11);
    expect(shouldTrigger(pctDown, row("FXN", 11, 6))).toBeNull();
  });

  it("never fires on missing data", () => {
    expect(shouldTrigger(above, undefined)).toBeNull();
    expect(shouldTrigger(above, { symbol: "BTC", data: null })).toBeNull();
    expect(shouldTrigger(pctUp, row("FXN", 14, null))).toBeNull();
  });
});

describe("priceAlertPoller", () => {
  beforeEach(() => {
    clearMarketCache();
    vi.unstubAllGlobals();
  });

  it("does not call CoinGecko at all when no alerts are active", async () => {
    (prisma.priceAlert.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await priceAlertPoller.check();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fires a matching alert once and archives it with the observed price", async () => {
    (prisma.priceAlert.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "a1",
        userId: "u1",
        symbol: "BTC",
        kind: "above",
        threshold: 60000,
        user: { telegramId: "42" },
      },
    ]);
    const update = prisma.priceAlert.update as ReturnType<typeof vi.fn>;
    update.mockClear();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => marketsBody([{ id: "bitcoin", current_price: 63000 }]),
      })
    );

    // notify() resolves prefs through the mocked prisma; make it deliver.
    const { initNotify, __resetNotifyForTests } = await import("../src/notifications/notify.js");
    __resetNotifyForTests?.();
    const sendFn = vi.fn().mockResolvedValue(undefined);
    initNotify(sendFn);
    (prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>).notificationPref = {
      findUnique: vi.fn().mockResolvedValue(null), // default prefs: rules=true
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    };

    await priceAlertPoller.check();

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(String(sendFn.mock.calls[0][1])).toContain("BTC");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "a1" },
        data: expect.objectContaining({ status: "triggered", triggerPrice: 63000 }),
      })
    );
  });

  it("refuses to fire from a stale snapshot", async () => {
    (prisma.priceAlert.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "a1", userId: "u1", symbol: "BTC", kind: "above", threshold: 1, user: { telegramId: "42" } },
    ]);
    const update = prisma.priceAlert.update as ReturnType<typeof vi.fn>;
    update.mockClear();

    // Seed the cache, then advance past TTL and make upstream fail → stale.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => marketsBody([{ id: "bitcoin", current_price: 63000 }]),
      })
    );
    const { getMarketOverview } = await import("../src/market/coingecko.js");
    await getMarketOverview();

    vi.useFakeTimers();
    vi.advanceTimersByTime(120_000);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    try {
      await priceAlertPoller.check();
      expect(update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("alertCommand", () => {
  it("enforces the per-user active alert cap", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
    (prisma.priceAlert.count as ReturnType<typeof vi.fn>).mockResolvedValue(MAX_ACTIVE_ALERTS);
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      from: { id: 42 },
      message: { text: "/alert btc > 65000" },
      reply,
    } as never;
    await alertCommand(ctx);
    expect(String(reply.mock.calls[0][0])).toContain("maximum");
    expect(prisma.priceAlert.create).not.toHaveBeenCalled();
  });
});

describe("positionUsd", () => {
  const pos = {
    market: "wstETH",
    side: "long",
    positionId: "1",
    leverage: 3,
    health: 0.2,
    collateral: 2,
    collateralToken: "wstETH",
    debt: 3000,
    debtToken: "fxUSD",
  } as unknown as OnChainPosition;

  it("computes collateral/debt/net from live spot prices", () => {
    const usd = positionUsd(pos, { wstETH: 2000, FXUSD: 1.0 });
    expect(usd).toEqual({ collateralUsd: 4000, debtUsd: 3000, netUsd: 1000 });
  });

  it("returns null (omit, never guess) when a needed price is missing", () => {
    expect(positionUsd(pos, { FXUSD: 1.0 })).toBeNull();
    expect(positionUsd(pos, { wstETH: null, FXUSD: 1.0 })).toBeNull();
  });

  it("falls back to $1 for fxUSD only when FXUSD itself is unpriced", () => {
    const usd = positionUsd(pos, { wstETH: 2000 });
    expect(usd?.debtUsd).toBe(3000);
  });
});
