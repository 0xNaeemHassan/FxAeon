import React from 'react';
import { createRoot } from 'react-dom/client';
import PositionsPage from '@/app/positions/page';

const account = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const fixturePositions = [
  ['ETH', 'long', 11, 'ETH', 'fxUSD'],
  ['ETH', 'short', 12, 'USDC', 'ETH'],
  ['BTC', 'long', 13, 'WBTC', 'fxUSD'],
  ['BTC', 'short', 14, 'USDC', 'WBTC'],
].map(([market, side, positionId, rawCollsToken, rawDebtsToken]) => ({
  market, side, info: {
    positionId: Number(positionId), rawColls: 2n * 10n ** 18n, rawCollsDecimals: 18,
    rawCollsToken, rawDebts: 100n * 10n ** 18n, rawDebtsDecimals: 18,
    rawDebtsToken, currentLeverage: 2,
  },
}));

declare global {
  var __positionsReviewHarness: {
    wallet: { ready: boolean; authenticated: boolean; address: string; chainId: number; connectionVersion: number };
    shared: Record<string, unknown>;
    walletRequests: number;
    rerender?: () => void;
  };
}

globalThis.__positionsReviewHarness = {
  wallet: { ready: true, authenticated: true, address: account, chainId: 1, connectionVersion: 1 },
  shared: {
    walletAddress: account, positions: fixturePositions, pendingPositions: [], status: 'ready', failedGroups: [],
    lastVerifiedAt: Date.now(), refreshing: false, refresh: async () => ({ positions: fixturePositions }),
    reconcileClosedPosition: async () => true, trackConfirmedPosition: async () => true,
  },
  walletRequests: 0,
};

document.documentElement.dataset.harnessReady = 'true';
function HarnessRoot() {
  const [, forceRender] = React.useState(0);
  globalThis.__positionsReviewHarness.rerender = () => forceRender((value) => value + 1);
  return <PositionsPage />;
}
createRoot(document.getElementById('root')!).render(<HarnessRoot />);
