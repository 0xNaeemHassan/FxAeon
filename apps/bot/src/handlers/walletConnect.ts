/**
 * Mini App → bot wallet-connect handler.
 *
 * Receives `message:web_app_data` sent by the Mini App login page via
 * `Telegram.WebApp.sendData()`. The payload is user-controlled, so it is
 * validated strictly and used ONLY as a trigger — the actual Privy user and
 * THEIR self-custodial wallet are resolved server-side from the authenticated
 * `ctx.from.id` (see core/onboarding.ts). The wallet itself was created or
 * imported BY THE USER in the Mini App; the server only links it.
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

    if (result.status === "no_wallet") {
      // The signal fired before wallet setup finished (or the user closed the
      // app mid-flow). Honest state, no DB row was written.
      await ctx.reply(
        `⏳ Almost there — your wallet isn't finished yet.\n\n` +
          `Open the app again and complete wallet setup (create a new wallet ` +
          `or import an existing one). Your keys stay with you either way.`,
        { reply_markup: { remove_keyboard: true } }
      );
      return;
    }

    const addr = result.user.walletAddress;
    const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;

    const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
    // Inline web_app launches DO get signed initData, so these buttons open
    // the Mini App with full authenticated state (real wallet + balances).
    const nextSteps = {
      inline_keyboard: [
        [
          { text: "📊 Portfolio", web_app: { url: `${miniAppUrl}/portfolio` } },
          { text: "💰 Deposit", web_app: { url: `${miniAppUrl}/qr?address=${addr}` } },
        ],
        [{ text: "⚡ Set up a trade", web_app: { url: `${miniAppUrl}/trade` } }],
      ],
    };

    if (result.status === "existing") {
      // Clear the stale wallet-setup reply keyboard, then show next steps.
      await ctx.reply(`✅ You're already set up.\n\nWallet: ${short}`, {
        reply_markup: { remove_keyboard: true },
      });
      await ctx.reply(`What's next?`, { reply_markup: nextSteps });
      return;
    }

    const tradingLine = result.user.walletDelegated
      ? `⚡ Bot trading is ON — you can trade right here in chat. Revoke any time in the app (Settings → Wallet).`
      : `💤 Bot trading is OFF — enable it in the app (Settings → Wallet) to trade from chat. The Mini App works either way.`;

    const funding = await getFundingState(addr as `0x${string}`);
    await ctx.reply(
      `🎉 Wallet ${result.user.walletImported ? "imported" : "created"} — and it's YOURS.\n\n` +
        `Address: ${addr}\n\n` +
        `🔐 Self-custody via Privy: keys live in a secure enclave, only you can ` +
        `export them, and nothing moves without your say-so.\n` +
        tradingLine +
        (result.referrerCode ? `\n\n🎁 Referral applied: ${result.referrerCode}` : "") +
        describeFunding(funding),
      { reply_markup: { remove_keyboard: true } }
    );
    await ctx.reply(`What's next?`, { reply_markup: nextSteps });
  } catch (e) {
    botLogger.error({ err: e, telegramId }, "onboarding failed");
    await ctx.reply(
      `❌ Wallet linking failed.\n\n` +
        `Nothing was changed and no funds are involved. Please try /start again ` +
        `in a moment — if this keeps happening, the wallet service may be down.`,
      { reply_markup: { remove_keyboard: true } }
    );
  }
}
