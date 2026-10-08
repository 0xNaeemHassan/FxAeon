/**
 * The unit a position's collateral figure is in, named for display.
 *
 * fx-sdk 1.0.5 labels the wstETH long pool's collateral "ETH" (its pool
 * config notes "stETH"), and `getPosition` returns the pool's raw collateral.
 * The PoolManager scales wstETH by its rate provider (stETH per wstETH) before
 * the pool records it, and the pool's oracle prices stETH, so that figure is
 * stETH. Every other pool's SDK symbol already names its unit: fxUSD for
 * shorts, WBTC (18-decimal accounting) for the BTC long.
 *
 * Display only: the SDK symbol stays the position's identity and the key its
 * USD value is priced with.
 */
export function positionCollateralSymbol(position: {
  market: 'ETH' | 'BTC';
  side: 'long' | 'short';
  info: { rawCollsToken: string };
}): string {
  return position.market === 'ETH' && position.side === 'long' ? 'stETH' : position.info.rawCollsToken;
}
