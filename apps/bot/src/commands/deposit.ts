import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function depositCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
  await ctx.reply(
    `📥 *Deposit*\n\n` +
    `Your wallet address:\n` +
    `\`${user.walletAddress}\`\n\n` +
    `Send ETH, wstETH, WBTC, or fxUSD from any wallet/exchange.\n\n` +
    `⚠️ *No fiat on-ramps.* We never accept, hold, or convert fiat.\n` +
    `You fund your own wallet — we never touch your funds.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📱 Show QR Code", web_app: { url: `${miniAppUrl}/qr?address=${user.walletAddress}` } }],
          [{ text: "📋 Copy Address", callback_data: `copy_${user.walletAddress}` }],
        ],
      },
    }
  );
}
