/**
 * Mini App data API — the authenticated bridge that makes the Mini App show
 * REAL state instead of placeholders.
 *
 * Auth: Telegram WebApp `initData` (HMAC-SHA256 per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 * sent as `Authorization: tma <initData>`. The Telegram user id extracted from
 * a valid signature is unforgeable — same trust level as a webhook update.
 *
 * Launch-context note (the root of the old broken UX): keyboard-button
 * launches get EMPTY initData (and are the only ones where sendData works);
 * inline-button / menu-button / direct-link launches get signed initData (and
 * sendData does NOT work). This API serves the second group; sendData serves
 * the first. Together every launch path has a working bot⇄app channel.
 */
import { createHmac } from "node:crypto";
import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@fxbot/db";
import { onboardUser } from "../core/onboarding.js";
import { getFundingState } from "../core/funding.js";
import { botLogger } from "../middleware/logger.js";

/** Max age of initData before we reject it (replay window). */
const MAX_INITDATA_AGE_SECONDS = 6 * 60 * 60;

export interface VerifiedInitData {
  telegramId: string;
  firstName?: string;
  username?: string;
  startParam?: string;
  authDate: number;
}

/**
 * Validate Telegram WebApp initData. Returns the verified user or null.
 * Constant-time hash comparison is unnecessary here (the hash is not a
 * secret), but we still compare full strings.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): VerifiedInitData | null {
  if (!initData || initData.length > 4096) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  if (expected !== hash) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return null;
  if (nowSeconds - authDate > MAX_INITDATA_AGE_SECONDS) return null;
  if (authDate - nowSeconds > 300) return null; // clock skew guard

  let user: { id?: number; first_name?: string; username?: string };
  try {
    user = JSON.parse(params.get("user") ?? "{}");
  } catch {
    return null;
  }
  if (!user.id) return null;

  return {
    telegramId: String(user.id),
    firstName: user.first_name,
    username: user.username,
    startParam: params.get("start_param") ?? undefined,
    authDate,
  };
}

// ---------------------------------------------------------------------------
// Router (initialized with deps so it can message the chat — same pattern as
// admin-alerts: no circular import on main.ts).
// ---------------------------------------------------------------------------

export interface MiniAppApiDeps {
  botToken: string;
  /** bot.api.sendMessage — used to confirm onboarding in the chat. */
  sendMessage: (
    chatId: string,
    text: string,
    opts?: Record<string, unknown>
  ) => Promise<unknown>;
  miniAppUrl: string;
}

interface AuthedRequest extends Request {
  tgUser?: VerifiedInitData;
}

export function createMiniAppRouter(deps: MiniAppApiDeps): Router {
  const router = Router();

  // -- auth middleware ------------------------------------------------------
  router.use((req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const m = /^tma (.+)$/i.exec(header);
    const verified = m ? verifyInitData(m[1], deps.botToken) : null;
    if (!verified) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid or missing Telegram initData" } });
      return;
    }
    req.tgUser = verified;
    next();
  });

  // -- GET /me: the single source of truth for the Mini App ---------------
  router.get("/me", async (req: AuthedRequest, res: Response) => {
    const telegramId = req.tgUser!.telegramId;
    try {
      const user = await prisma.user.findUnique({
        where: { telegramId },
        include: { positions: true },
      });
      if (!user) {
        res.json({ onboarded: false });
        return;
      }
      // Live on-chain balances; fail-soft ({known:false}) on RPC trouble.
      const funding = await getFundingState(user.walletAddress as `0x${string}`);
      res.json({
        onboarded: true,
        walletAddress: user.walletAddress,
        referralCode: user.referralCode,
        language: user.language,
        slippageBps: user.slippageBps,
        mevProtection: user.mevProtection,
        funding,
        positions: user.positions.map((p) => ({
          tokenId: p.tokenId,
          market: p.market,
          side: p.side,
          collateral: p.collateral,
          debt: p.debt,
          leverage: p.leverage,
          healthPercent: p.healthPercent,
          liquidationPrice: p.liquidationPrice,
        })),
      });
    } catch (e) {
      botLogger.error({ err: e, telegramId }, "miniapp /me failed");
      res.status(500).json({ error: { code: "INTERNAL", message: "Failed to load account" } });
    }
  });

  // -- POST /onboard: wallet creation for initData launch contexts ---------
  router.post("/onboard", async (req: AuthedRequest, res: Response) => {
    const telegramId = req.tgUser!.telegramId;
    const referral =
      typeof req.body?.referral === "string" &&
      /^[A-Za-z0-9]{4,16}$/.test(req.body.referral)
        ? req.body.referral.toUpperCase()
        : undefined;
    try {
      const result = await onboardUser(telegramId, referral);
      const addr = result.user.walletAddress;
      const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;

      // Mirror the state change into the chat so the bot and Mini App always
      // tell the same story (and clear the old reply keyboard).
      if (result.status === "created") {
        await deps
          .sendMessage(
            telegramId,
            `🎉 Wallet created!\n\nAddress: ${addr}\n\n` +
              `🔐 Protected by a default-deny policy — it can ONLY interact ` +
              `with verified f(x) Protocol contracts.\n\nNext: fund it with /deposit, then /trade.`,
            {
              reply_markup: {
                remove_keyboard: true,
              },
            }
          )
          .catch((e: unknown) =>
            botLogger.warn({ err: e, telegramId }, "onboard chat confirm failed (non-blocking)")
          );
      }

      res.json({
        onboarded: true,
        created: result.status === "created",
        walletAddress: addr,
        walletShort: short,
        referralApplied: result.referrerCode ?? null,
      });
    } catch (e) {
      botLogger.error({ err: e, telegramId }, "miniapp /onboard failed");
      res.status(500).json({ error: { code: "ONBOARD_FAILED", message: "Wallet creation failed — nothing was created. Try again in a moment." } });
    }
  });

  // -- POST /settings: language / slippage / MEV protection ----------------
  router.post("/settings", async (req: AuthedRequest, res: Response) => {
    const telegramId = req.tgUser!.telegramId;
    const body = req.body ?? {};
    const data: Record<string, unknown> = {};

    if (typeof body.language === "string" && /^[a-zA-Z-]{2,8}$/.test(body.language)) {
      data.language = body.language;
    }
    if (
      typeof body.slippageBps === "number" &&
      Number.isInteger(body.slippageBps) &&
      body.slippageBps >= 1 &&
      body.slippageBps <= 500
    ) {
      data.slippageBps = body.slippageBps;
    }
    if (body.mevProtection === "on" || body.mevProtection === "off") {
      data.mevProtection = body.mevProtection;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: { code: "NO_VALID_FIELDS", message: "Nothing valid to update" } });
      return;
    }

    try {
      const user = await prisma.user.update({ where: { telegramId }, data });
      res.json({
        ok: true,
        language: user.language,
        slippageBps: user.slippageBps,
        mevProtection: user.mevProtection,
      });
    } catch (e) {
      botLogger.error({ err: e, telegramId }, "miniapp /settings failed");
      res.status(500).json({ error: { code: "INTERNAL", message: "Failed to save settings" } });
    }
  });

  return router;
}
