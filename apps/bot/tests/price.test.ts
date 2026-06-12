import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { priceCommand, formatPrice, formatMarketCap, formatChange, renderMarketTable, escapeMarkdownV2 } from "../src/commands/price";
import { SUPPORTED_ASSETS, getMarketOverview, clearMarketCache } from "../src/market/coingecko";

const ORDERED_SYMBOLS = [
  "BTC", "ETH", "FXN", "CRV", "CVX", "FRAX", "AAVE",
  "MORPHO", "FXUSD", "SDT", "LDO", "PENDLE", "FLUID", "ETHFI",
];

function cgCoin(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    current_price: 100,
    market_cap: 1_000_000_000,
    price_change_percentage_24h: 1.5,
    price_change_percentage_24h_in_currency: 1.5,
    price_change_percentage_7d_in_currency: -2.25,
    ...over,
  };
}

/** Full CoinGecko payload for every supported asset (any order). */
function fullPayload() {
  return SUPPORTED_ASSETS.map(({ id }) => cgCoin(id)).reverse();
}

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as Response);
}

describe("market/coingecko", () => {
  beforeEach(() => {
    clearMarketCache();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("fetches every asset in ONE request and preserves the display order", async () => {
    const spy = mockFetchOnce(fullPayload());
    const overview = await getMarketOverview();
    expect(spy).toHaveBeenCalledTimes(1);
    const url = String(spy.mock.calls[0][0]);
    for (const { id } of SUPPORTED_ASSETS) expect(url).toContain(id);
    expect(overview.rows.map((r) => r.symbol)).toEqual(ORDERED_SYMBOLS);
    expect(overview.stale).toBe(false);
  });

  it("serves from cache within the TTL (no second upstream call)", async () => {
    const spy = mockFetchOnce(fullPayload());
    await getMarketOverview();
    await getMarketOverview();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns null data (→ N/A) for tokens CoinGecko omits, without failing", async () => {
    const partial = fullPayload().filter((c) => c.id !== "stake-dao");
    mockFetchOnce(partial);
    const overview = await getMarketOverview();
    const sdt = overview.rows.find((r) => r.symbol === "SDT")!;
    expect(sdt.data).toBeNull();
    expect(overview.rows.filter((r) => r.data !== null)).toHaveLength(13);
  });

  it("throws on HTTP errors when nothing is cached", async () => {
    mockFetchOnce({ error: "rate limited" }, false, 429);
    await expect(getMarketOverview()).rejects.toThrow(/429/);
  });

  it("serves a stale snapshot (marked stale) when upstream fails after a success", async () => {
    const spy = mockFetchOnce(fullPayload());
    await getMarketOverview();
    // Force cache expiry, then fail the next upstream call.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    spy.mockRejectedValueOnce(new Error("network down"));
    const overview = await getMarketOverview();
    expect(overview.stale).toBe(true);
    expect(overview.rows).toHaveLength(SUPPORTED_ASSETS.length);
    vi.useRealTimers();
  });
});

describe("/price formatting", () => {
  it("formats prices like the spec", () => {
    expect(formatPrice(104328)).toBe("$104,328");
    expect(formatPrice(3612.4)).toBe("$3,612");
    expect(formatPrice(145.21)).toBe("$145.21");
    expect(formatPrice(1.0)).toBe("$1.00");
    expect(formatPrice(0.92)).toBe("$0.92");
    expect(formatPrice(0.100582)).toBe("$0.1006");
  });

  it("abbreviates market caps as M/B/T", () => {
    expect(formatMarketCap(2.06e12)).toBe("$2.06T");
    expect(formatMarketCap(434.1e9)).toBe("$434.1B");
    expect(formatMarketCap(4.38e9)).toBe("$4.38B");
    expect(formatMarketCap(82.7e6)).toBe("$82.7M");
    expect(formatMarketCap(null)).toBe("N/A");
  });

  it("signs percentage changes", () => {
    expect(formatChange(2.137)).toBe("+2.14%");
    expect(formatChange(-1.03)).toBe("-1.03%");
    expect(formatChange(0)).toBe("+0.00%");
    expect(formatChange(null)).toBe("N/A");
  });

  it("renders N/A rows and keeps column alignment", () => {
    const table = renderMarketTable([
      { symbol: "BTC", data: { priceUsd: 104328, marketCapUsd: 2.06e12, change24hPct: 2.14, change7dPct: 8.73 } },
      { symbol: "SDT", data: null },
    ]);
    const lines = table.split("\n");
    expect(lines[0]).toMatch(/^BTC\s+\$104,328\s+MC: \$2.06T\s+24h: \+2.14%\s+7d: \+8.73%$/);
    expect(lines[1]).toMatch(/^SDT\s+N\/A\s+MC: N\/A\s+24h: N\/A\s+7d: N\/A$/);
    // Columns align: "MC:" starts at the same index in every row.
    expect(lines[0].indexOf("MC:")).toBe(lines[1].indexOf("MC:"));
  });

  it("escapes MarkdownV2 special characters", () => {
    expect(escapeMarkdownV2("a.b-c(d)!")).toBe("a\\.b\\-c\\(d\\)\\!");
  });
});

describe("/price command", () => {
  const mockCtx = { reply: vi.fn() } as any;

  beforeEach(() => {
    clearMarketCache();
    vi.restoreAllMocks();
    mockCtx.reply = vi.fn();
  });

  it("replies with a single MarkdownV2 message containing every symbol in order", async () => {
    mockFetchOnce(fullPayload());
    await priceCommand(mockCtx);
    expect(mockCtx.reply).toHaveBeenCalledTimes(1);
    const [text, opts] = mockCtx.reply.mock.calls[0];
    expect(opts).toEqual({ parse_mode: "MarkdownV2" });
    expect(text).toContain("Market Overview");
    expect(text).toContain("Source: CoinGecko");
    const idx = ORDERED_SYMBOLS.map((s) => (text as string).indexOf(`${s} `));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx); // listed order preserved
  });

  it("fails honestly (no fabricated numbers) when CoinGecko is down and cache is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    await priceCommand(mockCtx);
    const [text] = mockCtx.reply.mock.calls[0];
    expect(text).toContain("Couldn't fetch live prices");
    expect(text).not.toMatch(/\$\d/);
  });
});
