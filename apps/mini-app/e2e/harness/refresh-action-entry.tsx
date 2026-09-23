import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useRefreshAction } from '../../src/lib/useRefreshAction';

type Reader = 'portfolio' | 'activity' | 'positions';
type Pending = { resolve: () => void; reject: () => void };
type HarnessState = {
  calls: Record<string, number>;
  pending: Record<string, Partial<Record<Reader, Pending>>>;
  failActivity: boolean;
  settle: (identity: string, reader: Reader, outcome: 'resolve' | 'reject') => void;
};

const state: HarnessState = {
  calls: {},
  pending: {},
  failActivity: true,
  settle(identity, reader, outcome) {
    const request = this.pending[identity]?.[reader];
    if (!request) throw new Error(`No pending ${reader} request for ${identity}`);
    if (outcome === 'resolve') request.resolve();
    else request.reject();
  },
};
(window as Window & { __refreshActionHarness?: HarnessState }).__refreshActionHarness = state;

function readerTask(identity: string, reader: Reader): () => Promise<void> {
  return () => {
    const key = `${identity}:${reader}`;
    state.calls[key] = (state.calls[key] ?? 0) + 1;
    if (reader === 'activity' && state.failActivity) return Promise.reject(new Error('reader failed'));
    return new Promise<void>((resolve, reject) => {
      state.pending[identity] ??= {};
      state.pending[identity]![reader] = { resolve, reject };
    });
  };
}

function Harness() {
  const [identity, setIdentity] = useState('wallet-A');
  const { run, refreshing } = useRefreshAction(identity);
  return <main data-harness-ready="true">
    <output data-testid="identity">{identity}</output>
    <output data-testid="refresh-state" aria-live="polite">{refreshing ? 'Refreshing' : 'Idle'}</output>
    <button type="button" onClick={() => { void run(['portfolio', 'activity', 'positions'].map((reader) => readerTask(identity, reader as Reader))); }}>Refresh wallet data</button>
    <button type="button" onClick={() => { state.failActivity = false; }}>Allow activity reader</button>
    <button type="button" onClick={() => setIdentity('wallet-B')}>Change wallet</button>
  </main>;
}

document.documentElement.dataset.harnessReady = 'true';
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness /></React.StrictMode>);
