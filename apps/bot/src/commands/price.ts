/**
 * /price — live market overview of all supported assets in ONE message.
 *
 * Data: CoinGecko `/coins/markets` (single request for every asset, cached
 * 45s in src/market/coingecko.ts). Honest by design: a token CoinGecko does
 * not return renders as N/A; a full upstream outage either serves a snapshot
 * clearly marked as cached or says it failed — never fabricated numbers.
 *
 * Formatting: MarkdownV2 with the table inside a ``` code block so columns
 * stay aligned in Telegram's monospace font.
 */
import { Context } from "grammy";
import {
  getMarketOverview,
  SUPPORTED_ASSETS,
  type MarketRow,
} from "../market/coingecko.js";

/** Escape MarkdownV2 special characters (outside code blocks). */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

/** $104,328 · $3,612 · $145.21 · $0.92 · $0.1006 */
export function formatPrice(price: number): string {
  if (price >= 1000) return `$${Math.round(price).toLocaleString("en-US")}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  // Sub-$1: 4 significant digits, trailing zeros trimmed (keep ≥2 decimals).
  const s = price.toPrecision(4);
  const trimmed = parseFloat(s).toString();
  const [, dec = ""] = trimmed.split(".");
  return `$${dec.length >= 2 ? trimmed : parseFloat(s).toFixed(2)}`;
}

/** $2.06T · $434.1B · $82.7M — 2dp under 10, 1dp from 10 up. */
export function formatMarketCap(cap: number | null): string {
  if (cap === null || cap <= 0) return "N/A";
  const units: Array<[number, string]> = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
  ];
  for (const [div, suffix] of units) {
    if (cap >= div) {
      const scaled = cap / div;
      return `$${scaled.toFixed(scaled < 10 ? 2 : 1)}${suffix}`;
    }
  }
  return `$${Math.round(cap).toLocaleString("en-US")}`;
}

export function formatChange(pct: number | null): string {
  if (pct === null) return "N/A";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/** Render the aligned table body (plain text — goes inside a code block). */
export function renderMarketTable(rows: MarketRow[]): string {
  const cells = rows.map(({ symbol, data }) => ({
    symbol,
    price: data ? formatPrice(data.priceUsd) : "N/A",
    cap: data ? formatMarketCap(data.marketCapUsd) : "N/A",
    h24: data ? formatChange(data.change24hPct) : "N/A",
    d7: data ? formatChange(data.change7dPct) : "N/A",
  }));
  const symW = Math.max(...cells.map((c) => c.symbol.length)) + 1;
  const priceW = Math.max(...cells.map((c) => c.price.length)) + 2;
  const capW = Math.max(...cells.map((c) => `MC: ${c.cap}`.length)) + 2;
  const h24W = Math.max(...cells.map((c) => `24h: ${c.h24}`.length)) + 2;
  return cells
    .map(
      (c) =>
        pad(c.symbol, symW) +
        pad(c.price, priceW) +
        pad(`MC: ${c.cap}`, capW) +
        pad(`24h: ${c.h24}`, h24W) +
        `7d: ${c.d7}`
    )
    .join("\n");
}

export async function priceCommand(ctx: Context): Promise<void> {
  try {
    const overview = await getMarketOverview();

    const updated = overview.fetchedAt.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
    // Inside ``` blocks only backslash and backtick are special.
    const table = renderMarketTable(overview.rows).replace(/[\\`]/g, "\\$&");

    const message =
      `📊 *Market Overview*\n` +
      `\`\`\`\n${table}\n\`\`\`\n` +
      (overview.stale
        ? escapeMarkdownV2(`⚠️ CoinGecko is unreachable — showing the last snapshot.\n`)
        : "") +
      escapeMarkdownV2(`🕒 Updated: ${updated} UTC\nSource: CoinGecko`);

    await ctx.reply(message, { parse_mode: "MarkdownV2" });
  } catch (error) {
    console.error("[priceCommand] Error:", error);
    await ctx.reply(
      `📊 Market Overview\n\n❌ Couldn't fetch live prices right now ` +
        `(CoinGecko unavailable). Nothing is cached yet — please try again in a minute.`
    );
  }
}

/** Exported for the test suite. */
export const PRICE_SYMBOLS = SUPPORTED_ASSETS.map((a) => a.symbol);

export default priceCommand;
