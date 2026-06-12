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
  const amount = (args.length > 0 ? args[0] : undefined) || "all";
  const instant = args.includes("instant");

  await ctx.reply(
    `🔓 *Redeem fxUSD*\n\n` +
    `Amount: ${amount}\n` +
    `Mode: ${instant ? "Instant (0.01% fee)" : "2-step (0 fee, 60min cooldown)"}\n\n` +
    `

⚠️ On-chain execution for this action is not live yet — the confirm step was removed because it led to a dead screen. It will return when the f(x) SDK integration ships.
Live today: /trade (leveraged positions), /portfolio, /deposit.`,
    { parse_mode: "Markdown" }
  );
}
