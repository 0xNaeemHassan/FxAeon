import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function autoCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      include: { rules: { orderBy: { createdAt: "desc" } } },
    });

    const args = ctx.message?.text?.split(" ").slice(1) || [];
    if (args.length === 0) {
      const rules = user?.rules || [];
      let msg = `🤖 Automation Rules\n\n`;

      if (rules.length === 0) {
        msg += `No automation rules configured yet.\n\n`;
      } else {
        for (const rule of rules.slice(0, 5)) {
          const statusEmoji = rule.status === "active" ? "🟢" : rule.status === "paused" ? "⏸️" : "🔴";
          msg += `${statusEmoji} ${rule.name} (${rule.type}) — ${rule.status}\n`;
        }
        msg += `\n`;
      }

      msg += `Create a rule:\n`;
      msg += `/auto compound — auto-compound fxSAVE weekly\n`;
      msg += `/auto dca 100 fxUSD weekly — DCA into fxSAVE\n`;
      msg += `/auto tp wstETH long 3500 — take profit at $3500\n`;
      msg += `/auto sl wstETH long 2500 — stop loss at $2500\n`;
      await ctx.reply(msg);
      return;
    }

    if (!user) {
      await ctx.reply("Please connect your wallet first with /start");
      return;
    }

    await ctx.reply(
      `🤖 Create Automation Rule\n\nUse the Mini App to configure and sign the policy.`
    );
  } catch (error) {
    console.error("[autoCommand] Error:", error);
    await ctx.reply("❌ An error occurred. Please try again.");
  }
}
