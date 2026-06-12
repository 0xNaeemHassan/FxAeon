/**
 * W-18: per-position actions from /portfolio — Close (full) and TP/SL hint.
 *
 * Callback formats (navigation/identification only — no amounts to
 * tamper with; execution always re-reads the PRESSER's own on-chain
 * positions, so a forged positionId can never touch someone else's funds):
 *   pc_<mIdx>_<l|s>_<positionId>            → close confirmation prompt
 *   pcc_<mIdx>_<l|s>_<positionId>_<nonce8>  → execute full close
 *   pt_<mIdx>_<l|s>                         → TP/SL setup hint (/auto)
 */
import { randomBytes } from "node:crypto";
import { Context, InlineKeyboard, type Bot } from "grammy";
import { prisma } from "@fxbot/db";
import { MARKETS, type Market } from "@fxbot/shared";
import {
  createFxSdk,
  createPublicClientForUser,
  quoteClosePosition,
} from "../fx/index.js";
import { findUserPosition, type Side } from "../core/portfolio.js";
import { markSnapshotClosed } from "../core/pnl.js";
import { executeRoute } from "../core/txExecutor.js";
import { requireDelegatedWallet } from "../core/delegation.js";
import { statusLine } from "./tradeActions.js";
import { describeExecutionError } from "../core/errorTaxonomy.js";
import { botLogger } from "../middleware/logger.js";

async function editSafe(ctx: Context, text: string, keyboard?: InlineKeyboard): Promise<void> {
  try {
    await ctx.editMessageText(text, keyboard ? { reply_markup: keyboard } : undefined);
  } catch (error) {
    botLogger.debug({ error: String(error) }, "position-actions: editMessageText skipped");
  }
}

function parseTarget(data: string): { market: Market; side: Side; positionId: number; nonce?: string } | null {
  const m = /^pcc?_(\d+)_(l|s)_(\d+)(?:_([0-9a-f]{8}))?$/.exec(data);
  if (!m) return null;
  const market = MARKETS[Number(m[1])];
  if (!market) return null;
  return {
    market,
    side: m[2] === "s" ? "short" : "long",
    positionId: Number(m[3]),
    nonce: m[4],
  };
}

async function loadUser(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return null;
  return prisma.user.findUnique({ where: { telegramId } });
}

/** Step 1: confirmation prompt with a fresh on-chain read. */
export async function handleClosePrompt(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => undefined);
  const target = parseTarget(ctx.callbackQuery?.data ?? "");
  const user = await loadUser(ctx);
  if (!target || !user) {
    await editSafe(ctx, `🔐 Connect your wallet first with /start`);
    return;
  }

  try {
    const sdk = createFxSdk();
    const pos = await findUserPosition(sdk, user.walletAddress, target.market, target.side, target.positionId);
    if (!pos) {
      await editSafe(
        ctx,
        `❌ Position #${target.positionId} (${target.market} ${target.side}) not found on-chain for your wallet — it may already be closed.\n\n📊 /portfolio for a fresh view.`
      );
      return;
    }

    const nonce = randomBytes(4).toString("hex");
    const sideKey = target.side === "short" ? "s" : "l";
    const mIdx = MARKETS.indexOf(target.market);
    const keyboard = new InlineKeyboard()
      .text("✅ Close position", `pcc_${mIdx}_${sideKey}_${target.positionId}_${nonce}`)
      .text("❌ Cancel", "tx_cancel");

    await editSafe(
      ctx,
      `🔻 Close ${pos.market} ${pos.side.toUpperCase()} #${pos.positionId}?\n\n` +
        `Collateral: ${pos.collateral} ${pos.collateralToken}\n` +
        `Debt: ${pos.debt.toFixed(2)} ${pos.debtToken}\n` +
        `Leverage: ${pos.leverage.toFixed(2)}x\n\n` +
        `This closes the FULL position: debt is repaid and remaining collateral is returned to your wallet. ` +
        `Quote + simulation run on confirm — nothing is sent before that.`,
      keyboard
    );
  } catch (error) {
    botLogger.error({ error: String(error) }, "position-actions: close prompt failed");
    await editSafe(ctx, `❌ Couldn't read that position on-chain right now. Nothing was sent. Try /portfolio again.`);
  }
}

/** Step 2: execute the full close (re-reads the chain, simulation-gated). */
export async function handleCloseConfirm(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery({ text: "Closing…" }).catch(() => undefined);
  const target = parseTarget(ctx.callbackQuery?.data ?? "");
  const user = await loadUser(ctx);
  if (!target || !target.nonce || !user) {
    await editSafe(ctx, `❌ This button is no longer valid. Use /portfolio to start over.`);
    return;
  }
  const gate = await requireDelegatedWallet(user);
  if (!gate.ok) {
    await editSafe(ctx, gate.message);
    return;
  }

  const header = `🔻 Closing ${target.market} ${target.side.toUpperCase()} #${target.positionId}`;
  try {
    const sdk = createFxSdk();
    // Ownership gate: only positions readable for the PRESSER's wallet exist.
    const pos = await findUserPosition(sdk, user.walletAddress, target.market, target.side, target.positionId);
    if (!pos) {
      await editSafe(ctx, `${header}\n\n❌ Not found on-chain for your wallet — it may already be closed. Nothing was sent.`);
      return;
    }

    await editSafe(ctx, `${header}\n\n🔎 Fetching close quote…`);
    const quote = await quoteClosePosition({
      sdk,
      userAddress: user.walletAddress,
      market: target.market,
      side: target.side,
      positionId: target.positionId,
      amountWei: pos.rawCollateral,
      slippagePercent: user.slippageBps / 100,
      isClosePosition: true,
    });
    const route = quote.routes[0];
    if (!route) {
      await editSafe(ctx, `${header}\n\n❌ No close route available right now. Nothing was sent — try again shortly.`);
      return;
    }

    let lastStatus = "";
    const result = await executeRoute({
      userId: user.id,
      walletId: gate.walletId,
      walletAddress: user.walletAddress as `0x${string}`,
      idempotencyKey: `close:${user.id}:${target.market}:${target.side}:${target.positionId}:${target.nonce}`,
      txs: route.txs,
      type: target.side === "long" ? "close_long" : "close_short",
      client: createPublicClientForUser(user.mevProtection === "flashbots" ? "flashbots" : "off"),
      onStatus: (status, detail) => {
        const line = statusLine(status, detail);
        if (line === lastStatus) return;
        lastStatus = line;
        void editSafe(ctx, `${header}\n\n${line}`);
      },
    });

    if (result.ok) {
      await markSnapshotClosed(user.id, target.market, target.side, target.positionId);
      const hash = result.hashes[result.hashes.length - 1];
      await editSafe(
        ctx,
        `${header}\n\n` +
          (result.deduped
            ? `♻️ Already processed — duplicate tap, no second transaction sent.\n`
            : `✅ Position closed. Debt repaid, remaining collateral returned to your wallet.\n`) +
          (hash ? `\nTx: https://etherscan.io/tx/${hash}` : "") +
          `\n\n📊 /portfolio for the updated view.`
      );
    } else {
      // W-19: actionable copy with broadcast-state honesty.
      await editSafe(
        ctx,
        `${header}\n\n❌ Close not completed.\n\n${describeExecutionError(result.error)}\n\nRetry from /portfolio.`
      );
    }
  } catch (error) {
    botLogger.error({ error: String(error) }, "position-actions: close failed");
    await editSafe(ctx, `${header}\n\n❌ Close failed before broadcast — nothing was sent on-chain. Try again from /portfolio.`);
  }
}

/** TP/SL: honest pointer to /auto (rule creation isn't inline yet). */
export async function handleTpSlHint(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => undefined);
  const m = /^pt_(\d+)_(l|s)$/.exec(ctx.callbackQuery?.data ?? "");
  const market = m ? MARKETS[Number(m[1])] : undefined;
  const side = m?.[2] === "s" ? "short" : "long";
  const example = market ? `${market} ${side}` : "wstETH long";
  await ctx
    .reply(
      `🎯 Take-profit / stop-loss\n\n` +
        `Set a price-trigger rule right here in chat:\n` +
        `• /auto tp ${example} <price> — take profit\n` +
        `• /auto sl ${example} <price> — stop loss\n\n` +
        `Rules are checked every minute and close the full position through the ` +
        `same simulate-first path as the Close button. Requires bot trading ` +
        `(Settings → Wallet).`
    )
    .catch(() => undefined);
}

/** Register /portfolio position-action callbacks. Call once from main.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerPositionActions(bot: Bot<any>): void {
  bot.callbackQuery(/^pc_/, (ctx) => handleClosePrompt(ctx as unknown as Context));
  bot.callbackQuery(/^pcc_/, (ctx) => handleCloseConfirm(ctx as unknown as Context));
  bot.callbackQuery(/^pt_/, (ctx) => handleTpSlHint(ctx as unknown as Context));
}
