export type LeverageSide = 'long' | 'short';

/**
 * Debt as a share of collateral value, before fees. A displayed L× long has
 * collateral/equity = L, so debt/collateral = (L − 1) / L. A displayed L×
 * short has debt/equity = L, so debt/collateral = L / (L + 1). Educational
 * figures only: never a position valuation or an SDK input.
 */
export function debtShare(side: LeverageSide, leverage: number): number {
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  return side === 'short' ? leverage / (leverage + 1) : Math.max(0, (leverage - 1) / leverage);
}

/** Whole percentages that always total 100: the debt share rounded, the rest the trader's. */
export function splitPercents(side: LeverageSide, leverage: number): { debt: number; yours: number } {
  const debt = Math.round(debtShare(side, leverage) * 100);
  return { debt, yours: 100 - debt };
}

/** What the debt is: a long mints fxUSD against its collateral; a short borrows the market's asset. */
export function leverageDebtLabel(side: LeverageSide, market: 'ETH' | 'BTC'): string {
  return side === 'long' ? 'minted fxUSD' : `borrowed ${market === 'ETH' ? 'wstETH' : 'WBTC'}`;
}
