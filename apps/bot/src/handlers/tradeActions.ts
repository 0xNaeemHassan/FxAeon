/**
 * Trade UX (W-17): inline ladder, signed previews, server-side confirm with
 * status edits on the SAME message.
 *
 * This is the first production consumer of the W-11 executor — until now
 * `executeRoute` had no caller and /trade ended at a text-only "preview".
 *
 * Flow:
 *   /trade            → ladder: market → side → leverage → amount (one message,
 *                       edited in place; callback_data `tl_*`, navigation only)
 *   /trade <args>     → signed preview (Confirm = `tc_<signed token>`)
 *   /start t1_<token> → signed deep link (10-min TTL) → same preview
 *   Confirm           → verify sig+TTL → quote → simulate → broadcast →
 *                       receipt, each stage edited into the original message.
 *
 * Security: confirm tokens are HMAC-signed + short-TTL (see tradeIntent.ts);
 * params can't be tampered with via callback_data or crafted deep links, and
 * execution always uses the PRESSING user's wallet. The intent nonce feeds the
 * executor idempotency key, so double-taps dedupe instead of re-broadcasting.
 */
import { Context, InlineKeyboard, type Bot } from "grammy";
import { prisma } from "@fxbot/db";
import { parseUnits } from "viem";
import { MARKETS, RISK_PARAMS, type Market } from "@fxbot/shared";
import {
  collateralDecimals,
  createFxSdk,
  createPublicClientForUser,
  quoteOpenPosition,
} from "../fx/index.js";
import { executeRoute } from "../core/txExecutor.js";
import { requireDelegatedWallet } from "../core/delegation.js";
import type { TxState } from "../core/txState.js";
import {
  createTradeIntent,
  verifyTradeIntent,
  type TradeIntent,
} from "../core/tradeIntent.js";
import { describeExecutionError } from "../core/errorTaxonomy.js";
import { listUserPositions } from "../core/portfolio.js";
import { trackPositions } from "../core/pnl.js";
import { getSpotPrices } from "../market/coingecko.js";
import { botLogger } from "../middleware/logger.js";

type Side = "long" | "short";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const sideLabel = (s: Side) => (s === "long" ? "LONG 📈" : "SHORT 📉");

function maxLeverage(side: Side): number {
  return side === "long" ? RISK_PARAMS.MAX_LEVERAGE_LONG : RISK_PARAMS.MAX_LEVERAGE_SHORT;
}

/** Amount presets in collateral units (wstETH / WBTC). */
const AMOUNT_PRESETS: Record<Market, number[]> = {
  wstETH: [0.05, 0.1, 0.25, 0.5],
  WBTC: [0.001, 0.005, 0.01, 0.05],
};

function leveragePresets(side: Side): number[] {
  const max = maxLeverage(side);
  const base = side === "long" ? [2, 3, 5] : [1.5, 2];
  return [...base.filter((l) => l < max), max];
}

/** editMessageText that never throws (message gone, rate limit, same text). */
async function editSafe(
  ctx: Context,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  try {
    await ctx.editMessageText(text, keyboard ? { reply_markup: keyboard } : undefined);
  } catch (error) {
    botLogger.debug({ error: String(error) }, "trade-ux: editMessageText skipped");
  }
}

// ---------------------------------------------------------------------------
// Ladder keyboards (`tl_*` = navigation only, nothing security-relevant)
// ---------------------------------------------------------------------------

export function ladderText(): string {
  return (
    `⚡ Open a Leveraged Position\n\n` +
    `Pick a market below — or use the full command:\n\n` +
    `Usage:\n/trade <market> <long|short> <leverage> <amount>\n` +
    `Example: /trade wstETH long 3x 0.5`
  );
}

export function ladderMarketKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  MARKETS.forEach((m, i) => kb.text(`${m}`, `tl_s_${i}`));
  return kb;
}

function ladderSideKeyboard(marketIdx: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("📈 Long", `tl_l_${marketIdx}_l`)
    .text("📉 Short", `tl_l_${marketIdx}_s`)
    .row()
    .text("« Markets", "tl_m");
}

function ladderLeverageKeyboard(marketIdx: number, side: Side): InlineKeyboard {
  const kb = new InlineKeyboard();
  leveragePresets(side).forEach((lev) =>
    kb.text(`${lev}x`, `tl_a_${marketIdx}_${side === "long" ? "l" : "s"}_${Math.round(lev * 10)}`)
  );
  kb.row().text("« Back", `tl_s_${marketIdx}`);
  return kb;
}

function ladderAmountKeyboard(marketIdx: number, side: Side, lev10: number): InlineKeyboard {
  const market = MARKETS[marketIdx];
  const kb = new InlineKeyboard();
  AMOUNT_PRESETS[market].forEach((amt) =>
    kb.text(`${amt} ${market}`, `tl_p_${marketIdx}_${side === "long" ? "l" : "s"}_${lev10}_${Math.round(amt * 1e6)}`)
  );
  kb.row().text("« Back", `tl_l_${marketIdx}_${side === "long" ? "l" : "s"}`);
  return kb;
}

// ---------------------------------------------------------------------------
// Preview (signed)
// ---------------------------------------------------------------------------

export interface PreviewUserSettings {
  slippageBps: number;
  mevProtection: string;
}

export function buildPreview(
  intent: { market: Market; side: Side; leverage: number; amount: number },
  user: PreviewUserSettings | null,
  botUsername: string
): { text: string; keyboard: InlineKeyboard; token: string } {
  const token = createTradeIntent(intent);
  const minutesLeft = 10;

  const lines = [
    `⚡ Trade Preview`,
    ``,
    `Market: ${intent.market} ${sideLabel(intent.side)}`,
    `Leverage: ${intent.leverage}x`,
    `Collateral: ${intent.amount} ${intent.market}`,
  ];
  if (user) {
    lines.push(
      `Slippage: ${(user.slippageBps / 100).toFixed(2)}%`,
      `MEV Protection: ${user.mevProtection === "flashbots" ? "ON ✅" : "OFF ⚠️"}`
    );
  }
  lines.push(
    ``,
    `Quote, simulation and broadcast all happen on Confirm — nothing is sent before that.`,
    `This preview expires in ~${minutesLeft} min.`,
    ``,
    `⚠️ Leveraged trading carries liquidation risk. Only trade what you can afford to lose.`
  );

  const keyboard = new InlineKeyboard();
  if (user) {
    keyboard.text("✅ Confirm", `tc_${token}`).text("❌ Cancel", "tx_cancel");
  } else {
    lines.push(``, `🔐 Connect your wallet with /start before confirming.`);
  }
  keyboard.row().url("🔗 Share setup", `https://t.me/${botUsername}?start=${token}`);

  return { text: lines.join("\n"), keyboard, token };
}

// ---------------------------------------------------------------------------
// Execution with status edits on the same message
// ---------------------------------------------------------------------------

export function statusLine(state: TxState, detail?: string): string {
  switch (state) {
    case "prepared":
      return "⏳ Preparing…";
    case "simulated":
      return "🧪 Simulation passed — broadcasting…";
    case "broadcasting":
      return "📤 Broadcasting…";
    case "broadcast":
      return `📤 Broadcast${detail ? ` — ${detail}` : ""}\n⏳ Waiting for confirmation…`;
    case "confirmed":
      return "✅ Confirmed on-chain.";
    case "reverted":
      return `❌ Reverted on-chain${detail ? ` — ${detail}` : ""}.`;
    case "failed":
      return `❌ Failed${detail ? ` — ${detail}` : ""}.`;
  }
}

function tradeHeader(intent: TradeIntent): string {
  return `⚡ ${intent.market} ${sideLabel(intent.side)} ${intent.leverage}x — ${intent.amount} ${intent.market}`;
}

export async function executeTradeIntent(ctx: Context, intent: TradeIntent): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;
  const header = tradeHeader(intent);

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await editSafe(ctx, `${header}\n\n🔐 Wallet Required\n\nConnect your wallet first with /start`);
    return;
  }
  const gate = await requireDelegatedWallet(user);
  if (!gate.ok) {
    await editSafe(ctx, `${header}\n\n${gate.message}`);
    return;
  }

  // Re-validate leverage server-side: the token is signed, but limits may
  // have changed between preview and confirm.
  const maxLev = maxLeverage(intent.side);
  if (intent.leverage < RISK_PARAMS.MIN_LEVERAGE || intent.leverage > maxLev) {
    await editSafe(
      ctx,
      `${header}\n\n❌ Leverage out of range (${RISK_PARAMS.MIN_LEVERAGE}x–${maxLev}x for ${intent.side}).`
    );
    return;
  }

  await editSafe(ctx, `${header}\n\n🔎 Fetching route quote…`);

  try {
    const sdk = createFxSdk();
    const client = createPublicClientForUser(
      user.mevProtection === "flashbots" ? "flashbots" : "off"
    );
    const amountWei = parseUnits(String(intent.amount), collateralDecimals(intent.market));
    const quote = await quoteOpenPosition({
      sdk,
      userAddress: user.walletAddress,
      market: intent.market,
      side: intent.side,
      leverage: intent.leverage,
      amountWei,
      slippagePercent: user.slippageBps / 100,
    });
    const route = quote.routes[0];
    if (!route) {
      await editSafe(ctx, `${header}\n\n❌ No route available for this size right now. Try a different amount.`);
      return;
    }

    let lastStatus = "";
    const result = await executeRoute({
      userId: user.id,
      walletId: gate.walletId,
      walletAddress: user.walletAddress as `0x${string}`,
      // Nonce comes from the signed intent: double-taps and Telegram retries
      // hit the executor's idempotency check instead of broadcasting twice.
      idempotencyKey: `trade:${user.id}:${intent.nonce}`,
      txs: route.txs,
      type: intent.side === "long" ? "open_long" : "open_short",
      client,
      onStatus: (status, detail) => {
        const line = statusLine(status, detail);
        if (line === lastStatus) return;
        lastStatus = line;
        void editSafe(ctx, `${header}\n\n${line}`);
      },
    });

    if (result.ok) {
      // Snapshot the TRUE entry state for PnL tracking — fresh on-chain read
      // right after the open. Best-effort: a failed read just means the
      // snapshot is taken on the next /portfolio instead.
      try {
        const fresh = await listUserPositions(sdk, user.walletAddress, intent.market, intent.side);
        let spot: Record<string, number | null> | null = null;
        try {
          const snap = await getSpotPrices();
          if (!snap.stale) spot = snap.prices;
        } catch { /* feed down — snapshot without entry spot */ }
        await trackPositions(user.id, fresh, spot);
      } catch (e) {
        botLogger.warn({ error: String(e) }, "trade-ux: post-open snapshot failed");
      }
      const hash = result.hashes[result.hashes.length - 1];
      await editSafe(
        ctx,
        `${header}\n\n` +
          (result.deduped
            ? `♻️ Already processed — this confirm was a duplicate tap. No second transaction was sent.\n`
            : `✅ Position opened.\n`) +
          (hash ? `\nTx: https://etherscan.io/tx/${hash}` : "") +
          `\n\n📊 /portfolio to track it.`
      );
    } else {
      // W-19: classify the raw error into actionable copy (broadcast-state
      // honesty: post-broadcast kinds keep the tx hash, pre-broadcast kinds
      // may promise nothing was sent).
      await editSafe(
        ctx,
        `${header}\n\n❌ Trade not completed.\n\n${describeExecutionError(result.error)}\n\nRetry with /trade.`
      );
    }
  } catch (error) {
    botLogger.error({ error: String(error), telegramId }, "trade-ux: execution error");
    await editSafe(
      ctx,
      `${header}\n\n❌ Trade failed before broadcast — nothing was sent on-chain.\n\nPlease try again with /trade.`
    );
  }
}

// ---------------------------------------------------------------------------
// Callback routing
// ---------------------------------------------------------------------------

export async function handleLadderCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  await ctx.answerCallbackQuery().catch(() => undefined);
  const parts = data.split("_");
  const step = parts[1];

  if (step === "m") {
    await editSafe(ctx, ladderText(), ladderMarketKeyboard());
    return;
  }

  const marketIdx = Number(parts[2]);
  const market = MARKETS[marketIdx];
  if (!market) {
    await editSafe(ctx, ladderText(), ladderMarketKeyboard());
    return;
  }

  if (step === "s") {
    await editSafe(ctx, `⚡ ${market} — long or short?`, ladderSideKeyboard(marketIdx));
    return;
  }

  const side: Side = parts[3] === "s" ? "short" : "long";

  if (step === "l") {
    await editSafe(
      ctx,
      `⚡ ${market} ${sideLabel(side)} — choose leverage (${RISK_PARAMS.MIN_LEVERAGE}x–${maxLeverage(side)}x):`,
      ladderLeverageKeyboard(marketIdx, side)
    );
    return;
  }

  if (step === "a") {
    const lev10 = Number(parts[4]);
    await editSafe(
      ctx,
      `⚡ ${market} ${sideLabel(side)} ${lev10 / 10}x — collateral amount:\n\n(custom amount: /trade ${market} ${side} ${lev10 / 10}x <amount>)`,
      ladderAmountKeyboard(marketIdx, side, lev10)
    );
    return;
  }

  if (step === "p") {
    const leverage = Number(parts[4]) / 10;
    const amount = Number(parts[5]) / 1e6;
    const telegramId = ctx.from?.id.toString();
    const user = telegramId
      ? await prisma.user.findUnique({ where: { telegramId } })
      : null;
    const { text, keyboard } = buildPreview(
      { market, side, leverage, amount },
      user,
      ctx.me?.username ?? "FxAeonBot"
    );
    await editSafe(ctx, text, keyboard);
  }
}

export async function handleConfirmCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const token = data.slice("tc_".length);
  const verdict = verifyTradeIntent(token);

  if (!verdict.ok) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    const reason =
      verdict.reason === "expired"
        ? "⌛ This preview expired (10 min limit). Run /trade again for a fresh quote."
        : "❌ This confirmation link is invalid. Run /trade to create a new one.";
    await editSafe(ctx, reason);
    return;
  }

  await ctx
    .answerCallbackQuery({ text: "Confirming…" })
    .catch(() => undefined);
  await executeTradeIntent(ctx, verdict.intent);
}

export async function handleCancelCallback(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => undefined);
  await editSafe(ctx, `❌ Trade cancelled. Nothing was sent on-chain.\n\nStart over anytime with /trade.`);
}

/** Register all trade-ux callback handlers. Call once from main.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTradeActions(bot: Bot<any>): void {
  // Handlers are written against the base Context (they only use callback
  // fields all flavors share); narrow grammY callback contexts are fine.
  bot.callbackQuery(/^tl_/, (ctx) => handleLadderCallback(ctx as unknown as Context));
  bot.callbackQuery(/^tc_/, (ctx) => handleConfirmCallback(ctx as unknown as Context));
  bot.callbackQuery("tx_cancel", (ctx) => handleCancelCallback(ctx as unknown as Context));
}
