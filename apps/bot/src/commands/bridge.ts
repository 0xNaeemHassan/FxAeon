import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function bridgeCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(" ").slice(1) || [];
  if(args.length < 3) {
    await ctx.reply(
      `Usage: /bridge <from> <to> <amount> <token>\n\n` +
      `Example: /bridge ETH Base 1000 fxUSD\n\n` +
      `Bridge fxUSD between Ethereum and Base via LayerZero.`
    );
    return;
  }

  const [from, to, amount, token] = args;
  const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
  await ctx.reply(
    `🌉 *Bridge Preview*\n\n` +
    `From: ${from} → ${to}\n` +
    `Amount: ${amount} ${token}\n\n` +
    `Tap to confirm:`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Confirm Bridge", web_app: { url: `${miniAppUrl}/bridge?from=${from}&to=${to}&amount=${amount}&token=${token}` } }],
        ],
      },
    }
  );
}
