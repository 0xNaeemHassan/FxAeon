import React from 'react';
import { createRoot } from 'react-dom/client';
import { useRouteGasCost } from '../../src/lib/fx/useGasCost';
import type { FxPublicClient, PlannedRoute } from '../../src/lib/fx/types';

declare global {
  interface Window {
    __gasCostHarness: {
      nonce: string;
      estimateGasCalls: number;
      strictMode: boolean;
      resolveGas?: (value: bigint) => void;
      rejectGas?: (error: Error) => void;
    };
  }
}

const harness = window.__gasCostHarness;
const walletAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const transactionAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;

const route: PlannedRoute = {
  operation: 'increasePosition',
  chainId: 1,
  walletAddress,
  transactions: [{
    chainId: 1,
    from: walletAddress,
    to: transactionAddress,
    data: `0x${harness.nonce}`,
    value: 0n,
    kind: 'action',
    operation: 'increasePosition',
  }],
};

const client = {
  getChainId: async () => 1,
  estimateFeesPerGas: async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 100_000_000n }),
  estimateGas: async () => {
    harness.estimateGasCalls += 1;
    return new Promise<bigint>((resolve, reject) => {
      harness.resolveGas = resolve;
      harness.rejectGas = reject;
    });
  },
} as unknown as FxPublicClient;

function GasCostView() {
  const result = useRouteGasCost(route, { client });
  return <main>
    <output data-testid="cache-status">{result.status}</output>
    <output data-testid="estimate-status">{result.estimate?.status ?? ''}</output>
    <output data-testid="current">{String(result.estimateIsCurrent)}</output>
    <output data-testid="gas-units">{result.estimate?.estimatedGasUnits?.toString() ?? ''}</output>
    <output data-testid="execution-fee">{result.estimate?.executionGasFeeWei?.toString() ?? ''}</output>
  </main>;
}

document.documentElement.dataset.harnessReady = 'true';
const view = <GasCostView />;
createRoot(document.getElementById('root')!).render(harness.strictMode ? <React.StrictMode>{view}</React.StrictMode> : view);
