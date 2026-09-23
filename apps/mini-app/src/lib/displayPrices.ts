import type { UsdPriceMap, UsdPriceSnapshot } from './prices';
import type { FxTokenKey } from './fx/tokens';
import { ASSET_PRICE_MAX_AGE_MS } from './walletAssets';

/** Display-only quote validation shared by portfolio and position summaries.
 * A provider failure never renews a timestamp or supplies a stablecoin peg. */
export function freshDisplayPrices(snapshot: UsdPriceSnapshot, now = Date.now()): UsdPriceMap {
  const prices: UsdPriceMap = {};
  for (const key of Object.keys(snapshot.prices) as FxTokenKey[]) {
    const value = snapshot.prices[key];
    const timestamp = snapshot.updatedAts?.[key] ?? snapshot.updatedAt;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0
      && typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
      && timestamp <= now + 30_000 && now - timestamp <= ASSET_PRICE_MAX_AGE_MS) prices[key] = value;
  }
  return prices;
}
