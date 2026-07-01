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
 *   Step 3 — Collateral (live wallet balances via multicall3)
 *   Step 4 — Size (% of balance / USD / custom)
 *   Step 5 — Preview (real numbers, signed intent, single tap to confirm)
 *   Step 6 — Receipt (wired action buttons)
 *
 * Pro mode: `/longBTC 500 5x usdc` skips directly to Step 5.
 */
import { Context, InlineKeyboard } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";
import { prisma } from "@fxaeon/db";
import { MARKETS, RISK_PARAMS, type Market } from "@fxaeon/shared";
import { checkOracles, estimateDailyFunding } from "../market/oracle.js";
import { getCollateralBalances, formatBalance, type CollateralBalance } from "../core/collateral.js";
import { getSpotPrices } from "../market/coingecko.js";
import { storeCallbackPayload, consumeCallbackPayload } from "../core/callbackKeys.js";
import { buildPreview } from "../handlers/tradeActions.js";
import { botLogger } from "../middleware/logger.js";

type Side = "long" | "short";
type Asset = "BTC" | "ETH";

// ── Asset/Market mapping ────────────────────────────────────────────────────

function assetToMarket(asset: Asset): Market {
  return asset === "ETH" ? "wstETH" : "WBTC";
}

function marketToAsset(market: Market): Asset {
  return market === "wstETH" ? "ETH" : "BTC";
}

const sideLabel = (s: Side) => (s === "long" ? "LONG 📈" : "SHORT 📉");
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
 * Parse pro-mode args: /longBTC 500 5x usdc
 * Returns null if not enough args for pro mode.
 */
function parseProArgs(args: string[]): {
  amount: number;
  leverage: number;
  collateral?: string;
} | null {
  if (args.length < 2) return null;

  const amountStr = args[0];
  const levStr = args[1];
  const collStr = args[2];

  // Parse amount: "500", "$500", "0.5"
  const amount = parseFloat(amountStr.replace("$", ""));
  if (isNaN(amount) || amount <= 0) return null;

  // Parse leverage: "5x", "5", "3.5x"
  const leverage = parseFloat(levStr.replace(/x$/i, ""));
  if (isNaN(leverage) || leverage <= 0) return null;

  return {
    amount,
    leverage,
    collateral: collStr?.toUpperCase(),
  };
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
    oracleCheck = await checkOracles({ asset, spotPrice });
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
    `Typical f(x) fee:    ~${side === "long" ? "0.30" : "0.10"}% (scales with leverage — exact fee shown in preview)`,
    `FxAeon fee:          0.05%`,
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
  const isFirstTime = user && !user.mode;
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

  // Custom leverage
  const customNonce = storeCallbackPayload({
    action: "ls_custom_lev",
    market,
    side,
    asset,
  });
  kb.row().text("Custom…", `ls_custlev_${customNonce}`);
  kb.text("← Back", "ls_back_step1");

  return kb;
}

// ── Step 3: Collateral ──────────────────────────────────────────────────────

async function renderCollateralStep(
  ctx: Context,
  market: Market,
  side: Side,
  asset: Asset,
  leverage: number,
  userAddress: `0x${string}`,
  defaultCollateral?: string
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
        fxUSD: 1, // stablecoin
        USDC: 1,
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

  // Find default collateral
  const defaultToken = defaultCollateral || "fxUSD";
  const defaultBal = balances.find((b) => b.symbol === defaultToken) || balances[0];

  const lines = [
    `${sideEmoji(side)}  ${side === "long" ? "Long" : "Short"} ${asset} at ${leverage}×`,
    "",
    `Using ${defaultBal?.symbol ?? defaultToken} as your default collateral.`,
  ];

  if (defaultBal && !defaultBal.isEmpty) {
    lines.push(
      `Wallet balance:  ${formatBalance(defaultBal)}`
    );
  } else {
    lines.push(`Wallet balance:  0 ${defaultToken}  ⚠️ Insufficient`);
  }

  // Show other token balances
  const others = balances.filter((b) => b.symbol !== defaultBal?.symbol);
  if (others.length > 0) {
    lines.push("", "Other accepted tokens:");
    others.forEach((b) => {
      lines.push(`  ${b.isEmpty ? "⬛" : "🟢"} ${formatBalance(b)}`);
    });
  }

  // Store context
  const continueNonce = storeCallbackPayload({
    action: "ls_collateral_selected",
    market,
    side,
    asset,
    leverage,
    collateralSymbol: defaultBal?.symbol ?? defaultToken,
    collateralAddress: defaultBal?.address,
    collateralDecimals: defaultBal?.decimals ?? 18,
    balanceHuman: defaultBal?.balanceHuman ?? 0,
  });

  const changeNonce = storeCallbackPayload({
    action: "ls_change_collateral",
    market,
    side,
    asset,
    leverage,
    balances: balances.map((b) => ({
      symbol: b.symbol,
      address: b.address,
      decimals: b.decimals,
      balanceHuman: b.balanceHuman,
    })),
  });

  const kb = new InlineKeyboard()
    .text("✅ Continue", `ls_size_${continueNonce}`)
    .text("🔄 Change Token", `ls_chg_${changeNonce}`)
    .row()
    .text("← Back", "ls_back_lev");

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
  balanceHuman: number
): { text: string; keyboard: InlineKeyboard } {
  const lines = [
    `${sideEmoji(side)}  ${side === "long" ? "Long" : "Short"} ${asset} at ${leverage}× with ${collateralSymbol}`,
    "",
    "Choose size:",
  ];

  const kb = new InlineKeyboard();

  // Percentage presets (of token balance)
  const pctPresets = [25, 50, 75, 100];
  pctPresets.forEach((pct) => {
    const amount = (balanceHuman * pct) / 100;
    if (amount > 0) {
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

  kb.row();

  // USD presets
  const usdPresets = [50, 100, 250, 500, 1000];
  usdPresets.forEach((usd) => {
    const nonce = storeCallbackPayload({
      action: "ls_size_usd",
      market,
      side,
      asset,
      leverage,
      collateralSymbol,
      collateralAddress,
      collateralDecimals,
      amountUsd: usd,
      sizeLabel: `$${usd >= 1000 ? `${usd / 1000}k` : usd}`,
    });
    kb.text(`$${usd >= 1000 ? `${usd / 1000}k` : usd}`, `ls_prev_${nonce}`);
  });

  // Custom amount
  const customNonce = storeCallbackPayload({
    action: "ls_custom_size",
    market,
    side,
    asset,
    leverage,
    collateralSymbol,
    collateralAddress,
    collateralDecimals,
  });
  kb.row()
    .text("Custom amount…", `ls_cust_${customNonce}`)
    .text("← Back", "ls_back_col");

  return { text: lines.join("\n"), keyboard: kb };
}

// ── Step 5: Preview (delegates to tradeActions.buildPreview) ────────────────

async function renderPreview(
  ctx: Context,
  market: Market,
  side: Side,
  asset: Asset,
  leverage: number,
  amount: number,
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

  // Enhance with oracle info and funding cost for shorts
  const lines = text.split("\n");

  // Add funding cost for shorts
  if (side === "short") {
    const positionSize = amount * leverage;
    const funding = await estimateDailyFunding(positionSize).catch(() => null);
    if (funding) {
      const insertIdx = lines.findIndex((l) => l.includes("MEV protection")) || lines.length - 3;
      lines.splice(
        insertIdx,
        0,
        `Est. daily funding:  ~$${funding.dailyCostUsd.toFixed(2)}/day    (AAVE USDC rate × 10)`
      );
    }
  }

  await editOrReply(ctx, lines.join("\n"), keyboard);
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

    // Check for pro-mode args: /longBTC 500 5x usdc
    const args = text.split(/\s+/).slice(1);
    const proArgs = parseProArgs(args);

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
        proArgs.collateral || user.defaultCollateralToken || "fxUSD",
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
          action: "partial_close",
          market,
          side: pos.side,
          positionId: pos.positionId,
          sizeBps: pct * 100,
        });
        kb.text(`${pct}%`, `ls_pclose_${nonce}`);
      });

      await ctx.reply(
        `🔒 Close ${asset} ${pos.side.toUpperCase()} #${pos.positionId}\n\n` +
          `Collateral: ${Number(pos.collateral).toFixed(6)} ${pos.collateralToken}\n` +
          `Debt: ${Number(pos.debt).toFixed(2)} ${pos.debtToken}\n` +
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

  // Step 1 → Step 2 (leverage picker)
  if (data.startsWith("ls_lev_")) {
    const nonce = data.slice("ls_lev_".length);
    const payload = consumeCallbackPayload(nonce);
    if (!payload) {
      await editOrReply(ctx, "⌛ This button expired. Start over with a new command.");
      return;
    }
    const { market, side, asset } = payload as { market: Market; side: Side; asset: Asset };
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
    const { market, side, asset, leverage } = payload as {
      market: Market;
      side: Side;
      asset: Asset;
      leverage: number;
    };

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
      user.walletAddress as `0x${string}`,
      user.defaultCollateralToken
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
    const { market, side, asset, leverage, collateralSymbol, collateralAddress, collateralDecimals, balanceHuman } =
      payload as any;

    const { text, keyboard } = renderSizeKeyboard(
      market,
      side,
      asset,
      leverage,
      collateralSymbol,
      collateralAddress,
      collateralDecimals,
      balanceHuman
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
    const { market, side, asset, leverage, collateralSymbol, amount, amountUsd } = payload as any;

    const telegramId = ctx.from?.id.toString();
    const user = telegramId
      ? await prisma.user.findUnique({ where: { telegramId } })
      : null;

    // If USD amount, convert to token amount using current price
    let tokenAmount = amount;
    if (!tokenAmount && amountUsd) {
      try {
        const snap = await getSpotPrices();
        const ethPrice = snap.prices?.["ETH"] ?? 0;
        const btcPrice = snap.prices?.["BTC"] ?? 0;
        const priceMap: Record<string, number> = {
          fxUSD: 1,
          USDC: 1,
          wstETH: snap.prices?.["wstETH"] ?? ethPrice,
          stETH: ethPrice,
          WETH: ethPrice,
          ETH: ethPrice,
          WBTC: snap.prices?.["WBTC"] ?? btcPrice,
        };
        const price = priceMap[collateralSymbol] || 1;
        tokenAmount = amountUsd / price;
      } catch {
        tokenAmount = amountUsd; // fallback
      }
    }

    await renderPreview(
      ctx,
      market,
      side,
      asset,
      leverage,
      tokenAmount,
      collateralSymbol,
      user,
      ctx.me?.username ?? "FxAeonBot"
    );
    return;
  }

  // Change collateral token
  if (data.startsWith("ls_chg_")) {
    const nonce = data.slice("ls_chg_".length);
    const payload = consumeCallbackPayload(nonce);
    if (!payload) {
      await editOrReply(ctx, "⌛ This button expired. Start over with a new command.");
      return;
    }
    const { market, side, asset, leverage, balances } = payload as any;

    const kb = new InlineKeyboard();
    (balances as any[]).forEach((bal: any) => {
      const selNonce = storeCallbackPayload({
        action: "ls_collateral_selected",
        market,
        side,
        asset,
        leverage,
        collateralSymbol: bal.symbol,
        collateralAddress: bal.address,
        collateralDecimals: bal.decimals,
        balanceHuman: bal.balanceHuman,
      });
      const label = bal.balanceHuman > 0
        ? `${bal.symbol} (${bal.balanceHuman.toFixed(4)})`
        : `${bal.symbol} (empty)`;
      kb.text(label, `ls_size_${selNonce}`).row();
    });
    kb.text("← Back", "ls_back_col");

    await editOrReply(
      ctx,
      `🔄 Choose collateral token for ${side === "long" ? "Long" : "Short"} ${asset} at ${leverage}×:`,
      kb
    );
    return;
  }
}

// ── Registration ────────────────────────────────────────────────────────────

import type { Bot } from "grammy";

export function registerLongShortActions(bot: Bot<any>): void {
  bot.callbackQuery(/^ls_/, (ctx) => handleLongShortCallback(ctx as unknown as Context));
}
