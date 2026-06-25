/**
 * /mint — deposit collateral and mint (borrow) fxUSD against it, via the
 * official FxMintRouter. Live on-chain execution with signed confirm
 * (handlers/earnActions.ts). /borrow is an alias.
 */
import { Context } from "grammy";
import { prisma } from "@fxaeon/db";
import { MARKETS, type Market } from "@fxaeon/shared";
import { buildMintPreview } from "../handlers/earnActions.js";

const USAGE =
  `Usage: /mint <collateral amount> <fxUSD amount> [market]\n\n` +
  `Example: /mint 1 1500 wstETH — deposit 1 wstETH, mint 1500 fxUSD\n` +
  `Markets: ${MARKETS.join(", ")} (default wstETH)\n\n` +
  `Minting borrows fxUSD against your collateral — liquidation risk applies. ` +
  `Repay with /repay.`;

function resolveMarket(raw: string | undefined): Market | null {
  if (!raw) return "wstETH";
  const hit = (MARKETS as readonly string[]).find((m) => m.toLowerCase() === raw.toLowerCase());
  return (hit as Market) ?? null;
}

export async function mintCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
  if (args.length < 2) {
    await ctx.reply(USAGE);
    return;
  }

  const collateral = Number(args[0].replace(/,/g, ""));
  const fxUsd = Number(args[1].replace(/,/g, ""));
  const market = resolveMarket(args[2]);
  if (!Number.isFinite(collateral) || collateral <= 0 || !Number.isFinite(fxUsd) || fxUsd <= 0 || !market) {
    await ctx.reply(USAGE);
    return;
  }

  const { text, keyboard } = buildMintPreview(market, collateral, fxUsd);
  await ctx.reply(text, { reply_markup: keyboard });
}
