/**
 * /repay — repay fxUSD debt on a long/borrowing position via the official
 * FxMintRouter. Lists your real on-chain positions with debt; execution goes
 * through the signed-confirm flow (handlers/earnActions.ts).
 */
import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { formatUnits } from "viem";
import { MARKETS, type Market } from "@fxbot/shared";
import { createFxSdk, getPositions } from "../fx/index.js";
import { buildRepayPreview } from "../handlers/earnActions.js";

const USAGE =
  `Usage: /repay <market> <position id> <amount|all>\n\n` +
  `Example: /repay wstETH 123 all\n` +
  `Run /repay with no arguments to list your positions with debt.`;

export async function repayCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];

  // No args: list debt positions across markets.
  if (args.length === 0) {
    try {
      const sdk = createFxSdk();
      const all = await Promise.all(
        MARKETS.map(async (m) => ({
          market: m as Market,
          positions: (await getPositions(sdk, user.walletAddress, m as Market, "long")).filter(
            (p) => p.rawDebts > 0n
          ),
        }))
      );
      const lines: string[] = [`💸 Repay — your positions with fxUSD debt:`, ``];
      let count = 0;
      for (const { market, positions } of all) {
        for (const p of positions) {
          count++;
          lines.push(
            `• ${market} #${p.positionId} — debt ${Number(formatUnits(p.rawDebts, p.rawDebtsDecimals)).toFixed(2)} fxUSD, ` +
              `collateral ${Number(formatUnits(p.rawColls, p.rawCollsDecimals)).toFixed(4)} ${market}`
          );
        }
      }
      if (count === 0) {
        await ctx.reply(`💸 Repay\n\nNo outstanding fxUSD debt found on your positions. Mint with /mint.`);
        return;
      }
      lines.push(``, USAGE);
      await ctx.reply(lines.join("\n"));
    } catch {
      await ctx.reply(`💸 Repay\n\n❌ Couldn't load your positions right now (RPC issue).\n\n${USAGE}`);
    }
    return;
  }

  if (args.length < 3) {
    await ctx.reply(USAGE);
    return;
  }

  const market = (MARKETS as readonly string[]).find(
    (m) => m.toLowerCase() === args[0].toLowerCase()
  ) as Market | undefined;
  const positionId = Number(args[1]);
  const amountRaw = args[2].toLowerCase();
  const amount: number | "all" | null =
    amountRaw === "all"
      ? "all"
      : Number.isFinite(Number(amountRaw.replace(/,/g, ""))) && Number(amountRaw.replace(/,/g, "")) > 0
        ? Number(amountRaw.replace(/,/g, ""))
        : null;

  if (!market || !Number.isInteger(positionId) || positionId <= 0 || amount === null) {
    await ctx.reply(USAGE);
    return;
  }

  const { text, keyboard } = buildRepayPreview(market, positionId, amount);
  await ctx.reply(text, { reply_markup: keyboard });
}
