import { FX_TOKENS } from './fx/tokens';
import { usdValueForDecimal, usdValueForUnits, type UsdPriceMap } from './prices';

/**
 * SDK 1.0.5: convertToAssets/totalAssets are denominated in fxSAVE.asset(),
 * the fxUSD base-pool share token, not fxUSD. Pending redemptions come from
 * that base pool's redeemRequests, whereas balance/totalSupply are fxSAVE.
 */
export const FX_SAVE_UNITS = {
  balanceWei: { priceKey: 'fxSAVE', label: 'fxSAVE shares' },
  totalSupplyWei: { priceKey: 'fxSAVE', label: 'fxSAVE shares' },
  assetsWei: { priceKey: 'fxUSDBasePool', label: 'fxUSD base-pool shares' },
  totalAssetsWei: { priceKey: 'fxUSDBasePool', label: 'fxUSD base-pool shares' },
  pendingSharesWei: { priceKey: 'fxUSDBasePool', label: 'fxUSD base-pool shares' },
} as const;

/** Display-only valuation; a missing matching quote never falls back to fxUSD. */
export function fxSaveUsdValue(
  field: keyof typeof FX_SAVE_UNITS,
  value: bigint | string | null | undefined,
  prices: UsdPriceMap,
): number | null {
  if (value === null || value === undefined) return null;
  const { priceKey } = FX_SAVE_UNITS[field];
  return typeof value === 'bigint'
    ? usdValueForUnits(value, FX_TOKENS[priceKey].decimals, prices[priceKey])
    : usdValueForDecimal(value, prices[priceKey]);
}
