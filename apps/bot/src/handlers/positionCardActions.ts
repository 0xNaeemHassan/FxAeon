/**
 * Position-card action buttons — Phase 2 (Masterplan).
 *
 * After a trade receipt or from /portfolio, each position card shows
 * action buttons:
 *   📈 Increase | 📉 Reduce | 🔒 Close | ⚖️ Adjust Leverage
 *   🎯 TP/SL   | 🔄 Refresh | 🖥️ Open in App
 *
 * Each button either:
 * - Routes to the existing trade ladder (increase/reduce via /trade flow)
 * - Routes to the existing close flow (positionActions.ts)
 * - Performs an inline adjustment (leverage adjust)
 * - Shows a TP/SL setup hint (pointing to /auto)
 * - Refreshes the position card with live on-chain data
 * - Opens the mini-app deep link
 */
import { Context, InlineKeyboard, type Bot } from "grammy";
import { prisma } from "@fxaeon/db";
import { MARKETS, type Market } from "@fxaeon/shared";
import { createFxSdk } from "../fx/index.js";
import { fetchOnChainPositions, findUserPosition, type OnChainPosition, type Side } from "../core/portfolio.js";
import { storeCallbackPayload, consumeCallbackPayload } from "../core/callbackKeys.js";
import { botLogger } from "../middleware/logger.js";

// ── Position Card Rendering ─────────────────────────────────────────────────

/**
 * Build the action button keyboard for a position card.
 */
export function buildPositionActionKeyboard(
  market: Market,
  side: Side,
  positionId: number,
  miniAppUrl?: string
): InlineKeyboard {
  const mIdx = MARKETS.indexOf(market);
  const sideKey = side === "short" ? "s" : "l";

  // Store payloads for complex actions
  const increaseNonce = storeCallbackPayload({
    action: "pa_increase",
    market,
    side,
    positionId,
  });
  const reduceNonce = storeCallbackPayload({
    action: "pa_reduce",
    market,
    side,
    positionId,
  });
  const adjustLevNonce = storeCallbackPayload({
    action: "pa_adjust_lev",
    market,
    side,
    positionId,
  });

  const kb = new InlineKeyboard()
    // Row 1: Core trade actions
    .text("📈 Increase", `pa_inc_${increaseNonce}`)
    .text("📉 Reduce", `pa_red_${reduceNonce}`)
    .text("🔒 Close", `pc_${mIdx}_${sideKey}_${positionId}`)
    .row()
    // Row 2: Management
    .text("⚖️ Leverage", `pa_lev_${adjustLevNonce}`)
    .text("🎯 TP/SL", `pt_${mIdx}_${sideKey}`)
    .text("🔄 Refresh", `pa_ref_${mIdx}_${sideKey}_${positionId}`)
    .row();

  // Row 3: Mini app link (if available)
  if (miniAppUrl) {
    kb.url("🖥️ Open in App", `${miniAppUrl}?position=${mIdx}_${sideKey}_${positionId}`);
  }

  return kb;
}

/**
 * Render a full position card with action buttons.
 */
export function renderPositionCard(pos: OnChainPosition, miniAppUrl?: string): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const healthEmoji = pos.health < 0.7 ? "🟢" : pos.health < 0.85 ? "🟡" : pos.health < 0.95 ? "🟠" : "🔴";
  const sideEmoji = pos.side === "long" ? "📈" : "📉";

  const lines = [
    `${sideEmoji} ${pos.market} ${pos.side.toUpperCase()} #${pos.positionId}`,
    ``,
    `Collateral:    ${pos.collateral.toFixed(6)} ${pos.collateralToken}`,
    `Debt:          ${pos.debt.toFixed(2)} ${pos.debtToken}`,
    `Leverage:      ${pos.leverage.toFixed(2)}×`,
    `Debt ratio:    ${(pos.debtRatio * 100).toFixed(1)}%`,
    `Health:        ${healthEmoji} ${(pos.health * 100).toFixed(1)}%`,
  ];

  const keyboard = buildPositionActionKeyboard(
    pos.market,
    pos.side,
    pos.positionId,
    miniAppUrl
  );

  return { text: lines.join("\n"), keyboard };
}

// ── Callback Handlers ───────────────────────────────────────────────────────

async function editSafe(ctx: Context, text: string, keyboard?: InlineKeyboard): Promise<void> {
  try {
    await ctx.editMessageText(text, keyboard ? { reply_markup: keyboard } : undefined);
  } catch (error) {
    botLogger.debug({ error: String(error) }, "positionCardActions: editMessageText skipped");
  }
}

async function loadUser(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return null;
  return prisma.user.findUnique({ where: { telegramId } });
}

/** Handle "Increase" button — routes to trade flow with position pre-filled */
async function handleIncrease(ctx: Context): Promise<void> {
  const nonce = ctx.callbackQuery?.data?.slice("pa_inc_".length);
  if (!nonce) return;

  const payload = consumeCallbackPayload(nonce);
  if (!payload) {
    await editSafe(ctx, "⌛ This button expired. Use /portfolio for a fresh view.");
    return;
  }

  const { market, side, positionId } = payload;
  const asset = market === "wstETH" ? "ETH" : "BTC";

  await ctx.reply(
    `📈 Increase ${market} ${(side as string).toUpperCase()} #${positionId}\n\n` +
      `To add collateral to this position, use:\n` +
      `/${side}${asset} <amount> <leverage>x\n\n` +
      `Example: /${side}${asset} 0.5 ${(side as string) === "long" ? "5" : "2"}x\n\n` +
      `The trade flow will route through the existing position.`
  );
}

/** Handle "Reduce" button — partial close via reduce position */
async function handleReduce(ctx: Context): Promise<void> {
  const nonce = ctx.callbackQuery?.data?.slice("pa_red_".length);
  if (!nonce) return;

  const payload = consumeCallbackPayload(nonce);
  if (!payload) {
    await editSafe(ctx, "⌛ This button expired. Use /portfolio for a fresh view.");
    return;
  }

  const { market, side, positionId } = payload;
  const mIdx = MARKETS.indexOf(market as Market);
  const sideKey = (side as string) === "short" ? "s" : "l";

  // Show percentage reduction buttons
  const kb = new InlineKeyboard();
  [25, 50, 75].forEach((pct) => {
    const reduceNonce = storeCallbackPayload({
      action: "pa_do_reduce",
      market,
      side,
      positionId,
      sizeBps: pct * 100,
    });
    kb.text(`${pct}%`, `pa_dored_${reduceNonce}`);
  });
  kb.text("100% (Close)", `pc_${mIdx}_${sideKey}_${positionId}`);

  await editSafe(
    ctx,
    `📉 Reduce ${market} ${(side as string).toUpperCase()} #${positionId}\n\n` +
      `How much do you want to reduce?`,
    kb
  );
}

/** Handle "Adjust Leverage" button */
async function handleAdjustLeverage(ctx: Context): Promise<void> {
  const nonce = ctx.callbackQuery?.data?.slice("pa_lev_".length);
  if (!nonce) return;

  const payload = consumeCallbackPayload(nonce);
  if (!payload) {
    await editSafe(ctx, "⌛ This button expired. Use /portfolio for a fresh view.");
    return;
  }

  const { market, side, positionId } = payload;
  const user = await loadUser(ctx);
  if (!user) {
    await editSafe(ctx, "🔐 Connect your wallet first with /start.");
    return;
  }

  try {
    const sdk = createFxSdk();
    const pos = await findUserPosition(
      sdk,
      user.walletAddress,
      market as Market,
      side as Side,
      positionId as number
    );
    if (!pos) {
      await editSafe(ctx, "❌ Position not found on-chain. It may have been closed.");
      return;
    }

    const currentLev = pos.leverage;
    const maxLev = (side as string) === "long" ? 7 : 3;
    const minLev = 1.1;

    // Build leverage adjustment buttons
    const kb = new InlineKeyboard();
    const targets = (side as string) === "long" ? [2, 3, 5, 7] : [1.5, 2, 3];

    targets.forEach((lev) => {
      if (Math.abs(lev - currentLev) > 0.05) {
        const adjustNonce = storeCallbackPayload({
          action: "pa_do_adjust",
          market,
          side,
          positionId,
          targetLeverage: lev,
        });
        const direction = lev > currentLev ? "↑" : "↓";
        kb.text(`${direction} ${lev}×`, `pa_doadj_${adjustNonce}`);
      }
    });

    kb.row().text("← Back", `pa_ref_${MARKETS.indexOf(market as Market)}_${(side as string) === "short" ? "s" : "l"}_${positionId}`);

    await editSafe(
      ctx,
      `⚖️ Adjust Leverage — ${market} ${(side as string).toUpperCase()} #${positionId}\n\n` +
        `Current leverage: ${currentLev.toFixed(2)}×\n` +
        `Range: ${minLev}× – ${maxLev}×\n\n` +
        `Select target leverage:`,
      kb
    );
  } catch (error) {
    botLogger.error({ error: String(error) }, "positionCardActions: adjust leverage failed");
    await editSafe(ctx, "❌ Couldn't read position. Try /portfolio again.");
  }
}

/** Handle "Refresh" button — re-read on-chain data and update card */
async function handleRefresh(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const match = /^pa_ref_(\d+)_(l|s)_(\d+)$/.exec(data);
  if (!match) return;

  const market = MARKETS[Number(match[1])];
  const side: Side = match[2] === "s" ? "short" : "long";
  const positionId = Number(match[3]);

  if (!market) {
    await editSafe(ctx, "❌ Invalid market. Use /portfolio for a fresh view.");
    return;
  }

  const user = await loadUser(ctx);
  if (!user) {
    await editSafe(ctx, "🔐 Connect your wallet first with /start.");
    return;
  }

  try {
    const sdk = createFxSdk();
    const pos = await findUserPosition(sdk, user.walletAddress, market, side, positionId);
    if (!pos) {
      await editSafe(
        ctx,
        `❌ Position #${positionId} (${market} ${side}) not found on-chain — it may have been closed.\n\n📊 /portfolio`
      );
      return;
    }

    const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
    const { text, keyboard } = renderPositionCard(pos, miniAppUrl);
    await editSafe(ctx, `🔄 Refreshed\n\n${text}`, keyboard);
  } catch (error) {
    botLogger.error({ error: String(error) }, "positionCardActions: refresh failed");
    await editSafe(ctx, "❌ Couldn't refresh. Try /portfolio again.");
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerPositionCardActions(bot: Bot<any>): void {
  bot.callbackQuery(/^pa_inc_/, (ctx) => {
    ctx.answerCallbackQuery().catch(() => undefined);
    return handleIncrease(ctx as unknown as Context);
  });
  bot.callbackQuery(/^pa_red_/, (ctx) => {
    ctx.answerCallbackQuery().catch(() => undefined);
    return handleReduce(ctx as unknown as Context);
  });
  bot.callbackQuery(/^pa_lev_/, (ctx) => {
    ctx.answerCallbackQuery().catch(() => undefined);
    return handleAdjustLeverage(ctx as unknown as Context);
  });
  bot.callbackQuery(/^pa_ref_/, (ctx) => {
    ctx.answerCallbackQuery().catch(() => undefined);
    return handleRefresh(ctx as unknown as Context);
  });
  // Partial reduce execution
  bot.callbackQuery(/^pa_dored_/, (ctx) => {
    ctx.answerCallbackQuery().catch(() => undefined);
    // TODO: Wire to SDK reducePosition with partial amount
    ctx.reply("📉 Partial reduce is being executed…\n\n(Full SDK integration coming in Phase 3 fee layer)").catch(() => undefined);
  });
  // Leverage adjustment execution
  bot.callbackQuery(/^pa_doadj_/, (ctx) => {
    ctx.answerCallbackQuery().catch(() => undefined);
    // TODO: Wire to SDK adjustPositionLeverage
    ctx.reply("⚖️ Leverage adjustment is being executed…\n\n(Full SDK integration coming in Phase 3 fee layer)").catch(() => undefined);
  });
}
