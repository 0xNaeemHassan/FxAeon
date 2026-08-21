/**
 * Asset-locked trading shortcuts — Phase 2 (Masterplan).
 *
 * /longBTC, /longETH, /shortBTC, /shortETH, /closeBTC, /closeETH
 *
 * These are the user-facing entry points for the 6-step trading ladder.
 * Each locks the market + side upfront, eliminating the first two taps.
 *
 * Flow (for /longBTC):
 *   Step 1 — Position summary (auto-rendered, market data + oracle chips)
 *   Step 2 — Leverage picker (inline buttons)
 *   Step 3 — Native market collateral (live wallet balance via multicall3)
 *   Step 4 — Size (% of balance)
 *   Step 5 — Preview (real numbers, signed intent, single tap to confirm)
 *   Step 6 — Receipt (wired action buttons)
 *
 * Pro mode: `/longBTC 0.005 2x` skips directly to Step 5. Amounts are
 * always native market collateral units (WBTC for BTC, wstETH for ETH).
 */
import { Context, InlineKeyboard } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";
import { prisma } from "@fxaeon/db";
import { MARKETS, RISK_PARAMS, type Market } from "@fxaeon/shared";
import { checkOracles } from "../market/oracle.js";
import { getCollateralBalances, formatBalance } from "../core/collateral.js";
import { getSpotPrices } from "../market/coingecko.js";
import { storeCallbackPayload, consumeCallbackPayload } from "../core/callbackKeys.js";
import { buildPreview } from "../handlers/tradeActions.js";
import { botLogger } from "../middleware/logger.js";
import { formatUnits } from "viem";
import { canonicalActionAmount } from "../core/actionIntent.js";

type Side = "long" | "short";
type Asset = "BTC" | "ETH";

function isMarket(value: unknown): value is Market {
  return typeof value === "string" && (MARKETS as readonly string[]).includes(value);
}

function isSide(value: unknown): value is Side {
  return value === "long" || value === "short";
}

function isAsset(value: unknown): value is Asset {
  return value === "BTC" || value === "ETH";
}

function isValidLeverage(value: unknown, side: Side): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= RISK_PARAMS.MIN_LEVERAGE &&
    value <= maxLeverage(side)
  );
}

// ── Asset/Market mapping ────────────────────────────────────────────────────

function assetToMarket(asset: Asset): Market {
  return asset === "ETH" ? "wstETH" : "WBTC";
}

const sideEmoji = (s: Side) => (s === "long" ? "📈" : "📉");

function maxLeverage(side: Side): number {
  return side === "long" ? RISK_PARAMS.MAX_LEVERAGE_LONG : RISK_PARAMS.MAX_LEVERAGE_SHORT;
}

function leveragePresets(side: Side): number[] {
  if (side === "long") return [1.1, 2, 3, 5, 7];
  return [1.1, 1.5, 2, 3];
}

// ── Callback prefix: `ls_` (longshort) ──────────────────────────────────────

/**
 * Parse shortcut commands: /longBTC, /longETH, /shortBTC, /shortETH
 */
export function parseShortcutCommand(text: string): { asset: Asset; side: Side } | null {
  const clean = text.trim().split(/\s/)[0].toLowerCase().replace(/^\//, "");
  const match = /^(long|short)(btc|eth)$/.exec(clean);
  if (!match) return null;
  return {
    side: match[1] as Side,
    asset: match[2].toUpperCase() as Asset,
  };
}

/**
 * Parse pro-mode args: /longBTC 0.005 2x
 * The syntax is deliberately strict: accepting a fiat or token suffix here
 * would be unsafe because the current f(x) quote uses market-native units.
 */
export function parseProArgs(args: string[]): {
  amount: string;
  leverage: number;
} | null;
export function parseProArgs(args: string[], maxDecimals?: number): {
  amount: string;
  leverage: number;
} | null;
export function parseProArgs(args: string[], maxDecimals = 18): {
  amount: string;
  leverage: number;
} | null {
  if (args.length !== 2) return null;

  const amountStr = args[0];
  const levStr = args[1];
  const leverageMatch = /^(\d+(?:\.\d+)?|\.\d+)x?$/i.exec(levStr);
  if (!leverageMatch) return null;

  const amount = canonicalActionAmount(amountStr, maxDecimals);
  const leverage = Number(leverageMatch[1]);
  if (!amount || !Number.isFinite(leverage) || leverage <= 0 || !Number.isInteger(leverage * 10)) {
    return null;
  }

  return { amount, leverage };
}

// ── Step 1: Position Summary ────────────────────────────────────────────────

async function renderStep1(
  ctx: Context,
  asset: Asset,
  side: Side,
  user: any
): Promise<void> {
  const market = assetToMarket(asset);

  // Fetch spot prices for oracle comparison
  let spotPrice: number | undefined;
  try {
    const snap = await getSpotPrices();
    if (!snap.stale) {
      spotPrice = snap.prices[asset] ?? undefined;
    }
  } catch {
    /* feed down — continue without spot */
  }

  // Oracle checks (best-effort, non-blocking)
  let oracleCheck;
  try {
    oracleCheck = await checkOracles({
      asset,
      spotPrice,
      maxDivergence: (user?.oracleDivergenceBps ?? 50) / 10_000,
      maxStalenessSeconds: user?.chainlinkStalenessSec ?? 3600,
    });
  } catch {
    oracleCheck = null;
  }

  const maxLev = maxLeverage(side);
  const slippage = user?.slippageBps ? (user.slippageBps / 100).toFixed(2) : "0.50";

  const lines = [
    `${sideEmoji(side)}  ${side === "long" ? "Long" : "Short"} ${asset}`,
    "",
  ];

  // Market price
  if (spotPrice) {
    lines.push(
      `Market price:        $${spotPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}    (live)`
    );
  }

  // Oracle chips
  if (oracleCheck) {
    lines.push(oracleCheck.fxChip);
    lines.push(oracleCheck.chainlinkChip);
  }

  lines.push(
    `Available leverage:  ${RISK_PARAMS.MIN_LEVERAGE}× – ${maxLev}×`,
    `Protocol/network fees: calculated from the live route at confirmation`,
    `Slippage tolerance:  ${slippage}%    (Settings to change)`,
  );

  // Warning chips
  if (oracleCheck?.fxOracleWarning) {
    lines.push("", "⚠️ Oracle divergence exceeds threshold — proceed with caution.");
  }
  if (oracleCheck?.chainlinkStaleWarning) {
    lines.push("", "⚠️ Chainlink feed is stale — prices may be outdated.");
  }

  // First-time user tutor card
  const isFirstTime = user && !user.firstTradeAt;
  if (isFirstTime) {
    lines.push(
      "",
      "💡 First trade? Here's what happens:",
      "1️⃣ Pick leverage → 2️⃣ Choose collateral → 3️⃣ Set size → 4️⃣ Review preview → 5️⃣ Confirm",
      "Nothing is sent on-chain until you tap ✅ Confirm."
    );
  }

  // Store context for next step
  const nonce = storeCallbackPayload({
    action: "ls_step1",
    market,
    side,
    asset,
  });

  const kb = new InlineKeyboard()
    .text("Continue →", `ls_lev_${nonce}`)
    .text("❌ Cancel", "ls_cancel");

  await ctx.reply(lines.join("\n"), { reply_markup: kb });
}

// ── Step 2: Leverage ────────────────────────────────────────────────────────

function renderLeverageKeyboard(
  side: Side,
  asset: Asset,
  market: Market
): InlineKeyboard {
  const presets = leveragePresets(side);
  const kb = new InlineKeyboard();

  presets.forEach((lev) => {
    const nonce = storeCallbackPayload({
      action: "ls_leverage",
      market,
      side,
      asset,
      leverage: lev,
    });
    kb.text(`${lev}×`, `ls_col_${nonce}`);
  });

  const backNonce = storeCallbackPayload({
    action: "ls_back_step1",
    market,
    side,
    asset,
  });
  kb.row().text("← Back", `ls_back_step1_${backNonce}`);

  return kb;
}

// ── Step 3: Collateral ──────────────────────────────────────────────────────

async function renderCollateralStep(
  ctx: Context,
  market: Market,
  side: Side,
  asset: Asset,
  leverage: number,
  userAddress: `0x${string}`
): Promise<void> {
  // Fetch balances via multicall3
  let prices: Record<string, number> = {};
  try {
    const snap = await getSpotPrices();
    if (!snap.stale && snap.prices) {
      // CoinGecko cache is keyed by symbol (BTC, ETH, wstETH, WBTC, …)
      const ethPrice = snap.prices["ETH"] ?? 0;
      const btcPrice = snap.prices["BTC"] ?? 0;
      prices = {
        ...(snap.prices["FXUSD"] != null ? { fxUSD: snap.prices["FXUSD"] } : {}),
        ...(snap.prices["USDC"] != null ? { USDC: snap.prices["USDC"] } : {}),
        wstETH: snap.prices["wstETH"] ?? ethPrice,
        stETH: ethPrice,
        WETH: ethPrice,
        ETH: ethPrice,
        WBTC: snap.prices["WBTC"] ?? btcPrice,
      };
    }
  } catch {
    /* continue without prices */
  }

  const balances = await getCollateralBalances(userAddress, market, prices);

  // The SDK currently quotes market-native collateral only. Never display a
  // selectable token that the signed intent cannot faithfully represent.
  const nativeBal = balances.find((b) => b.symbol === market);

  const lines = [
    `${sideEmoji(side)}  ${side === "long" ? "Long" : "Short"} ${asset} at ${leverage}×`,
    "",
    `Collateral: ${market} (required for this market)`,
  ];

  if (nativeBal && !nativeBal.isEmpty) {
    lines.push(`Wallet balance:  ${formatBalance(nativeBal)}`);
  } else {
    lines.push(`Wallet balance:  0 ${market}  ⚠️ Insufficient`);
  }

  const backNonce = storeCallbackPayload({
    action: "ls_back_lev",
    market,
    side,
    asset,
    leverage,
  });

  const kb = new InlineKeyboard();
  if (nativeBal && !nativeBal.isEmpty) {
    const continueNonce = storeCallbackPayload({
      action: "ls_collateral_selected",
      market,
      side,
      asset,
      leverage,
      collateralSymbol: market,
      collateralAddress: nativeBal.address,
      collateralDecimals: nativeBal.decimals,
      balanceRaw: nativeBal.balanceRaw.toString(),
    });
    kb.text("✅ Continue", `ls_size_${continueNonce}`).row();
  } else {
    lines.push("", `Deposit ${market}, then start the trade again.`);
  }

  kb.text("← Back", `ls_back_lev_${backNonce}`);

  await editOrReply(ctx, lines.join("\n"), kb);
}

// ── Step 4: Size ────────────────────────────────────────────────────────────

function renderSizeKeyboard(
  market: Market,
  side: Side,
  asset: Asset,
  leverage: number,
  collateralSymbol: string,
  collateralAddress: string,
  collateralDecimals: number,
  balanceRaw: string
): { text: string; keyboard: InlineKeyboard } {
  const lines = [
    `${sideEmoji(side)}  ${side === "long" ? "Long" : "Short"} ${asset} at ${leverage}× with ${collateralSymbol}`,
    "",
    `Choose how much of your ${collateralSymbol} balance to use:`,
  ];

  const kb = new InlineKeyboard();

  // Percentage presets (of token balance)
  const pctPresets = [25, 50, 75, 100];
  pctPresets.forEach((pct) => {
    const amountWei = (BigInt(balanceRaw) * BigInt(pct)) / 100n;
    if (amountWei > 0n) {
      const amount = formatUnits(amountWei, collateralDecimals);
      const nonce = storeCallbackPayload({
        action: "ls_size_selected",
        market,
        side,
        asset,
        leverage,
        collateralSymbol,
        collateralAddress,
        collateralDecimals,
        amount,
        sizeLabel: `${pct}%`,
      });
      kb.text(`${pct}%`, `ls_prev_${nonce}`);
    }
  });

  const backNonce = storeCallbackPayload({
    action: "ls_back_col",
    market,
    side,
    asset,
    leverage,
  });
  kb.row().text("← Back", `ls_back_col_${backNonce}`);

  lines.push("", `Exact amount: /${side}${asset} <${market} amount> <leverage>x`);

  return { text: lines.join("\n"), keyboard: kb };
}

// ── Step 5: Preview (delegates to tradeActions.buildPreview) ────────────────

async function renderPreview(
  ctx: Context,
  market: Market,
  side: Side,
  asset: Asset,
  leverage: number,
  amount: string,
  collateralSymbol: string,
  user: any,
  botUsername: string
): Promise<void> {
  // Build the signed preview
  const { text, keyboard } = buildPreview(
    { market, side, leverage, amount },
    user ? { slippageBps: user.slippageBps ?? 50, mevProtection: user.mevProtection ?? "flashbots" } : null,
    botUsername
  );

  // Do not fabricate a funding estimate from an unrelated lending market.
  // The SDK route quote is the authoritative source for executable economics.
  await editOrReply(ctx, text, keyboard);
}

// ── Helper ──────────────────────────────────────────────────────────────────

async function editOrReply(
  ctx: Context,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, keyboard ? { reply_markup: keyboard } : undefined);
    } else {
      await ctx.reply(text, keyboard ? { reply_markup: keyboard } : undefined);
    }
  } catch (error) {
    botLogger.debug({ error: String(error) }, "longShort: editOrReply skipped");
    // Fallback to reply if edit fails
    try {
      await ctx.reply(text, keyboard ? { reply_markup: keyboard } : undefined);
    } catch { /* give up */ }
  }
}

// ── Command Handlers ────────────────────────────────────────────────────────

/**
 * Handle /longBTC, /longETH, /shortBTC, /shortETH commands.
 */
export async function longShortCommand(ctx: Context & I18nFlavor): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const text = ctx.message?.text ?? "";
  const parsed = parseShortcutCommand(text);
  if (!parsed) {
    await ctx.reply("❌ Invalid command. Use /longBTC, /longETH, /shortBTC, or /shortETH.");
    return;
  }

  const { asset, side } = parsed;
  const market = assetToMarket(asset);

  try {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      await ctx.reply(
        `🔐 Wallet Required\n\nConnect your wallet first with /start to trade.`
      );
      return;
    }

    // Check for strict native-unit pro mode: /longBTC 0.005 2x
    const args = text.split(/\s+/).slice(1);
    const proArgs = parseProArgs(args, market === "WBTC" ? 8 : 18);

    if (args.length > 0 && !proArgs) {
      await ctx.reply(
        `❌ Invalid trade syntax.\n\nUse /${side}${asset} <${market} amount> <leverage>x\nExample: /${side}${asset} ${asset === "BTC" ? "0.005" : "0.25"} 2x\n\nAmounts are ${market} units. Fiat and alternate-token amounts are not accepted in chat.`
      );
      return;
    }

    if (proArgs) {
      // Pro mode: skip straight to preview
      const maxLev = maxLeverage(side);
      if (proArgs.leverage < RISK_PARAMS.MIN_LEVERAGE || proArgs.leverage > maxLev) {
        await ctx.reply(
          `❌ Leverage out of range (${RISK_PARAMS.MIN_LEVERAGE}×–${maxLev}× for ${side}).`
        );
        return;
      }
      await renderPreview(
        ctx,
        market,
        side,
        asset,
        proArgs.leverage,
        proArgs.amount,
        market,
        user,
        ctx.me?.username ?? "FxAeonBot"
      );
    } else {
      // Standard flow: start from Step 1
      await renderStep1(ctx, asset, side, user);
    }
  } catch (error) {
    botLogger.error({ error: String(error) }, `longShort: ${side}${asset} failed`);
    await ctx.reply("❌ Something went wrong. Please try again.");
  }
}

/**
 * Handle /closeBTC, /closeETH commands.
 * Delegates to the close command but pre-filters by market.
 */
export async function closeAssetCommand(ctx: Context & I18nFlavor): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const text = (ctx.message?.text ?? "").trim().split(/\s/)[0].toLowerCase().replace(/^\//, "");
  const match = /^close(btc|eth)$/.exec(text);
  if (!match) {
    await ctx.reply("❌ Invalid command. Use /closeBTC or /closeETH.");
    return;
  }

  const asset = match[1].toUpperCase() as Asset;
  const market = assetToMarket(asset);

  try {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      await ctx.reply("🔐 Wallet Not Connected\n\nUse /start to connect your wallet.");
      return;
    }

    // Import and use the close position logic
    const { createFxSdk } = await import("../fx/index.js");
    const { fetchOnChainPositions } = await import("../core/portfolio.js");

    const { positions, failures } = await fetchOnChainPositions(
      createFxSdk(),
      user.walletAddress
    );

    // Filter to the requested market
    const marketPositions = positions.filter((p) => p.market === market);

    if (marketPositions.length === 0) {
      const failNote =
        failures.length > 0
          ? `\n\n⚠️ Couldn't read: ${failures.join(", ")} — retry shortly.`
          : "";
      await ctx.reply(
        `📊 No open ${asset} positions to close.\n\nUse /long${asset} or /short${asset} to open a position.${failNote}`
      );
      return;
    }

    if (marketPositions.length === 1) {
      const pos = marketPositions[0];
      const mIdx = MARKETS.indexOf(pos.market);
      const sideKey = pos.side === "short" ? "s" : "l";
      const kb = new InlineKeyboard()
        .text("🔒 Close 100%", `pc_${mIdx}_${sideKey}_${pos.positionId}`)
        .text("❌ Cancel", "pc_cancel")
        .row();

      // Add partial close buttons
      [25, 50, 75].forEach((pct) => {
        const nonce = storeCallbackPayload({
          action: "pa_do_reduce",
          market,
          side: pos.side,
          positionId: pos.positionId,
          sizeBps: pct * 100,
        });
        kb.text(`${pct}%`, `pa_dored_${nonce}`);
      });

      await ctx.reply(
        `🔒 Close ${asset} ${pos.side.toUpperCase()} #${pos.positionId}\n\n` +
          `Collateral: ${pos.collateral.toFixed(6)} ${pos.collateralToken}\n` +
          `Debt: ${pos.debt.toFixed(2)} ${pos.debtToken}\n` +
          `Leverage: ${pos.leverage.toFixed(2)}×\n\n` +
          `Close how much?`,
        { reply_markup: kb }
      );
      return;
    }

    // Multiple positions — picker
    const kb = new InlineKeyboard();
    marketPositions.slice(0, 8).forEach((pos) => {
      const mIdx = MARKETS.indexOf(pos.market);
      const sideKey = pos.side === "short" ? "s" : "l";
      kb.text(
        `🔒 ${pos.side.toUpperCase()} ${pos.leverage.toFixed(1)}× #${pos.positionId}`,
        `pc_${mIdx}_${sideKey}_${pos.positionId}`
      ).row();
    });

    await ctx.reply(
      `🔒 Close ${asset} Position\n\nYou have ${marketPositions.length} open ${asset} positions:`,
      { reply_markup: kb }
    );
  } catch (error) {
    botLogger.error({ error: String(error) }, `closeAsset: close${asset} failed`);
    await ctx.reply("❌ Couldn't load positions. Please try again.");
  }
}

// ── Callback Handlers ───────────────────────────────────────────────────────

export async function handleLongShortCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  await ctx.answerCallbackQuery().catch(() => undefined);

  // Cancel
  if (data === "ls_cancel") {
    await editOrReply(ctx, "❌ Trade cancelled. Nothing was sent on-chain.\n\nStart over with /longBTC, /longETH, /shortBTC, or /shortETH.");
    return;
  }

  if (data.startsWith("ls_back_step1_")) {
    const payload = consumeCallbackPayload(data.slice("ls_back_step1_".length));
    if (!payload || payload.action !== "ls_back_step1" || !isAsset(payload.asset) || !isSide(payload.side)) {
      await editOrReply(ctx, "⌛ This button expired. Start over with a new command.");
      return;
    }
    const telegramId = ctx.from?.id.toString();
    const user = telegramId ? await prisma.user.findUnique({ where: { telegramId } }) : null;
    await renderStep1(ctx, payload.asset, payload.side, user);
    return;
  }

  if (data.startsWith("ls_back_lev_")) {
    const payload = consumeCallbackPayload(data.slice("ls_back_lev_".length));
    if (
      !payload || payload.action !== "ls_back_lev" || !isMarket(payload.market) ||
      !isAsset(payload.asset) || !isSide(payload.side)
    ) {
      await editOrReply(ctx, "⌛ This button expired. Start over with a new command.");
      return;
    }
    await editOrReply(
      ctx,
      `${sideEmoji(payload.side)}  ${payload.side === "long" ? "Long" : "Short"} ${payload.asset} — choose leverage (${RISK_PARAMS.MIN_LEVERAGE}×–${maxLeverage(payload.side)}×):`,
      renderLeverageKeyboard(payload.side, payload.asset, payload.market)
    );
    return;
  }

  if (data.startsWith("ls_back_col_")) {
    const payload = consumeCallbackPayload(data.slice("ls_back_col_".length));
    if (
      !payload || payload.action !== "ls_back_col" || !isMarket(payload.market) ||
      !isAsset(payload.asset) || !isSide(payload.side) || !isValidLeverage(payload.leverage, payload.side)
    ) {
      await editOrReply(ctx, "⌛ This button expired. Start over with a new command.");
      return;
    }
    const telegramId = ctx.from?.id.toString();
    const user = telegramId ? await prisma.user.findUnique({ where: { telegramId } }) : null;
    if (!user) {
      await editOrReply(ctx, "🔐 Connect your wallet first with /start.");
      return;
    }
    await renderCollateralStep(
      ctx, payload.market, payload.side, payload.asset, payload.leverage,
      user.walletAddress as `0x${string}`
    );
    return;
  }

  // Step 1 → Step 2 (leverage picker)
  if (data.startsWith("ls_lev_")) {
    const nonce = data.slice("ls_lev_".length);
    const payload = consumeCallbackPayload(nonce);
    if (!payload) {
      await editOrReply(ctx, "⌛ This button expired. Start over with a new command.");
      return;
    }
    if (
      payload.action !== "ls_step1" ||
      !isMarket(payload.market) ||
      !isSide(payload.side) ||
      !isAsset(payload.asset)
    ) {
      await editOrReply(ctx, "⚠️ This trade step is invalid. Start over with a new command.");
      return;
    }
    const { market, side, asset } = payload;
    const maxLev = maxLeverage(side);
    const kb = renderLeverageKeyboard(side, asset, market);
    await editOrReply(
      ctx,
      `${sideEmoji(side)}  ${side === "long" ? "Long" : "Short"} ${asset} — choose leverage (${RISK_PARAMS.MIN_LEVERAGE}×–${maxLev}×):`,
      kb
    );
    return;
  }

  // Step 2 → Step 3 (collateral)
  if (data.startsWith("ls_col_")) {
    const nonce = data.slice("ls_col_".length);
    const payload = consumeCallbackPayload(nonce);
    if (!payload) {
      await editOrReply(ctx, "⌛ This button expired. Start over with a new command.");
      return;
    }
    if (
      payload.action !== "ls_leverage" ||
      !isMarket(payload.market) ||
      !isSide(payload.side) ||
      !isAsset(payload.asset) ||
      !isValidLeverage(payload.leverage, payload.side)
    ) {
      await editOrReply(ctx, "⚠️ This trade step is invalid. Start over with a new command.");
      return;
    }
    const { market, side, asset, leverage } = payload;

    const telegramId = ctx.from?.id.toString();
    const user = telegramId
      ? await prisma.user.findUnique({ where: { telegramId } })
      : null;
    if (!user) {
      await editOrReply(ctx, "🔐 Connect your wallet first with /start.");
      return;
    }

    await renderCollateralStep(
      ctx,
      market,
      side,
      asset,
      leverage,
      user.walletAddress as `0x${string}`
    );
    return;
  }

  // Step 3 → Step 4 (size)
  if (data.startsWith("ls_size_")) {
    const nonce = data.slice("ls_size_".length);
    const payload = consumeCallbackPayload(nonce);
    if (!payload) {
      await editOrReply(ctx, "⌛ This button expired. Start over with a new command.");
      return;
    }
    if (
      payload.action !== "ls_collateral_selected" || !isMarket(payload.market) ||
      !isSide(payload.side) || !isAsset(payload.asset) ||
      !isValidLeverage(payload.leverage, payload.side) || typeof payload.collateralSymbol !== "string" ||
      payload.collateralSymbol !== payload.market ||
      typeof payload.collateralAddress !== "string" || typeof payload.collateralDecimals !== "number" ||
      typeof payload.balanceRaw !== "string" || !/^\d+$/.test(payload.balanceRaw) || BigInt(payload.balanceRaw) <= 0n
    ) {
      await editOrReply(ctx, "⚠️ This trade step is invalid. Start over with a new command.");
      return;
    }
    const { market, side, asset, leverage, collateralSymbol, collateralAddress, collateralDecimals, balanceRaw } = payload;

    const { text, keyboard } = renderSizeKeyboard(
      market,
      side,
      asset,
      leverage,
      collateralSymbol,
      collateralAddress,
      collateralDecimals,
      balanceRaw
    );
    await editOrReply(ctx, text, keyboard);
    return;
  }

  // Step 4 → Step 5 (preview)
  if (data.startsWith("ls_prev_")) {
    const nonce = data.slice("ls_prev_".length);
    const payload = consumeCallbackPayload(nonce);
    if (!payload) {
      await editOrReply(ctx, "⌛ This button expired. Start over with a new command.");
      return;
    }
    if (
      payload.action !== "ls_size_selected" || !isMarket(payload.market) || !isSide(payload.side) ||
      !isAsset(payload.asset) || !isValidLeverage(payload.leverage, payload.side) ||
      typeof payload.collateralSymbol !== "string" || payload.collateralSymbol !== payload.market ||
      typeof payload.amount !== "string" ||
      !canonicalActionAmount(payload.amount, payload.market === "WBTC" ? 8 : 18)
    ) {
      await editOrReply(ctx, "⚠️ This trade size is invalid. Start over with a new command.");
      return;
    }
    const { market, side, asset, leverage, collateralSymbol, amount } = payload;

    const telegramId = ctx.from?.id.toString();
    const user = telegramId
      ? await prisma.user.findUnique({ where: { telegramId } })
      : null;

    await renderPreview(
      ctx,
      market,
      side,
      asset,
      leverage,
      amount,
      collateralSymbol,
      user,
      ctx.me?.username ?? "FxAeonBot"
    );
    return;
  }

  await editOrReply(ctx, "⌛ This trade control is no longer valid. Start over with a new command.");
}

// ── Registration ────────────────────────────────────────────────────────────

import type { Bot } from "grammy";

export function registerLongShortActions(bot: Bot<any>): void {
  bot.callbackQuery(/^ls_/, (ctx) => handleLongShortCallback(ctx as unknown as Context));
}
