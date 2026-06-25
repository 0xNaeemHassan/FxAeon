/**
 * /arb — NAV-vs-market arbitrage scanner for fxUSD.
 *
 *   /arb            → on-demand signal (mint-vs-market edge)
 *   /arb on|off     → opt in/out of background arb alerts (default: off)
 *
 * Reports whether it's currently cheaper to mint directly via the bot vs.
 * buying on the secondary market (or vice-versa), unlocking arbitrage loops.
 * Background alerts are pushed by the arb poller every 5 min (30-min throttle).
 */
import { Context } from "grammy";
import { prisma } from "@fxaeon/db";
import { getFxusdArbSnapshot, formatArbSnapshot } from "../market/arb.js";

export async function arbCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  const arg = ctx.message?.text?.split(/\s+/)[1]?.toLowerCase();

  // Toggle background alerts.
  if (arg === "on" || arg === "off") {
    if (!telegramId) return;
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      await ctx.reply("Please connect your wallet first with /start");
      return;
    }
    const enabled = arg === "on";
    await prisma.notificationPref.upsert({
      where: { userId: user.id },
      create: { userId: user.id, arb: enabled },
      update: { arb: enabled },
    });
    await ctx.reply(
      enabled
        ? "🔔 Arb alerts ON — I'll ping you when an fxUSD mint-vs-market edge opens (max once / 30 min)."
        : "🔕 Arb alerts OFF."
    );
    return;
  }

  const snap = await getFxusdArbSnapshot();
  if (!snap) {
    await ctx.reply("Couldn't fetch the fxUSD market price right now. Please try again shortly.");
    return;
  }
  await ctx.reply(`${formatArbSnapshot(snap)}\n\nToggle alerts: /arb on · /arb off`);
}
