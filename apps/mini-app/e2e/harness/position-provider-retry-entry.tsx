import React from 'react';
import { createRoot } from 'react-dom/client';
import ProtocolPositionProvider, { useProtocolPositions } from '../../src/components/ProtocolPositionProvider';

type RetryHarnessState = {
  wallet: { ready: boolean; authenticated: boolean; address: string };
  failAttempts: Record<string, number>;
  partialReads: Record<string, number[]>;
  reads: string[];
  foreground: boolean;
  resume?: () => void;
  setWallet: (address: string) => void;
  unmount: () => void;
};

const initial = (window as Window & { __positionRetryConfig?: { failAttempts?: Record<string, number>; partialReads?: Record<string, number[]>; foreground?: boolean } }).__positionRetryConfig;
const state: RetryHarnessState = {
  wallet: { ready: true, authenticated: true, address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  failAttempts: Object.fromEntries(Object.entries(initial?.failAttempts ?? {}).map(([address, count]) => [address.toLowerCase(), count])),
  partialReads: Object.fromEntries(Object.entries(initial?.partialReads ?? {}).map(([address, calls]) => [address.toLowerCase(), calls])),
  reads: [],
  foreground: initial?.foreground ?? true,
  setWallet: () => undefined,
  unmount: () => undefined,
};
(window as Window & { __positionRetryHarness?: RetryHarnessState }).__positionRetryHarness = state;

function Probe() {
  const positions = useProtocolPositions();
  return <main data-harness-ready="true">
    <output data-testid="status">{positions.status}</output>
    <output data-testid="reads">{state.reads.length}</output>
    <button type="button" onClick={() => { void positions.refresh(); }}>Manual refresh</button>
    {positions.positions.map((position) => <output data-testid="position" key={`${position.market}:${position.side}:${position.info.positionId}`}>
      {position.market}:{position.side}:{position.info.positionId}
    </output>)}
  </main>;
}

const root = createRoot(document.getElementById('root')!);
function render() { root.render(<ProtocolPositionProvider><Probe /></ProtocolPositionProvider>); }
state.setWallet = (address) => { state.wallet = { ...state.wallet, address }; render(); };
state.unmount = () => root.unmount();
document.documentElement.dataset.harnessReady = 'true';
render();
