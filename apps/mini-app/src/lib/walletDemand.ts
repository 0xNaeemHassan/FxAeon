export type WalletDemand = {
  enabled: boolean;
  expandedAssets: boolean;
  chainPulse: boolean;
  positions: boolean;
};

const OFF: WalletDemand = { enabled: false, expandedAssets: false, chainPulse: false, positions: false };
const EXACT: WalletDemand = { enabled: true, expandedAssets: false, chainPulse: false, positions: false };
const POSITIONS: WalletDemand = { enabled: true, expandedAssets: false, chainPulse: true, positions: true };
const PORTFOLIO: WalletDemand = { enabled: true, expandedAssets: true, chainPulse: true, positions: true };

function routeMatches(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** Keep expensive expanded assets separate from exact form reads and positions. */
export function walletDemandForPathname(pathname: string): WalletDemand {
  if (routeMatches(pathname, '/portfolio')) return PORTFOLIO;
  if (routeMatches(pathname, '/trade') || routeMatches(pathname, '/borrow') || routeMatches(pathname, '/positions')) return POSITIONS;
  if (routeMatches(pathname, '/earn') || routeMatches(pathname, '/move')) return EXACT;
  return OFF;
}
