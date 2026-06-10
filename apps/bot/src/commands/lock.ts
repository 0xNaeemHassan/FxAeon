import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function lockCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(" ").slice(1) || [];
  if(args.length < 2) {
    await ctx.reply(
      `Usage: /lock <amount> <duration>\n\n` +
      `Example: /lock 100 FXN 1y\n\n` +
      `Lock FXN into veFXN for governance. Duration: 1w, 1m, 1y, 4y (max).`
    );
    return;
  }

  const [amount, duration] = args;
  const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
  await ctx.reply(
    `🔒 *Lock FXN → veFXN*\n\n` +
    `Amount: ${amount} FXN\n` +
    `Duration: ${duration}\n\n` +
    `Tap to confirm:`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Confirm Lock", web_app: { url: `${miniAppUrl}/lock?amount=${amount}&duration=${duration}` } }],
        ],
      },
    }
  );
}
