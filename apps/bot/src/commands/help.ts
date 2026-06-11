import { Context } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";

/**
 * W-21: the full command guide lives in the locale catalogs
 * (src/i18n/locales/*.ftl, key `help-body`) so it can be translated as one
 * coherent block. Command names themselves stay in English — Telegram
 * commands are not localizable.
 */
export async function helpCommand(ctx: Context & I18nFlavor) {
  try {
    await ctx.reply(ctx.t("help-body"));
  } catch (error) {
    console.error("[helpCommand] Error:", error);
    await ctx.reply(ctx.t("help-error"));
  }
}

export default helpCommand;
