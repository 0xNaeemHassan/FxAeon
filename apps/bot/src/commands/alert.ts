/**
 * /alert — one-shot price alerts on the /price asset set.
 *
 *   /alert btc > 65000     fire when BTC trades above $65,000
 *   /alert eth < 1500      fire when ETH trades below $1,500
 *   /alert fxn +10%        fire when FXN's 24h change reaches +10%
 *   /alert btc -5%         fire when BTC's 24h change reaches -5%
 *   /alerts                list active alerts (with delete buttons)
 *
 * Alerts are one-shot: they fire once through the notify() gate (kind
 * "rules" — pref-aware, quiet-hours aware) and flip to status=triggered.
 * Evaluation happens in notifications/price-alert-poller.ts against the
 * SAME cached CoinGecko snapshot /price uses — zero extra API cost.
 */
import { Context, InlineKeyboard } from "grammy";
import { prisma } from "@fxbot/db";
import { SUPPORTED_ASSETS, getMarketOverview } from "../market/coingecko.js";
import { formatPrice } from "./price.js";
import { botLogger } from "../middleware/logger.js";

/** Max active alerts per user — keeps the poller's working set bounded. */
export const MAX_ACTIVE_ALERTS = 10;

export type ParsedAlert =
  | { kind: "above" | "below"; symbol: string; threshold: number }
  | { kind: "pct"; symbol: string; threshold: number };

const SYMBOLS = new Set(SUPPORTED_ASSETS.map((a) => a.symbol));

const USAGE =
  `🔔 Price alerts\n\n` +
  `Usage:\n` +
  `/alert btc > 65000 — when BTC goes above $65,000\n` +
  `/alert eth < 1500 — when ETH goes below $1,500\n` +
  `/alert fxn +10% — when FXN's 24h move reaches +10%\n` +
  `/alert btc -5% — when BTC's 24h move reaches -5%\n` +
  `/alerts — list & manage your active alerts\n\n` +
  `Supported: ${SUPPORTED_ASSETS.map((a) => a.symbol).join(", ")}\n` +
  `Alerts fire once, then auto-archive.`;

/**
 * Parse "/alert btc > 65000" style args (without the command itself).
 * Returns a string error message for humans on bad input.
 */
export function parseAlertArgs(args: string[]): ParsedAlert | string {
  if (args.length < 2) return USAGE;

  const symbol = args[0].toUpperCase();
  if (!SYMBOLS.has(symbol)) {
    return `Unknown token "${args[0]}". Supported: ${SUPPORTED_ASSETS.map((a) => a.symbol).join(", ")}`;
  }

  // Percent form: "+10%", "-5%", also tolerate "+10 %" split across args.
  const rest = args.slice(1).join(" ").trim();
  const pctMatch = rest.match(/^([+-]\d+(?:\.\d+)?)\s*%$/);
  if (pctMatch) {
    const pct = Number(pctMatch[1]);
    if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 1000) {
      return "Percent threshold must be a non-zero signed number, e.g. +10% or -5%.";
    }
    return { kind: "pct", symbol, threshold: pct };
  }

  // Absolute form: "> 65000", "< 1500" (also ">65000").
  const absMatch = rest.match(/^([<>])\s*\$?(\d+(?:[,_]\d{3})*(?:\.\d+)?)$/);
  if (absMatch) {
    const price = Number(absMatch[2].replace(/[,_]/g, ""));
    if (!Number.isFinite(price) || price <= 0) {
      return "Price must be a positive number, e.g. /alert btc > 65000";
    }
    return { kind: absMatch[1] === ">" ? "above" : "below", symbol, threshold: price };
  }

  return USAGE;
}

export function describeAlert(a: { symbol: string; kind: string; threshold: number }): string {
  if (a.kind === "pct") {
    const sign = a.threshold > 0 ? "+" : "";
    return `${a.symbol} 24h move reaches ${sign}${a.threshold}%`;
  }
  return `${a.symbol} goes ${a.kind} ${formatPrice(a.threshold)}`;
}

export async function alertCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
    const parsed = parseAlertArgs(args);
    if (typeof parsed === "string") {
      await ctx.reply(parsed);
      return;
    }

    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      await ctx.reply("Please connect your wallet first with /start");
      return;
    }

    const active = await prisma.priceAlert.count({
      where: { userId: user.id, status: "active" },
    });
    if (active >= MAX_ACTIVE_ALERTS) {
      await ctx.reply(
        `You already have ${MAX_ACTIVE_ALERTS} active alerts (the maximum). ` +
          `Remove one with /alerts first.`
      );
      return;
    }

    const alert = await prisma.priceAlert.create({
      data: {
        userId: user.id,
        symbol: parsed.symbol,
        kind: parsed.kind,
        threshold: parsed.threshold,
      },
    });

    // Show current state so the user can sanity-check the threshold.
    let nowLine = "";
    try {
      const overview = await getMarketOverview();
      const row = overview.rows.find((r) => r.symbol === parsed.symbol);
      if (row?.data) {
        nowLine =
          parsed.kind === "pct"
            ? `\nRight now: 24h ${row.data.change24hPct === null ? "N/A" : `${row.data.change24hPct >= 0 ? "+" : ""}${row.data.change24hPct.toFixed(2)}%`}`
            : `\nRight now: ${formatPrice(row.data.priceUsd)}`;
      }
    } catch {
      /* price unavailable — the alert is still set */
    }

    await ctx.reply(
      `🔔 Alert set: ${describeAlert(alert)}${nowLine}\n\n` +
        `It fires once, then archives. Manage with /alerts`
    );
  } catch (error) {
    botLogger.error({ err: error }, "alertCommand error");
    await ctx.reply("❌ Couldn't set the alert. Please try again.");
  }
}

function alertsKeyboard(alerts: Array<{ id: string }>): InlineKeyboard {
  const kb = new InlineKeyboard();
  alerts.forEach((a, i) => {
    kb.text(`🗑 Delete #${i + 1}`, `aldel_${a.id}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

export async function alertsCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      await ctx.reply("Please connect your wallet first with /start");
      return;
    }

    const alerts = await prisma.priceAlert.findMany({
      where: { userId: user.id, status: "active" },
      orderBy: { createdAt: "asc" },
    });

    if (alerts.length === 0) {
      await ctx.reply(`🔔 No active alerts.\n\n${USAGE}`);
      return;
    }

    const lines = alerts.map((a, i) => `${i + 1}. ${describeAlert(a)}`).join("\n");
    await ctx.reply(
      `🔔 Active alerts (${alerts.length}/${MAX_ACTIVE_ALERTS})\n\n${lines}\n\n` +
        `Each fires once, then archives.`,
      { reply_markup: alertsKeyboard(alerts) }
    );
  } catch (error) {
    botLogger.error({ err: error }, "alertsCommand error");
    await ctx.reply("❌ Couldn't load alerts. Please try again.");
  }
}

/** Callback handler for the 🗑 Delete buttons (data: `aldel_<id>`). */
export async function handleAlertDeleteCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const telegramId = ctx.from?.id.toString();
  if (!data || !telegramId) return;

  try {
    const id = data.slice("aldel_".length);
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      await ctx.answerCallbackQuery({ text: "Not connected — use /start." }).catch(() => undefined);
      return;
    }

    // Scope by userId so nobody can cancel another user's alert by id.
    const res = await prisma.priceAlert.updateMany({
      where: { id, userId: user.id, status: "active" },
      data: { status: "cancelled" },
    });

    await ctx
      .answerCallbackQuery({ text: res.count > 0 ? "Alert deleted." : "Already gone." })
      .catch(() => undefined);

    // Re-render the list in place.
    const alerts = await prisma.priceAlert.findMany({
      where: { userId: user.id, status: "active" },
      orderBy: { createdAt: "asc" },
    });
    const body =
      alerts.length === 0
        ? "🔔 No active alerts.\n\nSet one with /alert — e.g. /alert btc > 65000"
        : `🔔 Active alerts (${alerts.length}/${MAX_ACTIVE_ALERTS})\n\n` +
          alerts.map((a, i) => `${i + 1}. ${describeAlert(a)}`).join("\n") +
          `\n\nEach fires once, then archives.`;
    await ctx
      .editMessageText(body, alerts.length ? { reply_markup: alertsKeyboard(alerts) } : undefined)
      .catch(() => undefined);
  } catch (error) {
    botLogger.error({ err: error }, "handleAlertDeleteCallback error");
    await ctx.answerCallbackQuery({ text: "Failed — try again." }).catch(() => undefined);
  }
}
