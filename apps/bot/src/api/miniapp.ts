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
import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@fxaeon/db";
import { PROTOCOL_TOKENS, RISK_PARAMS } from "@fxaeon/shared";
import { formatUnits } from "viem";
import { onboardUser, syncWalletState } from "../core/onboarding.js";
import { getFundingState, isPositiveDecimalString } from "../core/funding.js";
import { getMarketOverview, getSpotPrices } from "../market/coingecko.js";
import { createFxSdk } from "../fx/index.js";
import { fetchOnChainPositions, type OnChainPosition } from "../core/portfolio.js";
import {
  getBridgeBalances,
  getSaveConfig,
  getSaveOverview,
  type BridgeChainId,
  type SaveOverview,
} from "../fx/earn.js";
import { trackPositions, computePnl, snapshotKey, type PnlEstimate } from "../core/pnl.js";
import {
  summarizePortfolio,
  valuePosition,
  valueSavings,
  type PortfolioSummary,
} from "../core/portfolioSummary.js";
import { botLogger } from "../middleware/logger.js";
import { SUPPORTED_LOCALES } from "../i18n/index.js";
import { features } from "../middleware/config.js";
import {
  buildMiniActionQuote,
  executeMiniAction,
  validateMiniActionBody,
} from "../core/miniappActions.js";

/** Opaque 32-byte base64url handle returned only after a successful quote. */
function validActionTicket(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}

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
 * The initData hash is an authentication tag. Compare decoded bytes in
 * constant time so this endpoint never becomes a remote HMAC timing oracle.
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
  if (!hash || !/^[0-9a-fA-F]{64}$/.test(hash)) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest();
  const supplied = Buffer.from(hash, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return null;
  if (nowSeconds - authDate > MAX_INITDATA_AGE_SECONDS) return null;
  if (authDate - nowSeconds > 300) return null; // clock skew guard

  let user: { id?: number; first_name?: string; username?: string };
  try {
    user = JSON.parse(params.get("user") ?? "{}");
  } catch {
    return null;
  }
  if (typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) return null;

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

export interface PendingSaveAssets {
  /** Exact claim-preview amount of fxUSD (18 decimals, formatted). */
  fxUsd: string;
  /** Exact claim-preview amount of USDC (6 decimals, formatted). */
  usdc: string;
}

/**
 * Price both assets returned by FxUSDBasePool.previewRedeem. A zero leg does
 * not require a price; a positive unpriced leg makes the whole value unknown.
 */
export function valuePendingSaveAssets(
  assets: PendingSaveAssets,
  prices: Record<string, number | null> | null
): number | null {
  if (!prices) return null;
  const legs: Array<[amount: string, priceKey: "FXUSD" | "USDC"]> = [
    [assets.fxUsd, "FXUSD"],
    [assets.usdc, "USDC"],
  ];
  let value = 0;
  for (const [amountText, priceKey] of legs) {
    if (!isPositiveDecimalString(amountText)) continue;
    const amount = Number(amountText);
    const price = prices[priceKey];
    if (!Number.isFinite(amount) || typeof price !== "number") return null;
    value += amount * price;
  }
  return value;
}

/**
 * Build the Mini App savings view from one coherent overview plus the optional
 * claim preview. Pending state is independent of the wallet's current shares.
 */
export function buildMiniSavingsSnapshot(
  overview: SaveOverview,
  pendingAssets: PendingSaveAssets | null,
  prices: Record<string, number | null> | null
): { savings: Record<string, unknown> | null; savingsUsd: number | null } {
  const activeSavingsUsd = valueSavings(overview.shares, overview.assets, prices);
  const pendingSavingsUsd = overview.redeem.hasPendingRedeem
    ? pendingAssets === null
      ? null
      : valuePendingSaveAssets(pendingAssets, prices)
    : 0;
  const savingsUsd = activeSavingsUsd === null || pendingSavingsUsd === null
    ? null
    : activeSavingsUsd + pendingSavingsUsd;
  const hasSavingsState = isPositiveDecimalString(overview.shares)
    || overview.redeem.hasPendingRedeem;

  return {
    savings: hasSavingsState
      ? {
          shares: overview.shares,
          assets: overview.assets,
          pendingAssets,
          valueUsd: savingsUsd,
          pendingRedeem: overview.redeem.hasPendingRedeem,
          redeemReady: overview.redeem.isCooldownComplete,
          pendingShares: overview.redeem.pendingShares,
          redeemableAt: overview.redeem.redeemableAt,
          cooldownHours: overview.redeem.cooldownHours,
        }
      : null,
    savingsUsd,
  };
}

export function createMiniAppRouter(deps: MiniAppApiDeps): Router {
  const router = Router();

  // -- auth middleware ------------------------------------------------------
  router.use((req: AuthedRequest, res: Response, next: NextFunction) => {
    // Wallet balances, positions, quote tickets and activity are private and
    // volatile. Never let a browser/proxy reuse one Telegram user's response
    // for another authorization header or after the on-chain state changed.
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.vary("Authorization");
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

  // -- GET /market: live market snapshot (same cached CoinGecko data as
  // /price — auth'd like everything else so it can't be scraped as a free
  // price proxy). 503 with no body fabrication when upstream + cache fail.
  router.get("/market", async (_req: AuthedRequest, res: Response) => {
    try {
      const overview = await getMarketOverview();
      res.json({
        fetchedAt: overview.fetchedAt.toISOString(),
        stale: overview.stale,
        rows: overview.rows,
      });
    } catch (err) {
      botLogger.error({ err }, "miniapp /market failed");
      res.status(503).json({ error: "market data unavailable" });
    }
  });

  // -- GET /protocol: live product configuration + canonical token support -
  // This is deliberately SDK-backed. The Mini App must never ship a made-up
  // APY, cooldown or fee, and token decimals must stay identical to the
  // server-side action validator.
  router.get("/protocol", async (_req: AuthedRequest, res: Response) => {
    try {
      const save = await getSaveConfig(createFxSdk());
      res.json({
        network: { name: "Ethereum", chainId: 1 },
        save,
        tokens: Object.values(PROTOCOL_TOKENS).map((token) => ({
          symbol: token.symbol,
          decimals: token.decimals,
          native: token.native,
          positionMarkets: token.positionMarkets,
        })),
      });
    } catch (err) {
      botLogger.error({ err }, "miniapp /protocol failed");
      res.status(503).json({
        error: { code: "PROTOCOL_UNAVAILABLE", message: "Live protocol configuration is unavailable." },
      });
    }
  });

  // -- GET /bridge-state: source-chain balances + operator availability ----
  // An unavailable RPC is represented as known:false, never as a fabricated
  // zero. The Move screen uses this before it lets a user review a bridge.
  router.get("/bridge-state", async (req: AuthedRequest, res: Response) => {
    const telegramId = req.tgUser!.telegramId;
    try {
      const user = await prisma.user.findUnique({ where: { telegramId } });
      if (!user) {
        res.status(404).json({
          error: { code: "NOT_ONBOARDED", message: "Finish wallet setup first." },
        });
        return;
      }
      const wallet = user.walletAddress as `0x${string}`;
      const read = async (chainId: BridgeChainId) => {
        try {
          return await getBridgeBalances(wallet, chainId);
        } catch (error) {
          botLogger.warn(
            { err: error, telegramId, chainId },
            "miniapp /bridge-state: chain balance read failed"
          );
          return {
            chainId,
            known: false as const,
            native: null,
            assets: { fxUSD: null, fxSAVE: null },
          };
        }
      };
      const [ethereum, base] = await Promise.all([read(1), read(8453)]);
      res.json({
        enabled: features.enableBridgeExecution,
        ethereum,
        base,
      });
    } catch (error) {
      botLogger.error({ err: error, telegramId }, "miniapp /bridge-state failed");
      res.status(500).json({
        error: { code: "BRIDGE_STATE_UNAVAILABLE", message: "Bridge state is unavailable." },
      });
    }
  });

  // -- GET /me: the single source of truth for the Mini App ---------------
  router.get("/me", async (req: AuthedRequest, res: Response) => {
    const telegramId = req.tgUser!.telegramId;
    try {
      const user = await prisma.user.findUnique({ where: { telegramId } });
      if (!user) {
        res.json({ onboarded: false });
        return;
      }
      // Live on-chain balances; fail-soft ({known:false}) on RPC trouble.
      const funding = await getFundingState(user.walletAddress as `0x${string}`);

      // One SDK + one live-price read, shared by the position and the
      // stability-pool (fxSAVE) valuations below. SDK creation is fail-soft
      // (it throws when RPC config is missing) so /me still returns the rest
      // of the account instead of 500ing.
      let sdk: ReturnType<typeof createFxSdk> | null = null;
      try {
        sdk = createFxSdk();
      } catch (e) {
        botLogger.warn({ err: e, telegramId }, "miniapp /me: SDK init failed");
      }
      let prices: Record<string, number | null> | null = null;
      try {
        const spot = await getSpotPrices();
        if (!spot.stale) prices = spot.prices;
      } catch { /* prices unavailable — omit USD/PnL fields */ }

      // Positions read on-chain (W-18: the chain is the source of truth —
      // the old prisma.position table was never written and always rendered
      // an empty portfolio). Fail-soft: positionsKnown=false on RPC trouble.
      let positionsKnown = true;
      let apiPositions: Array<Record<string, unknown>> = [];
      let positions: OnChainPosition[] = [];
      let pnls: Array<PnlEstimate | null> = [];
      try {
        if (!sdk) throw new Error("SDK unavailable");
        const read = await fetchOnChainPositions(sdk, user.walletAddress);
        positions = read.positions;
        positionsKnown = read.failures.length === 0;
        const snapshots = await trackPositions(user.id, positions, prices, read.failures);
        pnls = positions.map((p) => computePnl(p, snapshots.get(snapshotKey(p)), prices));
        apiPositions = positions.map((p, i) => {
          const pnl = pnls[i];
          const valuation = prices ? valuePosition(p, prices) : null;
          return {
            tokenId: String(p.positionId),
            market: p.market,
            side: p.side,
            collateral: String(p.collateral),
            collateralToken: p.collateralToken,
            debt: String(p.debt),
            debtToken: p.debtToken,
            leverage: p.leverage,
            // Health for display: 1 = healthy, 0 = at liquidation.
            healthPercent: Math.max(0, Math.min(1, 1 - p.health)),
            // Position size (collateral notional) in USD — null when unpriced.
            sizeUsd: valuation ? valuation.collateralUsd : null,
            pnlUsd: pnl ? pnl.pnlUsd : null,
            pnlPct: pnl ? pnl.pnlPct : null,
            entryPrice: snapshots.get(snapshotKey(p))?.entrySpotUsd ?? null,
            pnlSince: pnl ? pnl.since.toISOString() : null,
          };
        });
      } catch (e) {
        positionsKnown = false;
        botLogger.warn({ err: e, telegramId }, "miniapp /me: on-chain positions read failed");
      }

      // Stability pool (fxSAVE) — the user's real savings position. Read
      // independently and fail-soft: savingsKnown=false on RPC trouble so the
      // Total Value hero never silently drops or fakes the holding.
      let savingsKnown = true;
      let savings: Record<string, unknown> | null = null;
      let savingsUsd: number | null = 0;
      try {
        if (!sdk) throw new Error("SDK unavailable");
        const o = await getSaveOverview(sdk, user.walletAddress);
        let pendingAssets: PendingSaveAssets | null = null;

        // requestRedeem transfers the queued shares out of the user's wallet,
        // so a redeem-all correctly reports shares=0 while claim state still
        // exists. Price the queue from the SDK's exact base-pool preview. If
        // that extra read fails, retain the claim state but make the total
        // unknown rather than silently valuing a real receivable at zero.
        if (o.redeem.hasPendingRedeem) {
          try {
            const claimable = await sdk.getFxSaveClaimable({ userAddress: user.walletAddress });
            if (claimable.previewReceive) {
              pendingAssets = {
                fxUsd: formatUnits(claimable.previewReceive.amountYieldOutWei, 18),
                usdc: formatUnits(claimable.previewReceive.amountStableOutWei, 6),
              };
            }
          } catch (e) {
            botLogger.warn(
              { err: e, telegramId },
              "miniapp /me: fxSAVE pending redemption preview failed"
            );
          }
        }
        ({ savings, savingsUsd } = buildMiniSavingsSnapshot(o, pendingAssets, prices));
      } catch (e) {
        savingsKnown = false;
        savingsUsd = null; // unknown holding → don't claim a complete total
        botLogger.warn({ err: e, telegramId }, "miniapp /me: fxSAVE read failed");
      }

      // Real portfolio totals for the Mini App "Total Value" hero (Screen 4).
      // Only claim a total when BOTH the position and savings reads were clean
      // and complete — otherwise the UI shows an honest "—".
      let summary: PortfolioSummary = {
        totalValueUsd: null,
        walletUsd: null,
        positionsUsd: null,
        savingsUsd: null,
        netPnlUsd: null,
        netPnlPct: null,
      };
      if (positionsKnown && savingsKnown) {
        summary = summarizePortfolio(funding, positions, pnls, prices, savingsUsd);
      }

      res.json({
        onboarded: true,
        walletAddress: user.walletAddress,
        walletDelegated: user.walletDelegated,
        walletImported: user.walletImported,
        referralCode: user.referralCode,
        language: user.language,
        slippageBps: user.slippageBps,
        mevProtection: user.mevProtection === "flashbots" || user.mevProtection === "on" ? "on" : "off",
        funding,
        positionsKnown,
        positions: apiPositions,
        savingsKnown,
        savings,
        summary,
      });
    } catch (e) {
      botLogger.error({ err: e, telegramId }, "miniapp /me failed");
      res.status(500).json({ error: { code: "INTERNAL", message: "Failed to load account" } });
    }
  });

  // -- POST /onboard: link the user's self-custodial wallet ----------------
  // The wallet was created or imported BY THE USER in the Mini App via the
  // Privy SDK. This endpoint only links it server-side: the Privy user is
  // resolved from the verified Telegram id and the wallet is read from
  // Privy's user record — nothing in the request body is trusted.
  router.post("/onboard", async (req: AuthedRequest, res: Response) => {
    const telegramId = req.tgUser!.telegramId;
    const referral =
      typeof req.body?.referral === "string" &&
      /^[A-Za-z0-9]{4,16}$/.test(req.body.referral)
        ? req.body.referral.toUpperCase()
        : undefined;
    try {
      const result = await onboardUser(telegramId, referral);

      if (result.status === "no_wallet") {
        // Wallet setup not finished client-side yet — honest 409, no DB write.
        res.status(409).json({
          error: {
            code: "NO_WALLET",
            message: "Finish creating or importing your wallet first, then retry.",
          },
        });
        return;
      }

      const addr = result.user.walletAddress;
      const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;

      // Mirror the state change into the chat so the bot and Mini App always
      // tell the same story (and clear the old reply keyboard).
      if (result.status === "linked") {
        const tradingLine = result.user.walletDelegated
          ? `⚡ Bot trading is ON — trade right here in chat. Revoke any time in the app.`
          : `💤 Bot trading is OFF — enable it in the app (Settings → Wallet) to trade from chat.`;
        await deps
          .sendMessage(
            telegramId,
            `🎉 Wallet ${result.user.walletImported ? "imported" : "created"} — and it's YOURS.\n\n` +
              `Address: ${addr}\n\n` +
              `🔐 Self-custody via Privy: only you can export the key, and you ` +
              `decide what the bot may do.\n${tradingLine}\n\nNext: fund it with /deposit, then /trade.`,
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
        created: result.status === "linked",
        walletAddress: addr,
        walletShort: short,
        walletDelegated: result.user.walletDelegated,
        walletImported: result.user.walletImported,
        referralApplied: result.referrerCode ?? null,
      });
    } catch (e) {
      botLogger.error({ err: e, telegramId }, "miniapp /onboard failed");
      res.status(500).json({ error: { code: "ONBOARD_FAILED", message: "Wallet linking failed — nothing was changed. Try again in a moment." } });
    }
  });

  // -- POST /wallet/sync: refresh delegation/import state from Privy --------
  // Called by the Mini App right after the user grants or revokes the bot's
  // session signer so chat commands immediately reflect the new state.
  router.post("/wallet/sync", async (req: AuthedRequest, res: Response) => {
    const telegramId = req.tgUser!.telegramId;
    try {
      const user = await prisma.user.findUnique({ where: { telegramId } });
      if (!user) {
        res.status(404).json({ error: { code: "NOT_ONBOARDED", message: "Finish wallet setup first" } });
        return;
      }
      const synced = await syncWalletState(user);
      res.json({
        ok: true,
        walletAddress: synced.walletAddress,
        walletDelegated: synced.walletDelegated,
        walletImported: synced.walletImported,
      });
    } catch (e) {
      botLogger.error({ err: e, telegramId }, "miniapp /wallet/sync failed");
      res.status(500).json({ error: { code: "INTERNAL", message: "Failed to sync wallet state" } });
    }
  });

  // -- POST /settings: language / slippage / MEV protection ----------------
  router.post("/settings", async (req: AuthedRequest, res: Response) => {
    const telegramId = req.tgUser!.telegramId;
    const body = req.body ?? {};
    const data: Record<string, unknown> = {};

    if (
      typeof body.language === "string" &&
      (SUPPORTED_LOCALES as readonly string[]).includes(body.language)
    ) {
      data.language = body.language;
    }
    if (
      typeof body.slippageBps === "number" &&
      Number.isInteger(body.slippageBps) &&
      body.slippageBps >= 1 &&
      body.slippageBps <= RISK_PARAMS.SLIPPAGE_MAX_BPS
    ) {
      data.slippageBps = body.slippageBps;
    }
    if (body.mevProtection === "on" || body.mevProtection === "off") {
      data.mevProtection = body.mevProtection === "on" ? "flashbots" : "off";
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
        mevProtection: user.mevProtection === "flashbots" || user.mevProtection === "on" ? "on" : "off",
      });
    } catch (e) {
      botLogger.error({ err: e, telegramId }, "miniapp /settings failed");
      res.status(500).json({ error: { code: "INTERNAL", message: "Failed to save settings" } });
    }
  });

  // -- POST /action/quote + /action/execute: the complete SDK gateway ------
  // These endpoints cover position lifecycle, borrowing, fxSAVE and bridge
  // intents. The client submits intent values only; calldata, destinations,
  // wallet ownership, fees and gas are all resolved and checked server-side.
  router.post("/action/quote", async (req: AuthedRequest, res: Response) => {
    const telegramId = req.tgUser!.telegramId;
    const valid = validateMiniActionBody(req.body);
    if (!valid.ok) {
      res.status(400).json({ error: { code: valid.code, message: valid.message } });
      return;
    }
    try {
      const user = await prisma.user.findUnique({ where: { telegramId } });
      if (!user) {
        res.status(404).json({ error: { code: "NOT_ONBOARDED", message: "Finish wallet setup first." } });
        return;
      }
      const quote = await buildMiniActionQuote(
        {
          id: user.id,
          privyUserId: user.privyUserId,
          walletAddress: user.walletAddress,
          privyWalletId: user.privyWalletId,
          walletDelegated: user.walletDelegated,
          walletImported: user.walletImported,
          slippageBps: user.slippageBps,
          mevProtection: user.mevProtection,
        },
        valid.params
      );
      res.json({ ok: true, quote });
    } catch (err) {
      botLogger.warn({ err, telegramId, kind: valid.params.kind }, "miniapp action quote failed");
      res.status(422).json({
        error: {
          code: "QUOTE_FAILED",
          message: "This action could not be prepared or simulated. Check balances and live position state, then try again.",
        },
      });
    }
  });

  router.post("/action/execute", async (req: AuthedRequest, res: Response) => {
    const telegramId = req.tgUser!.telegramId;
    const ticket = req.body?.ticket;
    if (!validActionTicket(ticket)) {
      res.status(400).json({ error: { code: "BAD_QUOTE_TICKET", message: "Review the action before confirming it." } });
      return;
    }
    const rawTier = req.body?.feeTier;
    if (
      rawTier !== undefined &&
      rawTier !== "slow" &&
      rawTier !== "market" &&
      rawTier !== "fast"
    ) {
      res.status(400).json({
        error: { code: "BAD_FEE_TIER", message: "Choose slow, market, or fast." },
      });
      return;
    }
    const feeTier: "slow" | "market" | "fast" =
      rawTier === "slow" || rawTier === "fast" ? rawTier : "market";
    try {
      const user = await prisma.user.findUnique({ where: { telegramId } });
      if (!user) {
        res.status(404).json({ error: { code: "NOT_ONBOARDED", message: "Finish wallet setup first." } });
        return;
      }
      const result = await executeMiniAction(
        {
          id: user.id,
          privyUserId: user.privyUserId,
          walletAddress: user.walletAddress,
          privyWalletId: user.privyWalletId,
          walletDelegated: user.walletDelegated,
          walletImported: user.walletImported,
          slippageBps: user.slippageBps,
          mevProtection: user.mevProtection,
        },
        ticket,
        feeTier
      );
      if (!result.ok) {
        const status = result.code === "QUOTE_TICKET_EXPIRED"
          ? 410
          : result.code === "BOT_TRADING_OFF" || result.code === "BRIDGE_EXECUTION_DISABLED"
            ? 409
            : 422;
        res.status(status).json({
          error: { code: result.code, message: result.message },
        });
        return;
      }
      res.json(result);
    } catch (err) {
      botLogger.error({ err, telegramId, ticket }, "miniapp action execute failed");
      res.status(500).json({ error: { code: "INTERNAL", message: "The action could not be executed." } });
    }
  });

  // -- GET /activity: scoped transaction journal for the signed-in wallet --
  router.get("/activity", async (req: AuthedRequest, res: Response) => {
    const telegramId = req.tgUser!.telegramId;
    const takeRaw = Number(req.query.take ?? 30);
    const take = Number.isSafeInteger(takeRaw) ? Math.max(1, Math.min(50, takeRaw)) : 30;
    try {
      const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
      if (!user) {
        res.status(404).json({ error: { code: "NOT_ONBOARDED", message: "Finish wallet setup first." } });
        return;
      }
      const records = await prisma.txRecord.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, hash: true, status: true, type: true, data: true, createdAt: true, updatedAt: true },
      });
      res.json({
        items: records.map((record) => {
          const data = record.data as { hashes?: unknown; chainId?: unknown; steps?: unknown; error?: unknown };
          const steps = Array.isArray(data.steps)
            ? data.steps.flatMap((raw, index) => {
                if (!raw || typeof raw !== "object") return [];
                const step = raw as Record<string, unknown>;
                return [{
                  index: typeof step.index === "number" ? step.index : index,
                  status: typeof step.status === "string" ? step.status : "unknown",
                  hash: typeof step.hash === "string" ? step.hash : null,
                }];
              })
            : [];
          return {
            id: record.id,
            hash: record.hash,
            status: record.status,
            type: record.type,
            chainId: data.chainId === 8453 ? 8453 : 1,
            hashes: data.hashes instanceof Array
              ? data.hashes.filter((value): value is string => typeof value === "string")
              : [],
            steps,
            message: typeof data.error === "string" ? data.error : null,
            createdAt: record.createdAt.toISOString(),
            updatedAt: record.updatedAt.toISOString(),
          };
        }),
      });
    } catch (err) {
      botLogger.error({ err, telegramId }, "miniapp /activity failed");
      res.status(500).json({ error: { code: "INTERNAL", message: "Activity could not be loaded." } });
    }
  });

  return router;
}
