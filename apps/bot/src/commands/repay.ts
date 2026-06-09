import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function async repayCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  async if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(" ").slice(1) || [];
  const amount = args.length > 0 ? args[0] : undefined || "all";

  const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
  await ctx.reply(
    `🔄 *Repay fxUSD Debt*\n\n` +
    `Amount: ${amount}\n\n` +
    `Tap to confirm:`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Confirm Repay", web_app: { url: `${miniAppUrl}/repay?amount=${amount}` } }],
        ],
      },
    }
  );
}
