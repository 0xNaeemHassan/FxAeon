import { Context } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";
import { prisma } from "@fxaeon/db";
import { RISK_PARAMS } from "@fxaeon/shared";
import { SUPPORTED_LOCALES, invalidateLocaleCache } from "../i18n/index.js";

export async function settingsCommand(ctx: Context & I18nFlavor) {
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
        ctx.t("settings-overview", {
          lang,
          slippage: (slippageBps / 100).toFixed(2),
          mev: ctx.t(mevProtection === "flashbots" ? "settings-mev-on" : "settings-mev-off"),
        })
      );
      return;
    }

    const [key, value] = args;

    if (key === "lang") {
      if (!(SUPPORTED_LOCALES as readonly string[]).includes(value)) {
        await ctx.reply(ctx.t("settings-unknown"));
        return;
      }
      if (user) {
        await prisma.user.update({ where: { telegramId }, data: { language: value } });
      }
      // Confirm in the NEW language, not the one the update started with.
      invalidateLocaleCache(telegramId);
      ctx.i18n.useLocale(value);
      await ctx.reply(ctx.t("settings-lang-set", { value }));
    } else if (key === "slippage") {
      const slippageVal = parseFloat(value);
      const bps = Math.round(slippageVal * 100);
      if (isNaN(slippageVal) || !(bps > 0 && bps <= RISK_PARAMS.SLIPPAGE_MAX_BPS)) {
        await ctx.reply(
          ctx.t("settings-slippage-invalid", { max: RISK_PARAMS.SLIPPAGE_MAX_BPS / 100 })
        );
        return;
      }
      if (user) {
        await prisma.user.update({ where: { telegramId }, data: { slippageBps: bps } });
      }
      await ctx.reply(ctx.t("settings-slippage-set", { value }));
    } else if (key === "mev") {
      if (!["on", "off"].includes(value)) {
        await ctx.reply(ctx.t("settings-unknown"));
        return;
      }
      const mev = value === "on" ? "flashbots" : "off";
      if (user) {
        await prisma.user.update({ where: { telegramId }, data: { mevProtection: mev } });
      }
      await ctx.reply(ctx.t(mev === "flashbots" ? "settings-mev-enabled" : "settings-mev-disabled"));
    } else {
      await ctx.reply(ctx.t("settings-unknown"));
    }
  } catch (error) {
    console.error("Error in settings command:", error);
    await ctx.reply(ctx.t("errors-generic"));
  }
}
