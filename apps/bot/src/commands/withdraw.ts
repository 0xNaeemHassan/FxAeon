/**
 * /withdraw — intentionally NOT live, and honest about why.
 *
 * The bot's Privy wallet policy is default-deny: it only allows transactions
 * to the audited f(x) Protocol contracts. Privy policy conditions can match
 * the tx `to`/`value` and decoded calldata fields, but cannot express
 * "ERC20 transfer to addresses the user chose" without allowing transfers to
 * ANY address — which would let a compromised bot drain every wallet.
 * Withdrawals to arbitrary addresses therefore stay off until a safe design
 * (e.g. per-user allow-listed withdrawal addresses) ships.
 */
import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function withdrawCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }
  await ctx.reply(
    `📤 Withdraw\n\n` +
      `Withdrawals to external addresses are not enabled yet — and that's deliberate.\n\n` +
      `Your wallet is protected by a default-deny security policy that only ` +
      `allows transactions to the official f(x) Protocol contracts. Arbitrary ` +
      `transfers would weaken that protection, so they stay off until a safe ` +
      `design (pre-approved withdrawal addresses) ships.\n\n` +
      `Your funds and your keys: the wallet is yours via Privy — you can export ` +
      `it from the mini-app settings at any time.\n\n` +
      `Live today: /trade · /save · /mint · /repay · /redeem · /claim · /limit`
  );
}
