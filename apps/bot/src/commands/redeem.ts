/**
 * /redeem — redeem fxSAVE back to fxUSD. Same flow as /save withdraw:
 * 2-step (no fee, cooldown then /claim) or instant (fee + slippage).
 * Live on-chain execution via signed confirm (handlers/earnActions.ts).
 */
import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { buildSaveWithdrawPreview } from "../handlers/earnActions.js";

export async function redeemCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = (ctx.message?.text?.split(/\s+/).slice(1) ?? []).map((a) => a.toLowerCase());
  const instant = args.includes("instant");
  const amountRaw = args.find((a) => a !== "instant");

  let amount: number | "all" = "all";
  if (amountRaw && amountRaw !== "all") {
    const n = Number(amountRaw.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      await ctx.reply(
        `Usage: /redeem <amount|all> [instant]\n\n` +
          `Redeems fxSAVE shares back to fxUSD.\n` +
          `Default: 2-step (no fee — request now, /claim after the cooldown).\n` +
          `Add "instant" for immediate redemption (small fee + slippage).`
      );
      return;
    }
    amount = n;
  }

  const { text, keyboard } = buildSaveWithdrawPreview(amount, instant);
  await ctx.reply(text, { reply_markup: keyboard });
}
