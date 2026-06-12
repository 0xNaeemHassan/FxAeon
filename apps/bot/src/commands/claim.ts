/**
 * /claim — claim a matured fxSAVE 2-step redemption. Shows real cooldown
 * state; when ready, a signed confirm executes on-chain
 * (handlers/earnActions.ts). Other reward types are not live and say so.
 */
import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { createFxSdk } from "../fx/index.js";
import { getSaveClaimable } from "../fx/earn.js";
import { buildClaimPreview } from "../handlers/earnActions.js";

export async function claimCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  try {
    const sdk = createFxSdk();
    const status = await getSaveClaimable(sdk, user.walletAddress);

    if (!status.hasPendingRedeem) {
      await ctx.reply(
        `💎 Claim\n\n` +
          `Nothing to claim — you have no pending fxSAVE redemption.\n\n` +
          `Start one with /redeem (2-step, no fee). ` +
          `Gauge/referral reward claiming isn't live yet.`
      );
      return;
    }

    if (!status.isCooldownComplete) {
      const when = status.redeemableAt
        ? new Date(status.redeemableAt * 1000).toUTCString()
        : "after the cooldown";
      await ctx.reply(
        `💎 Claim\n\n` +
          `⏳ Your redemption of ${Number(status.pendingShares).toFixed(4)} fxSAVE shares is still cooling down.\n` +
          `Claimable: ${when}\n\nRun /claim again once it's ready.`
      );
      return;
    }

    const { text, keyboard } = buildClaimPreview(status);
    await ctx.reply(text, { reply_markup: keyboard });
  } catch {
    await ctx.reply(
      `💎 Claim\n\n❌ Couldn't check your redemption status right now (RPC issue). Please try again.`
    );
  }
}
