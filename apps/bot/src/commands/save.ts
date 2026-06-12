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
  await ctx.reply(
    `💰 *fxSAVE ${action.toUpperCase()}*\n\n` +
    `Amount: ${amount} fxUSD\n\n` +
    `

⚠️ On-chain execution for this action is not live yet — the confirm step was removed because it led to a dead screen. It will return when the f(x) SDK integration ships.
Live today: /trade (leveraged positions), /portfolio, /deposit.`,
    { parse_mode: "Markdown" }
  );
}
