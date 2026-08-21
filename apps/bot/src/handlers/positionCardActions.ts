/**
 * Position-card action buttons — Phase 2 (Masterplan).
 *
 * After a trade receipt or from /portfolio, each position card shows
 * action buttons:
 *   📉 Reduce | 🔒 Close | ⚖️ Adjust Leverage
 *   🎯 TP/SL   | 🔄 Refresh | 🖥️ Open in App
 *
 * Each button either:
 * - Executes a simulation-gated reduction or leverage adjustment
 * - Routes to the existing close flow (positionActions.ts)
 * - Performs an inline adjustment (leverage adjust)
 * - Shows a TP/SL setup hint (pointing to /auto)
 * - Refreshes the position card with live on-chain data
 * - Opens the mini-app deep link
 */
import { Context, InlineKeyboard, type Bot } from "grammy";
import { prisma } from "@fxaeon/db";
import { MARKETS, RISK_PARAMS, type Market } from "@fxaeon/shared";
import {
  createFxSdk,
  createPublicClientForUser,
  getSdkReductionAmountWei,
  mevModeForUser,
  quoteAdjustPositionLeverage,
  quoteClosePosition,
} from "../fx/index.js";
import { findUserPosition, type OnChainPosition, type Side } from "../core/portfolio.js";
import { storeCallbackPayload, consumeCallbackPayload } from "../core/callbackKeys.js";
import { botLogger } from "../middleware/logger.js";
import { executeRoute } from "../core/txExecutor.js";
import { requireDelegatedWallet } from "../core/delegation.js";
import { describeExecutionError } from "../core/errorTaxonomy.js";
import { statusLine } from "./tradeActions.js";

interface PositionTarget {
  market: Market;
  side: Side;
  positionId: number;
}

function readPositionTarget(
  payload: ReturnType<typeof consumeCallbackPayload>,
  action: string
): PositionTarget | null {
  if (
    !payload ||
    payload.action !== action ||
    typeof payload.market !== "string" ||
    !(MARKETS as readonly string[]).includes(payload.market) ||
    (payload.side !== "long" && payload.side !== "short") ||
    !Number.isSafeInteger(payload.positionId) ||
    (payload.positionId as number) < 0
  ) {
    return null;
  }
  return {
    market: payload.market as Market,
    side: payload.side,
    positionId: payload.positionId as number,
  };
}

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

/** Handle "Reduce" button — partial close via reduce position */
async function handleReduce(ctx: Context): Promise<void> {
  const nonce = ctx.callbackQuery?.data?.slice("pa_red_".length);
  if (!nonce) return;

  const payload = consumeCallbackPayload(nonce);
  const target = readPositionTarget(payload, "pa_reduce");
  if (!target) {
    await editSafe(ctx, "⌛ This button expired or is invalid. Use /portfolio for a fresh view.");
    return;
  }

  const { market, side, positionId } = target;
  const mIdx = MARKETS.indexOf(market);
  const sideKey = side === "short" ? "s" : "l";

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
    `📉 Reduce ${market} ${side.toUpperCase()} #${positionId}\n\n` +
      `How much do you want to reduce?`,
    kb
  );
}

/** Handle "Adjust Leverage" button */
async function handleAdjustLeverage(ctx: Context): Promise<void> {
  const nonce = ctx.callbackQuery?.data?.slice("pa_lev_".length);
  if (!nonce) return;

  const payload = consumeCallbackPayload(nonce);
  const target = readPositionTarget(payload, "pa_adjust_lev");
  if (!target) {
    await editSafe(ctx, "⌛ This button expired or is invalid. Use /portfolio for a fresh view.");
    return;
  }

  const { market, side, positionId } = target;
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
      market,
      side,
      positionId
    );
    if (!pos) {
      await editSafe(ctx, "❌ Position not found on-chain. It may have been closed.");
      return;
    }

    const currentLev = pos.leverage;
    const maxLev = side === "long" ? RISK_PARAMS.MAX_LEVERAGE_LONG : RISK_PARAMS.MAX_LEVERAGE_SHORT;
    const minLev = RISK_PARAMS.MIN_LEVERAGE;

    // Build leverage adjustment buttons
    const kb = new InlineKeyboard();
    const targets = side === "long" ? [2, 3, 5, 7] : [1.5, 2, 3];

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

    kb.row().text("← Back", `pa_ref_${MARKETS.indexOf(market)}_${side === "short" ? "s" : "l"}_${positionId}`);

    await editSafe(
      ctx,
      `⚖️ Adjust Leverage — ${market} ${side.toUpperCase()} #${positionId}\n\n` +
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

/** Execute a simulation-gated partial position reduction. */
export async function handleExecuteReduce(ctx: Context): Promise<void> {
  const nonce = ctx.callbackQuery?.data?.slice("pa_dored_".length);
  const payload = nonce ? consumeCallbackPayload(nonce) : null;
  const target = readPositionTarget(payload, "pa_do_reduce");
  const sizeBps = payload?.sizeBps;
  if (!nonce || !target || !Number.isInteger(sizeBps) || sizeBps! <= 0 || sizeBps! >= 10_000) {
    await editSafe(ctx, "⌛ This reduction request expired or is invalid. Use /portfolio to start over.");
    return;
  }

  const user = await loadUser(ctx);
  if (!user) {
    await editSafe(ctx, "🔐 Connect your wallet first with /start.");
    return;
  }
  const gate = await requireDelegatedWallet(user);
  if (!gate.ok) {
    await editSafe(ctx, gate.message);
    return;
  }

  const percent = sizeBps! / 100;
  const header = `📉 Reducing ${target.market} ${target.side.toUpperCase()} #${target.positionId} by ${percent}%`;
  try {
    const sdk = createFxSdk();
    const position = await findUserPosition(
      sdk,
      user.walletAddress,
      target.market,
      target.side,
      target.positionId
    );
    if (!position) {
      await editSafe(ctx, `${header}\n\n❌ Position not found for your wallet. It may already be closed.`);
      return;
    }

    const client = createPublicClientForUser(mevModeForUser(user.mevProtection));
    const amountWei = await getSdkReductionAmountWei({
      client,
      market: target.market,
      side: target.side,
      rawCollateralWei: position.rawCollateral,
      rawDebtWei: position.rawDebt,
      fractionBps: sizeBps!,
    });

    await editSafe(ctx, `${header}\n\n🔎 Fetching reduction quote…`);
    const quote = await quoteClosePosition({
      sdk,
      userAddress: user.walletAddress,
      market: target.market,
      side: target.side,
      positionId: target.positionId,
      amountWei,
      slippagePercent: user.slippageBps / 100,
      isClosePosition: false,
    });
    const route = quote.routes[0];
    if (!route) {
      await editSafe(ctx, `${header}\n\n❌ No reduction route is available right now. Nothing was sent.`);
      return;
    }

    let lastStatus = "";
    const result = await executeRoute({
      userId: user.id,
      walletId: gate.walletId,
      walletAddress: user.walletAddress as `0x${string}`,
      idempotencyKey: `reduce:${user.id}:${target.market}:${target.side}:${target.positionId}:${sizeBps}:${nonce}`,
      txs: route.txs,
      type: "reduce_position",
      client,
      mev: mevModeForUser(user.mevProtection),
      onStatus: (state, detail) => {
        const line = statusLine(state, detail);
        if (line === lastStatus) return;
        lastStatus = line;
        void editSafe(ctx, `${header}\n\n${line}`);
      },
    });

    if (!result.ok) {
      await editSafe(ctx, `${header}\n\n❌ Reduction not completed.\n\n${describeExecutionError(result.error)}`);
      return;
    }
    const hash = result.hashes[result.hashes.length - 1];
    await editSafe(
      ctx,
      `${header}\n\n${result.deduped ? "♻️ Already processed; no duplicate transaction was sent." : "✅ Position reduced."}` +
        (hash ? `\n\nTx: https://etherscan.io/tx/${hash}` : "") +
        `\n\n📊 /portfolio for the updated position.`
    );
  } catch (error) {
    botLogger.error({ error: String(error), ...target }, "positionCardActions: reduce failed");
    await editSafe(ctx, `${header}\n\n❌ Reduction failed before broadcast. Nothing was sent.`);
  }
}

/** Execute a simulation-gated leverage adjustment. */
export async function handleExecuteAdjustLeverage(ctx: Context): Promise<void> {
  const nonce = ctx.callbackQuery?.data?.slice("pa_doadj_".length);
  const payload = nonce ? consumeCallbackPayload(nonce) : null;
  const target = readPositionTarget(payload, "pa_do_adjust");
  const targetLeverage = payload?.targetLeverage;
  const maxLev = target?.side === "short" ? RISK_PARAMS.MAX_LEVERAGE_SHORT : RISK_PARAMS.MAX_LEVERAGE_LONG;
  if (
    !nonce ||
    !target ||
    typeof targetLeverage !== "number" ||
    !Number.isFinite(targetLeverage) ||
    targetLeverage < RISK_PARAMS.MIN_LEVERAGE ||
    targetLeverage > maxLev
  ) {
    await editSafe(ctx, "⌛ This leverage request expired or is invalid. Use /portfolio to start over.");
    return;
  }

  const user = await loadUser(ctx);
  if (!user) {
    await editSafe(ctx, "🔐 Connect your wallet first with /start.");
    return;
  }
  const gate = await requireDelegatedWallet(user);
  if (!gate.ok) {
    await editSafe(ctx, gate.message);
    return;
  }

  const header = `⚖️ Adjusting ${target.market} ${target.side.toUpperCase()} #${target.positionId} to ${targetLeverage}×`;
  try {
    const sdk = createFxSdk();
    const position = await findUserPosition(
      sdk,
      user.walletAddress,
      target.market,
      target.side,
      target.positionId
    );
    if (!position) {
      await editSafe(ctx, `${header}\n\n❌ Position not found for your wallet. It may already be closed.`);
      return;
    }
    if (Math.abs(position.leverage - targetLeverage) <= 0.05) {
      await editSafe(ctx, `${header}\n\nℹ️ The position is already at this leverage. Nothing was sent.`);
      return;
    }

    await editSafe(ctx, `${header}\n\n🔎 Fetching leverage quote…`);
    const quote = await quoteAdjustPositionLeverage({
      sdk,
      userAddress: user.walletAddress,
      market: target.market,
      side: target.side,
      positionId: target.positionId,
      leverage: targetLeverage,
      slippagePercent: user.slippageBps / 100,
    });
    const route = quote.routes[0];
    if (!route) {
      await editSafe(ctx, `${header}\n\n❌ No adjustment route is available right now. Nothing was sent.`);
      return;
    }

    let lastStatus = "";
    const result = await executeRoute({
      userId: user.id,
      walletId: gate.walletId,
      walletAddress: user.walletAddress as `0x${string}`,
      idempotencyKey: `adjust:${user.id}:${target.market}:${target.side}:${target.positionId}:${targetLeverage}:${nonce}`,
      txs: route.txs,
      type: "adjust_leverage",
      client: createPublicClientForUser(mevModeForUser(user.mevProtection)),
      mev: mevModeForUser(user.mevProtection),
      onStatus: (state, detail) => {
        const line = statusLine(state, detail);
        if (line === lastStatus) return;
        lastStatus = line;
        void editSafe(ctx, `${header}\n\n${line}`);
      },
    });

    if (!result.ok) {
      await editSafe(ctx, `${header}\n\n❌ Adjustment not completed.\n\n${describeExecutionError(result.error)}`);
      return;
    }
    const hash = result.hashes[result.hashes.length - 1];
    await editSafe(
      ctx,
      `${header}\n\n${result.deduped ? "♻️ Already processed; no duplicate transaction was sent." : "✅ Leverage adjusted."}` +
        (hash ? `\n\nTx: https://etherscan.io/tx/${hash}` : "") +
        `\n\n📊 /portfolio for the updated position.`
    );
  } catch (error) {
    botLogger.error({ error: String(error), ...target }, "positionCardActions: leverage adjust failed");
    await editSafe(ctx, `${header}\n\n❌ Adjustment failed before broadcast. Nothing was sent.`);
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

    const miniAppUrl = process.env.MINI_APP_URL || "http://localhost:3000";
    const { text, keyboard } = renderPositionCard(pos, miniAppUrl);
    await editSafe(ctx, `🔄 Refreshed\n\n${text}`, keyboard);
  } catch (error) {
    botLogger.error({ error: String(error) }, "positionCardActions: refresh failed");
    await editSafe(ctx, "❌ Couldn't refresh. Try /portfolio again.");
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerPositionCardActions(bot: Bot<any>): void {
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
  bot.callbackQuery(/^pa_dored_/, (ctx) => {
    ctx.answerCallbackQuery().catch(() => undefined);
    return handleExecuteReduce(ctx as unknown as Context);
  });
  bot.callbackQuery(/^pa_doadj_/, (ctx) => {
    ctx.answerCallbackQuery().catch(() => undefined);
    return handleExecuteAdjustLeverage(ctx as unknown as Context);
  });
}
