import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { botLogger } from "../middleware/logger.js";
import { parseReferralPayload } from "../core/onboarding.js";
import { describeFunding, getFundingState } from "../core/funding.js";
import { looksLikeTradeIntent, verifyTradeIntent } from "../core/tradeIntent.js";
import { buildPreview } from "../handlers/tradeActions.js";
import { MARKETS, RISK_PARAMS } from "@fxbot/shared";

/**
 * Render a trade preview from a /start deep link. Returns true when the
 * payload was consumed (even if invalid — we reply honestly instead of
 * falling through to the welcome message).
 */
async function handleTradeDeepLink(
  ctx: Context,
  user: { slippageBps: number; mevProtection: string },
  payload: string
): Promise<boolean> {
  let intent: { market: (typeof MARKETS)[number]; side: "long" | "short"; leverage: number; amount: number };

  if (looksLikeTradeIntent(payload)) {
    const verdict = verifyTradeIntent(payload);
    if (!verdict.ok) {
      await ctx.reply(
        verdict.reason === "expired"
          ? `⌛ This trade link expired (10 min limit). Ask for a fresh one or use /trade.`
          : `❌ This trade link is invalid. Use /trade to set up a position.`
      );
      return true;
    }
    intent = verdict.intent;
  } else {
    // tq_<marketIdx>_<l|s>_<leverage*10>_<amount*1e6> — untrusted Mini App
    // params, validated exactly like typed /trade arguments.
    const m = /^tq_(\d+)_(l|s)_(\d+)_(\d+)$/.exec(payload);
    if (!m) return false;
    const market = MARKETS[Number(m[1])];
    const side = m[2] === "l" ? "long" : "short";
    const leverage = Number(m[3]) / 10;
    const amount = Number(m[4]) / 1e6;
    const maxLev = side === "long" ? RISK_PARAMS.MAX_LEVERAGE_LONG : RISK_PARAMS.MAX_LEVERAGE_SHORT;
    if (!market || leverage < RISK_PARAMS.MIN_LEVERAGE || leverage > maxLev || !(amount > 0)) {
      await ctx.reply(`❌ Invalid trade parameters in that link. Use /trade to set up a position.`);
      return true;
    }
    intent = { market, side, leverage, amount };
  }

  const { text, keyboard } = buildPreview(intent, user, ctx.me?.username ?? "FxAeonBot");
  await ctx.reply(text, { reply_markup: keyboard });
  return true;
}

export async function startCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const referralCode = parseReferralPayload(ctx.message?.text);
    const user = await prisma.user.findUnique({ where: { telegramId } });

    // ── W-17: trade deep links ──────────────────────────────────────────────
    // `t1_*` = signed short-TTL intent ("Share setup" links); `tq_*` = unsigned
    // params from the Mini App MainButton — re-validated and re-signed here.
    // Both only render a PREVIEW; execution requires the inline Confirm tap.
    const startPayload = ctx.message?.text?.split(" ")[1];
    if (user && startPayload && (startPayload.startsWith("t1_") || startPayload.startsWith("tq_"))) {
      const handled = await handleTradeDeepLink(ctx, user, startPayload);
      if (handled) return;
    }

    if (!user) {
      // ── New user onboarding (W-16) ──────────────────────────────────────
      // The Create-Wallet button MUST be a reply-keyboard web_app button:
      // Telegram only delivers WebApp.sendData() for keyboard-launched apps.
      const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
      const loginUrl = referralCode
        ? `${miniAppUrl}/login?ref=${encodeURIComponent(referralCode)}`
        : `${miniAppUrl}/login`;

      await ctx.reply(
        `🚀 Welcome to fxBot\n\n` +
          `The most advanced interface for f(x) Protocol — leveraged positions, ` +
          `limit orders, and yield automation, all from Telegram.\n\n` +
          `🔐 Non-custodial — your wallet is policy-locked to f(x) contracts only\n` +
          `⚡ Simulation-gated — nothing broadcasts unless it simulates clean\n` +
          `🤖 Honest by design — no fake numbers, ever\n\n` +
          (referralCode ? `🎁 Referral code detected: ${referralCode}\n\n` : "") +
          `👇 Tap the button below to create your wallet.`,
        {
          reply_markup: {
            keyboard: [[{ text: "🔐 Create Wallet", web_app: { url: loginUrl } }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );

      botLogger.info(
        { telegramId, referredBy: referralCode },
        "onboarding started"
      );
      return;
    }

    // ── Returning user ─────────────────────────────────────────────────────
    const walletShort = `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`;
    const positionCount = await prisma.position.count({ where: { userId: user.id } });

    let welcomeMsg = `👋 Welcome back to fxBot!\n\nWallet: ${walletShort}\n`;

    if (positionCount > 0) {
      welcomeMsg += `\n📊 You have ${positionCount} active position${positionCount > 1 ? "s" : ""}.\n\n`;
      welcomeMsg += `Quick actions: /trade /portfolio /settings`;
    } else {
      // Funded-address empty states (W-16): balance-aware, fail-soft.
      const funding = await getFundingState(user.walletAddress as `0x${string}`);
      const fundingLine = describeFunding(funding);
      if (fundingLine) {
        welcomeMsg += fundingLine;
      } else {
        welcomeMsg += `\nNo active positions yet.\n\nGet started: /trade /portfolio /help`;
      }
    }

    await ctx.reply(welcomeMsg, { reply_markup: { remove_keyboard: true } });
  } catch (error) {
    botLogger.error({ err: error }, "startCommand error");
    await ctx.reply(
      `❌ Oops, something went wrong\n\nPlease try again in a moment. If the issue persists, contact support.`
    );
  }
}

export default startCommand;
