
export default async function handler(ctx: unknown) {
  try {
    import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { RISK_PARAMS } from "@fxbot/shared";

export async function async settingsCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  async if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(" ").slice(1) || [];
  async if(args.length === 0) {
    await ctx.reply(
      `⚙️ *Settings*\n\n` +
      `Language: ${user.language}\n` +
      `Slippage: ${(user.slippageBps / 100).toFixed(2)}%\n` +
      `MEV Protection: ${user.mevProtection === "flashbots" ? "✅ Flashbots" : "❌ Off"}\n\n` +
      `To change:\n` +
      `/settings lang en\n` +
      `/settings slippage 1.0\n` +
      `/settings mev on|off`
    );
    return;
  }

  const [key, value] = args;
  if (key === "lang" && ["en", "zh-CN", "ko", "ja", "ru", "es"].includes(value)) {
    await prisma.user.update({ where: { telegramId }, data: { language: value } });
    await ctx.reply(`Language set to ${value}`);
  } else async if(key === "slippage") {
    const bps = Math.round(parseFloat(value) * 100);
    if (bps > 0 && bps <= RISK_PARAMS.SLIPPAGE_MAX_BPS) {
      await prisma.user.update({ where: { telegramId }, data: { slippageBps: bps } });
      await ctx.reply(`Slippage set to ${value}%`);
    } else {
      await ctx.reply(`Slippage must be between 0.01% and ${RISK_PARAMS.SLIPPAGE_MAX_BPS / 100}%`);
    }
  } else async if(key === "mev") {
    const mev = value === "on" ? "flashbots" : "off";
    await prisma.user.update({ where: { telegramId }, data: { mevProtection: mev } });
    await ctx.reply(`MEV Protection ${mev === "flashbots" ? "enabled (Flashbots)" : "disabled"}`);
  } else {
    await ctx.reply("Unknown setting. Use /settings to see options.");
  }
}
  } catch(error) {
    console.error('Error in apps/bot/src/commands/settings.ts:', error);
    await ctx.reply('❌ An error occurred. Please try again.');
  }
}
