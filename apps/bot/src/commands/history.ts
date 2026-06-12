/**
 * /history — REAL transaction history from the executor's TxRecord table
 * (every on-chain action the bot has broadcast for this user).
 */
import { Context } from "grammy";
import { prisma } from "@fxbot/db";

const TYPE_LABELS: Record<string, string> = {
  open_long: "📈 Open long",
  open_short: "📉 Open short",
  close: "🔒 Close position",
  fxsave_deposit: "🏦 fxSAVE deposit",
  fxsave_withdraw: "🔓 fxSAVE withdraw",
  fxsave_claim: "💎 fxSAVE claim",
  mint: "🏛 Mint fxUSD",
  repay: "💸 Repay debt",
};

const STATUS_EMOJI: Record<string, string> = {
  confirmed: "✅",
  reverted: "❌",
  failed: "❌",
  broadcast: "📤",
  broadcasting: "📤",
  simulated: "🧪",
  prepared: "⏳",
};

export async function historyCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const records = await prisma.txRecord.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (records.length === 0) {
    await ctx.reply(
      `📜 History\n\nNo on-chain actions yet.\n\nStart with /trade, /save or /mint — every broadcast lands here.`
    );
    return;
  }

  const lines = [`📜 Your last ${records.length} on-chain action(s):`, ``];
  for (const r of records) {
    const label = TYPE_LABELS[r.type] ?? r.type;
    const emoji = STATUS_EMOJI[r.status] ?? "•";
    const date = r.createdAt.toISOString().slice(0, 16).replace("T", " ");
    lines.push(`${emoji} ${label} — ${r.status} · ${date} UTC`);
    if (r.hash) lines.push(`   https://etherscan.io/tx/${r.hash}`);
  }
  await ctx.reply(lines.join("\n"), { link_preview_options: { is_disabled: true } });
}
