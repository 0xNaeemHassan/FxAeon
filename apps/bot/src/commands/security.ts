import { Context } from "grammy";
import { prisma } from "@fxaeon/db";

export async function securityCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  await ctx.reply(
    `🔒 *Security Center*\n\n` +
    `Wallet: \`${user.walletAddress}\`\n` +
    `Auth: Telegram + Privy TEE\n\n` +
    `*Audits:*\n` +
    `• Trail of Bits (Apr 2024, Jul 2024)\n` +
    `• OpenZeppelin (Aug 2025)\n` +
    `• Secbit (Oct 2025)\n\n` +
    `*Self-custody:*\n` +
    `• Your wallet, your keys — created or imported by YOU, exportable any time (Mini App → Settings)\n` +
    `• Bot trading = a revocable session-signer grant; the bot can't sign without it\n` +
    `• Simulation-gated execution: nothing broadcasts unless it simulates clean\n\n` +
    `[View full audit reports](https://fxprotocol.gitbook.io/fx-docs/risk-management/audit-reports)\n\n` +
    `Export your data: /security export`,
    { parse_mode: "Markdown" }
  );
}
