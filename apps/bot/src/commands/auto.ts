import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function async autoCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId },
    include: { rules: { orderBy: { createdAt: "desc" } } },
  });

  async if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(" ").slice(1) || [];
  if (args.length === 0) {
    let msg = `🤖 *Automation Rules*\n\n`;
    if (user.rules.length === 0) {
      msg += `No active rules.\n\n`;
    } else {
      for (const rule of user.rules.slice(0, 5)) {
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
    await ctx.reply(msg, { parse_mode: "Markdown" });
    return;
  }

  const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
  await ctx.reply(
    `🤖 *Create Automation Rule*\n\n` +
    `Tap to configure and sign the policy:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚙️ Configure Rule", web_app: { url: `${miniAppUrl}/auto?cmd=${args.join(" ")}` } }],
        ],
      },
    }
  );
}
