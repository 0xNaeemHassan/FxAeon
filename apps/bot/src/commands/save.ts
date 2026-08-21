/**
 * /save (/earn) — live fxSAVE dashboard and action launcher.
 *
 * Every number comes from the official f(x) SDK or an on-chain balance read.
 * Deposit, queued/instant withdrawal, and matured-redemption claim all end in
 * the signed, simulation-gated action flow in handlers/earnActions.ts.
 */
import { Context, InlineKeyboard } from "grammy";
import { prisma } from "@fxaeon/db";
import { createFxSdk } from "../fx/index.js";
import {
  getSaveClaimable,
  getSaveConfig,
  getSaveOverview,
} from "../fx/earn.js";
import {
  buildClaimPreview,
  buildSaveDepositPreview,
  buildSaveWithdrawPreview,
} from "../handlers/earnActions.js";
import { botLogger } from "../middleware/logger.js";
import { canonicalActionAmount } from "../core/actionIntent.js";

const USAGE =
  `Usage:\n` +
  `/save — live dashboard\n` +
  `/save <amount> [usdc] — quick deposit\n` +
  `/save deposit <amount> [usdc] — deposit fxUSD or USDC\n` +
  `/save withdraw <amount|all> [instant] — withdraw\n` +
  `/save claim — claim a matured redemption`;

function parseAmount(raw: string | undefined, maxDecimals = 18): string | "all" | null {
  if (!raw) return null;
  if (raw.toLowerCase() === "all") return "all";
  return canonicalActionAmount(raw, maxDecimals);
}

function formatAmount(n: number): string {
  return n >= 1_000
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

async function sendDashboard(ctx: Context, walletAddress: string): Promise<void> {
  const sdk = createFxSdk();
  const [overview, config] = await Promise.all([
    getSaveOverview(sdk, walletAddress),
    getSaveConfig(sdk),
  ]);
  const shares = Number(overview.shares);
  const assets = overview.assets === null ? null : Number(overview.assets);
  const lines = [
    `🏦 fxSAVE — Stability Pool`,
    ``,
    `Pool assets:       ${formatAmount(Number(config.totalAssets))} fxUSD`,
    `Assets / share:    ${config.assetsPerShare?.toFixed(6) ?? "—"}`,
    `Instant exit fee:  ${config.instantRedeemFeePct.toFixed(2)}%`,
    `Cooldown:          ${config.cooldownHours.toFixed(0)}h`,
    ``,
    `Your deposit:      ${shares > 0 ? `${formatAmount(shares)} shares` : "0 shares"}` +
      (assets !== null && assets > 0 ? ` (≈ ${formatAmount(assets)} fxUSD)` : ""),
    `Wallet:            ${formatAmount(Number(overview.fxUsd))} fxUSD · ${formatAmount(Number(overview.usdc))} USDC`,
  ];

  if (overview.redeem.hasPendingRedeem) {
    lines.push("");
    if (overview.redeem.isCooldownComplete) {
      lines.push("💎 Pending redemption ready — tap Claim or run /save claim.");
    } else {
      const eta = overview.redeem.redeemableAt
        ? new Date(overview.redeem.redeemableAt * 1000).toUTCString()
        : `about ${overview.redeem.cooldownHours.toFixed(0)}h after the request`;
      lines.push(
        `⏳ ${formatAmount(Number(overview.redeem.pendingShares))} shares pending — claimable ${eta}`
      );
    }
  }

  const keyboard = new InlineKeyboard()
    .text("Deposit", "sv_deposit")
    .text("Withdraw", "sv_withdraw")
    .row()
    .text("Claim", "sv_claim")
    .text("Refresh", "sv_overview");
  await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
}

async function sendClaimPreview(ctx: Context, walletAddress: string): Promise<void> {
  try {
    const claimable = await getSaveClaimable(createFxSdk(), walletAddress);
    if (!claimable.hasPendingRedeem) {
      await ctx.reply("💎 Claim\n\nNothing to claim — you have no pending fxSAVE redemption.");
      return;
    }
    if (!claimable.isCooldownComplete) {
      const when = claimable.redeemableAt
        ? new Date(claimable.redeemableAt * 1000).toUTCString()
        : "after the cooldown";
      await ctx.reply(`💎 Claim\n\nYour redemption is still cooling down. Claimable ${when}.`);
      return;
    }
    const preview = buildClaimPreview(claimable);
    await ctx.reply(preview.text, { reply_markup: preview.keyboard });
  } catch (error) {
    botLogger.error({ error: String(error) }, "save: claim preview failed");
    await ctx.reply("💎 Claim\n\nCouldn't check the live redemption status. Nothing was sent.");
  }
}

export async function saveCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("🔐 Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.trim().split(/\s+/).slice(1) ?? [];
  if (args.length === 0) {
    try {
      await sendDashboard(ctx, user.walletAddress);
    } catch (error) {
      botLogger.error({ error: String(error) }, "save: dashboard failed");
      await ctx.reply(`🏦 fxSAVE\n\nCouldn't load live pool data right now. Nothing was estimated.\n\n${USAGE}`);
    }
    return;
  }

  const action = args[0].toLowerCase();
  const shortcutToken = args[1]?.toLowerCase() === "usdc" ? "usdc" : "fxUSD";
  const shortcutAmount = parseAmount(args[0], shortcutToken === "usdc" ? 6 : 18);
  if (shortcutAmount !== null && shortcutAmount !== "all" && args.length <= 2) {
    const preview = buildSaveDepositPreview(shortcutToken, shortcutAmount);
    await ctx.reply(preview.text, { reply_markup: preview.keyboard });
    return;
  }

  if (action === "deposit" && (args.length === 2 || args.length === 3)) {
    const tokenArg = args[2]?.toLowerCase();
    const amount = parseAmount(args[1], tokenArg === "usdc" ? 6 : 18);
    if (amount === null || amount === "all" || (tokenArg && tokenArg !== "usdc" && tokenArg !== "fxusd")) {
      await ctx.reply(`Enter a valid amount and optional token (fxUSD or USDC).\n\n${USAGE}`);
      return;
    }
    const preview = buildSaveDepositPreview(tokenArg === "usdc" ? "usdc" : "fxUSD", amount);
    await ctx.reply(preview.text, { reply_markup: preview.keyboard });
    return;
  }

  if (action === "withdraw" && (args.length === 2 || args.length === 3)) {
    const amount = parseAmount(args[1], 18);
    const mode = args[2]?.toLowerCase();
    if (amount === null || (mode && mode !== "instant")) {
      await ctx.reply(`Enter an amount or all, with optional instant mode.\n\n${USAGE}`);
      return;
    }
    const preview = buildSaveWithdrawPreview(amount, mode === "instant");
    await ctx.reply(preview.text, { reply_markup: preview.keyboard });
    return;
  }

  if (action === "claim" && args.length === 1) {
    await sendClaimPreview(ctx, user.walletAddress);
    return;
  }

  if (action === "compound") {
    await ctx.reply(
      "Compound is not a single f(x) SDK action. Claim a matured redemption first, then choose a new deposit amount after the funds arrive."
    );
    return;
  }

  await ctx.reply(USAGE);
}

export async function handleSaveCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const telegramId = ctx.from?.id.toString();
  await ctx.answerCallbackQuery().catch(() => undefined);
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("Connect your wallet first with /start.");
    return;
  }

  if (data === "sv_overview") {
    try {
      await sendDashboard(ctx, user.walletAddress);
    } catch (error) {
      botLogger.error({ error: String(error) }, "save: refresh failed");
      await ctx.reply("Couldn't refresh live fxSAVE data. Try again shortly.");
    }
    return;
  }
  if (data === "sv_deposit") {
    await ctx.reply("Deposit fxUSD or USDC:\n/save deposit <amount> [usdc]\n\nExample: /save deposit 500 usdc");
    return;
  }
  if (data === "sv_withdraw") {
    await ctx.reply(
      "Queued exit (no instant fee):\n/save withdraw <amount|all>\n\nInstant exit:\n/save withdraw <amount|all> instant"
    );
    return;
  }
  if (data === "sv_claim") {
    await sendClaimPreview(ctx, user.walletAddress);
    return;
  }
  if (data === "sv_compound" || data === "sv_compound_confirm" || data === "sv_claim_confirm") {
    await ctx.reply("This old button expired. Run /save for current live actions.");
    return;
  }
  if (data === "sv_cancel") {
    await ctx.editMessageText("Cancelled. Nothing was changed.").catch(() => undefined);
  }
}
