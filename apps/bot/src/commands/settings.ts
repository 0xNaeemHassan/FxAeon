/**
 * /settings — user preferences (Phase 1 base + Phase 2 extensions).
 *
 * Phase 2 additions:
 * - Beginner/Pro mode toggle
 * - Default collateral token
 * - Default leverage
 * - Oracle divergence threshold
 * - Chainlink staleness threshold
 */
import { Context, InlineKeyboard } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";
import { prisma } from "@fxaeon/db";
import { RISK_PARAMS } from "@fxaeon/shared";
import { SUPPORTED_LOCALES, invalidateLocaleCache } from "../i18n/index.js";

const VALID_MODES = ["beginner", "pro"] as const;
const VALID_AI = ["on", "off"] as const;
const VALID_COLLATERALS = ["fxUSD", "wstETH", "WBTC", "USDC", "WETH", "stETH", "ETH"] as const;

export async function settingsCommand(ctx: Context & I18nFlavor) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const args = ctx.message?.text?.split(" ").slice(1) || [];
    const user = await prisma.user.findUnique({ where: { telegramId } });

    // Current values (with defaults)
    const lang = user?.language || "en";
    const slippageBps = user?.slippageBps ?? RISK_PARAMS.SLIPPAGE_DEFAULT_BPS;
    const mevProtection = user?.mevProtection || "flashbots";
    const mode = (user as any)?.mode || "beginner";
    const defaultCollateral = (user as any)?.defaultCollateralToken || "fxUSD";
    const defaultLeverage = (user as any)?.defaultLeverage ?? 3.0;
    const oracleThreshold = (user as any)?.oracleDivergenceThresholdPct ?? 0.5;
    const chainlinkThreshold = (user as any)?.chainlinkStalenessThresholdMin ?? 60;
    const aiInputEnabled = (user as any)?.aiInputEnabled ?? false;

    if (args.length === 0) {
      // Show all settings
      const overview = [
        `⚙️ Settings\n`,
        `🌐 Language: ${lang}`,
        `📊 Slippage: ${(slippageBps / 100).toFixed(2)}%`,
        `🛡️ MEV Protection: ${mevProtection === "flashbots" ? "ON ✅" : "OFF ⚠️"}`,
        `🎮 Mode: ${mode === "pro" ? "Pro 🔧" : "Beginner 🟢"}`,
        `💰 Default collateral: ${defaultCollateral}`,
        `📈 Default leverage: ${defaultLeverage}×`,
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
        `  mode <beginner|pro>`,
        `  collateral <${VALID_COLLATERALS.join("|")}>`,
        `  leverage <${RISK_PARAMS.MIN_LEVERAGE}–${RISK_PARAMS.MAX_LEVERAGE_LONG}>`,
        `  oracle <0.1–5.0>  (divergence %)`,
        `  staleness <10–1440>  (minutes)`,
        `  ai <on|off>  (natural language input)`,
      ].join("\n");

      // Quick-toggle buttons
      const kb = new InlineKeyboard()
        .text(mode === "beginner" ? "🔧 Switch to Pro" : "🟢 Switch to Beginner", "set_mode_toggle")
        .row()
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
    } else if (key === "mode") {
      if (!VALID_MODES.includes(value as any)) {
        await ctx.reply(`❌ Mode must be one of: ${VALID_MODES.join(", ")}`);
        return;
      }
      if (user) {
        await prisma.user.update({ where: { telegramId }, data: { mode: value } as any });
      }
      const emoji = value === "pro" ? "🔧" : "🟢";
      await ctx.reply(`${emoji} Mode set to ${value}.\n\n${value === "pro"
        ? "Pro mode: type /longBTC 500 5x usdc to skip straight to preview."
        : "Beginner mode: guided 6-step flow with explanations."
      }`);
    } else if (key === "collateral") {
      if (!VALID_COLLATERALS.includes(value as any)) {
        await ctx.reply(`❌ Collateral must be one of: ${VALID_COLLATERALS.join(", ")}`);
        return;
      }
      if (user) {
        await prisma.user.update({
          where: { telegramId },
          data: { defaultCollateralToken: value } as any,
        });
      }
      await ctx.reply(`💰 Default collateral set to ${value}.`);
    } else if (key === "leverage") {
      const lev = parseFloat(value);
      if (isNaN(lev) || lev < RISK_PARAMS.MIN_LEVERAGE || lev > RISK_PARAMS.MAX_LEVERAGE_LONG) {
        await ctx.reply(
          `❌ Leverage must be between ${RISK_PARAMS.MIN_LEVERAGE}× and ${RISK_PARAMS.MAX_LEVERAGE_LONG}×.`
        );
        return;
      }
      if (user) {
        await prisma.user.update({
          where: { telegramId },
          data: { defaultLeverage: lev } as any,
        });
      }
      await ctx.reply(`📈 Default leverage set to ${lev}×.`);
    } else if (key === "oracle") {
      const threshold = parseFloat(value);
      if (isNaN(threshold) || threshold < 0.1 || threshold > 5.0) {
        await ctx.reply("❌ Oracle threshold must be between 0.1% and 5.0%.");
        return;
      }
      if (user) {
        await prisma.user.update({
          where: { telegramId },
          data: { oracleDivergenceThresholdPct: threshold } as any,
        });
      }
      await ctx.reply(`🔮 Oracle divergence alert set to ${threshold}%.`);
    } else if (key === "staleness") {
      const mins = parseInt(value);
      if (isNaN(mins) || mins < 10 || mins > 1440) {
        await ctx.reply("❌ Staleness threshold must be between 10 and 1440 minutes.");
        return;
      }
      if (user) {
        await prisma.user.update({
          where: { telegramId },
          data: { chainlinkStalenessThresholdMin: mins } as any,
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
          data: { aiInputEnabled: enabled } as any,
        });
      }
      if (enabled) {
        await ctx.reply(
          `🤖 AI input *enabled*.\n\n` +
          `You can now type natural language like:\n` +
          `• "go long 500 fxusd on btc at 5x"\n` +
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
    console.error("Error in settings command:", error);
    await ctx.reply(ctx.t("errors-generic"));
  }
}

/**
 * Handle settings toggle callbacks.
 */
export async function handleSettingsCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  await ctx.answerCallbackQuery().catch(() => undefined);

  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) return;

  if (data === "set_mode_toggle") {
    const currentMode = (user as any).mode || "beginner";
    const newMode = currentMode === "beginner" ? "pro" : "beginner";
    await prisma.user.update({
      where: { telegramId },
      data: { mode: newMode } as any,
    });
    const emoji = newMode === "pro" ? "🔧" : "🟢";
    await ctx.answerCallbackQuery({ text: `${emoji} Switched to ${newMode} mode` });
    // Re-render settings (edit the message)
    try {
      const kb = new InlineKeyboard()
        .text(newMode === "beginner" ? "🔧 Switch to Pro" : "🟢 Switch to Beginner", "set_mode_toggle")
        .row()
        .text(user.mevProtection === "flashbots" ? "⚠️ Disable MEV" : "✅ Enable MEV", "set_mev_toggle");
      await ctx.editMessageReplyMarkup({ reply_markup: kb });
    } catch { /* edit race */ }
  } else if (data === "set_mev_toggle") {
    const newMev = user.mevProtection === "flashbots" ? "off" : "flashbots";
    await prisma.user.update({
      where: { telegramId },
      data: { mevProtection: newMev },
    });
    const icon = newMev === "flashbots" ? "✅" : "⚠️";
    await ctx.answerCallbackQuery({ text: `${icon} MEV protection ${newMev === "flashbots" ? "enabled" : "disabled"}` });
    try {
      const currentMode = (user as any).mode || "beginner";
      const kb = new InlineKeyboard()
        .text(currentMode === "beginner" ? "🔧 Switch to Pro" : "🟢 Switch to Beginner", "set_mode_toggle")
        .row()
        .text(newMev === "flashbots" ? "⚠️ Disable MEV" : "✅ Enable MEV", "set_mev_toggle");
      await ctx.editMessageReplyMarkup({ reply_markup: kb });
    } catch { /* edit race */ }
  }
}

import type { Bot } from "grammy";

export function registerSettingsActions(bot: Bot<any>): void {
  bot.callbackQuery(/^set_/, (ctx) => handleSettingsCallback(ctx as unknown as Context));
}
