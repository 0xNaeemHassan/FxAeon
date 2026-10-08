import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { routeGasCostCache } from '../../src/lib/fx/gasCost';
import { useRouteGasCost } from '../../src/lib/fx/useGasCost';
import type { FxPublicClient, PlannedRoute } from '../../src/lib/fx/types';

export interface GasPendingHarness {
  requests: Array<{ resolve: (gas: bigint) => void; reject: (error: Error) => void }>;
  isRefreshing: () => boolean;
  cachedGas: () => string;
}

declare global {
  interface Window {
    __gasPendingHarness: GasPendingHarness;
  }
}

const walletAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const route: PlannedRoute = {
  operation: 'increasePosition',
  chainId: 1,
  walletAddress,
  transactions: [{
    chainId: 1,
    from: walletAddress,
    to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    data: '0x12345678',
    value: 0n,
    kind: 'action',
    operation: 'increasePosition',
  }],
};
const harness = window.__gasPendingHarness = {
  requests: [] as GasPendingHarness['requests'],
  isRefreshing: () => routeGasCostCache.isRefreshing(route),
  cachedGas: () => routeGasCostCache.view(route).current?.estimatedGasUnits?.toString() ?? '',
};
const client = {
  getChainId: async () => 1,
  estimateFeesPerGas: async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 100_000_000n }),
  estimateGas: () => new Promise<bigint>((resolve, reject) => harness.requests.push({ resolve, reject })),
} as unknown as FxPublicClient;

function GasCostView({ enabled }: { enabled: boolean }) {
  const result = useRouteGasCost(route, { client, enabled });
  return <main>
    <output data-testid="checking">{String(result.checking)}</output>
    <output data-testid="cache-status">{result.status}</output>
    <output data-testid="estimate-status">{result.estimate?.status ?? ''}</output>
    <output data-testid="current">{String(result.estimateIsCurrent)}</output>
    <output data-testid="gas-units">{result.estimate?.estimatedGasUnits?.toString() ?? ''}</output>
  </main>;
}

function Harness() {
  const [enabled, setEnabled] = useState(true);
  const [mounted, setMounted] = useState(true);
  return <>
    <button onClick={() => setEnabled((value) => !value)}>Toggle fee checks</button>
    <button onClick={() => setMounted((value) => !value)}>Toggle consumer</button>
    {mounted && <GasCostView enabled={enabled} />}
  </>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness /></React.StrictMode>);
