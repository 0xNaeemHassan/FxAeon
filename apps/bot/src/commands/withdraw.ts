import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function withdrawCommand(ctx: Context) {
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
      `Usage: /withdraw <amount> <address> <token>\n\n` +
      `Example: /withdraw 1.5 0x123... ETH\n\n` +
      `Send tokens to any external address.`
    );
    return;
  }

  const [amount, address, token = "ETH"] = args;
  await ctx.reply(
    `📤 *Withdraw*\n\n` +
    `Amount: ${amount} ${token}\n` +
    `To: \`${address}\`\n\n` +
    `

⚠️ On-chain execution for this action is not live yet — the confirm step was removed because it led to a dead screen. It will return when the f(x) SDK integration ships.
Live today: /trade (leveraged positions), /portfolio, /deposit.`,
    { parse_mode: "Markdown" }
  );
}
