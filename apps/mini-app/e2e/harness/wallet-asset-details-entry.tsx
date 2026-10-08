import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WalletAssetModal } from '../../src/components/WalletAssetDetails';
import type { WalletAsset } from '../../src/lib/walletAssets';

type FixtureState = 'fresh' | 'stale' | 'dust';
const walletA = '0x930f0000000000000000000000000000000098b9';

function asset(state: FixtureState): WalletAsset {
  const now = Date.now();
  // One wei above 1,234 ETH: rounding to any fixed number of places would hide it.
  const balance = state === 'dust' ? '0.000000000000000001' : '1234.000000000000000001';
  return {
    id: '1:ETH',
    chainId: 1,
    network: 'ethereum',
    tokenAddress: null,
    canonicalKey: 'ETH',
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    balanceWei: state === 'dust' ? 1n : 1_234_000_000_000_000_000_001n,
    balance,
    balanceUpdatedAt: now,
    priceUsd: 2400,
    priceUpdatedAt: state === 'stale' ? now - 3_600_000 : now,
    priceStatus: state === 'stale' ? 'stale' : 'fresh',
    usdValue: state === 'stale' ? null : state === 'dust' ? 0 : 2_961_600,
    logoUrl: null,
    source: 'canonical',
  };
}

function Harness() {
  const [fixture, setFixture] = useState<FixtureState>('fresh');
  const [open, setOpen] = useState(true);
  return <main data-harness-ready="true">
    <div role="toolbar" aria-label="Asset detail fixture states">
      <button type="button" onClick={() => { setFixture('fresh'); setOpen(true); }}>Fresh price</button>
      <button type="button" onClick={() => { setFixture('stale'); setOpen(true); }}>Stale price</button>
      <button type="button" onClick={() => { setFixture('dust'); setOpen(true); }}>Dust balance</button>
      <output data-testid="sheet-state">{open ? 'open' : 'closed'}</output>
    </div>
    {open && <WalletAssetModal key={fixture} asset={asset(fixture)} walletAddress={walletA} onClose={() => setOpen(false)} />}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
(window as Window & { __walletAssetDetailsHarnessReady?: boolean }).__walletAssetDetailsHarnessReady = true;
