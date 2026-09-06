export type WalletDemand = {
  enabled: boolean;
  expandedAssets: boolean;
  chainPulse: boolean;
  positions: boolean;
};
export type WalletDemandRegistration = Pick<WalletDemand, 'expandedAssets' | 'chainPulse' | 'positions'>;

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

export type WalletDemandRegistry = {
  setRouteDemand: (demand: WalletDemand) => void;
  register: (demand: WalletDemandRegistration) => () => void;
  getDemand: () => WalletDemand;
};

/** Small imperative core used by the React context and deterministic tests. */
export function createWalletDemandRegistry(routeDemand: WalletDemand): WalletDemandRegistry {
  let currentRouteDemand = routeDemand;
  let nextToken = 0;
  const registrations = new Map<number, WalletDemandRegistration>();
  return {
    setRouteDemand: (demand) => { currentRouteDemand = demand; },
    register: (demand) => {
      const token = nextToken++;
      registrations.set(token, demand);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        registrations.delete(token);
      };
    },
    getDemand: () => ({
      enabled: currentRouteDemand.enabled || registrations.size > 0,
      expandedAssets: currentRouteDemand.expandedAssets || [...registrations.values()].some((demand) => demand.expandedAssets),
      chainPulse: currentRouteDemand.chainPulse || [...registrations.values()].some((demand) => demand.chainPulse),
      positions: currentRouteDemand.positions || [...registrations.values()].some((demand) => demand.positions),
    }),
  };
}
