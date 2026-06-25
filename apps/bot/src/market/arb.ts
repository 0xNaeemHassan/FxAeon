/**
 * fxUSD NAV-vs-market arbitrage data layer.
 *
 * NAV: fxUSD redeems at ~$1 by protocol design, so $1 is the mint/redeem
 * reference. Secondary-market price comes from the same cached CoinGecko
 * snapshot /price uses (no extra upstream request). Fees default to 0 here
 * and should be wired to live protocol fee reads when available; the pure
 * computeArbSignal already accounts for them.
 */
import { computeArbSignal, formatArbSignal, type ArbSignal } from "@fxaeon/shared";
import { getSpotPrices } from "./coingecko.js";

export const FXUSD_SYMBOL = "FXUSD";
/** fxUSD protocol NAV (USD per unit). Stablecoin pegged to $1. */
export const FXUSD_NAV_USD = 1.0;

export interface ArbSnapshot {
  signal: ArbSignal;
  stale: boolean;
  marketSource: string;
}

export async function getFxusdArbSnapshot(opts?: {
  thresholdBps?: number;
  mintFeeBps?: number;
  redeemFeeBps?: number;
}): Promise<ArbSnapshot | null> {
  const spot = await getSpotPrices();
  const market = spot.prices[FXUSD_SYMBOL];
  if (market == null || !Number.isFinite(market) || market <= 0) return null;
  const signal = computeArbSignal({
    navUsd: FXUSD_NAV_USD,
    marketUsd: market,
    mintFeeBps: opts?.mintFeeBps ?? 0,
    redeemFeeBps: opts?.redeemFeeBps ?? 0,
    thresholdBps: opts?.thresholdBps ?? 30,
  });
  return { signal, stale: spot.stale, marketSource: "CoinGecko (fxUSD)" };
}

export function formatArbSnapshot(snap: ArbSnapshot): string {
  const base = formatArbSignal(snap.signal, "fxUSD");
  const note = snap.stale ? "\n\n⚠️ Prices may be slightly stale." : "";
  return `${base}\n\nSource: ${snap.marketSource}${note}`;
}
