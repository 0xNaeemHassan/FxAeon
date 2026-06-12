/**
 * /save — real fxSAVE: balance dashboard + deposit / withdraw with signed
 * confirm previews (see handlers/earnActions.ts). Live on-chain execution.
 */
import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { createFxSdk } from "../fx/index.js";
import { getSaveOverview } from "../fx/earn.js";
import {
  buildSaveDepositPreview,
  buildSaveWithdrawPreview,
} from "../handlers/earnActions.js";

const USAGE =
  `Usage:\n` +
  `/save deposit <amount> [usdc] — deposit fxUSD (or USDC) into fxSAVE\n` +
  `/save withdraw <amount|all> [instant] — withdraw back to fxUSD\n\n` +
  `Withdraw modes: 2-step (no fee — request, then /claim after the cooldown) ` +
  `or add "instant" (small fee + slippage).`;

function parseAmount(raw: string | undefined): number | "all" | null {
  if (!raw) return null;
  if (raw.toLowerCase() === "all") return "all";
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function saveCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];

  // Dashboard
  if (args.length === 0) {
    try {
      const sdk = createFxSdk();
      const o = await getSaveOverview(sdk, user.walletAddress);
      const lines = [
        `🏦 fxSAVE — yield-bearing fxUSD savings`,
        ``,
        `Your fxSAVE: ${Number(o.shares).toFixed(4)} shares` +
          (o.assets ? ` (≈ ${Number(o.assets).toFixed(2)} fxUSD)` : ""),
        `Wallet: ${Number(o.fxUsd).toFixed(2)} fxUSD · ${Number(o.usdc).toFixed(2)} USDC`,
      ];
      if (o.redeem.hasPendingRedeem) {
        lines.push(
          ``,
          o.redeem.isCooldownComplete
            ? `💎 Pending redemption READY — run /claim to receive it.`
            : `⏳ Pending redemption: ${Number(o.redeem.pendingShares).toFixed(4)} shares — claimable ${
                o.redeem.redeemableAt
                  ? `at ${new Date(o.redeem.redeemableAt * 1000).toUTCString()}`
                  : `after the ~${o.redeem.cooldownHours.toFixed(0)}h cooldown`
              }.`
        );
      }
      lines.push(``, USAGE);
      await ctx.reply(lines.join("\n"));
    } catch {
      await ctx.reply(
        `🏦 fxSAVE\n\nCouldn't load your balance right now (RPC issue) — actions still work.\n\n${USAGE}`
      );
    }
    return;
  }

  const action = args[0]?.toLowerCase();

  if (action === "deposit") {
    const amount = parseAmount(args[1]);
    if (amount === null || amount === "all") {
      await ctx.reply(`Enter a numeric amount.\n\n${USAGE}`);
      return;
    }
    const token = args[2]?.toLowerCase() === "usdc" ? ("usdc" as const) : ("fxUSD" as const);
    const { text, keyboard } = buildSaveDepositPreview(token, amount);
    await ctx.reply(text, { reply_markup: keyboard });
    return;
  }

  if (action === "withdraw") {
    const amount = parseAmount(args[1]);
    if (amount === null) {
      await ctx.reply(`Enter a numeric amount or "all".\n\n${USAGE}`);
      return;
    }
    const instant = args.map((a) => a.toLowerCase()).includes("instant");
    const { text, keyboard } = buildSaveWithdrawPreview(amount, instant);
    await ctx.reply(text, { reply_markup: keyboard });
    return;
  }

  await ctx.reply(USAGE);
}
