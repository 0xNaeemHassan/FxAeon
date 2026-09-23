import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActionReview } from '@/components/ActionReview';
import type { PlannedRoute } from '@/lib/fx';
import type { Address, Hex } from 'viem';

type WalletState = { ready: boolean; authenticated: boolean; connectionVersion: number; address?: string; chainId?: 1 | 8453 };
type PreviewRequest = {
  id: number;
  routeVersion: number;
  routeType: string;
  routeWalletAddress: string;
  previewWalletAddress: string;
  connectionVersion: number;
  settled: boolean;
  resolve: () => void;
};
type HarnessState = {
  wallet: WalletState; version: number; mode: 'auto' | 'deferred'; failNextPrepare: boolean; executeVersion?: number; partialResult: boolean;
  deferRunner: boolean; failRunner: boolean; executionResolvers: Array<() => void>; deferWalletResponse: boolean; walletResolvers: Array<() => void>; lastExecutedRouteVersion?: number;
  prepareCount: number; planCount: number; runnerCount: number; sendCount: number; draftSaveCount: number;
  previewRequests: PreviewRequest[]; nextPreviewRequestId: number;
  deferRefresh: boolean; refreshStarted: boolean; completeStarted: boolean; refreshResolvers: Array<() => void>; rerender?: () => void;
  previewDelayMs: number; refreshDelayMs: number; accountRefreshCount: number;
};

const initialOptions = (globalThis as typeof globalThis & { __actionReviewHarnessInitialOptions?: { mode?: 'auto' | 'deferred'; previewDelayMs?: number; refreshDelayMs?: number } }).__actionReviewHarnessInitialOptions;
const H = (globalThis as typeof globalThis & { __actionReviewHarness?: HarnessState }).__actionReviewHarness ??= {
  wallet: { ready: true, authenticated: true, connectionVersion: 1, address: '0x00000000000000000000000000000000000000aa', chainId: 1 },
  version: 1, mode: initialOptions?.mode ?? 'auto', failNextPrepare: false, executeVersion: undefined, partialResult: false, deferRunner: false, failRunner: false, executionResolvers: [], deferWalletResponse: false, walletResolvers: [],
  prepareCount: 0, planCount: 0, runnerCount: 0, sendCount: 0, draftSaveCount: 0,
  previewRequests: [], nextPreviewRequestId: 1,
  deferRefresh: false, refreshStarted: false, completeStarted: false, refreshResolvers: [],
  previewDelayMs: initialOptions?.previewDelayMs ?? 0, refreshDelayMs: initialOptions?.refreshDelayMs ?? 0, accountRefreshCount: 0,
};

type HarnessRoute = PlannedRoute & { harnessRouteVersion: number; harnessConnectionVersion: number };

const routeFor = (version: number): HarnessRoute => ({
  operation: 'increasePosition', chainId: 1, walletAddress: H.wallet.address! as Address,
  harnessRouteVersion: version, harnessConnectionVersion: H.wallet.connectionVersion,
  transactions: [{ chainId: 1, from: H.wallet.address! as Address, to: '0x00000000000000000000000000000000000000bb' as Address, data: '0x12345678' as Hex, value: 0n, kind: 'action', type: 'increasePosition', operation: 'increasePosition' }],
  details: { routeType: `Terms ${version}` },
});

function Harness() {
  const [, redraw] = useState(0);
  const [version, setVersion] = useState(H.version);
  const [builderRevision, setBuilderRevision] = useState(0);
  const [resumeReview, setResumeReview] = useState(0);
  const [disabled, setDisabled] = useState(false);
  const [builderAvailable, setBuilderAvailable] = useState(true);
  const draftState = useMemo(() => ({ action: 'increase', amount: String(version), side: 'long' }), [version]);
  // Expose the redraw callback during the first render as well as the effect;
  // the readiness marker is rendered before effects flush, and the reconnect
  // controls must never lose their first state transition in that window.
  H.rerender = () => redraw((value) => value + 1);
  useEffect(() => () => { H.rerender = undefined; }, []);
  const planBuilder = useCallback(async () => {
    H.planCount += 1;
    const route = routeFor(H.executeVersion ?? version);
    return route;
  }, [builderRevision, version]);
  const setTerms = () => { H.version = version + 1; setVersion((value) => value + 1); };
  const disconnect = () => { H.wallet = { ...H.wallet, ready: true, authenticated: false, address: undefined, chainId: undefined }; H.rerender?.(); };
  const connect = () => { H.wallet = { ready: true, authenticated: true, connectionVersion: H.wallet.connectionVersion + 1, address: '0x00000000000000000000000000000000000000aa', chainId: 1 }; H.rerender?.(); };
  return <>
    <div data-harness-ready="true" />
    <div role="toolbar">
      <button type="button" onClick={setTerms}>Change terms</button>
      <button type="button" onClick={() => setBuilderRevision((value) => value + 1)}>Recreate planner</button>
      <button type="button" onClick={() => setDisabled((value) => !value)}>{disabled ? 'Enable action' : 'Disable action'}</button>
      <button type="button" onClick={() => setBuilderAvailable((value) => !value)}>{builderAvailable ? 'Remove planner' : 'Restore planner'}</button>
      <button type="button" onClick={disconnect}>Disconnect</button>
      <button type="button" onClick={connect}>Reconnect</button>
      <button type="button" onClick={() => { H.mode = 'deferred'; }}>Defer preview</button>
      <button type="button" onClick={() => setResumeReview((value) => value + 1)}>Resume review</button>
      <button type="button" onClick={() => { H.deferRunner = true; }}>Defer before wallet request</button>
      <button type="button" onClick={() => { H.deferWalletResponse = true; }}>Defer wallet response</button>
      <button type="button" onClick={() => { H.walletResolvers.shift()?.(); }}>Resolve wallet response</button>
      <button type="button" onClick={() => { H.failRunner = true; }}>Fail before wallet request</button>
      <button type="button" onClick={() => { H.executeVersion = version + 1; }}>Change planner after quote</button>
      <button type="button" onClick={() => { H.executeVersion = version + 1; H.rerender?.(); }}>Change quote terms to v{version + 1}</button>
      <button type="button" onClick={() => { H.failNextPrepare = true; setTerms(); }}>Fail next preview</button>
      <button type="button" onClick={() => {
        const pending = H.previewRequests.find((request) => !request.settled);
        if (pending) pending.resolve();
      }}>Resolve oldest preview</button>
      <button type="button" onClick={() => { H.executionResolvers.shift()?.(); }}>Resolve execution</button>
      <button type="button" onClick={() => { H.deferRefresh = true; }}>Defer wallet refresh</button>
      <button type="button" onClick={() => { H.partialResult = true; }}>Return partial result</button>
      <button type="button" onClick={() => { H.refreshResolvers.shift()?.(); }}>Resolve wallet refresh</button>
    </div>
    <ActionReview
      planBuilder={builderAvailable ? planBuilder : null}
      label="Review position"
      operationLabel={`Open position v${version}`}
      surface="content"
      resumeReview={resumeReview}
      draftState={draftState}
      disabled={disabled}
      editor={<p>Editor terms v{version}</p>}
      onComplete={async () => {
        H.completeStarted = true;
        H.rerender?.();
      }}
    />
    <p>Account value: <output aria-label="Refreshed account value">{H.accountRefreshCount > 0 ? '1.25 ETH' : 'Waiting for account refresh'}</output></p>
    <output data-metrics>{JSON.stringify({ prepare: H.prepareCount, plan: H.planCount, runner: H.runnerCount, send: H.sendCount, draftSave: H.draftSaveCount, refreshStarted: H.refreshStarted, completeStarted: H.completeStarted })}</output>
  </>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
