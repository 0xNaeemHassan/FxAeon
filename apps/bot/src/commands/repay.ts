import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function repayCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(" ").slice(1) || [];
  const amount = (args.length > 0 ? args[0] : undefined) || "all";

  await ctx.reply(
    `🔄 *Repay fxUSD Debt*\n\n` +
    `Amount: ${amount}\n\n` +
    `

⚠️ On-chain execution for this action is not live yet — the confirm step was removed because it led to a dead screen. It will return when the f(x) SDK integration ships.
Live today: /trade (leveraged positions), /portfolio, /deposit.`,
    { parse_mode: "Markdown" }
  );
}
