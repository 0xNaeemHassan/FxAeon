import { Context } from "grammy";
import { prisma } from "@fxaeon/db";

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
  await ctx.reply(
    `🔒 *Lock FXN → veFXN*\n\n` +
    `Amount: ${amount} FXN\n` +
    `Duration: ${duration}\n\n` +
    `

⚠️ On-chain execution for this action is not live yet — the confirm step was removed because it led to a dead screen. It will return when the f(x) SDK integration ships.
Live today: /trade (leveraged positions), /portfolio, /deposit.`,
    { parse_mode: "Markdown" }
  );
}
