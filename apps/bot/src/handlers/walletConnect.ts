/**
 * Mini App → bot wallet-connect handler (W-16).
 *
 * Receives `message:web_app_data` sent by the Mini App login page via
 * `Telegram.WebApp.sendData()`. The payload is user-controlled, so it is
 * validated strictly and used ONLY as a trigger — the actual Privy user and
 * the policy-guarded wallet are resolved server-side from the authenticated
 * `ctx.from.id` (see core/onboarding.ts).
 *
 * Note: `sendData` only works for Mini Apps launched from a reply-keyboard
 * `web_app` button (Telegram platform constraint) — which is exactly what
 * /start shows to new users.
 */
import { Context } from "grammy";
import { z } from "zod";
import { onboardUser } from "../core/onboarding.js";
import { describeFunding, getFundingState } from "../core/funding.js";
import { botLogger } from "../middleware/logger.js";

const walletConnectedSchema = z.object({
  type: z.literal("wallet_connected"),
  // Display-only / untrusted; never used to create or link anything.
  address: z.string().optional(),
  privyUserId: z.string().optional(),
  referral: z.string().regex(/^[A-Za-z0-9]{4,16}$/).nullish(),
});

export async function handleWebAppData(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  const raw = ctx.message?.web_app_data?.data;
  if (!telegramId || !raw) return;

  let payload: z.infer<typeof walletConnectedSchema>;
  try {
    payload = walletConnectedSchema.parse(JSON.parse(raw));
  } catch {
    botLogger.warn({ telegramId }, "ignoring malformed web_app_data payload");
    return;
  }

  try {
    const result = await onboardUser(
      telegramId,
      payload.referral?.toUpperCase() ?? undefined
    );
    const addr = result.user.walletAddress;
    const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;

    if (result.status === "existing") {
      await ctx.reply(
        `✅ You're already set up.\n\nWallet: ${short}\n\nTry /portfolio or /trade.`,
        { reply_markup: { remove_keyboard: true } }
      );
      return;
    }

    const funding = await getFundingState(addr as `0x${string}`);
    await ctx.reply(
      `🎉 Wallet created!\n\n` +
        `Address: ${addr}\n\n` +
        `🔐 Your wallet is protected by a default-deny policy — it can ONLY ` +
        `interact with verified f(x) Protocol contracts. Nothing else, ever.` +
        (result.referrerCode ? `\n\n🎁 Referral applied: ${result.referrerCode}` : "") +
        describeFunding(funding),
      { reply_markup: { remove_keyboard: true } }
    );
  } catch (e) {
    botLogger.error({ err: e, telegramId }, "onboarding failed");
    await ctx.reply(
      `❌ Wallet creation failed.\n\n` +
        `Nothing was created and no funds are involved. Please try /start again ` +
        `in a moment — if this keeps happening, the wallet service may be down.`,
      { reply_markup: { remove_keyboard: true } }
    );
  }
}
