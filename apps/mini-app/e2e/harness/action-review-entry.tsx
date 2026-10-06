import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActionReview } from '@/components/ActionReview';
import { AppShell } from '@/components/ui';
import type { PlannedRoute } from '@/lib/fx';
import type { Address, Hex } from 'viem';

type WalletState = { ready: boolean; authenticated: boolean; isEmbedded: boolean; connectionVersion: number; address?: string; chainId?: 1 | 8453 };
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
  deferRunner: boolean; failRunner: boolean; executionResolvers: Array<() => void>; deferWalletResponse: boolean; walletResolvers: Array<(reject?: boolean) => void>; lastExecutedRouteVersion?: number;
  multiStepExecution: boolean; nonzeroTransactionValues: boolean; gasCost: { status: 'refreshing' | 'unavailable' | 'current'; estimate?: { status: 'current' | 'partial'; nativeValueWei: bigint; executionGasFeeWei?: bigint; totalNativeCostWei?: bigint }; estimateIsCurrent: boolean; error?: string };
  rejectActionSignature: boolean;
  prepareCount: number; planCount: number; runnerCount: number; sendCount: number; draftSaveCount: number; draftCancelCount: number; draftRemoveCount: number;
  feeQuoteCount: number; lastFeeSelection?: unknown;
  previewRequests: PreviewRequest[]; nextPreviewRequestId: number;
  deferRefresh: boolean; refreshStarted: boolean; completeStarted: boolean; refreshResolvers: Array<() => void>; rerender?: () => void;
  approvalRequired: boolean; sentTransactions: Array<{ maxFeePerGas?: string; maxPriorityFeePerGas?: string }>;
  previewDelayMs: number; refreshDelayMs: number; accountRefreshCount: number;
};

const initialOptions = (globalThis as typeof globalThis & { __actionReviewHarnessInitialOptions?: { mode?: 'auto' | 'deferred'; previewDelayMs?: number; refreshDelayMs?: number; presentationMode?: boolean } }).__actionReviewHarnessInitialOptions;
const H = (globalThis as typeof globalThis & { __actionReviewHarness?: HarnessState }).__actionReviewHarness ??= {
  wallet: { ready: true, authenticated: true, isEmbedded: false, connectionVersion: 1, address: '0x00000000000000000000000000000000000000aa', chainId: 1 },
  version: 1, mode: initialOptions?.mode ?? 'auto', failNextPrepare: false, executeVersion: undefined, partialResult: false, deferRunner: false, failRunner: false, executionResolvers: [], deferWalletResponse: false, walletResolvers: [],
  multiStepExecution: false, nonzeroTransactionValues: false, approvalRequired: false, sentTransactions: [], gasCost: initialOptions?.presentationMode
    ? { status: 'current', estimate: { status: 'current', nativeValueWei: 0n, executionGasFeeWei: 840000000000000n, totalNativeCostWei: 840000000000000n }, estimateIsCurrent: true }
    : { status: 'refreshing', estimateIsCurrent: false },
  prepareCount: 0, planCount: 0, runnerCount: 0, sendCount: 0, draftSaveCount: 0, draftCancelCount: 0, draftRemoveCount: 0, feeQuoteCount: 0,
  previewRequests: [], nextPreviewRequestId: 1,
  deferRefresh: false, refreshStarted: false, completeStarted: false, refreshResolvers: [],
  rejectActionSignature: false,
  previewDelayMs: initialOptions?.previewDelayMs ?? 0, refreshDelayMs: initialOptions?.refreshDelayMs ?? 0, accountRefreshCount: 0,
};

type HarnessRoute = PlannedRoute & { harnessRouteVersion: number; harnessConnectionVersion: number };

const routeFor = (version: number): HarnessRoute => ({
  operation: 'increasePosition', chainId: 1, walletAddress: H.wallet.address! as Address,
  harnessRouteVersion: version, harnessConnectionVersion: H.wallet.connectionVersion,
  transactions: [
    ...(H.approvalRequired ? [{ chainId: 1, from: H.wallet.address! as Address, to: '0x00000000000000000000000000000000000000c1' as Address, data: ('0x095ea7b3' + '0'.repeat(24) + '0'.repeat(40) + '0'.repeat(63) + '1') as Hex, value: 0n, kind: 'approval', type: 'approveToken', operation: 'increasePosition' }] : []),
    { chainId: 1, from: H.wallet.address! as Address, to: '0x00000000000000000000000000000000000000bb' as Address, data: '0x12345678' as Hex, value: H.nonzeroTransactionValues ? 123n : 0n, kind: 'action', type: 'increasePosition', operation: 'increasePosition' },
    ...(H.multiStepExecution ? [{ chainId: 1, from: H.wallet.address! as Address, to: '0x00000000000000000000000000000000000000cc' as Address, data: '0x87654321' as Hex, value: H.nonzeroTransactionValues ? 456n : 0n, kind: 'action', type: 'increasePosition', operation: 'increasePosition' }] : []),
  ],
  details: { routeType: `Terms ${version}` },
  ...(initialOptions?.presentationMode ? { policy: { reviewedAction: {
    kind: 'position-increase', poolAddress: '0x00000000000000000000000000000000000000bb' as Address,
    positionId: 42, inputTokenAddress: '0x00000000000000000000000000000000000000c1' as Address,
    inputAmount: 250000000000000000n, nativeInput: false,
    collateralTokenAddress: '0x00000000000000000000000000000000000000c1' as Address,
    debtTokenAddress: '0x00000000000000000000000000000000000000c2' as Address,
    positionType: 'long', requestedLeverage: 3, slippagePercent: 0.5,
  } } } : {}),
});

function Harness() {
  const [, redraw] = useState(0);
  const [version, setVersion] = useState(H.version);
  const [builderRevision, setBuilderRevision] = useState(0);
  const [resumeReview, setResumeReview] = useState(0);
  const [disabled, setDisabled] = useState(false);
  const [builderAvailable, setBuilderAvailable] = useState(true);
  const [reviewMounted, setReviewMounted] = useState(true);
  const presentationMode = Boolean(initialOptions?.presentationMode);
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
  const connect = () => { H.wallet = { ...H.wallet, ready: true, authenticated: true, connectionVersion: H.wallet.connectionVersion + 1, address: '0x00000000000000000000000000000000000000aa', chainId: 1 }; H.rerender?.(); };
  const switchAccount = () => { H.wallet = { ...H.wallet, ready: true, authenticated: true, connectionVersion: H.wallet.connectionVersion + 1, address: '0x00000000000000000000000000000000000000dd', chainId: 1 }; H.rerender?.(); };
  const startOnBase = () => { H.wallet = { ...H.wallet, chainId: 8453 }; H.rerender?.(); };
  const toggleWalletMode = () => { H.wallet = { ...H.wallet, isEmbedded: !H.wallet.isEmbedded, connectionVersion: H.wallet.connectionVersion + 1 }; H.rerender?.(); };
  const contents = <>
    <div data-harness-ready="true" />
    <div role="toolbar" style={presentationMode ? { display: 'none' } : undefined}>
      <button type="button" onClick={setTerms}>Change terms</button>
      <button type="button" onClick={() => setBuilderRevision((value) => value + 1)}>Recreate planner</button>
      <button type="button" onClick={() => setDisabled((value) => !value)}>{disabled ? 'Enable action' : 'Disable action'}</button>
      <button type="button" onClick={() => setBuilderAvailable((value) => !value)}>{builderAvailable ? 'Remove planner' : 'Restore planner'}</button>
      <button type="button" onClick={disconnect}>Disconnect</button>
      <button type="button" onClick={connect}>Reconnect</button>
      <button type="button" onClick={switchAccount}>Switch account</button>
      <button type="button" onClick={startOnBase}>Start on Base</button>
      <button type="button" onClick={toggleWalletMode}>Toggle embedded wallet mode</button>
      <button type="button" onClick={() => { H.mode = 'deferred'; }}>Defer preview</button>
      <button type="button" onClick={() => setResumeReview((value) => value + 1)}>Resume review</button>
      <button type="button" onClick={() => { H.deferRunner = true; }}>Defer before wallet request</button>
      <button type="button" onClick={() => { H.deferWalletResponse = true; }}>Defer wallet response</button>
      <button type="button" onClick={() => { H.walletResolvers.shift()?.(); }}>Resolve wallet response</button>
      <button type="button" onClick={() => { H.walletResolvers.shift()?.(true); }}>Reject wallet response</button>
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
      <button type="button" onClick={() => { H.multiStepExecution = true; H.rerender?.(); }}>Use multi-step route</button>
      <button type="button" onClick={() => { H.nonzeroTransactionValues = true; H.rerender?.(); }}>Use nonzero transaction values</button>
      <button type="button" onClick={() => { H.approvalRequired = true; H.rerender?.(); }}>Use approval route</button>
      <button type="button" onClick={() => { H.rejectActionSignature = true; }}>Reject action signature</button>
      <button type="button" onClick={() => { H.gasCost = { status: 'unavailable', estimateIsCurrent: false, error: 'RPC unavailable' }; H.rerender?.(); }}>Gas estimate unavailable</button>
      <button type="button" onClick={() => { H.gasCost = { status: 'current', estimate: { status: 'current', nativeValueWei: 0n, executionGasFeeWei: 840000000000000n, totalNativeCostWei: 840000000000000n }, estimateIsCurrent: true }; H.rerender?.(); }}>Gas estimate current</button>
      <button type="button" onClick={() => setReviewMounted((mounted) => !mounted)}>{reviewMounted ? 'Unmount review' : 'Mount review'}</button>
    </div>
    {reviewMounted && <ActionReview
      planBuilder={builderAvailable ? planBuilder : null}
      label="Review position"
      operationLabel={presentationMode ? 'Increase ETH Long' : `Open position v${version}`}
      surface={presentationMode ? 'card' : 'content'}
      resumeReview={resumeReview}
      draftState={draftState}
      disabled={disabled}
      editor={<p>Editor terms v{version}</p>}
      onComplete={async () => {
        H.completeStarted = true;
        H.rerender?.();
      }}
    />}
    {!presentationMode && <>
      <p>Account value: <output aria-label="Refreshed account value">{H.accountRefreshCount > 0 ? '1.25 ETH' : 'Waiting for account refresh'}</output></p>
      <output data-metrics>{JSON.stringify({ prepare: H.prepareCount, plan: H.planCount, runner: H.runnerCount, send: H.sendCount, draftSave: H.draftSaveCount, feeQuoteCount: H.feeQuoteCount, hasFeeSelection: H.lastFeeSelection !== null && H.lastFeeSelection !== undefined, refreshStarted: H.refreshStarted, completeStarted: H.completeStarted })}</output>
    </>}
  </>;
  return presentationMode ? <AppShell>{contents}</AppShell> : contents;
}

createRoot(document.getElementById('root')!).render(<Harness />);
