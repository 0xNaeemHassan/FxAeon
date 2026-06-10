import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { RISK_PARAMS } from "@fxbot/shared";

export async function settingsCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const args = ctx.message?.text?.split(" ").slice(1) || [];
    const user = await prisma.user.findUnique({ where: { telegramId } });

    // Default values used when user doesn't exist yet
    const lang = user?.language || "en";
    const slippageBps = user?.slippageBps ?? RISK_PARAMS.SLIPPAGE_DEFAULT_BPS;
    const mevProtection = user?.mevProtection || "flashbots";

    if (args.length === 0) {
      await ctx.reply(
        `⚙️ Settings\n\n` +
        `Language: ${lang}\n` +
        `Slippage: ${(slippageBps / 100).toFixed(2)}%\n` +
        `MEV Protection: ${mevProtection === "flashbots" ? "✅ Flashbots" : "❌ Off"}\n\n` +
        `To change:\n` +
        `/settings lang en\n` +
        `/settings slippage 1.0\n` +
        `/settings mev on|off`
      );
      return;
    }

    const [key, value] = args;

    if (key === "lang") {
      const validLangs = ["en", "zh-CN", "ko", "ja", "ru", "es"];
      if (!validLangs.includes(value)) {
        await ctx.reply("Unknown setting. Use /settings to see options.");
        return;
      }
      if (user) {
        await prisma.user.update({ where: { telegramId }, data: { language: value } });
      }
      await ctx.reply(`Language set to ${value}`);
    } else if (key === "slippage") {
      const slippageVal = parseFloat(value);
      const bps = Math.round(slippageVal * 100);
      if (isNaN(slippageVal) || !(bps > 0 && bps <= RISK_PARAMS.SLIPPAGE_MAX_BPS)) {
        await ctx.reply(
          `Slippage must be between 0.01% and ${RISK_PARAMS.SLIPPAGE_MAX_BPS / 100}%`
        );
        return;
      }
      if (user) {
        await prisma.user.update({ where: { telegramId }, data: { slippageBps: bps } });
      }
      await ctx.reply(`Slippage set to ${value}%`);
    } else if (key === "mev") {
      if (!["on", "off"].includes(value)) {
        await ctx.reply("Unknown setting. Use /settings to see options.");
        return;
      }
      const mev = value === "on" ? "flashbots" : "off";
      if (user) {
        await prisma.user.update({ where: { telegramId }, data: { mevProtection: mev } });
      }
      await ctx.reply(`MEV Protection ${mev === "flashbots" ? "enabled (Flashbots)" : "disabled"}`);
    } else {
      await ctx.reply("Unknown setting. Use /settings to see options.");
    }
  } catch (error) {
    console.error("Error in settings command:", error);
    await ctx.reply("❌ An error occurred. Please try again.");
  }
}
