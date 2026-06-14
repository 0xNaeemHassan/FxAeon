/**
 * In-app trade execution core (Mini App screens 2/3/5: review-quote → gas →
 * position-opened).
 *
 * SAFETY — this does NOT re-introduce the audited P0-2 kill-switch danger.
 * The old in-app path broadcast empty-calldata txs from the client and faked
 * success. This module instead routes the Mini App's Confirm through the SAME
 * sanctioned server-side engine the bot chat uses:
 *
 *   quoteOpenPosition (real f(x) calldata, verified addresses)
 *     → executeRoute (idempotent → fail-closed simulate → session-signer
 *       broadcast → on-chain receipt watch).
 *
 * Nothing here trusts client-supplied calldata: the quote is rebuilt
 * server-side from validated (market, side, leverage, amount). The session
 * signer gate is enforced (requireDelegatedWallet) and Privy re-enforces it
 * server-side regardless. There is no "skip simulation" flag.
 *
 * The quote endpoint returns ONLY real numbers (SDK execution price + a real
 * `simulateCalls` gas estimate + EIP-1559 fees from feeHistory). When the RPC
 * or price feed is unavailable it returns an honest error — never a fabricated
 * gas figure.
 */
import { parseUnits, formatUnits } from "viem";
import { MARKETS, RISK_PARAMS, type Market } from "@fxbot/shared";
import {
  collateralDecimals,
  createFxSdk,
  createPublicClientForUser,
  quoteOpenPosition,
  simulateRoute,
} from "../fx/index.js";
import { executeRoute } from "./txExecutor.js";
import { requireDelegatedWallet, type DelegationGateUser } from "./delegation.js";
import { getEip1559Fees } from "./fees.js";
import { listUserPositions } from "./portfolio.js";
import { trackPositions } from "./pnl.js";
import { getSpotPrices } from "../market/coingecko.js";
import { describeExecutionError } from "./errorTaxonomy.js";
import { botLogger } from "../middleware/logger.js";

const GWEI = 1_000_000_000n;

export type Side = "long" | "short";

export interface ValidatedTradeParams {
  market: Market;
  side: Side;
  leverage: number;
  amount: number;
}

export type ValidationResult =
  | { ok: true; params: ValidatedTradeParams }
  | { ok: false; code: string; message: string };

/** Max leverage for a side (long and short have different caps). */
export function maxLeverageFor(side: Side): number {
  return side === "long" ? RISK_PARAMS.MAX_LEVERAGE_LONG : RISK_PARAMS.MAX_LEVERAGE_SHORT;
}

/**
 * Validate an untrusted trade request body. Mirrors the bot's server-side
 * re-validation: market in the allow-list, side long|short, leverage within
 * the side's cap, amount a positive finite number.
 */
export function validateTradeBody(body: unknown): ValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const market = b.market;
  const side = b.side;
  const leverage = typeof b.leverage === "number" ? b.leverage : Number(b.leverage);
  const amount = typeof b.amount === "number" ? b.amount : Number(b.amount);

  if (typeof market !== "string" || !(MARKETS as readonly string[]).includes(market)) {
    return { ok: false, code: "BAD_MARKET", message: `Unsupported market. Choose ${MARKETS.join(" or ")}.` };
  }
  if (side !== "long" && side !== "short") {
    return { ok: false, code: "BAD_SIDE", message: "Side must be long or short." };
  }
  const maxLev = maxLeverageFor(side);
  if (!Number.isFinite(leverage) || leverage < RISK_PARAMS.MIN_LEVERAGE || leverage > maxLev) {
    return {
      ok: false,
      code: "BAD_LEVERAGE",
      message: `Leverage must be ${RISK_PARAMS.MIN_LEVERAGE}x–${maxLev}x for ${side}.`,
    };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: "BAD_AMOUNT", message: "Enter a collateral amount greater than 0." };
  }
  return { ok: true, params: { market: market as Market, side, leverage, amount } };
}

export interface GasEstimate {
  /** Total gas units across the route (approve + router call). */
  units: string;
  maxFeeGwei: number;
  priorityGwei: number;
  /** Estimated total fee (units × maxFeePerGas) in wei / ETH / USD. */
  estCostWei: string;
  estCostEth: number;
  estCostUsd: number | null;
}

/**
 * Pure gas-cost math, split out so it can be unit-tested without a chain.
 * estCostUsd is null when no ETH price is available (honest unknown).
 */
export function computeGasEstimate(
  totalGas: bigint,
  maxFeePerGas: bigint,
  maxPriorityFeePerGas: bigint,
  ethPriceUsd: number | null
): GasEstimate {
  const estCostWei = totalGas * maxFeePerGas;
  const estCostEth = Number(formatUnits(estCostWei, 18));
  return {
    units: totalGas.toString(),
    maxFeeGwei: Number(maxFeePerGas) / Number(GWEI),
    priorityGwei: Number(maxPriorityFeePerGas) / Number(GWEI),
    estCostWei: estCostWei.toString(),
    estCostEth,
    estCostUsd: ethPriceUsd != null ? estCostEth * ethPriceUsd : null,
  };
}

export interface TradeQuote {
  market: Market;
  side: Side;
  leverage: number;
  collateral: number;
  collateralToken: Market;
  /** Notional exposure = collateral × leverage (display). */
  exposure: number;
  /** SDK execution price for the route (string from the SDK). */
  executionPrice: string;
  positionId: number;
  slippagePct: number;
  mevProtection: "on" | "off";
  routeType: string;
  gas: GasEstimate;
}

export type QuoteResult =
  | { ok: true; quote: TradeQuote }
  | { ok: false; code: string; message: string };

export interface QuoteUser {
  walletAddress: string;
  slippageBps: number;
  mevProtection: string;
}

/**
 * Build a real review-quote + gas estimate for an open. No fabrication: if the
 * SDK/RPC can't produce a route or a simulated gas figure, returns an honest
 * error the UI renders as "couldn't price this right now".
 */
export async function buildTradeQuote(
  user: QuoteUser,
  params: ValidatedTradeParams
): Promise<QuoteResult> {
  let sdk: ReturnType<typeof createFxSdk>;
  try {
    sdk = createFxSdk();
  } catch (e) {
    botLogger.warn({ err: e }, "miniapp quote: SDK init failed");
    return { ok: false, code: "RPC_UNAVAILABLE", message: "Live pricing is unavailable right now. Try again shortly." };
  }

  const amountWei = parseUnits(String(params.amount), collateralDecimals(params.market));

  let route;
  let positionId = 0;
  let slippagePct = user.slippageBps / 100;
  try {
    const quote = await quoteOpenPosition({
      sdk,
      userAddress: user.walletAddress,
      market: params.market,
      side: params.side,
      leverage: params.leverage,
      amountWei,
      slippagePercent: slippagePct,
    });
    route = quote.routes[0];
    positionId = quote.positionId;
    slippagePct = quote.slippage;
  } catch (e) {
    botLogger.warn({ err: e }, "miniapp quote: quoteOpenPosition failed");
    return { ok: false, code: "NO_ROUTE", message: "Couldn't build a route for this size right now. Try a different amount." };
  }
  if (!route) {
    return { ok: false, code: "NO_ROUTE", message: "No route available for this size right now. Try a different amount." };
  }

  // Real gas via simulateCalls on the route (also a fail-closed sanity check —
  // a route that won't simulate is never quoted as if it would succeed).
  const client = createPublicClientForUser(user.mevProtection === "flashbots" ? "flashbots" : "off");
  const sim = await simulateRoute(client, user.walletAddress as `0x${string}`, route.txs);
  if (!sim.success) {
    return {
      ok: false,
      code: "SIMULATION_FAILED",
      message: `This trade would fail on-chain: ${sim.error}. Nothing was sent.`,
    };
  }

  let fees;
  try {
    fees = await getEip1559Fees(client);
  } catch (e) {
    botLogger.warn({ err: e }, "miniapp quote: fee estimation failed");
    return { ok: false, code: "FEE_UNAVAILABLE", message: "Couldn't estimate network fees right now. Try again shortly." };
  }

  let ethPrice: number | null = null;
  try {
    const spot = await getSpotPrices();
    if (!spot.stale) ethPrice = spot.prices["ETH"] ?? null;
  } catch { /* price feed down — USD gas stays null, never fabricated */ }

  return {
    ok: true,
    quote: {
      market: params.market,
      side: params.side,
      leverage: params.leverage,
      collateral: params.amount,
      collateralToken: params.market,
      exposure: params.amount * params.leverage,
      executionPrice: route.executionPrice,
      positionId,
      slippagePct,
      mevProtection: user.mevProtection === "flashbots" ? "on" : "off",
      routeType: route.routeType,
      gas: computeGasEstimate(sim.totalGas, fees.maxFeePerGas, fees.maxPriorityFeePerGas, ethPrice),
    },
  };
}

export interface ExecuteUser extends DelegationGateUser {
  id: string;
  walletAddress: string;
  slippageBps: number;
  mevProtection: string;
}

export type ExecuteResult =
  | { ok: true; deduped: boolean; status: string; txHash: string | null; hashes: string[]; recordId: string }
  | { ok: false; code: string; message: string };

/**
 * Execute an open from the Mini App. Gate on the session-signer grant, rebuild
 * the route server-side (never trust client calldata), then run the sanctioned
 * executeRoute path. `nonce` makes the open idempotent: a double-tap or retry
 * with the same nonce dedupes instead of broadcasting twice.
 */
export async function executeTrade(
  user: ExecuteUser,
  params: ValidatedTradeParams,
  nonce: string
): Promise<ExecuteResult> {
  const gate = await requireDelegatedWallet(user);
  if (!gate.ok) {
    return { ok: false, code: "BOT_TRADING_OFF", message: gate.message };
  }

  let sdk: ReturnType<typeof createFxSdk>;
  try {
    sdk = createFxSdk();
  } catch (e) {
    botLogger.warn({ err: e }, "miniapp execute: SDK init failed");
    return { ok: false, code: "RPC_UNAVAILABLE", message: "Live execution is unavailable right now. Nothing was sent." };
  }

  const amountWei = parseUnits(String(params.amount), collateralDecimals(params.market));
  let route;
  try {
    const quote = await quoteOpenPosition({
      sdk,
      userAddress: user.walletAddress,
      market: params.market,
      side: params.side,
      leverage: params.leverage,
      amountWei,
      slippagePercent: user.slippageBps / 100,
    });
    route = quote.routes[0];
  } catch (e) {
    botLogger.warn({ err: e }, "miniapp execute: re-quote failed");
    return { ok: false, code: "NO_ROUTE", message: "Couldn't build a route for this size right now. Nothing was sent." };
  }
  if (!route) {
    return { ok: false, code: "NO_ROUTE", message: "No route available for this size right now. Nothing was sent." };
  }

  const client = createPublicClientForUser(user.mevProtection === "flashbots" ? "flashbots" : "off");

  const result = await executeRoute({
    userId: user.id,
    walletId: gate.walletId,
    walletAddress: user.walletAddress as `0x${string}`,
    idempotencyKey: `miniapp-trade:${user.id}:${nonce}`,
    txs: route.txs,
    type: params.side === "long" ? "open_long" : "open_short",
    client,
  });

  if (!result.ok) {
    return {
      ok: false,
      code: "EXECUTION_FAILED",
      message: describeExecutionError(result.error),
    };
  }

  // Best-effort: snapshot the true entry state for PnL right after the open.
  try {
    const fresh = await listUserPositions(sdk, user.walletAddress, params.market, params.side);
    let spot: Record<string, number | null> | null = null;
    try {
      const snap = await getSpotPrices();
      if (!snap.stale) spot = snap.prices;
    } catch { /* feed down — snapshot without entry spot */ }
    await trackPositions(user.id, fresh, spot);
  } catch (e) {
    botLogger.warn({ err: e }, "miniapp execute: post-open snapshot failed");
  }

  const txHash = result.hashes.length > 0 ? result.hashes[result.hashes.length - 1] : null;
  return {
    ok: true,
    deduped: result.deduped,
    status: result.status,
    txHash,
    hashes: result.hashes,
    recordId: result.recordId,
  };
}
