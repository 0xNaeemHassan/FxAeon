/**
 * /settings — preferences that are applied by live execution/read paths.
 */
import { Context, InlineKeyboard } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";
import { prisma } from "@fxaeon/db";
import { RISK_PARAMS } from "@fxaeon/shared";
import { SUPPORTED_LOCALES, invalidateLocaleCache } from "../i18n/index.js";
import { botLogger } from "../middleware/logger.js";

function strictNumber(value: string | undefined): number {
  return value && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? Number(value) : NaN;
}

export async function settingsCommand(ctx: Context & I18nFlavor) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const args = ctx.message?.text?.trim().split(/\s+/).slice(1) || [];
    const user = await prisma.user.findUnique({ where: { telegramId } });

    // Current values (with defaults)
    const lang = user?.language || "en";
    const slippageBps = user?.slippageBps ?? RISK_PARAMS.SLIPPAGE_DEFAULT_BPS;
    const mevProtection =
      user?.mevProtection === "flashbots" || user?.mevProtection === "on" ? "flashbots" : "off";
    const oracleThreshold = (user?.oracleDivergenceBps ?? 50) / 100;
    const chainlinkThreshold = (user?.chainlinkStalenessSec ?? 3600) / 60;
    const aiInputEnabled = user?.aiInputEnabled ?? false;

    if (args.length === 0) {
      // Show all settings
      const overview = [
        `⚙️ Settings\n`,
        `🌐 Language: ${lang}`,
        `📊 Slippage: ${(slippageBps / 100).toFixed(2)}%`,
        `🛡️ MEV Protection: ${mevProtection === "flashbots" ? "ON ✅" : "OFF ⚠️"}`,
        `🔮 Oracle divergence alert: ${oracleThreshold}%`,
        `⏱️ Chainlink staleness alert: ${chainlinkThreshold}min`,
        `🤖 AI input: ${aiInputEnabled ? "ON ✅" : "OFF"}`,
        ``,
        `To change: /settings <key> <value>`,
        ``,
        `Keys:`,
        `  lang <${Array.from(SUPPORTED_LOCALES).join("|")}>`,
        `  slippage <0.1–${RISK_PARAMS.SLIPPAGE_MAX_BPS / 100}>`,
        `  mev <on|off>`,
        `  oracle <0.1–5.0>  (divergence %)`,
        `  staleness <10–1440>  (minutes)`,
        `  ai <on|off>  (natural language input)`,
      ].join("\n");

      // Quick-toggle buttons
      const kb = new InlineKeyboard()
        .text(mevProtection === "flashbots" ? "⚠️ Disable MEV" : "✅ Enable MEV", "set_mev_toggle");

      await ctx.reply(overview, { reply_markup: kb });
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
      invalidateLocaleCache(telegramId);
      ctx.i18n.useLocale(value);
      await ctx.reply(ctx.t("settings-lang-set", { value }));
    } else if (key === "slippage") {
      const slippageVal = strictNumber(value);
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
    } else if (key === "oracle") {
      const threshold = strictNumber(value);
      if (isNaN(threshold) || threshold < 0.1 || threshold > 5.0) {
        await ctx.reply("❌ Oracle threshold must be between 0.1% and 5.0%.");
        return;
      }
      if (user) {
        await prisma.user.update({
          where: { telegramId },
          data: { oracleDivergenceBps: Math.round(threshold * 100) },
        });
      }
      await ctx.reply(`🔮 Oracle divergence alert set to ${threshold}%.`);
    } else if (key === "staleness") {
      const mins = strictNumber(value);
      if (!Number.isInteger(mins) || mins < 10 || mins > 1440) {
        await ctx.reply("❌ Staleness threshold must be between 10 and 1440 minutes.");
        return;
      }
      if (user) {
        await prisma.user.update({
          where: { telegramId },
          data: { chainlinkStalenessSec: mins * 60 },
        });
      }
      await ctx.reply(`⏱️ Chainlink staleness alert set to ${mins} minutes.`);
    } else if (key === "ai") {
      if (!["on", "off"].includes(value)) {
        await ctx.reply("❌ AI input must be 'on' or 'off'.");
        return;
      }
      const enabled = value === "on";
      if (user) {
        await prisma.user.update({
          where: { telegramId },
          data: { aiInputEnabled: enabled },
        });
      }
      if (enabled) {
        await ctx.reply(
          `🤖 AI input *enabled*.\n\n` +
          `You can now type natural language like:\n` +
          `• "go long btc with 0.005 wbtc at 2x"\n` +
          `• "short eth 0.5 wsteth 3x"\n` +
          `• "check my positions"\n\n` +
          `⚠️ *Privacy note:* Your text messages will be parsed locally by FxAeon's intent engine. ` +
          `No data is sent to external AI services. All processing happens on the bot server.\n\n` +
          `To disable: /settings ai off`,
          { parse_mode: "Markdown" }
        );
      } else {
        await ctx.reply("🤖 AI input disabled. Use /commands as usual.");
      }
    } else {
      await ctx.reply(ctx.t("settings-unknown"));
    }
  } catch (error) {
    botLogger.error({ err: error, telegramId }, "settings command failed");
    await ctx.reply(ctx.t("errors-generic"));
  }
}

/**
 * Handle settings toggle callbacks.
 */
export async function handleSettingsCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";

  const telegramId = ctx.from?.id.toString();
  if (!telegramId) {
    await ctx.answerCallbackQuery({ text: "Invalid Telegram user." }).catch(() => undefined);
    return;
  }

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.answerCallbackQuery({ text: "Connect your wallet with /start first." }).catch(() => undefined);
    return;
  }

  if (data === "set_mode_toggle") {
    await ctx.answerCallbackQuery({ text: "This legacy display-mode toggle has been retired." });
  } else if (data === "set_mev_toggle") {
    const newMev = user.mevProtection === "flashbots" || user.mevProtection === "on" ? "off" : "flashbots";
    await prisma.user.update({
      where: { telegramId },
      data: { mevProtection: newMev },
    });
    const icon = newMev === "flashbots" ? "✅" : "⚠️";
    await ctx.answerCallbackQuery({ text: `${icon} MEV protection ${newMev === "flashbots" ? "enabled" : "disabled"}` });
    try {
      const kb = new InlineKeyboard()
        .text(newMev === "flashbots" ? "⚠️ Disable MEV" : "✅ Enable MEV", "set_mev_toggle");
      await ctx.editMessageReplyMarkup({ reply_markup: kb });
    } catch { /* edit race */ }
  } else {
    await ctx.answerCallbackQuery({ text: "This setting is no longer available." }).catch(() => undefined);
  }
}

import type { Bot } from "grammy";

export function registerSettingsActions(bot: Bot<any>): void {
  bot.callbackQuery(/^set_/, (ctx) => handleSettingsCallback(ctx as unknown as Context));
}
