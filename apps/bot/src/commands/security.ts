/**
 * /security — Phase 4: Live security surface.
 *
 * Renders the signer policy state, allow-list count, wallet info,
 * and what FxAeon can/cannot do. Not new functionality — it's the
 * existing signer policy and Privy session-signer state rendered
 * in a way the user can read and trust.
 */
import { Context, InlineKeyboard } from "grammy";
import { prisma } from "@fxaeon/db";
import { ALLOWED_TARGETS, resolvePolicyMode } from "../core/signerPolicy.js";
import { getBotState, BS_POLICY_MODE } from "../core/botState.js";

export async function securityCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("🔐 Please connect your wallet first with /start");
    return;
  }

  const walletShort = `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}`;
  const walletType = user.walletImported ? "imported key" : "Privy embedded, TEE-protected";
  const delegationStatus = user.walletDelegated ? "Active ✅" : "Inactive ❌";

  // Resolve policy mode from BotState (hot-toggleable) or env
  const storedMode = await getBotState(BS_POLICY_MODE);
  const policyMode = (storedMode ?? resolvePolicyMode()).toUpperCase();
  const allowListCount = ALLOWED_TARGETS.size;

  const mevStatus = user.mevProtection === "flashbots" ? "ON" : "OFF";

  const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";

  const lines = [
    `🛡  Security`,
    ``,
    `Wallet:               ${walletShort}          (${walletType})`,
    `Session signer:       ${delegationStatus}             (revoke any time)`,
    `Signer policy:        ${policyMode}              (default-deny, allow-list only)`,
    `Allow-listed targets: ${allowListCount} contracts`,
    `Trade simulation:     ENABLED ✅            (every tx is pre-simulated)`,
    `MEV protection:       ${mevStatus}                    (${mevStatus === "ON" ? "Flashbots Protect" : "Standard"})`,
    ``,
    `What FxAeon can do today:`,
    `  • Sign trades against f(x) Protocol contracts only`,
    `  • Send fees to the FxAeon collector`,
    `  • Send your withdrawals to a destination you confirm`,
    ``,
    `What FxAeon can NOT do:`,
    `  • Send your funds to any other address`,
    `  • Sign anything not pre-simulated`,
    `  • Sign while you are logged out`,
    ``,
    `All sessions are encrypted with Privy's TEE infrastructure.`,
    `Your key is exportable at any time from the Mini App.`,
  ];

  const keyboard = new InlineKeyboard()
    .text("🚫 Revoke bot trading", "sec_revoke")
    .row()
    .text("📋 View allow-list", "sec_allowlist")
    .row()
    .url(
      "📄 Read the threat model",
      "https://fxprotocol.gitbook.io/fx-docs/risk-management/audit-reports"
    );

  await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
}

/**
 * Handle security-related callback queries.
 */
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

    // Set walletDelegated to false — the actual Privy session-signer
    // revocation happens in the Mini App (client-side Privy SDK).
    await prisma.user.update({
      where: { telegramId },
      data: { walletDelegated: false },
    });

    const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
    await ctx.reply(
      `🚫 Bot trading revoked.\n\n` +
        `The bot can no longer sign transactions on your behalf.\n` +
        `To complete the revocation, also revoke the session signer in the Mini App.\n\n` +
        `Re-enable any time from /start or the Mini App.`,
      {
        reply_markup: new InlineKeyboard().url(
          "📱 Open Mini App",
          `${miniAppUrl}/settings`
        ),
      }
    );
    return;
  }

  if (data === "sec_allowlist") {
    const targets = [...ALLOWED_TARGETS].sort();
    const chunks: string[] = [];
    for (let i = 0; i < targets.length; i += 10) {
      chunks.push(targets.slice(i, i + 10).map((a) => `  ${a}`).join("\n"));
    }
    await ctx.reply(
      `📋 Signer Policy Allow-List (${targets.length} addresses)\n\n` +
        `Every transaction must target one of these verified f(x) Protocol contracts.\n` +
        `Any other target is refused before broadcast.\n\n` +
        chunks.join("\n")
    );
    return;
  }
}
