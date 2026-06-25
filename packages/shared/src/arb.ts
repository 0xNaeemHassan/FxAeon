/**
 * NAV-vs-Market arbitrage signal (pure).
 *
 * Compares the protocol's internal mint/redeem reference (NAV) against a
 * secondary-market price (e.g. a Curve pool) and reports whether — after
 * protocol fees — there is an actionable arbitrage loop:
 *
 *   • MINT_THEN_SELL  — market price > mint cost  → mint via the protocol,
 *                        sell on the secondary market for a profit.
 *   • BUY_THEN_REDEEM — market price < redeem value → buy cheap on the
 *                        secondary market, redeem at the protocol.
 *
 * Pure and deterministic: feed it live numbers, unit-test it offline.
 */

export type ArbDirection = "MINT_THEN_SELL" | "BUY_THEN_REDEEM" | "NONE";

export interface ArbInputs {
  /** Protocol NAV / mint reference price (USD per unit). */
  navUsd: number;
  /** Secondary-market price, e.g. Curve (USD per unit). */
  marketUsd: number;
  /** Protocol mint fee in basis points (default 0). */
  mintFeeBps?: number;
  /** Protocol redeem fee in basis points (default 0). */
  redeemFeeBps?: number;
  /** Minimum net edge (bps) to flag the signal actionable (default 30 = 0.30%). */
  thresholdBps?: number;
}

export interface ArbSignal {
  direction: ArbDirection;
  /** Best net edge after fees, in basis points (>= 0). */
  edgeBps: number;
  /** Same edge expressed as a percentage. */
  edgePct: number;
  /** All-in cost to acquire 1 unit by minting (USD). */
  mintCostUsd: number;
  /** Net value of redeeming 1 unit at the protocol (USD). */
  redeemValueUsd: number;
  marketUsd: number;
  navUsd: number;
  /** edgeBps >= thresholdBps and a real direction. */
  actionable: boolean;
}

function assertPos(name: string, v: number): void {
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`computeArbSignal: ${name} must be a positive finite number, got ${v}`);
  }
}

export function computeArbSignal(inputs: ArbInputs): ArbSignal {
  const { navUsd, marketUsd } = inputs;
  const mintFeeBps = inputs.mintFeeBps ?? 0;
  const redeemFeeBps = inputs.redeemFeeBps ?? 0;
  const thresholdBps = inputs.thresholdBps ?? 30;

  assertPos("navUsd", navUsd);
  assertPos("marketUsd", marketUsd);
  if (mintFeeBps < 0 || redeemFeeBps < 0 || thresholdBps < 0) {
    throw new Error("computeArbSignal: fees and threshold must be non-negative");
  }

  const mintCostUsd = navUsd * (1 + mintFeeBps / 10_000);
  const redeemValueUsd = navUsd * (1 - redeemFeeBps / 10_000);

  // Mint then sell on the market: profit relative to what you paid to mint.
  const sellEdge = marketUsd > mintCostUsd ? (marketUsd - mintCostUsd) / mintCostUsd : 0;
  // Buy on the market then redeem at the protocol: profit relative to market cost.
  const buyEdge = marketUsd < redeemValueUsd ? (redeemValueUsd - marketUsd) / marketUsd : 0;

  let direction: ArbDirection = "NONE";
  let edge = 0;
  if (sellEdge >= buyEdge && sellEdge > 0) {
    direction = "MINT_THEN_SELL";
    edge = sellEdge;
  } else if (buyEdge > 0) {
    direction = "BUY_THEN_REDEEM";
    edge = buyEdge;
  }

  const edgeBps = Math.round(edge * 10_000);
  const actionable = direction !== "NONE" && edgeBps >= thresholdBps;

  return {
    direction,
    edgeBps,
    edgePct: edgeBps / 100,
    mintCostUsd,
    redeemValueUsd,
    marketUsd,
    navUsd,
    actionable,
  };
}

/** Human-readable one-liner for chat / alerts. */
export function formatArbSignal(sig: ArbSignal, symbol = "fxUSD"): string {
  if (sig.direction === "NONE" || !sig.actionable) {
    return `No actionable ${symbol} arbitrage right now (edge ${sig.edgePct.toFixed(2)}%, NAV $${sig.navUsd.toFixed(4)} vs market $${sig.marketUsd.toFixed(4)}).`;
  }
  if (sig.direction === "MINT_THEN_SELL") {
    return `🟢 ${symbol} arb: MINT then SELL — +${sig.edgePct.toFixed(2)}% edge. Mint cost $${sig.mintCostUsd.toFixed(4)} < market $${sig.marketUsd.toFixed(4)}. Mint via the bot, sell on the secondary market.`;
  }
  return `🟢 ${symbol} arb: BUY then REDEEM — +${sig.edgePct.toFixed(2)}% edge. Market $${sig.marketUsd.toFixed(4)} < redeem value $${sig.redeemValueUsd.toFixed(4)}. Buy on the market, redeem at the protocol.`;
}
