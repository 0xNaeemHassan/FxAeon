'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { decodeFunctionData, formatEther, formatUnits } from 'viem';
import {
  FX_TOKENS,
  prepareRoutesForReview,
  runTransactionRoute,
  routesMatchForSigning,
  selectRefreshedRoute,
  type PlannedRoute,
  type PlannedTransaction,
  type PlanStatus,
  type TransactionExecutionResult,
  type TransactionStepResult,
} from '@/lib/fx';
import { cancelSignatureRequiredDraft, removeSignatureRequiredDraft, saveSignatureRequiredDraft, type SignatureDraftState } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { useInvalidateWalletData } from '@/components/WalletDataProvider';
import { createRouteWalletRefresh } from '@/lib/walletDataRefresh';
import { haptic } from '@/lib/telegram';
import { Button, Card } from '@/components/ui';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { userSafeError } from '@/lib/errors';
import { confirmedUpdateCopy, hasTransactionHash, transactionStepProgress } from '@/lib/transactionProgress';
import { BridgeTracker } from '@/components/BridgeTracker';
import { InlineError, StatusNotice, stepProgress, TransactionHashLink, chainName } from '@/components/review/ReviewProgress';
import { resultPresentation } from '@/components/review/executionResult';
import { rawQuoteReviewFacts, routeFinancialReviewFacts, type ReviewFact } from '@/lib/fx/reviewFormatting';
import styles from './FlowWorkspace.module.css';

export type ActionPlanBuilder = () => Promise<PlannedRoute | readonly PlannedRoute[]>;

export type ActionReviewStage = 'input' | 'planning' | 'review' | 'executing' | 'result';

export interface ActionReviewProps {
  /** Build a fresh SDK route for initial review and confirm-time refresh. */
  planBuilder: ActionPlanBuilder | null;
  /**
   * Read an exact, short-lived in-memory route prepared for these inputs.
   * Returning null falls back to planBuilder. Prefetched routes still pass
   * the normal review simulation. The initial route is rebuilt before signing;
   * a newly reviewed route may be reused briefly, but the runner always
   * performs its final simulation immediately before opening the wallet.
   */
  prefetchedPlan?: () => Promise<PlannedRoute | readonly PlannedRoute[] | null>;
  label?: string;
  disabled?: boolean;
  /** Runs after verified receipts and the required following-block boundary. */
  onComplete?: (result: TransactionExecutionResult, confirmedRoute: PlannedRoute) => void | Promise<void>;
  operationLabel?: string;
  /** Uses an explicit destructive treatment for irreversible full exits. */
  destructive?: boolean;
  /**
   * Notifies the owning product card when the flow replaces its editor.
   * Product pages can hide their mounted editor while preserving all input
   * state, then reveal it again when this callback reports `input`.
   */
  onStageChange?: (stage: ActionReviewStage) => void;
  /** Optional primitive-only UI snapshot for local unsigned-draft recovery. */
  draftState?: SignatureDraftState;
  /** Stable product-level identity used to match a History draft to its form. */
  draftActionKey?: string;
  /** Optional same-origin resume path; defaults to the current location. */
  draftResumePath?: string;
  /**
   * Monotonic caller nonce used when History restores an unsigned form. A
   * matching nonce triggers one fresh review (never a wallet request) once
   * the restored form exposes a plan builder.
   */
  resumeReview?: number;
  /**
   * Optional editor content owned by the product surface. When supplied it is
   * rendered only in the `input` stage, allowing the review to replace the
   * editor in the same card without unmounting the action controller.
   */
  editor?: ReactNode;
  /** Render the review as a card, or as content inside an existing product card. */
  surface?: 'card' | 'content';
  /** Verified current values for an existing position or account context. */
  decisionBefore?: ReviewFact[];
}

type Stage = ActionReviewStage;

// A route which changed during the confirm-time rebuild has just been fully
// displayed and simulated. Keep it reusable for a short window; the runner
// still simulates it again inside the signing lock.
const REFRESHED_ROUTE_REUSE_MS = 10_000;

function asRoutes(value: PlannedRoute | readonly PlannedRoute[]): PlannedRoute[] {
  const routes = Array.isArray(value) ? [...value] : [value];
  if (!routes.length) throw new Error('No executable transaction route was returned.');
  return routes;
}

function trimDecimal(value: string): string {
  return value.includes('.') ? value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : value;
}

function compactAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function signatureDraftActionKey(route: PlannedRoute): string {
  const details = route.details;
  return [
    route.operation,
    details?.routeType ?? '',
    details?.positionId ?? '',
    details?.requestedAmount ?? '',
    details?.requestedLeverage ?? '',
    details?.slippagePercent ?? '',
    route.transactions.length,
  ].join(':').slice(0, 160);
}

function tokenForAddress(address: string | undefined) {
  if (!address) return undefined;
  return Object.values(FX_TOKENS).find((token) => token.address.toLowerCase() === address.toLowerCase());
}

function formatTokenAmount(value: bigint, tokenAddress?: string, fallback = 'raw units'): string {
  const token = tokenForAddress(tokenAddress);
  if (!token) return `${value.toString()} ${fallback}`;
  return `${trimDecimal(formatUnits(value, token.decimals))} ${token.key}`;
}

function addFact(facts: ReviewFact[], label: string, value: string | undefined): void {
  if (!value || facts.some((fact) => fact.label === label)) return;
  facts.push({ label, value });
}

function primaryReviewFacts(route: PlannedRoute): ReviewFact[] {
  const facts: ReviewFact[] = [];
  const intent = route.policy?.reviewedAction;
  if (intent) {
    switch (intent.kind) {
      case 'position-increase':
        addFact(facts, 'Amount', formatTokenAmount(intent.inputAmount, intent.inputTokenAddress));
        if (intent.requestedLeverage !== undefined) addFact(facts, 'Target leverage', `${intent.requestedLeverage}×`);
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        addFact(facts, 'Position', intent.positionId === 0 ? 'New position' : `#${intent.positionId}`);
        break;
      case 'position-reduce':
        addFact(facts, 'Position', `#${intent.positionId}`);
        addFact(facts, 'Action', intent.isClosePosition ? 'Close position' : 'Reduce position');
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        break;
      case 'position-adjust':
        addFact(facts, 'Position', `#${intent.positionId}`);
        if (intent.requestedLeverage !== undefined) addFact(facts, 'Target leverage', `${intent.requestedLeverage}×`);
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        break;
      case 'deposit-and-mint':
        addFact(facts, 'Deposit', formatTokenAmount(intent.depositAmount, intent.depositTokenAddress));
        addFact(facts, 'Mint', formatTokenAmount(intent.mintAmount, FX_TOKENS.fxUSD.address));
        addFact(facts, 'Position', intent.positionId === 0 ? 'New position' : `#${intent.positionId}`);
        break;
      case 'repay-and-withdraw':
        addFact(facts, 'Repay', formatTokenAmount(intent.minimumRepayAmount, intent.repayTokenAddress));
        addFact(facts, 'Withdraw', formatTokenAmount(intent.withdrawAmount, intent.withdrawTokenAddress));
        addFact(facts, 'Position', `#${intent.positionId}`);
        break;
      case 'fxsave-deposit':
        addFact(facts, 'Deposit', formatTokenAmount(intent.amount, intent.tokenInAddress));
        addFact(facts, 'Recipient', compactAddress(intent.receiver));
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        break;
      case 'fxsave-withdraw':
        addFact(facts, 'fxSAVE', formatTokenAmount(intent.amount, FX_TOKENS.fxSAVE.address));
        addFact(facts, 'Receive', tokenForAddress(intent.tokenOutAddress)?.key ?? compactAddress(intent.tokenOutAddress));
        addFact(facts, 'Mode', intent.directBasePool ? 'Direct' : intent.instant ? 'Instant' : 'Queued');
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        break;
      case 'fxsave-claim':
        addFact(facts, 'Recipient', compactAddress(intent.receiver));
        break;
    }
  }

  if (route.details?.routeType) addFact(facts, 'Route', route.details.routeType);
  if (route.details?.requestedLeverage !== undefined) addFact(facts, 'Target leverage', `${route.details.requestedLeverage}×`);
  if (route.details?.slippagePercent !== undefined) addFact(facts, 'Slippage', `${route.details.slippagePercent}%`);
  if (route.details?.leverage !== undefined) addFact(facts, 'Leverage', `${route.details.leverage}×`);
  facts.push(...routeFinancialReviewFacts(route));

  if (isBridgeQuote(route.quote)) {
    addFact(facts, 'Asset', route.quote.bridgeToken ?? 'Bridge asset');
    if (route.quote.bridgeAmount !== undefined) {
      addFact(facts, 'Amount', `${trimDecimal(formatUnits(route.quote.bridgeAmount, 18))} ${route.quote.bridgeToken ?? 'tokens'}`);
    }
    if (route.quote.minAmountLD !== undefined) {
      addFact(facts, 'Minimum received', `${trimDecimal(formatUnits(route.quote.minAmountLD, 18))} ${route.quote.bridgeToken ?? 'tokens'}`);
    }
    if (route.quote.recipient) addFact(facts, 'Recipient', route.quote.recipient);
    addFact(facts, 'Network fee', `${trimDecimal(formatEther(route.quote.nativeFee))} ETH`);
  }

  return facts;
}

const APPROVE_ABI = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amountOrTokenId', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

function approvalFacts(transaction: PlannedTransaction): {
  spender: string;
  valueLabel: string;
  value: bigint;
} | null {
  if (transaction.kind !== 'approval') return null;
  try {
    const decoded = decodeFunctionData({ abi: APPROVE_ABI, data: transaction.data });
    const [spender, amountOrTokenId] = decoded.args;
    return {
      spender,
      valueLabel: transaction.type === 'approvePosition' ? 'Position NFT ID' : 'Exact amount (raw units)',
      value: amountOrTokenId,
    };
  } catch {
    return null;
  }
}

function approvalSummary(transaction: PlannedTransaction, approval: NonNullable<ReturnType<typeof approvalFacts>>): string {
  if (transaction.type === 'approvePosition') return `Position #${approval.value.toString()}`;
  return formatTokenAmount(approval.value, transaction.to);
}

function stepTitle(transaction: PlannedTransaction): string {
  if (transaction.kind !== 'approval') return 'Confirm action';
  return transaction.type === 'approvePosition' ? 'Approve position' : `Approve ${tokenForAddress(transaction.to)?.key ?? 'token'}`;
}

function statusPresentation(params: {
  stage: Stage;
  status: PlanStatus;
  detail: string;
  stepResults: readonly TransactionStepResult[];
  stepCount: number;
  operation?: PlannedRoute['operation'];
  refreshing?: boolean;
}): { label: string; body: string; className: string; icon: ReactNode } {
  const confirmed = params.stepResults.filter((step) => transactionStepProgress(step).state === 'confirmed').length;
  const uncertain = params.stepResults.find((step) => ['unknown', 'unverified'].includes(transactionStepProgress(step).state));
  if (uncertain) {
    return {
      label: transactionStepProgress(uncertain).label,
      body: 'Submission is recorded. Check the explorer or History; do not submit this action again.',
      className: 'text-warn',
      icon: <Clock3 className="h-4 w-4" />,
    };
  }
  if (params.status === 'planning') {
    return {
      label: params.stage === 'executing' ? 'Preparing wallet request' : 'Preparing review',
      body: params.stage === 'executing' ? 'Rechecking the reviewed route before signing.' : 'Building a fresh route from current on-chain state.',
      className: 'text-mint',
      icon: <LoaderCircle className="h-4 w-4 animate-spin" />,
    };
  }
  if (params.status === 'reviewing') {
    return params.stage === 'review'
      ? { label: 'Ready to confirm', body: 'Checks passed. Review the amounts, limits, and transaction steps.', className: 'text-success', icon: <CheckCircle2 className="h-4 w-4" /> }
      : { label: 'Checking transaction', body: 'Simulating the ordered route against current chain state.', className: 'text-mint', icon: <LoaderCircle className="h-4 w-4 animate-spin" /> };
  }
  if (params.status === 'awaiting-user') {
    return {
      label: 'Wallet approval',
      body: params.detail ? `${params.detail.replace(/^transaction/i, 'Transaction')}. Review it in your wallet.` : 'Review and approve the transaction in your wallet.',
      className: 'text-warn',
      icon: <Clock3 className="h-4 w-4" />,
    };
  }
  if (params.status === 'submitted') {
    return {
      label: 'Submitted',
      body: 'Waiting for on-chain confirmation. Track it below or in History; do not submit again.',
      className: 'text-mint',
      icon: <LoaderCircle className="h-4 w-4 animate-spin" />,
    };
  }
  if (params.status === 'included' || params.status === 'confirming') {
    const active = params.stepResults.find((step) => step.status === 'included' || step.status === 'confirming');
    const count = active?.confirmations ?? 0;
    const required = active?.requiredConfirmations ?? 3;
    return {
      label: params.status === 'included' ? 'Included' : `Confirming · ${count}/${required}`,
      body: `The transaction is in a canonical block. FxAeon is rechecking its block identity until ${required} confirmations; later route steps remain paused.`,
      className: 'text-mint',
      icon: <LoaderCircle className="h-4 w-4 animate-spin" />,
    };
  }
  if (params.status === 'confirmed') {
    return confirmed < params.stepCount
      ? { label: 'Step confirmed', body: `${confirmed} of ${params.stepCount} confirmed. Preparing the next transaction.`, className: 'text-success', icon: <CheckCircle2 className="h-4 w-4" /> }
      : { ...confirmedUpdateCopy(params.operation, params.refreshing ?? false), className: 'text-success', icon: <CheckCircle2 className="h-4 w-4" /> };
  }
  if (params.status === 'partial' || (params.status === 'failed' && confirmed > 0)) {
    return { label: 'Partially completed', body: 'An earlier step confirmed before the route stopped.', className: 'text-warn', icon: <AlertTriangle className="h-4 w-4" /> };
  }
  return {
    label: 'Route stopped',
    body: userSafeError(params.detail, 'The route could not continue. Review it again before signing.'),
    className: 'text-danger',
    icon: <CircleAlert className="h-4 w-4" />,
  };
}

export function ActionReview({
  planBuilder,
  prefetchedPlan,
  label = 'Review action',
  disabled = false,
  onComplete,
  operationLabel,
  destructive = false,
  onStageChange,
  draftState,
  draftActionKey,
  draftResumePath,
  resumeReview = 0,
  editor,
  surface = 'card',
  decisionBefore,
}: ActionReviewProps) {
  const wallet = usePrivyWallet();
  const invalidateWalletData = useInvalidateWalletData();
  const [stage, setStage] = useState<Stage>('input');
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
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [reviewContext, setReviewContext] = useState<{ walletAddress: string; chainId?: number } | null>(null);
  const [resumeAfterConnect, setResumeAfterConnect] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousPlanBuilder = useRef<ActionPlanBuilder | null>(planBuilder);
  // React state updates are asynchronous; latch before any wallet request so
  // repeated clicks in the same frame cannot start a second execution.
  const busyRef = useRef(false);
  const executionStepsRef = useRef<TransactionStepResult[]>([]);
  const refreshedRouteRef = useRef<{ route: PlannedRoute; at: number } | null>(null);
  const signatureDraftIdRef = useRef<string | null>(null);
  const resumedReviewRef = useRef<number | null>(null);
  // Every asynchronous planning/execution attempt owns a generation. Route,
  // account, and component changes invalidate the generation so late SDK/RPC
  // responses can never repopulate a newer wallet session.
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const liveWalletRef = useRef({
    authenticated: wallet.authenticated,
    address: wallet.address,
    chainId: wallet.chainId,
  });
  const onStageChangeRef = useRef(onStageChange);
  onStageChangeRef.current = onStageChange;

  const isCurrentGeneration = useCallback((generation: number) => (
    mountedRef.current && generationRef.current === generation
  ), []);

  useEffect(() => () => {
    mountedRef.current = false;
    generationRef.current += 1;
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
  };

  const route = (stage === 'executing' || stage === 'result') && executionRoute
    ? executionRoute
    : routes[selectedRoute];

  useEffect(() => {
    if (stage === 'review' || stage === 'result') {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [stage]);

  // Keep only a local resume hint for the exact wallet/chain/action/path. The
  // route itself is never persisted; confirm-time planning and simulation are
  // still mandatory before the wallet prompt.
  useEffect(() => {
    if (stage !== 'review' || !route || !wallet.authenticated || !wallet.address) return;
    const resumePath = draftResumePath ?? `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const draft = saveSignatureRequiredDraft({
      walletAddress: route.walletAddress,
      chainId: route.chainId,
      operation: route.operation,
      actionKey: draftActionKey ?? signatureDraftActionKey(route),
      resumePath,
      formState: draftState,
    });
    signatureDraftIdRef.current = draft.id;
  }, [draftActionKey, draftResumePath, draftState, route, stage, wallet.address, wallet.authenticated]);

  const reset = useCallback(() => {
    if (busyRef.current) return;
    generationRef.current += 1;
    if (signatureDraftIdRef.current) {
      cancelSignatureRequiredDraft(signatureDraftIdRef.current);
      signatureDraftIdRef.current = null;
    }
    setStage('input');
    setRoutes([]);
    setSelectedRoute(0);
    setError(null);
    setResult(null);
    setStepResults([]);
    setExecutionRoute(null);
    executionStepsRef.current = [];
    setRefreshing(false);
    setReviewTitle(null);
    setReviewNotice(null);
    setReviewContext(null);
    setResumeAfterConnect(false);
    refreshedRouteRef.current = null;
    setStatus('planning');
    setStatusDetail('');
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

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
    setStage('input');
    setRoutes([]);
    setSelectedRoute(0);
    setResult(null);
    setStepResults([]);
    setExecutionRoute(null);
    setReviewTitle(null);
    setReviewNotice(null);
    setReviewContext(null);
    refreshedRouteRef.current = null;
    setResumeAfterConnect(false);
    setStatus('failed');
    setStatusDetail('');
    setLoading(false);
    setError(message);
  }, []);

  // The route is a snapshot of the wallet, network, and form inputs at review
  // time. Any change invalidates it before another signing prompt can open.
  useEffect(() => {
    if (previousPlanBuilder.current !== planBuilder) {
      previousPlanBuilder.current = planBuilder;
      if (stage === 'review') {
        invalidatePreparedRoute('The inputs changed. Review the action again before signing.');
      }
    }
  }, [invalidatePreparedRoute, planBuilder, stage]);

  useEffect(() => {
    // Results are non-signable historical evidence. Retain their original
    // wallet and chain when the active wallet or form changes.
    if (!reviewContext || (stage !== 'review' && stage !== 'executing')) return;
    const currentWallet = wallet.address?.toLowerCase();
    const walletChanged = !wallet.authenticated || !currentWallet || currentWallet !== reviewContext.walletAddress;
    // `undefined` is also a change: an account that moved to an unsupported
    // network must not retain a review prepared for Ethereum/Base.
    const chainChanged = reviewContext.chainId !== undefined
      && wallet.chainId !== reviewContext.chainId;
    if (walletChanged || chainChanged) {
      invalidatePreparedRoute(walletChanged
        ? 'The selected wallet changed. Review the action again before signing.'
        : 'The wallet network changed. Review the action again before signing.');
    }
  }, [invalidatePreparedRoute, reviewContext, stage, wallet.address, wallet.authenticated, wallet.chainId]);

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
    const assertReviewSession = () => {
      if (!isCurrentGeneration(generation)) return false;
      const liveWallet = liveWalletRef.current;
      if (!liveWallet.authenticated || liveWallet.address?.toLowerCase() !== reviewWalletAddress) {
        throw new Error('The selected wallet changed while preparing the review.');
      }
      if (reviewChainId !== undefined && liveWallet.chainId !== reviewChainId) {
        throw new Error('The wallet network changed while preparing the review.');
      }
      return true;
    };
    busyRef.current = true;
    setLoading(true);
    setStage('planning');
    setError(null);
    setStatus('planning');
    setStatusDetail('Preparing a fresh route.');
    try {
      const prefetched = await prefetchedPlan?.();
      if (!assertReviewSession()) return;
      const planned = asRoutes(prefetched ?? await planBuilder());
      if (!assertReviewSession()) return;
      setStatus('reviewing');
      setStatusDetail('Checking the ordered transactions against current chain state.');
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
      setReviewNotice(null);
      refreshedRouteRef.current = null;
      // Snapshot the human-readable action with the calldata. Inputs remain
      // visible above the review card, but later form edits must never rename
      // an already reviewed route.
      setReviewTitle(operationLabel ?? viable[0].operation);
      setReviewContext({ walletAddress, chainId: wallet.chainId });
      setStatus('reviewing');
      setStatusDetail('Checks passed. Review the amounts, limits, and transaction steps.');
      setStage('review');
      haptic('selection');
    } catch (cause) {
      if (!isCurrentGeneration(generation)) return;
      setStage('input');
      setStatus('failed');
      setError(userSafeError(cause, 'The transaction could not be prepared. Check the inputs and network, then try again.'));
      haptic('error');
    } finally {
      busyRef.current = false;
      if (isCurrentGeneration(generation)) setLoading(false);
    }
  }, [disabled, isCurrentGeneration, loading, operationLabel, planBuilder, prefetchedPlan, stage, wallet.address, wallet.authenticated, wallet.chainId]);

  // The action rail doubles as wallet entry. Resume only after the selected
  // wallet has reached React state and the wallet-scoped plan is available.
  useEffect(() => {
    if (!resumeAfterConnect || stage !== 'input' || loading || !wallet.authenticated || !wallet.address) return;
    if (disabled) {
      setResumeAfterConnect(false);
      return;
    }
    // A connection can invalidate balance-dependent form data for one render.
    // Keep the explicit user intent until the current product exposes its
    // planner; otherwise the first click would connect successfully and then
    // strand the user at an idle review rail.
    if (!planBuilder) return;
    setResumeAfterConnect(false);
    void review();
  }, [disabled, loading, planBuilder, resumeAfterConnect, review, stage, wallet.address, wallet.authenticated]);

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

  const execute = useCallback(async () => {
    if (!route || loading || busyRef.current || stage !== 'review' || status === 'failed' || stepResults.some(hasTransactionHash)) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const executionWalletAddress = route.walletAddress.toLowerCase();
    const isCurrentExecution = () => {
      if (!isCurrentGeneration(generation)) return false;
      const liveWallet = liveWalletRef.current;
      return liveWallet.authenticated && liveWallet.address?.toLowerCase() === executionWalletAddress;
    };
    busyRef.current = true;
    setLoading(true);
    setError(null);
    setStage('executing');
    setStatus('planning');
    setStatusDetail('Refreshing the selected route before signing.');
    setStepResults([]);
    executionStepsRef.current = [];
    setRefreshing(false);
    // Scope refreshes to the captured review, never the currently selected wallet.
    const refreshWallet = createRouteWalletRefresh(invalidateWalletData);
    let currentRoute = route;
    try {
      const recentRefresh = refreshedRouteRef.current;
      const canReuseRecentRefresh = recentRefresh
        && Date.now() - recentRefresh.at <= REFRESHED_ROUTE_REUSE_MS
        && routesMatchForSigning(route, recentRefresh.route);

      if (!canReuseRecentRefresh) {
        if (!planBuilder) throw new Error('The transaction inputs are no longer available. Review the action again.');
        const rebuilt = asRoutes(await planBuilder());
        if (!isCurrentExecution()) throw new Error('The selected wallet changed while refreshing the route.');
        const liveWallet = liveWalletRef.current;
        if (!liveWallet.authenticated || liveWallet.address?.toLowerCase() !== route.walletAddress.toLowerCase()) {
          throw new Error('The selected wallet changed while refreshing the route.');
        }
        currentRoute = selectRefreshedRoute(route, rebuilt, selectedRoute);
        if (currentRoute.walletAddress.toLowerCase() !== route.walletAddress.toLowerCase()) {
          throw new Error('The selected wallet changed while refreshing the route.');
        }
        if (currentRoute.chainId !== route.chainId || currentRoute.operation !== route.operation) {
          throw new Error('The refreshed route changed network or operation. Review the action again.');
        }

        if (!routesMatchForSigning(route, currentRoute)) {
          setStatus('reviewing');
          setStatusDetail('Checking the refreshed transaction against current chain state.');
          const { viable, failures } = await prepareRoutesForReview([currentRoute], route.walletAddress);
          if (!isCurrentExecution()) throw new Error('The selected wallet changed while checking the refreshed route.');
          if (!viable.length) {
            throw new Error(`The refreshed transaction could not be simulated: ${failures.join('; ')}`);
          }
          const refreshedRoute = viable[0];
          refreshedRouteRef.current = { route: refreshedRoute, at: Date.now() };
          setRoutes([refreshedRoute]);
          setSelectedRoute(0);
          setExecutionRoute(null);
          setReviewNotice('Quote updated—review again.');
          setStatus('reviewing');
          setStatusDetail('The current route passed simulation. Review its updated amounts and transaction details.');
          setStage('review');
          haptic('selection');
          return;
        }
      }

      setReviewNotice(null);
      setExecutionRoute(currentRoute);
      setStatus('awaiting-user');
      setStatusDetail('Each transaction opens in your wallet separately.');
      const execution = await runTransactionRoute({
        route: currentRoute,
        callbacks: {
          ensureChain: (chainId) => wallet.switchChain(chainId),
          requestSignature: async (request) => {
            const liveWallet = liveWalletRef.current;
            if (!liveWallet.authenticated || liveWallet.address?.toLowerCase() !== request.from.toLowerCase()) {
              throw new Error('The selected wallet changed before signing.');
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
              description: `Review this transaction on ${chainName(request.chainId)}.`,
              buttonText: 'Review transaction',
            });
            if (signatureDraftIdRef.current) {
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
          // confirmation depth have both been observed. Keeping the page refresh
          // inside that boundary prevents stale reads from being presented as
          // the result of a completed financial action.
          postConfirmRead: async (confirmedRoute, execution) => {
            if (!isCurrentExecution()) return;
            setRefreshing(true);
            try {
              if (!isCurrentExecution()) return;
              await refreshWallet(confirmedRoute, execution);
              if (!isCurrentExecution()) return;
              await onComplete?.(execution, confirmedRoute);
            } finally {
              if (isCurrentExecution()) setRefreshing(false);
            }
          },
        },
      });
      if (!isCurrentExecution()) return;
      // A finality/confirmation timeout can skip postConfirmRead despite inclusion.
      // Mark wallet data stale for gas/approvals/reverts without moving the
      // protocol onComplete callback outside its authoritative read boundary.
      await refreshWallet(currentRoute, execution);
      if (!isCurrentExecution()) return;
      setResult(execution);
      setStage('result');
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
        setStage('result');
      } else {
        if (signatureDraftIdRef.current) {
          cancelSignatureRequiredDraft(signatureDraftIdRef.current);
          signatureDraftIdRef.current = null;
        }
        setError(message);
        setStage('review');
      }
      setStatus('failed');
      // A failed or stale route must be explicitly reviewed again. This is
      // especially important when the runner rejects a changed minOut,
      // converter path, leverage, or transformed reduction amount.
      haptic(submittedSteps.some(hasTransactionHash) ? 'warning' : 'error');
    } finally {
      busyRef.current = false;
      if (isCurrentGeneration(generation)) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, [invalidateWalletData, isCurrentGeneration, loading, onComplete, planBuilder, reviewTitle, route, selectedRoute, stage, status, stepResults, wallet]);

  const routeSummaries = useMemo(() => routes.map((candidate) => {
    const routeType = candidate.details?.routeType ?? 'Route';
    const approvals = candidate.transactions.filter((transaction) => transaction.kind === 'approval').length;
    return { routeType, approvals, count: candidate.transactions.length };
  }), [routes]);

  if (stage === 'input') {
    const progress = statusPresentation({ stage, status, detail: statusDetail, stepResults, stepCount: 0 });
    const disconnected = !wallet.authenticated || !wallet.address;
    const trigger = (
      <div className={`${styles.reviewTrigger} reviewTrigger flex flex-col gap-2.5`}>
        {error && <InlineError message={error} />}
        {disconnected ? (
          <ConnectWalletButton
            className={`button button-primary glass-press ${styles.primaryAction} flex w-full items-center justify-center gap-2`}
            // ConnectWalletButton queues while the provider hydrates; only
            // the action's own disabled state should block that intent.
            disabled={disabled}
            resumeIfConnected
            onConnectStart={() => { setError(null); setResumeAfterConnect(true); }}
            onConnectError={() => setResumeAfterConnect(false)}
          >
            <ShieldCheck aria-hidden="true" className="h-4 w-4" /> Connect wallet
          </ConnectWalletButton>
        ) : (
          <Button ref={triggerRef} variant={destructive ? 'danger' : 'primary'} className={styles.primaryAction} disabled={!planBuilder || disabled || !wallet.ready} loading={loading} onClick={() => void review()}>
            <ShieldCheck aria-hidden="true" className="h-4 w-4" /> {label}
          </Button>
        )}
        {loading && <StatusNotice {...progress} />}
      </div>
    );
    if (editor) {
      return <>{editor}{trigger}</>;
    }
    return trigger;
  }

  if (stage === 'planning') {
    return (
      <ReviewSurface surface={surface} className={`${styles.reviewCard} ${styles.reviewInlineCard} p-5`}>
          <div className="flex min-h-56 flex-col items-center justify-center text-center" role="status" aria-live="polite">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
              <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
            </span>
            <h3 data-review-focus tabIndex={-1} className="text-display mt-4 text-[21px] font-semibold outline-none">Preparing your review</h3>
            <p className="mt-2 max-w-[320px] text-[12px] leading-relaxed text-mut">Building a fresh route and checking every transaction against the current chain state.</p>
          </div>
      </ReviewSurface>
    );
  }

  if (stage === 'result' && result) {
    const bridgeQuote = route?.operation === 'buildBridgeTx' && isBridgeQuote(route.quote) ? route.quote : null;
    const bridge = Boolean(bridgeQuote);
    const presentation = resultPresentation(result, bridge);
    const ResultIcon = presentation.icon;
    const bridgeStep = bridge
      ? [...result.steps].reverse().find((step) => step.transaction.kind === 'action' && step.hash)
      : undefined;
    const bridgeStatus = bridgeStep?.receipt?.status === 'reverted'
      ? 'failed'
      : bridgeStep?.status === 'confirmed' && bridgeStep.receipt?.status === 'success'
        ? 'source_confirmed'
        : 'pending';
    const tone = presentation.tone === 'success'
      ? 'bg-[var(--success-dim)] text-success'
      : presentation.tone === 'warning'
        ? 'bg-[var(--warn-dim)] text-warn'
        : 'bg-[var(--danger-dim)] text-danger';
    return (
      <ReviewSurface surface={surface} className={`${styles.reviewCard} ${styles.reviewInlineCard} anim-scale-in p-5`}>
        <div className="flex flex-col items-center text-center">
          <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${tone}`}>
            <ResultIcon className="h-6 w-6" aria-hidden="true" />
          </span>
          <h3 ref={headingRef} data-review-focus tabIndex={-1} className="text-display mt-4 text-[21px] font-semibold outline-none">
            {presentation.title}
          </h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-mut">
            {presentation.body}
          </p>
          <p className="mt-2 text-[11px] text-mut" title={result.walletAddress}>
            {chainName(result.chainId)} · Wallet {compactAddress(result.walletAddress)}
          </p>
          {result.steps.some(hasTransactionHash) && (
            <div className="mt-4 flex w-full flex-col gap-2 text-left">
              {result.steps.map((step) => hasTransactionHash(step) ? (
                <TransactionHashLink key={`${step.index}-${step.hash}`} step={step} chainId={result.chainId} />
              ) : null)}
            </div>
          )}
          {bridgeQuote && bridgeStep?.hash && (
            <BridgeTracker
              className="mt-4 w-full text-left"
              sourceChain={route.chainId === 1 ? 'Ethereum' : 'Base'}
              destinationChain={route.chainId === 1 ? 'Base' : 'Ethereum'}
              token={bridgeQuote.bridgeToken ?? 'Bridge asset'}
              amount={bridgeQuote.bridgeAmount === undefined ? '' : formatUnits(bridgeQuote.bridgeAmount, 18)}
              sourceTxHash={bridgeStep.hash}
              status={bridgeStatus}
              sourceOftAddress={bridgeQuote.sourceOftAddress}
              destinationOftAddress={bridgeQuote.destinationOftAddress}
              recipient={bridgeQuote.recipient}
              sourceSender={route.walletAddress}
              amountLD={bridgeQuote.amountLD}
              minAmountLD={bridgeQuote.minAmountLD}
              destinationBaselineBlock={bridgeQuote.destinationBaselineBlock}
            />
          )}
          <Button variant="ghost" aria-label="Done" className={`${styles.primaryAction} mt-4`} onClick={reset}>{bridge ? 'Back to Move' : result.status === 'confirmed' ? 'Back to action' : 'Review again'}</Button>
        </div>
      </ReviewSurface>
    );
  }

  if (!route) return null;
  const stepCount = route.transactions.length;
  const approvalCount = route.transactions.filter((transaction) => transaction.kind === 'approval').length;
  const facts = primaryReviewFacts(route);
  const progress = statusPresentation({ stage, status, detail: statusDetail, stepResults, stepCount, operation: route.operation, refreshing });
  const showExecutionProgress = stage === 'executing' || stepResults.some(hasTransactionHash);
  return (
    <ReviewSurface surface={surface} className={`${styles.reviewCard} ${styles.reviewInlineCard} anim-scale-in p-5`}>
      <button
        type="button"
        disabled={loading}
        onClick={reset}
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl pr-3 text-[12px] font-semibold text-mut disabled:opacity-50"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Edit
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={styles.eyebrow}>Transaction review</p>
          <h3 ref={headingRef} data-review-focus tabIndex={-1} className="text-display mt-2 text-[24px] font-semibold leading-tight outline-none">
            {reviewTitle ?? route.operation}
          </h3>
          <p className="mt-1 text-[12px] text-mut">
            {chainName(route.chainId)} · {stepCount} {stepCount === 1 ? 'transaction' : 'transactions'}
            {approvalCount > 0 ? ` · ${approvalCount} approval${approvalCount === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
      </div>

      {showExecutionProgress && (
        <section className="mt-4 flex flex-col gap-2" aria-label="Submitted transactions">
          <StatusNotice {...progress} />
          {stepResults.map((step) => hasTransactionHash(step) ? (
            <TransactionHashLink key={`${step.index}-${step.hash}`} step={step} chainId={route.chainId} />
          ) : null)}
        </section>
      )}

      {routes.length > 1 && (
        <div className="mt-4 flex flex-col gap-2" role="radiogroup" aria-label="Route options">
          <p className="text-[12px] font-medium text-mut">Choose route</p>
          {routes.map((candidate, index) => (
            <button
              type="button"
              role="radio"
              aria-checked={selectedRoute === index}
              disabled={loading || stage !== 'review'}
              key={`${candidate.operation}-${index}`}
              tabIndex={selectedRoute === index ? 0 : -1}
              onClick={() => {
                if (busyRef.current || stage !== 'review') return;
                setSelectedRoute(index);
                setStepResults([]);
                setReviewNotice(null);
                refreshedRouteRef.current = null;
              }}
              onKeyDown={(event) => {
                const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
                if (!keys.includes(event.key)) return;
                event.preventDefault();
                const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
                const next = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? routes.length - 1
                    : (index + (backwards ? -1 : 1) + routes.length) % routes.length;
                setSelectedRoute(next);
                setStepResults([]);
                setReviewNotice(null);
                refreshedRouteRef.current = null;
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
              }}
              className={`flex min-h-12 items-center justify-between rounded-xl border px-3 text-left disabled:cursor-default ${selectedRoute === index ? 'border-[rgba(139,109,255,.55)] bg-[var(--mint-dim)]' : 'border-[var(--line)] bg-[rgba(255,255,255,.025)]'}`}
            >
              <span className="text-[12px] font-semibold">{routeSummaries[index].routeType}</span>
              <span className="text-[11px] text-mut">{routeSummaries[index].count} tx · {routeSummaries[index].approvals} approval{routeSummaries[index].approvals === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>
      )}

      <div className="my-5 hairline" />
      <div className={styles.reviewFacts}>
        <ReviewRow label="Network" value={chainName(route.chainId)} />
        <ReviewRow label="Wallet" value={compactAddress(route.walletAddress)} title={route.walletAddress} />
        {facts.map((fact) => <ReviewRow key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.value} title={fact.title} />)}
     </div>

      <DecisionContext route={route} facts={facts} beforeFacts={decisionBefore} />

     <AdvancedReviewDetails route={route} />

      <section className="mt-4 flex flex-col gap-2" aria-labelledby="transaction-steps-heading">
        <p id="transaction-steps-heading" className="text-[12px] font-medium text-mut">{stage === 'executing' ? 'Transaction steps' : 'What you will approve'}</p>
        {route.transactions.map((transaction, index) => {
          const approval = approvalFacts(transaction);
          const progress = stepProgress(stepResults[index]);
          return (
          <div key={`${transaction.to}-${index}`} className={`${styles.reviewStep} border border-[var(--line)] p-3`}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-semibold">{index + 1}. {stepTitle(transaction)}</span>
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${progress.className}`}>{progress.icon}{progress.label}</span>
            </div>
            {approval && <p className="mt-1 text-[11px] text-mut">{approvalSummary(transaction, approval)} to <span className="font-mono">{compactAddress(approval.spender)}</span></p>}
            {transaction.value > 0n && <p className="mt-1 text-[11px] text-mut">Network value: {trimDecimal(formatEther(transaction.value))} ETH</p>}
            {transaction.kind !== 'approval' && <p className="mt-1 text-[11px] text-mut">Contract <span className="font-mono">{compactAddress(transaction.to)}</span></p>}
            <details className="mt-2 border-t border-[var(--line)] pt-1">
              <summary className="flex min-h-11 cursor-pointer items-center text-[11px] font-semibold text-mint">Transaction details</summary>
              <ReviewRow label="Contract" value={transaction.to} />
              <ReviewRow label="Nonce" value={transaction.nonce === undefined ? 'Checked before signing' : String(transaction.nonce)} />
              {approval && <ReviewRow label="Approval spender" value={approval.spender} />}
              {approval && <ReviewRow label={approval.valueLabel} value={approval.value.toString()} />}
              <p className="mt-1 font-mono text-[10px] text-mut">Selector: {transaction.data.slice(0, 10)}</p>
              <p className="mt-1 break-all font-mono text-[9px] leading-relaxed text-[var(--mut-2)]">{transaction.data}</p>
            </details>
          </div>
          );
        })}
      </section>

      {!showExecutionProgress && <div className="mt-4"><StatusNotice {...progress} /></div>}
      {reviewNotice && <p role="status" className="mt-3 rounded-xl border border-[rgba(255,194,102,.24)] bg-[var(--warn-dim)] px-3 py-2 text-[12px] font-semibold text-warn">{reviewNotice}</p>}
      {error && <div className="mt-3"><InlineError message={error} /></div>}
      {stage === 'review' && (
        <div className={styles.reviewInlineActions}>
          <Button variant={destructive ? 'danger' : 'primary'} disabled={loading || status === 'failed'} loading={loading} className={`${styles.primaryAction} mt-4`} onClick={() => void execute()}>
            <ShieldCheck aria-hidden="true" className="h-4 w-4" /> {stepCount === 1 ? 'Confirm in wallet' : `Confirm ${stepCount} transactions`}
          </Button>
        </div>
      )}
    </ReviewSurface>
  );
}

function ReviewSurface({ surface, className, children }: { surface: 'card' | 'content'; className: string; children: ReactNode }) {
  if (surface === 'content') return <div className={styles.reviewInlineContent}>{children}</div>;
  return <Card className={className}>{children}</Card>;
}

function ReviewRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div className="flex items-start justify-between gap-4 text-[12px]"><span className="text-mut">{label}</span><span title={title ?? value} className="max-w-[62%] break-all text-right font-semibold tabular-nums">{value}</span></div>;
}

function AdvancedReviewDetails({ route }: { route: PlannedRoute }) {
  const bridgeQuote = isBridgeQuote(route.quote) ? route.quote : null;
  const rawQuoteFacts = rawQuoteReviewFacts(route);
  const hasDetails = Boolean(
    route.details?.requestedAmount
      || rawQuoteFacts.length
      || route.details?.sdkSlippagePercent !== undefined
      || route.details?.economicLimits?.length
      || route.details?.conversionPaths?.length
      || route.policy?.reviewedAction?.expectedActionDataFingerprint
      || bridgeQuote,
  );
  if (!hasDetails) return null;

  return (
    <details className="group mt-4 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.02)] px-3">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[12px] font-semibold text-mut">
        <span>Advanced details</span>
        <span className="text-[11px] font-normal text-[var(--mut-2)] group-open:hidden">Route and contract data</span>
      </summary>
      <div className="flex flex-col gap-2.5 border-t border-[var(--line)] py-3">
        {route.details?.requestedAmount && <ReviewRow label="Requested amount (raw units)" value={route.details.requestedAmount} />}
        {rawQuoteFacts.map((fact) => <ReviewRow key={fact.label} label={fact.label} value={fact.value} />)}
        {route.details?.sdkSlippagePercent !== undefined && <ReviewRow label="Quoted slippage" value={`${route.details.sdkSlippagePercent}%`} />}
        {route.details?.economicLimits?.map((limit, index) => <ReviewRow key={`limit-${index}`} label={limit.label} value={`${limit.value} raw units`} />)}
        {route.details?.conversionPaths?.map((path, index) => <ReviewRow key={`path-${index}`} label={`${path.label} fingerprint`} value={path.fingerprint} />)}
        {route.policy?.reviewedAction?.expectedActionDataFingerprint && <ReviewRow label="Action fingerprint" value={route.policy.reviewedAction.expectedActionDataFingerprint} />}
        {bridgeQuote && (
          <>
            {bridgeQuote.sourceOftAddress && <ReviewRow label="Source OFT" value={bridgeQuote.sourceOftAddress} />}
            {bridgeQuote.destinationOftAddress && <ReviewRow label="Destination OFT" value={bridgeQuote.destinationOftAddress} />}
            {bridgeQuote.sourceTokenAddress && <ReviewRow label="Source token" value={bridgeQuote.sourceTokenAddress} />}
            {bridgeQuote.destinationTokenAddress && <ReviewRow label="Destination token" value={bridgeQuote.destinationTokenAddress} />}
            {bridgeQuote.sourceApprovalRequired !== undefined && <ReviewRow label="Source approval" value={bridgeQuote.sourceApprovalRequired ? 'Required if allowance is low' : 'Not required'} />}
            {bridgeQuote.destinationApprovalRequired !== undefined && <ReviewRow label="Destination approval" value={bridgeQuote.destinationApprovalRequired ? 'Required by adapter' : 'Not required'} />}
            {bridgeQuote.approvalTokenAddress && <ReviewRow label="Approval token" value={bridgeQuote.approvalTokenAddress} />}
            {bridgeQuote.destinationEid !== undefined && <ReviewRow label="Destination endpoint" value={String(bridgeQuote.destinationEid)} />}
            {bridgeQuote.recipientBytes32 && <ReviewRow label="Recipient (bytes32)" value={bridgeQuote.recipientBytes32} />}
            {bridgeQuote.amountLD !== undefined && <ReviewRow label="Bridge amount (raw units)" value={bridgeQuote.amountLD.toString()} />}
            {bridgeQuote.minAmountLD !== undefined && <ReviewRow label="Minimum delivered (raw units)" value={bridgeQuote.minAmountLD.toString()} />}
            {bridgeQuote.extraOptions !== undefined && <ReviewRow label="Extra options" value={bridgeQuote.extraOptions} />}
            {bridgeQuote.composeMsg !== undefined && <ReviewRow label="Compose message" value={bridgeQuote.composeMsg} />}
            {bridgeQuote.oftCmd !== undefined && <ReviewRow label="OFT command" value={bridgeQuote.oftCmd} />}
            {bridgeQuote.refundAddress && <ReviewRow label="Fee refund" value={bridgeQuote.refundAddress} />}
            {bridgeQuote.destinationBaselineBlock !== undefined && <ReviewRow label="Destination baseline block" value={bridgeQuote.destinationBaselineBlock.toString()} />}
          </>
        )}
      </div>
    </details>
  );
}

type BridgeReviewQuote = {
  nativeFee: bigint;
  lzTokenFee?: bigint;
  sourceOftAddress?: string;
  destinationOftAddress?: string;
  sourceTokenAddress?: string;
  destinationEid?: number;
  recipientBytes32?: string;
  amountLD?: bigint;
  minAmountLD?: bigint;
  extraOptions?: string;
  composeMsg?: string;
  oftCmd?: string;
  refundAddress?: string;
  bridgeToken?: string;
  bridgeAmount?: bigint;
  deliveryLowerBound?: bigint;
  destinationTokenAddress?: string;
  destinationBaselineBlock?: bigint;
  recipient?: string;
  sourceApprovalRequired?: boolean;
  destinationApprovalRequired?: boolean;
  approvalTokenAddress?: string;
};

function isBridgeQuote(value: unknown): value is BridgeReviewQuote {
  return Boolean(value && typeof value === 'object' && 'nativeFee' in value && typeof (value as { nativeFee?: unknown }).nativeFee === 'bigint');
}
function DecisionContext({ route, facts, beforeFacts }: { route: PlannedRoute; facts: ReviewFact[]; beforeFacts?: ReviewFact[] }) {
  const intent = route.policy?.reviewedAction;
  const before = intent && 'positionId' in intent ? (intent.positionId === 0 ? 'No existing position is being changed.' : `Existing position #${intent.positionId} is the source context.`) : 'The current source state is checked again before signing.';
  const after = intent?.kind === 'position-reduce' && intent.isClosePosition ? 'The selected position will be closed if every reviewed step succeeds.' : intent?.kind === 'position-reduce' ? 'The selected position will be reduced; the verified minimum output is shown in the review facts.' : intent?.kind === 'position-increase' ? 'The selected leverage action will open or increase a position using the reviewed amount and limits.' : intent?.kind === 'deposit-and-mint' ? 'Collateral and fxUSD debt will change together; reviewed values are shown when returned by the SDK.' : intent?.kind === 'repay-and-withdraw' ? 'Repayment and collateral withdrawal will be applied together; the reviewed minimums are shown below.' : 'The reviewed route shows the verified amounts and limits that will change.';
  const hasResultFacts = facts.some((fact) => /^Estimated|^Minimum|^Execution/.test(fact.label));
  const afterFacts = facts.filter((fact) => /^Estimated/.test(fact.label));
  return <section aria-label="What changes" className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3"><p className="text-[12px] font-semibold">What changes</p><p className="mt-2 text-[11px] leading-relaxed text-mut"><strong className="text-[var(--text)]">Before:</strong> {before}</p>{beforeFacts && beforeFacts.length > 0 && <div className="mt-2 grid gap-1">{beforeFacts.map((fact) => <ReviewRow key={`before-${fact.label}`} label={fact.label} value={fact.value} title={fact.title} />)}</div>}<p className="mt-2 text-[11px] leading-relaxed text-mut"><strong className="text-[var(--text)]">After confirmation:</strong> {after}</p>{afterFacts.length > 0 && <div className="mt-2 grid gap-1">{afterFacts.map((fact) => <ReviewRow key={`after-${fact.label}`} label={fact.label.replace(/^Estimated\s*/, '')} value={fact.value} title={fact.title} />)}</div>}{!hasResultFacts && <p className="mt-2 text-[11px] leading-relaxed text-warn">This route did not return a verified collateral/debt or execution estimate. No risk metric is inferred.</p>}</section>;
}
