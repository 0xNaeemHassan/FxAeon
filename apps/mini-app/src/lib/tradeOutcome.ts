import type { PlannedRoute } from '@/lib/fx/types';
import { formatUsdCents, usdCentsForDecimalAmount } from '@/lib/positionValuation';
import { priceKeyForSymbol, type UsdPriceMap } from '@/lib/prices';

/**
 * The Trade ticket's outcome preview, for one exact ticket: the warm-up
 * planned for it is still running, failed, or returned this route.
 */
export type TradeOutcomeState =
  | { key: string; status: 'pending' | 'failed' }
  | { key: string; status: 'ready'; route: PlannedRoute };

export type TradeOutcomeTicket = {
  walletAddress: string;
  walletChainId: number | null;
  market: 'ETH' | 'BTC';
  side: 'long' | 'short';
  token: string;
  amountWei: bigint;
  leverage: number;
  slippagePercent: number;
  leverageMin: number;
  leverageMax: number;
};

/**
 * Every input a warmed route is planned from (its prefetch descriptor without
 * the session and block). The preview shows a route's figures only while this
 * key is unchanged, so they can never describe a different ticket.
 */
export function tradeOutcomeKey(ticket: TradeOutcomeTicket): string {
  return JSON.stringify([
    ticket.walletAddress.toLowerCase(), ticket.walletChainId, ticket.market, ticket.side, ticket.token,
    ticket.amountWei.toString(), ticket.leverage, ticket.slippagePercent, ticket.leverageMin, ticket.leverageMax,
  ]);
}

/** A settled warm-up: its first route, as the review would open it, or nothing to show. */
export function settledTradeOutcome(key: string, routes: unknown): TradeOutcomeState {
  const first: unknown = Array.isArray(routes) ? routes[0] : routes;
  return first && typeof first === 'object'
    ? { key, status: 'ready', route: first as PlannedRoute }
    : { key, status: 'failed' };
}

/**
 * What the ticket may show for the inputs it has now. No key (no wallet, or
 * nothing to plan) shows nothing; a state for any other key reads as pending,
 * so changed inputs clear the old figures on the same render.
 */
export function currentTradeOutcome(state: TradeOutcomeState | null, key: string | null): TradeOutcomeState | null {
  if (!key) return null;
  return state?.key === key ? state : { key, status: 'pending' };
}

/**
 * Every preview figure is an estimate, so it carries one "≈", including
 * figures the review shows without one because no digits were cut. A "<"
 * bound already says it is approximate.
 */
export function approximately(value: string): string {
  return /^[≈<]/.test(value) ? value : `≈ ${value}`;
}

/** A display-only USD value for the quoted collateral, from a fresh price only. */
export function collateralUsdEstimate(collateral: { exact: string; symbol: string }, prices: UsdPriceMap): string | null {
  const key = priceKeyForSymbol(collateral.symbol);
  const cents = usdCentsForDecimalAmount(collateral.exact, key ? prices[key] : undefined);
  if (cents === null || cents < 0n) return null;
  if (cents === 0n) return /[1-9]/.test(collateral.exact) ? '<$0.01' : null;
  return `≈ ${formatUsdCents(cents)}`;
}
