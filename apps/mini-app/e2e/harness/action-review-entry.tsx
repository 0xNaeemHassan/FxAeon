import React, { useCallback, useEffect, useState } from 'react';
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
  wallet: WalletState; version: number; mode: 'auto' | 'deferred'; failNextPrepare: boolean; executeVersion?: number;
  deferRunner: boolean; failRunner: boolean; executionResolvers: Array<() => void>; lastExecutedRouteVersion?: number;
  prepareCount: number; planCount: number; runnerCount: number; sendCount: number; draftSaveCount: number;
  previewRequests: PreviewRequest[]; nextPreviewRequestId: number;
  deferRefresh: boolean; refreshStarted: boolean; completeStarted: boolean; refreshResolvers: Array<() => void>; rerender?: () => void;
};

const initialMode = (globalThis as typeof globalThis & { __actionReviewHarnessInitialMode?: 'auto' | 'deferred' }).__actionReviewHarnessInitialMode;
const H = (globalThis as typeof globalThis & { __actionReviewHarness?: HarnessState }).__actionReviewHarness ??= {
  wallet: { ready: true, authenticated: true, connectionVersion: 1, address: '0x00000000000000000000000000000000000000aa', chainId: 1 },
  version: 1, mode: initialMode ?? 'auto', failNextPrepare: false, executeVersion: undefined, deferRunner: false, failRunner: false, executionResolvers: [],
  prepareCount: 0, planCount: 0, runnerCount: 0, sendCount: 0, draftSaveCount: 0,
  previewRequests: [], nextPreviewRequestId: 1,
  deferRefresh: false, refreshStarted: false, completeStarted: false, refreshResolvers: [],
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
  const [resumeReview, setResumeReview] = useState(0);
  const [reviewBeforeSign, setReviewBeforeSign] = useState(false);
  // Expose the redraw callback during the first render as well as the effect;
  // the readiness marker is rendered before effects flush, and the reconnect
  // controls must never lose their first state transition in that window.
  H.rerender = () => redraw((value) => value + 1);
  useEffect(() => () => { H.rerender = undefined; }, []);
  const planBuilder = useCallback(async () => {
    H.planCount += 1;
    const route = routeFor(H.executeVersion ?? version);
    return route;
  }, [version]);
  const setTerms = () => { H.version = version + 1; setVersion((value) => value + 1); };
  const disconnect = () => { H.wallet = { ...H.wallet, ready: true, authenticated: false, address: undefined, chainId: undefined }; H.rerender?.(); };
  const connect = () => { H.wallet = { ready: true, authenticated: true, connectionVersion: H.wallet.connectionVersion + 1, address: '0x00000000000000000000000000000000000000aa', chainId: 1 }; H.rerender?.(); };
  return <>
    <div data-harness-ready="true" />
    <div role="toolbar">
      <button type="button" onClick={() => setReviewBeforeSign(true)}>Use explicit review</button>
      <button type="button" onClick={setTerms}>Change terms</button>
      <button type="button" onClick={disconnect}>Disconnect</button>
      <button type="button" onClick={connect}>Reconnect</button>
      <button type="button" onClick={() => { H.mode = 'deferred'; }}>Defer preview</button>
      <button type="button" onClick={() => setResumeReview((value) => value + 1)}>Resume legacy review</button>
      <button type="button" onClick={() => { H.deferRunner = true; }}>Defer before wallet request</button>
      <button type="button" onClick={() => { H.failRunner = true; }}>Fail before wallet request</button>
      <button type="button" onClick={() => { H.executeVersion = version + 1; }}>Change planner after quote</button>
      <button type="button" onClick={() => { H.failNextPrepare = true; setTerms(); }}>Fail next preview</button>
      <button type="button" onClick={() => {
        const pending = H.previewRequests.find((request) => !request.settled);
        if (pending) pending.resolve();
      }}>Resolve oldest preview</button>
      <button type="button" onClick={() => { H.executionResolvers.shift()?.(); }}>Resolve execution</button>
      <button type="button" onClick={() => { H.deferRefresh = true; }}>Defer wallet refresh</button>
      <button type="button" onClick={() => { H.refreshResolvers.shift()?.(); }}>Resolve wallet refresh</button>
    </div>
    <ActionReview
      reviewBeforeSign={reviewBeforeSign}
      planBuilder={planBuilder}
      label="Review position"
      operationLabel={`Open position v${version}`}
      surface="content"
      resumeReview={resumeReview}
      editor={<p>Editor terms v{version}</p>}
      onComplete={async () => {
        H.completeStarted = true;
        H.rerender?.();
      }}
    />
    <output data-metrics>{JSON.stringify({ prepare: H.prepareCount, plan: H.planCount, runner: H.runnerCount, send: H.sendCount, draftSave: H.draftSaveCount, refreshStarted: H.refreshStarted, completeStarted: H.completeStarted })}</output>
  </>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
