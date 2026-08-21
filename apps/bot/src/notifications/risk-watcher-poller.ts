/**
 * Risk & Liquidation Alert Watcher Poller
 *
 * Scans active positions periodically.
 * When a position's health drops into critical territory (< 20%),
 * sends an actionable Telegram notification with 1-tap mitigation buttons.
 */
import { prisma } from '@fxaeon/db';
import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { botLogger } from '../middleware/logger.js';

let timer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;

export function startRiskWatcher(bot: Bot<any>, intervalMs = 60_000) {
  if (timer) clearInterval(timer);

  const poll = async () => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      // Find active positions with critical health (< 20%)
      const lowHealthPositions = await prisma.position.findMany({
        where: {
          healthPercent: {
            lt: 20.0,
            gt: 0.0,
          },
        },
        include: {
          user: true,
        },
        take: 20,
      });

      for (const pos of lowHealthPositions) {
        if (!pos.user?.telegramId) continue;
        const tgId = Number(pos.user.telegramId);
        if (Number.isNaN(tgId)) continue;

        const healthPct = Math.round(pos.healthPercent);
        const botUsername = bot.botInfo?.username || 'FxAeonBot';

        const keyboard = new InlineKeyboard()
          .url('🛡️ Add Collateral', `https://t.me/${botUsername}/app?startapp=positions`)
          .url('⚡ Manage Position', `https://t.me/${botUsername}/app?startapp=positions`);

        try {
          await bot.api.sendMessage(
            tgId,
            `⚠️ *CRITICAL LIQUIDATION WARNING*\n\nYour *${pos.market}* ${pos.side.toUpperCase()} position is at *${healthPct}% health*.\nLiquidation occurs if health reaches 0%.\n\n_Add collateral or reduce exposure immediately to protect your funds._`,
            {
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            }
          );
        } catch (err) {
          botLogger.debug({ err, tgId }, 'Failed to deliver risk warning DM');
        }
      }
    } catch (cause) {
      botLogger.debug({ cause }, 'Risk watcher check cycle complete');
    } finally {
      pollInFlight = false;
    }
  };

  timer = setInterval(poll, intervalMs);
}

export function stopRiskWatcher() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
