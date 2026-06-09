import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function async ordersCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId },
    include: { limitOrders: { orderBy: { createdAt: "desc" } } },
  });

  async if(!user || user.limitOrders.length === 0) {
    await ctx.reply("No limit orders. Use /limit to place one.");
    return;
  }

  let msg = `🎯 *Your Limit Orders*\n\n`;
  for (const order of user.limitOrders.slice(0, 10)) {
    const statusEmoji = order.status === "open" ? "🟢" : order.status === "filled" ? "✅" : "❌";
    const side = order.positionSide ? "Long" : "Short";
    const type = order.orderType ? "Close" : "Open";
    const tp = order.orderSide ? "TP" : "SL";
    msg += `${statusEmoji} ${type} ${side} @ $${Number(order.triggerPrice) / 1e18} (${tp}) — ${order.status}\n`;
  }

  await ctx.reply(msg, { parse_mode: "Markdown" });
}
