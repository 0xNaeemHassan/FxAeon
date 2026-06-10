import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function redeemCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(" ").slice(1) || [];
  const amount = args.length > 0 ? args[0] : undefined || "all";
  const instant = args.includes("instant");

  const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
  await ctx.reply(
    `🔓 *Redeem fxUSD*\n\n` +
    `Amount: ${amount}\n` +
    `Mode: ${instant ? "Instant (0.01% fee)" : "2-step (0 fee, 60min cooldown)"}\n\n` +
    `Tap to confirm:`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Confirm Redeem", web_app: { url: `${miniAppUrl}/redeem?amount=${amount}&instant=${instant}` } }],
        ],
      },
    }
  );
}
