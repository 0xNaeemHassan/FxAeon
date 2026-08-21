import { Context, InlineKeyboard } from "grammy";
import { prisma } from "@fxaeon/db";
import { ALLOWED_TARGETS, resolvePolicyMode } from "../core/signerPolicy.js";

/** Show the policy the executor actually enforces; no stale BotState claims. */
export async function securityCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("🔐 Please connect your wallet first with /start");
    return;
  }

  const walletShort = `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}`;
  const walletType = user.walletImported ? "imported key" : "Privy embedded wallet";
  const delegationStatus = user.walletDelegated ? "Active ✅" : "Inactive ❌";
  const policyMode = resolvePolicyMode().toUpperCase();
  const mevStatus = user.mevProtection === "flashbots" ? "ON" : "OFF";

  const lines = [
    "🛡 Security",
    "",
    `Wallet: ${walletShort} (${walletType})`,
    `Delegated signer: ${delegationStatus} (revoke any time)`,
    `Signer policy: ${policyMode} (default-deny)`,
    `Allow-listed Ethereum targets: ${ALLOWED_TARGETS.size}`,
    "Route simulation: REQUIRED ✅",
    `Ethereum MEV protection: ${mevStatus}`,
    "",
    "What FxAeon can do:",
    "  • Sign only server-built f(x) routes you confirm",
    "  • Simulate each route before broadcasting it",
    "  • Send withdrawals only to a destination you explicitly confirm",
    "",
    "What FxAeon cannot do:",
    "  • Target contracts outside the chain-scoped allow-list",
    "  • Sign anything that fails or skips simulation",
    "  • Sign after you revoke the delegated signer",
    "",
    "Logging out is not the same as revoking bot trading.",
    "Revoke below whenever you want to stop server execution.",
    "Your embedded wallet key remains exportable through Privy in the Mini App.",
  ];

  const keyboard = new InlineKeyboard()
    .text("🚫 Revoke bot trading", "sec_revoke")
    .row()
    .text("📋 View allow-list", "sec_allowlist")
    .row()
    .url("📄 f(x) audit reports", "https://fxprotocol.gitbook.io/fx-docs/risk-management/audit-reports");

  await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
}

export async function handleSecurityCallback(ctx: Context) {
  const data = ctx.callbackQuery?.data ?? "";
  const telegramId = ctx.from?.id.toString();
  await ctx.answerCallbackQuery().catch(() => {});
  if (!telegramId) return;

  if (data === "sec_revoke") {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) return;
    if (!user.walletDelegated) {
      await ctx.reply("Bot trading is already inactive. Nothing to revoke.");
      return;
    }
    // Local state fails closed immediately. The user must also remove the
    // Privy key quorum in Settings; walletSync mirrors the remote grant.
    await prisma.user.update({
      where: { telegramId },
      data: { walletDelegated: false },
    });
    await ctx.reply(
      "✅ FxAeon execution is disabled locally. Open Settings → Wallet and remove the Privy signer grant to revoke it at the wallet layer too."
    );
    return;
  }

  if (data === "sec_allowlist") {
    const labels = Object.entries((await import("@fxaeon/shared")).ADDRESSES)
      .filter(([, address]) => ALLOWED_TARGETS.has(address.toLowerCase()))
      .map(([label, address]) => `• ${label}: ${address}`);
    await ctx.reply(
      `📋 Ethereum signer allow-list (${labels.length})\n\n${labels.join("\n")}\n\nBase bridge targets are enforced by a separate chain-scoped allow-list.`,
      { link_preview_options: { is_disabled: true } }
    );
  }
}
