'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prepareRoutesForReview, runTransactionRoute, type PlannedRoute, type PlanStatus, type TransactionExecutionResult, type TransactionStepResult } from '@/lib/fx';
import { cancelSignatureRequiredDraft, removeSignatureRequiredDraft, saveSignatureRequiredDraft } from '@/lib/fx';
import { useRouteGasCost } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { useInvalidateWalletData } from '@/components/WalletDataProvider';
import { createRouteWalletRefresh } from '@/lib/walletDataRefresh';
import { haptic } from '@/lib/telegram';
import { userSafeError } from '@/lib/errors';
import { hasTransactionHash, transactionStepProgress } from '@/lib/transactionProgress';
import { chainName } from '@/components/review/ReviewProgress';
import { primaryReviewFacts } from '@/components/review/actionReviewPresentation';
import { changedConsequenceFacts, reviewGenerationIsCurrent, updatedRouteTermsRequired, type ChangedReviewFact, type ReviewTransition } from '@/components/review/actionReviewModel';
import { useActionReviewController } from '@/components/review/useActionReviewController';
import type { ActionPlanBuilder, ActionReviewProps } from './actionReviewTypes';

const PREVIEW_REFRESH_INTERVAL_MS = 15_000;
const PREVIEW_FRESHNESS_MS = 30_000;

function asRoutes(value: PlannedRoute | readonly PlannedRoute[]): PlannedRoute[] {
  const routes = Array.isArray(value) ? [...value] : [value];
  if (!routes.length) throw new Error('No executable transaction route was returned.');
  return routes;
}

function safePreviewFailure(cause: unknown, fallback: string): string {
  const message = userSafeError(cause, fallback);
  if (!message || /0x[a-f\d]{128,}|\bcalldata\b|raw (?:rpc|transaction) data/i.test(message)) return fallback;
  return message.length > 150 ? message.slice(0, 147).trimEnd() + '…' : message;
}

function signatureDraftActionKey(route: PlannedRoute): string {
  const details = route.details;
  return [route.operation, details?.routeType ?? '', details?.positionId ?? '', details?.requestedAmount ?? '', details?.requestedLeverage ?? '', details?.slippagePercent ?? '', route.transactions.length].join(':').slice(0, 160);
}

export function useActionReviewLifecycle(props: ActionReviewProps) {
  const {
    planBuilder,
    prefetchedPlan,
    disabled = false,
    onComplete,
    operationLabel,
    onStageChange,
    draftState,
    draftActionKey,
    draftResumePath,
    resumeReview = 0,
  } = props;

  const wallet = usePrivyWallet();
  const invalidateWalletData = useInvalidateWalletData();
  const { stage, acceptRoute, expireQuote, clearAcceptedRoute, quoteExpired, acceptedTerms, transition: transitionStage, matchesAcceptedRoute, bindSession, clearSession, reviewSession, sessionMismatch, checkSession } = useActionReviewController();
  const [routes, setRoutes] = useState<PlannedRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PlanStatus>('planning');
  const [statusDetail, setStatusDetail] = useState('');
  const [result, setResult] = useState<TransactionExecutionResult | null>(null);
  const [stepResults, setStepResults] = useState<TransactionStepResult[]>([]);
  const [executionRoute, setExecutionRoute] = useState<PlannedRoute | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewTitle, setReviewTitle] = useState<string | null>(null);
  const [quoteChanges, setQuoteChanges] = useState<ChangedReviewFact[]>([]);
  const [networkSwitching, setNetworkSwitching] = useState(false);
  const [resumeAfterConnect, setResumeAfterConnect] = useState(false);
  const [previewRoutes, setPreviewRoutes] = useState<PlannedRoute[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUpdating, setPreviewUpdating] = useState(false);
  const [previewPreparedAt, setPreviewPreparedAt] = useState<number | null>(null);
  const [previewIsStale, setPreviewIsStale] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const transition = useCallback((event: ReviewTransition) => {
    transitionStage(event, status === 'awaiting-user');
  }, [status, transitionStage]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // React state updates are asynchronous; latch before any wallet request so
  // repeated clicks in the same frame cannot start a second execution.
  const busyRef = useRef(false);
  const executionStepsRef = useRef<TransactionStepResult[]>([]);
  const signatureDraftIdRef = useRef<string | null>(null);
  const resumedReviewRef = useRef<number | null>(null);
  // Every asynchronous planning/execution attempt owns a generation. Route,
  // account, and component changes invalidate the generation so late SDK/RPC
  // responses can never repopulate a newer wallet session.
  const generationRef = useRef(0);
  const previewGenerationRef = useRef(0);
  const previewRouteRef = useRef<PlannedRoute | null>(null);
  const previewPreparedAtRef = useRef<number | null>(null);
  const previewOwnerRef = useRef<{ intentKey: string | ActionPlanBuilder | null; walletAddress?: string; chainId?: number; connectionVersion: number } | null>(null);
  const planBuilderRef = useRef(planBuilder);
  const prefetchedPlanRef = useRef(prefetchedPlan);
  const mountedRef = useRef(true);
  const liveWalletRef = useRef({
    authenticated: wallet.authenticated,
    address: wallet.address,
    chainId: wallet.chainId,
    connectionVersion: wallet.connectionVersion,
  });
  const onStageChangeRef = useRef(onStageChange);
  onStageChangeRef.current = onStageChange;
  planBuilderRef.current = planBuilder;
  prefetchedPlanRef.current = prefetchedPlan;

  const isCurrentGeneration = useCallback((generation: number) => (
    reviewGenerationIsCurrent(mountedRef.current, generationRef.current, generation)
  ), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  // Keep the owning product card synchronized without depending on callback
  // identity (route pages commonly pass an inline setter).
  useEffect(() => {
    onStageChangeRef.current?.(stage);
  }, [stage]);
  liveWalletRef.current = {
    authenticated: wallet.authenticated,
    address: wallet.address,
    chainId: wallet.chainId,
    connectionVersion: wallet.connectionVersion,
  };

  const route = (stage === 'executing' || stage === 'result') && executionRoute
    ? executionRoute
    : routes[selectedRoute];
  const previewRoute = stage === 'input' ? previewRoutes[selectedRoute] ?? previewRoutes[0] : undefined;
  const activeRoute = stage === 'input' ? previewRoute : route;
  const gasCost = useRouteGasCost(activeRoute, { enabled: Boolean(activeRoute && stage !== 'planning') });
  const previewIntentKey = draftState === undefined ? planBuilder : JSON.stringify(draftState);
  const previousIntentKey = useRef<typeof previewIntentKey>(previewIntentKey);

  // Prepare a read-only, debounced route while the editor remains mounted.
  // This supplies useful facts before the primary action, but it never changes
  // stage or opens a wallet. The generation and wallet checks discard late
  // results after input, account, network, or component changes.
  useEffect(() => {
    // The input preview lifecycle must stop when entering the separate review
    // surface, but it must leave the review's own freshness timestamp intact.
    // Otherwise the review() timestamp below is immediately cleared here.
    if (stage !== 'input') {
      setPreviewLoading(false);
      setPreviewUpdating(false);
      return undefined;
    }

    previewGenerationRef.current += 1;
    const previewGeneration = previewGenerationRef.current;
    const previewWalletAddress = wallet.address?.toLowerCase();
    const previewChainId = wallet.chainId;
    const previewConnectionVersion = wallet.connectionVersion;
    let cancelled = false;
    let running = false;
    let timer: number | undefined;

    const previousPreview = previewRouteRef.current;
    const previousOwner = previewOwnerRef.current;
    const preservePreview = Boolean(
      previousPreview
      && previousOwner?.intentKey === previewIntentKey
      && previousOwner.connectionVersion === previewConnectionVersion
      && previousPreview.walletAddress.toLowerCase() === previewWalletAddress
      && previousPreview.chainId === previewChainId,
    );
    previewOwnerRef.current = {
      intentKey: previewIntentKey,
      walletAddress: previewWalletAddress,
      chainId: previewChainId,
      connectionVersion: previewConnectionVersion,
    };
    previewRouteRef.current = preservePreview ? previousPreview : null;
    setPreviewRoutes(preservePreview ? [previousPreview!] : []);
    if (!preservePreview) {
      previewPreparedAtRef.current = null;
      setPreviewPreparedAt(null);
      setPreviewIsStale(true);
    }
    setPreviewError(null);

    const isVisibleAndOnline = () => (
      (typeof document === 'undefined' || document.visibilityState === 'visible')
      && (typeof navigator === 'undefined' || navigator.onLine !== false)
    );
    const isCurrentPreview = () => {
      const liveWallet = liveWalletRef.current;
      return !cancelled
        && reviewGenerationIsCurrent(mountedRef.current, previewGenerationRef.current, previewGeneration)
        && stage === 'input'
        && liveWallet.authenticated
        && liveWallet.address?.toLowerCase() === previewWalletAddress
        && liveWallet.chainId === previewChainId
        && liveWallet.connectionVersion === previewConnectionVersion;
    };
    const schedule = (delay: number) => {
      if (cancelled) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        if (isVisibleAndOnline()) void load();
        else schedule(PREVIEW_REFRESH_INTERVAL_MS);
      }, delay);
    };
    const load = async () => {
      if (running || !isCurrentPreview()) return;
      if (!isVisibleAndOnline()) {
        schedule(PREVIEW_REFRESH_INTERVAL_MS);
        return;
      }
      running = true;
      const hasCurrentQuote = Boolean(previewRouteRef.current);
      if (!hasCurrentQuote) setPreviewLoading(true);
      setPreviewUpdating(hasCurrentQuote);
      setPreviewError(null);
      try {
        const currentPlanBuilder = planBuilderRef.current;
        if (!currentPlanBuilder) throw new Error('Enter valid action details to prepare a quote.');
        const prefetched = await prefetchedPlanRef.current?.();
        if (!isCurrentPreview()) return;
        const planned = asRoutes(prefetched ?? await currentPlanBuilder());
        if (!isCurrentPreview()) return;
        const { viable, failures } = await prepareRoutesForReview(planned, previewWalletAddress!);
        if (!isCurrentPreview()) return;
        if (!viable.length) {
          const reason = failures
            .map((failure) => safePreviewFailure(failure, ''))
            .find(Boolean);
          throw new Error(reason ?? 'No executable transaction route is available.');
        }
        const currentType = previewRouteRef.current?.details?.routeType;
        const selectedIndex = currentType
          ? viable.findIndex((candidate) => candidate.details?.routeType === currentType)
          : -1;
        const nextIndex = selectedIndex >= 0 ? selectedIndex : 0;
        setPreviewRoutes(viable);
        setSelectedRoute(nextIndex);
        previewRouteRef.current = viable[nextIndex] ?? null;
        const preparedAt = Date.now();
        previewPreparedAtRef.current = preparedAt;
        setPreviewPreparedAt(preparedAt);
        setPreviewIsStale(false);
      } catch (cause) {
        if (isCurrentPreview()) {
          if (!previewRouteRef.current) setPreviewRoutes([]);
          const quoteIsFresh = Boolean(previewPreparedAtRef.current && Date.now() - previewPreparedAtRef.current < PREVIEW_FRESHNESS_MS);
          setPreviewIsStale(!quoteIsFresh);
          const reason = safePreviewFailure(cause, 'Try again.');
          setPreviewError(previewRouteRef.current
            ? quoteIsFresh
              ? `Quote refresh failed: ${reason}. The shown quote is still current.`
              : `Quote refresh failed: ${reason}. Refresh before continuing.`
            : `Could not prepare: ${reason}`);
        }
      } finally {
        running = false;
        if (isCurrentPreview()) {
          setPreviewLoading(false);
          setPreviewUpdating(false);
          schedule(PREVIEW_REFRESH_INTERVAL_MS);
        }
      }
    };

    if (!planBuilderRef.current || disabled || !wallet.ready || !wallet.authenticated || !previewWalletAddress) {
      setPreviewLoading(false);
      setPreviewUpdating(false);
      return undefined;
    }
    schedule(350);
    const refreshWhenActive = () => {
      if (!isCurrentPreview() || running || !isVisibleAndOnline()) return;
      if (previewPreparedAtRef.current === null || Date.now() - previewPreparedAtRef.current >= PREVIEW_FRESHNESS_MS) setPreviewIsStale(true);
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      void load();
    };
    document.addEventListener('visibilitychange', refreshWhenActive);
    window.addEventListener('online', refreshWhenActive);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshWhenActive);
      window.removeEventListener('online', refreshWhenActive);
      if (previewGenerationRef.current === previewGeneration) previewGenerationRef.current += 1;
    };
  }, [disabled, previewIntentKey, previewRetry, stage, wallet.address, wallet.authenticated, wallet.chainId, wallet.connectionVersion, wallet.ready]);

  useEffect(() => {
    if ((stage !== 'input' && stage !== 'review') || previewPreparedAt === null) return undefined;
    const remaining = Math.max(0, PREVIEW_FRESHNESS_MS - (Date.now() - previewPreparedAt));
    const timer = window.setTimeout(() => {
      setPreviewIsStale(true);
      if (stage === 'review') {
        expireQuote();
        setError('This quote expired. Review an updated quote before signing.');
      }
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [expireQuote, previewPreparedAt, stage]);

  useEffect(() => {
    previewRouteRef.current = previewRoutes[selectedRoute] ?? previewRoutes[0] ?? null;
  }, [previewRoutes, selectedRoute]);

  useEffect(() => {
    if (stage === 'review' || stage === 'result') {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [stage]);

  const reset = useCallback(() => {
    if (busyRef.current) return;
    generationRef.current += 1;
    if (signatureDraftIdRef.current) {
      cancelSignatureRequiredDraft(signatureDraftIdRef.current);
      signatureDraftIdRef.current = null;
    }
    transition('return-to-input');
    setNetworkSwitching(false);
    setRoutes([]);
    setSelectedRoute(0);
    setError(null);
    setResult(null);
    setStepResults([]);
    setExecutionRoute(null);
    executionStepsRef.current = [];
    setRefreshing(false);
    setReviewTitle(null);
    clearAcceptedRoute();
    clearSession();
    setResumeAfterConnect(false);
    setStatus('planning');
    setStatusDetail('');
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, [clearAcceptedRoute, clearSession, transition]);

  useEffect(() => {
    const onTelegramBack = (event: Event) => {
      if (stage !== 'review' && stage !== 'result') return;
      const detail = (event as CustomEvent<{ consume?: () => void; isConsumed?: () => boolean }>).detail;
      if (detail?.isConsumed?.()) return;
      reset();
      detail?.consume?.();
    };
    window.addEventListener('fxaeon:telegram-back', onTelegramBack);
    return () => window.removeEventListener('fxaeon:telegram-back', onTelegramBack);
  }, [reset, stage]);

  const invalidatePreparedRoute = useCallback((message: string) => {
    generationRef.current += 1;
    if (signatureDraftIdRef.current) {
      cancelSignatureRequiredDraft(signatureDraftIdRef.current);
      signatureDraftIdRef.current = null;
    }
    transition('return-to-input');
    setRoutes([]);
    setSelectedRoute(0);
    setResult(null);
    setStepResults([]);
    setExecutionRoute(null);
    setReviewTitle(null);
    expireQuote();
    clearSession();
    setResumeAfterConnect(false);
    setStatus('planning');
    setStatusDetail('');
    setLoading(false);
    setRefreshing(false);
    setNetworkSwitching(false);
    busyRef.current = false;
    setError(message);
  }, [clearSession, expireQuote, transition]);

  // Bind the reviewed route to logical form intent. Callers with a primitive
  // draft snapshot may recreate planners during claim/balance polling without
  // changing what the user accepted.
  useEffect(() => {
    if (previousIntentKey.current !== previewIntentKey) {
      previousIntentKey.current = previewIntentKey;
      if (stage === 'review') {
        invalidatePreparedRoute('The inputs changed. Check the action again before signing.');
      }
    }
  }, [invalidatePreparedRoute, previewIntentKey, stage]);

  useEffect(() => {
    // Results are non-signable historical evidence. Retain their original
    // wallet and chain when the active wallet or form changes.
    if (!reviewSession || (stage !== 'review' && stage !== 'executing')) return;
    const currentWallet = wallet.address?.toLowerCase();
    const mismatch = sessionMismatch({
      walletAddress: currentWallet ?? '', authenticated: wallet.authenticated,
      chainId: wallet.chainId, connectionVersion: wallet.connectionVersion,
    });
    if (mismatch) {
      invalidatePreparedRoute(mismatch === 'wallet'
        ? 'The selected wallet changed. Check the action again before signing.'
        : mismatch === 'network'
          ? 'The wallet network changed. Check the action again before signing.'
          : 'The wallet connection changed. Check the action again before signing.');
    }
  }, [invalidatePreparedRoute, reviewSession, sessionMismatch, stage, wallet.address, wallet.authenticated, wallet.chainId, wallet.connectionVersion]);

  const review = useCallback(async () => {
    if (!planBuilder || disabled || loading || busyRef.current || stage !== 'input') return;
    if (!wallet.authenticated || !wallet.address) {
      setError('Connect a wallet before preparing a transaction.');
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const reviewWalletAddress = wallet.address.toLowerCase();
    const reviewChainId = wallet.chainId;
    const reviewConnectionVersion = wallet.connectionVersion;
    const reviewSessionSnapshot = { walletAddress: reviewWalletAddress, chainId: reviewChainId, connectionVersion: reviewConnectionVersion };
    const assertReviewSession = () => {
      if (!isCurrentGeneration(generation)) return false;
      const liveWallet = liveWalletRef.current;
      const mismatch = checkSession(reviewSessionSnapshot, {
        walletAddress: liveWallet.address?.toLowerCase() ?? '', authenticated: liveWallet.authenticated,
        chainId: liveWallet.chainId, connectionVersion: liveWallet.connectionVersion,
      });
      if (mismatch) throw new Error(mismatch === 'wallet'
        ? 'The selected wallet changed while preparing the review.'
        : mismatch === 'network'
          ? 'The wallet network changed while preparing the review.'
          : 'The selected wallet connection changed while preparing the review.');
      return true;
    };
    busyRef.current = true;
    setLoading(true);
    transition('prepare');
    setError(null);
    setStatus('planning');
    setStatusDetail('Preparing a fresh route.');
    try {
      const prefetched = await prefetchedPlan?.();
      if (!assertReviewSession()) return;
      const planned = asRoutes(prefetched ?? await planBuilder());
      if (!assertReviewSession()) return;
      setStatus('reviewing');
      setStatusDetail('Verifying the route.');
      const walletAddress = reviewWalletAddress;
      // Alternatives are independent; checking them concurrently removes one
      // RPC round trip per extra route from the review's critical path.
      const { viable, failures } = await prepareRoutesForReview(planned, walletAddress);
      if (!assertReviewSession()) return;
      if (!viable.length) {
        throw new Error(`The transaction could not be simulated: ${failures.join('; ')}`);
      }
      setRoutes(viable);
      setSelectedRoute(0);
      setStepResults([]);
      executionStepsRef.current = [];
      setExecutionRoute(null);
      // Snapshot the human-readable action with the calldata. Inputs remain
      // visible above the review card, but later form edits must never rename
      // an already reviewed route.
      setReviewTitle(operationLabel ?? viable[0].operation);
      bindSession({ walletAddress, chainId: wallet.chainId, connectionVersion: wallet.connectionVersion });
      setStatus('reviewing');
      setStatusDetail('Route ready.');
      const preparedAt = Date.now();
      acceptRoute(viable[0], previewIntentKey);
      setQuoteChanges([]);
      previewPreparedAtRef.current = preparedAt;
      setPreviewPreparedAt(preparedAt);
      setPreviewIsStale(false);
      transition('prepared');
      haptic('selection');
    } catch (cause) {
      if (!isCurrentGeneration(generation)) return;
      transition('prepare-failed');
      setStatus('failed');
      setError(userSafeError(cause, 'The transaction could not be prepared. Check the inputs and network, then try again.'));
      haptic('error');
    } finally {
      if (isCurrentGeneration(generation)) {
        busyRef.current = false;
        setLoading(false);
      }
    }
  }, [acceptRoute, bindSession, checkSession, disabled, isCurrentGeneration, loading, operationLabel, planBuilder, prefetchedPlan, previewIntentKey, setQuoteChanges, stage, transition, wallet.address, wallet.authenticated, wallet.chainId, wallet.connectionVersion]);

  const refreshReviewedQuote = useCallback(async () => {
    if (stage !== 'review' || !quoteExpired || !planBuilder || disabled || busyRef.current) return;
    const reviewed = routes[selectedRoute];
    if (!reviewed) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const walletAddress = reviewed.walletAddress.toLowerCase();
    const sessionChainId = wallet.chainId;
    const connectionVersion = wallet.connectionVersion;
    const sessionMatches = () => {
      if (!isCurrentGeneration(generation)) return false;
      const live = liveWalletRef.current;
      return live.authenticated
        && live.address?.toLowerCase() === walletAddress
        && live.chainId === sessionChainId
        && live.connectionVersion === connectionVersion;
    };
    busyRef.current = true;
    setLoading(true);
    setError(null);
    setStatus('planning');
    setStatusDetail('Preparing an updated quote.');
    try {
      const planned = asRoutes(await planBuilder());
      if (!sessionMatches()) return;
      setStatus('reviewing');
      const { viable, failures } = await prepareRoutesForReview(planned, walletAddress);
      if (!sessionMatches()) return;
      if (!viable.length) throw new Error(`The updated transaction could not be simulated: ${failures.join('; ')}`);
      const next = viable[0];
      const termsChanged = updatedRouteTermsRequired(acceptedTerms, next);
      const previousFacts = primaryReviewFacts(reviewed);
      const nextFacts = primaryReviewFacts(next);
      const factChanges = changedConsequenceFacts(previousFacts, nextFacts);
      const previousRouteType = reviewed.details?.routeType;
      const nextRouteType = next.details?.routeType;
      if (previousRouteType !== nextRouteType && (previousRouteType || nextRouteType)) {
        factChanges.push({ label: 'Route', before: previousRouteType, after: nextRouteType });
      }
      setQuoteChanges(factChanges);
      setRoutes(viable);
      setSelectedRoute(0);
      setStepResults([]);
      executionStepsRef.current = [];
      setReviewTitle(operationLabel ?? next.operation);
      bindSession({ walletAddress, chainId: sessionChainId, connectionVersion });
      acceptRoute(next, previewIntentKey);
      setPreviewPreparedAt(Date.now());
      previewPreparedAtRef.current = Date.now();
      setPreviewIsStale(false);
      if (termsChanged && factChanges.length === 0) {
        setQuoteChanges([{ label: 'Transaction route', before: 'Previously reviewed route', after: 'Updated route' }]);
      }
      setStatus('reviewing');
      setStatusDetail('Review the updated transaction terms.');
      haptic('selection');
    } catch (cause) {
      if (sessionMatches()) {
        setError(userSafeError(cause, 'The updated quote could not be prepared. The reviewed terms remain unchanged.'));
        setStatus('failed');
      }
    } finally {
      if (isCurrentGeneration(generation)) {
        busyRef.current = false;
        setLoading(false);
      }
    }
  }, [acceptRoute, acceptedTerms, bindSession, disabled, isCurrentGeneration, operationLabel, planBuilder, previewIntentKey, quoteExpired, routes, selectedRoute, stage, wallet.chainId, wallet.connectionVersion]);

  // History restores editable primitives only. Once the route owner has
  // applied those values and exposes its planner, immediately reopen the
  // exact review surface so the user can continue signing without having to
  // press Review a second time. This is deliberately one-shot per nonce:
  // reconnects and planner refreshes can never trigger an implicit wallet
  // request or loop back into review.
  useEffect(() => {
    if (resumeReview <= 0) {
      resumedReviewRef.current = null;
      return;
    }
    if (resumedReviewRef.current === resumeReview || stage !== 'input' || loading || disabled) return;
    if (!wallet.authenticated || !wallet.address || !planBuilder) return;
    resumedReviewRef.current = resumeReview;
    void review();
  }, [disabled, loading, planBuilder, resumeReview, review, stage, wallet.address, wallet.authenticated]);

  const execute = useCallback(async (inputRoute?: PlannedRoute) => {
    const startingRoute = inputRoute ?? route;
    const directFromInput = stage === 'input' && Boolean(inputRoute);
    if (disabled || !planBuilder || !startingRoute || loading || busyRef.current || (!directFromInput && stage !== 'review') || (!directFromInput && status === 'failed') || stepResults.some(hasTransactionHash)) return;
    if (!directFromInput && (!matchesAcceptedRoute(startingRoute, previewIntentKey) || quoteExpired)) {
      expireQuote();
      setError('Action details changed. Refresh and review the updated terms before signing.');
      setStatus('reviewing');
      return;
    }
    const executionWalletAddress = startingRoute.walletAddress.toLowerCase();
    const previewOwner = previewOwnerRef.current;
    const previewSessionMatches = previewOwner?.intentKey === previewIntentKey
      && previewOwner.walletAddress?.toLowerCase() === executionWalletAddress
      && previewOwner.chainId === wallet.chainId
      && previewOwner.connectionVersion === wallet.connectionVersion;
    if ((directFromInput && !previewSessionMatches)
      || !previewPreparedAtRef.current
      || Date.now() - previewPreparedAtRef.current >= PREVIEW_FRESHNESS_MS) {
      setPreviewIsStale(true);
      if (!directFromInput) expireQuote();
      setError(directFromInput
        ? previewSessionMatches ? 'This quote expired. Refreshing it before continuing.' : 'Action details changed. Updating the quote before continuing.'
        : 'This quote expired. Review an updated quote before signing.');
      if (!directFromInput) {
        setStatus('reviewing');
      } else {
        setPreviewRetry((value) => value + 1);
      }
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const executionConnectionVersion = wallet.connectionVersion;
    const isCurrentExecution = () => {
      if (!isCurrentGeneration(generation)) return false;
      const liveWallet = liveWalletRef.current;
      return liveWallet.authenticated
        && liveWallet.address?.toLowerCase() === executionWalletAddress
        && liveWallet.connectionVersion === executionConnectionVersion;
    };
    busyRef.current = true;
    setLoading(true);
    setError(null);
    // Bind the displayed route to this wallet session before simulation.
    // Deliberate network switching remains valid during execution, while
    // account/reconnect changes invalidate this context.
    bindSession({ walletAddress: executionWalletAddress, connectionVersion: executionConnectionVersion });
    transition('begin-signing');
    // Keep the displayed route visible while the runner performs its final
    // policy validation and simulation immediately before each wallet request.
    setExecutionRoute(startingRoute);
    setStatus('planning');
    setStatusDetail('Checking the displayed quote before signing.');
    setStepResults([]);
    executionStepsRef.current = [];
    setRefreshing(false);
    // Scope refreshes to the captured review, never the currently selected wallet.
    const refreshWallet = createRouteWalletRefresh(invalidateWalletData);
    const currentRoute = startingRoute;
    let postConfirmReadStarted = false;
    try {
      setExecutionRoute(currentRoute);
      const execution = await runTransactionRoute({
        route: currentRoute,
        callbacks: {
          ensureChain: async (chainId) => {
            if (!isCurrentExecution()) throw new Error('The selected wallet changed before the network switch.');
            setNetworkSwitching(true);
            try {
              await wallet.switchChain(chainId);
              if (!isCurrentExecution()) throw new Error('The selected wallet changed during the network switch.');
            } finally {
              if (isCurrentExecution()) setNetworkSwitching(false);
            }
          },
          requestSignature: async (request) => {
            const liveWallet = liveWalletRef.current;
            if (!isCurrentExecution()
              || !liveWallet.authenticated
              || liveWallet.address?.toLowerCase() !== request.from.toLowerCase()
              || liveWallet.connectionVersion !== executionConnectionVersion) {
              throw new Error('The selected wallet changed before signing.');
            }
            setStatus('awaiting-user');
            setStatusDetail('Review this transaction in your wallet.');
            // Persist the unsigned resume hint only after the runner's final
            // validation/simulation has reached the wallet request boundary.
            if (!signatureDraftIdRef.current) {
              try {
                const draft = saveSignatureRequiredDraft({
                  walletAddress: startingRoute.walletAddress,
                  chainId: startingRoute.chainId,
                  operation: startingRoute.operation,
                  actionKey: draftActionKey ?? signatureDraftActionKey(startingRoute),
                  resumePath: draftResumePath ?? `${window.location.pathname}${window.location.search}${window.location.hash}`,
                  formState: draftState,
                });
                signatureDraftIdRef.current = draft.id;
              } catch {
                signatureDraftIdRef.current = null;
              }
            }
            const signed = await wallet.sendTransaction({
              chainId: request.chainId,
              from: request.from,
              to: request.to,
              data: request.data,
              value: request.value,
              nonce: request.nonce,
            }, {
              action: `${reviewTitle ?? currentRoute.operation} · ${request.to}`,
              description: `Check this transaction on ${chainName(request.chainId)} before approving it.`,
              buttonText: 'Confirm transaction',
            });
            if (isCurrentExecution() && signatureDraftIdRef.current) {
              removeSignatureRequiredDraft(signatureDraftIdRef.current);
              signatureDraftIdRef.current = null;
            }
            return signed.hash;
          },
          onStatus: (next, detail) => {
            if (!isCurrentExecution()) return;
            setStatus(next);
            setStatusDetail(detail ? userSafeError(detail, 'The transaction could not continue. Check the network and try again.') : '');
          },
          onStep: (step) => {
            if (!isCurrentExecution()) return;
            const next = [...executionStepsRef.current];
            next[step.index] = step;
            executionStepsRef.current = next;
            setStepResults(next);
          },
          // The runner invokes this only after a receipt and the required
          // confirmation depth have both been observed. Publish the receipt
          // result before the optional state refresh so the user sees the
          // confirmed action immediately while the read runs in the background.
          postConfirmRead: async (confirmedRoute, execution) => {
            if (!isCurrentExecution()) return;
            postConfirmReadStarted = true;
            setResult(execution);
            transition('completed');
            setRefreshing(true);
            try {
              // These reads have independent cache boundaries. Start both
              // immediately so a slow wallet refresh cannot delay the
              // receipt-bound position hint or other completion bookkeeping.
              // Each task is scoped before it starts; the owning callbacks
              // retain their own account/session guards for late results.
              const refreshPromise = Promise.resolve().then(() => {
                if (!isCurrentExecution()) return;
                return refreshWallet(confirmedRoute, execution);
              });
              const completePromise = Promise.resolve().then(() => {
                if (!isCurrentExecution()) return;
                return onComplete?.(execution, confirmedRoute);
              });
              const outcomes = await Promise.allSettled([refreshPromise, completePromise]);
              if (!isCurrentExecution()) return;
              const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
              if (rejected) throw rejected.reason;
            } finally {
              if (isCurrentExecution()) setRefreshing(false);
            }
          },
        },
      });
      if (!isCurrentExecution()) return;
      // A finality/confirmation timeout can skip postConfirmRead despite
      // inclusion. Mark wallet data stale for gas/approvals/reverts without
      // duplicating the refresh already running behind the result view.
      if (!postConfirmReadStarted) await refreshWallet(currentRoute, execution);
      if (!isCurrentExecution()) return;
      setResult(execution);
      transition('completed');
      const uncertain = execution.steps.some((step) => ['unknown', 'unverified'].includes(transactionStepProgress(step).state));
      haptic(execution.status === 'confirmed' ? 'success' : execution.status === 'partial' || uncertain ? 'warning' : 'error');
    } catch (cause) {
      if (!isCurrentExecution()) return;
      const message = userSafeError(cause, 'The transaction could not continue. No later step was submitted.');
      const submittedSteps = executionStepsRef.current;
      if (submittedSteps.some(hasTransactionHash)) {
        // A UI/observer exception cannot erase a broadcast hash or reopen a
        // signing action. The existing journal remains the recovery authority.
        const interrupted: TransactionExecutionResult = {
          status: submittedSteps.some((step) => step.status === 'confirmed') ? 'partial' : 'failed',
          operation: currentRoute.operation,
          chainId: currentRoute.chainId,
          walletAddress: currentRoute.walletAddress,
          steps: submittedSteps.map((step) => step.status === 'submitted' ? { ...step, status: 'failed', error: message } : step),
          error: message,
        };
        await refreshWallet(currentRoute, interrupted);
        setResult(interrupted);
        transition('interrupted');
      } else {
        if (signatureDraftIdRef.current) {
          cancelSignatureRequiredDraft(signatureDraftIdRef.current);
          signatureDraftIdRef.current = null;
        }
        setError(message);
        if (directFromInput) {
          setPreviewRoutes([startingRoute]);
          previewRouteRef.current = startingRoute;
          setExecutionRoute(null);
          setStatus('planning');
          transition('return-to-input');
        } else {
          transition('signing-failed');
        }
      }
      setStatus('failed');
      // A failed or stale route must be explicitly reviewed again. This is
      // especially important when the runner rejects a changed minOut,
      // converter path, leverage, or transformed reduction amount.
      haptic(submittedSteps.some(hasTransactionHash) ? 'warning' : 'error');
    } finally {
      if (isCurrentGeneration(generation)) {
        busyRef.current = false;
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, [bindSession, disabled, draftActionKey, draftResumePath, draftState, expireQuote, invalidateWalletData, isCurrentGeneration, loading, matchesAcceptedRoute, onComplete, planBuilder, previewIntentKey, quoteExpired, reviewTitle, route, stage, status, stepResults, transition, wallet]);

  // A connect click leaves the editor and its read-only preview in place. It
  // never opens the legacy review surface or requests a signature; the user
  // must click the action again after the wallet is connected.
  useEffect(() => {
    if (!resumeAfterConnect || stage !== 'input' || !wallet.authenticated || !wallet.address) return;
    if (disabled) {
      setResumeAfterConnect(false);
      return;
    }
    setResumeAfterConnect(false);
  }, [disabled, resumeAfterConnect, stage, wallet.address, wallet.authenticated]);

  const routeSummaries = useMemo(() => routes.map((candidate) => {
    const routeType = candidate.details?.routeType ?? 'Route';
    const approvals = candidate.transactions.filter((transaction) => transaction.kind === 'approval').length;
    return { routeType, approvals, count: candidate.transactions.length };
  }), [routes]);
  const selectPreviewRoute = useCallback((index: number) => setSelectedRoute(index), []);
  const selectReviewedRoute = useCallback((index: number) => {
    if (busyRef.current || stage !== 'review') return;
    const candidate = routes[index];
    if (!candidate) return;
    setSelectedRoute(index);
    acceptRoute(candidate, previewIntentKey);
    setStepResults([]);
  }, [acceptRoute, previewIntentKey, routes, stage]);
  const retryPreview = useCallback(() => setPreviewRetry((value) => value + 1), []);
  const startConnectFlow = useCallback(() => { setError(null); setResumeAfterConnect(true); }, []);
  const endConnectFlow = useCallback(() => setResumeAfterConnect(false), []);

  return {
    stage, wallet, route, routes, selectedRoute, routeSummaries,
    status, statusDetail, stepResults, loading, networkSwitching, refreshing,
    error, result, reviewTitle, quoteExpired, quoteChanges,
    previewRoute, previewRoutes, previewLoading, previewUpdating, previewIsStale, previewError, gasCost,
    triggerRef, headingRef, review, execute, refreshReviewedQuote, reset,
    selectPreviewRoute, selectReviewedRoute,
    canSelectReviewedRoute: stage === 'review' && !busyRef.current,
    retryPreview, startConnectFlow, endConnectFlow,
  };
}
