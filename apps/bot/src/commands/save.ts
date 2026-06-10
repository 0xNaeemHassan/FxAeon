import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function saveCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(" ").slice(1) || [];
  if(args.length === 0) {
    await ctx.reply(
      `Usage: /save <deposit|withdraw> <amount>\n\n` +
      `Example: /save deposit 1000\n` +
      `Deposit fxUSD into fxSAVE to earn yield.\n\n` +
      `Use /save withdraw 500 to withdraw (instant with 0.01% fee, or 2-step free).`
    );
    return;
  }

  const [action, amount] = args;
  const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
  await ctx.reply(
    `💰 *fxSAVE ${action.toUpperCase()}*\n\n` +
    `Amount: ${amount} fxUSD\n\n` +
    `Tap to confirm:`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Confirm", web_app: { url: `${miniAppUrl}/save?action=${action}&amount=${amount}` } }],
        ],
      },
    }
  );
}
