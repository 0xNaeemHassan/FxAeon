/**
 * /bridge — REAL cross-chain bridge quotes (fx-sdk LayerZero V2 OFT).
 *
 * Ethereum → Base for fxUSD / fxSAVE. The preview shows a live on-chain
 * LayerZero quote (no fabricated numbers); broadcast is gated behind the
 * BRIDGE_EXECUTION_ENABLED operator flag (see handlers/earnActions.ts).
 */
import { Context } from "grammy";
import { prisma } from "@fxaeon/db";
import { parseUnits } from "viem";
import { createFxSdk } from "../fx/index.js";
import { quoteBridgeFee, BRIDGE_TOKEN_DECIMALS, type BridgeToken } from "../fx/earn.js";
import { buildBridgePreview } from "../handlers/earnActions.js";
import { botLogger } from "../middleware/logger.js";

const USAGE =
  `Usage: /bridge <from> <to> <amount> <token>\n\n` +
  `Example: /bridge ETH Base 100 fxUSD\n\n` +
  `Bridges fxUSD or fxSAVE from Ethereum to Base via LayerZero.\n` +
  `(Base → Ethereum isn't live yet — it must be signed on Base.)`;

function normToken(raw: string | undefined): BridgeToken | null {
  const t = (raw ?? "").toLowerCase();
  if (t === "fxusd") return "fxUSD";
  if (t === "fxsave") return "fxSAVE";
  return null;
}

function isEthereum(s: string): boolean {
  const v = s.toLowerCase();
  return v === "eth" || v === "ethereum" || v === "mainnet";
}
function isBase(s: string): boolean {
  return s.toLowerCase() === "base";
}

export async function bridgeCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
  if (args.length < 4) {
    await ctx.reply(USAGE);
    return;
  }

  const [from, to, amountRaw, tokenRaw] = args;
  const token = normToken(tokenRaw);
  const amount = Number((amountRaw ?? "").replace(/,/g, ""));

  if (!isEthereum(from) || !isBase(to)) {
    await ctx.reply(
      `Only Ethereum → Base is supported today.\n\n${USAGE}`
    );
    return;
  }
  if (!token) {
    await ctx.reply(`Token must be fxUSD or fxSAVE.\n\n${USAGE}`);
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply(`Enter a positive amount.\n\n${USAGE}`);
    return;
  }

  try {
    const sdk = createFxSdk();
    const quote = await quoteBridgeFee({
      sdk,
      token,
      amountWei: parseUnits(String(amount), BRIDGE_TOKEN_DECIMALS),
      recipient: user.walletAddress,
    });
    const { text, keyboard } = buildBridgePreview({
      token,
      amount,
      nativeFeeWei: quote.nativeFeeWei,
    });
    await ctx.reply(text, keyboard ? { reply_markup: keyboard } : undefined);
  } catch (error) {
    botLogger.error({ error: String(error) }, "bridge: quote failed");
    const msg = error instanceof Error ? error.message : "couldn't fetch a quote right now";
    await ctx.reply(`🌉 Bridge\n\n❌ ${msg}\n\n${USAGE}`);
  }
}
