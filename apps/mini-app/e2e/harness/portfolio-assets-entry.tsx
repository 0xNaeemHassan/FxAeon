import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PortfolioAssets, type PortfolioNetwork } from '../../src/components/PortfolioAssets';
import type { WalletAsset, WalletAssetSnapshot } from '../../src/lib/walletAssets';

type FixtureState = 'base-pending' | 'base-zero' | 'base-unavailable' | 'base-refreshing';
const walletA = '0x930f0000000000000000000000000000000098b9';

function asset(chainId: 1 | 8453, symbol: string): WalletAsset {
  const now = Date.now();
  const balance = chainId === 1 ? '1.25' : '42';
  return {
    id: `${chainId}:${symbol}`,
    chainId,
    network: chainId === 1 ? 'ethereum' : 'base',
    tokenAddress: null,
    canonicalKey: null,
    symbol,
    name: symbol,
    decimals: 18,
    balanceWei: chainId === 1 ? 1_250_000_000_000_000_000n : 42_000_000_000_000_000_000n,
    balance,
    balanceUpdatedAt: now,
    priceUsd: 2,
    priceUpdatedAt: now,
    priceStatus: 'fresh',
    usdValue: null,
    logoUrl: null,
    source: 'canonical',
  };
}

function snapshot(state: FixtureState): WalletAssetSnapshot {
  const now = Date.now();
  const baseStatus = state === 'base-pending' || state === 'base-refreshing'
    ? 'pending' as const
    : state === 'base-unavailable' ? 'unavailable' as const : 'ready' as const;
  return {
    walletAddress: walletA,
    assets: [asset(1, 'ETH'), ...(state === 'base-refreshing' ? [asset(8453, 'fxUSD')] : [])],
    networks: {
      1: { chainId: 1, status: 'ready', error: '' },
      8453: { chainId: 8453, status: baseStatus, error: baseStatus === 'unavailable' ? 'Base read failed.' : '' },
    },
    totalUsdValue: 0,
    unpricedAssetCount: 0,
    updatedAt: now,
    source: 'canonical',
  };
}

function Harness() {
  const [fixture, setFixture] = useState<FixtureState>('base-pending');
  const [network, setNetwork] = useState<PortfolioNetwork>('all');
  const [retryCount, setRetryCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const currentSnapshot = snapshot(fixture);
  const loading = fixture === 'base-pending' || fixture === 'base-refreshing';
  return <main data-harness-ready="true">
    <div role="toolbar" aria-label="Portfolio asset fixture states">
      <button type="button" onClick={() => setFixture('base-pending')}>Base pending</button>
      <button type="button" onClick={() => setFixture('base-zero')}>Base zero</button>
      <button type="button" onClick={() => setFixture('base-unavailable')}>Base unavailable</button>
      <button type="button" onClick={() => setFixture('base-refreshing')}>Base refreshing with holding</button>
      <button type="button" onClick={() => setRefreshing(false)}>Resolve asset refresh</button>
      <output data-testid="retry-count">{retryCount}</output>
    </div>
    <PortfolioAssets
      snapshot={currentSnapshot}
      loading={loading}
      network={network}
      onNetworkChange={setNetwork}
      onRefresh={() => { setRetryCount((count) => count + 1); setRefreshing(true); }}
      refreshing={refreshing}
    />
  </main>;
}

(window as Window & { __portfolioAssetsHarnessReady?: boolean }).__portfolioAssetsHarnessReady = true;
createRoot(document.getElementById('root')!).render(<Harness />);
