'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
} from 'lucide-react';
import { decodeFunctionData, formatEther, formatUnits } from 'viem';
import {
  FX_TOKENS,
  formatRouteGasCost,
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
import { useRouteGasCost } from '@/lib/fx';
import type { UseGasCostResult } from '@/lib/fx/useGasCost';
import { cancelSignatureRequiredDraft, removeSignatureRequiredDraft, saveSignatureRequiredDraft, type SignatureDraftState } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { useInvalidateWalletData } from '@/components/WalletDataProvider';
import { createRouteWalletRefresh } from '@/lib/walletDataRefresh';
import { haptic } from '@/lib/telegram';
import { Button, Card } from '@/components/ui';
import { ValueOrSkeleton } from '@/components/MissingValue';
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
  /** Runs after verified receipts and confirmation; state reads may still be settling. */
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
  /** Optional authoritative cost facts supplied by the gas/cost estimator. */
  executionCost?: {
    estimatedGas?: string;
    gasFee?: string;
    protocolFee?: string;
    totalCost?: string;
  };
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
        addFact(facts, 'Risk', 'New leverage can increase liquidation exposure');
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
        addFact(facts, 'Risk', 'Changing leverage can alter liquidation exposure');
        break;
      case 'deposit-and-mint':
        addFact(facts, 'Deposit', formatTokenAmount(intent.depositAmount, intent.depositTokenAddress));
        addFact(facts, 'Borrow', formatTokenAmount(intent.mintAmount, FX_TOKENS.fxUSD.address));
        addFact(facts, 'Position', intent.positionId === 0 ? 'New position' : `#${intent.positionId}`);
        addFact(facts, 'Risk', intent.mintAmount > 0n ? 'Added debt can increase liquidation exposure' : 'Collateral change affects the liquidation buffer');
        break;
      case 'repay-and-withdraw':
        addFact(facts, 'Repay', formatTokenAmount(intent.minimumRepayAmount, intent.repayTokenAddress));
        addFact(facts, 'Withdraw', formatTokenAmount(intent.withdrawAmount, intent.withdrawTokenAddress));
        addFact(facts, 'Position', `#${intent.positionId}`);
        addFact(facts, 'Risk', intent.withdrawAmount > 0n ? 'Withdrawal can reduce the liquidation buffer' : 'Repayment should reduce debt after confirmation');
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
    addFact(facts, 'Bridge fee', `${trimDecimal(formatEther(route.quote.nativeFee))} ETH`);
  }

  return facts;
}

function routeFacts(route: PlannedRoute, gasCost: Pick<UseGasCostResult, 'estimate' | 'estimateIsCurrent'>, executionCost?: ActionReviewProps['executionCost']): ReviewFact[] {
  const facts = primaryReviewFacts(route);
  const currentGasCost = gasCost.estimateIsCurrent && gasCost.estimate
    ? formatRouteGasCost(gasCost.estimate)
    : undefined;
  if (currentGasCost?.gasFee) addFact(facts, 'Gas fee', currentGasCost.gasFee);
  if (currentGasCost?.totalCost) addFact(facts, 'Total cost', currentGasCost.totalCost);
  if (executionCost?.gasFee) addFact(facts, 'Gas fee', executionCost.gasFee);
  if (executionCost?.protocolFee) addFact(facts, 'Protocol fee', executionCost.protocolFee);
  if (executionCost?.totalCost) addFact(facts, 'Total cost', executionCost.totalCost);
  return facts;
}

function actionButtonLabel(label: string, operationLabel?: string): string {
  const value = operationLabel ?? label;
  return /^review\s+/i.test(value) ? value.replace(/^review\s+/i, '') : value;
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
  if (transaction.kind !== 'approval') return 'Action';
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
  networkSwitching?: boolean;
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
      label: params.stage === 'executing' ? 'Preparing wallet request' : 'Preparing transaction',
      body: params.stage === 'executing' ? 'Verifying the latest route.' : 'Building the route.',
      className: 'text-mint',
      icon: <LoaderCircle className="h-4 w-4 animate-spin" />,
    };
  }
  if (params.status === 'reviewing') {
    return params.stage === 'review'
      ? { label: 'Ready to sign', body: 'Review the amount, limits, approvals, and risk above.', className: 'text-success', icon: <CheckCircle2 className="h-4 w-4" /> }
      : { label: 'Checking transaction', body: 'Verifying the route.', className: 'text-mint', icon: <LoaderCircle className="h-4 w-4 animate-spin" /> };
  }
  if (params.status === 'awaiting-user') {
    if (params.networkSwitching) {
      return {
        label: 'Switching network',
        body: 'Your wallet is switching to the transaction network. Signing opens after the switch is verified.',
        className: 'text-warn',
        icon: <LoaderCircle className="h-4 w-4 animate-spin" />,
      };
    }
    return {
      label: 'Wallet approval',
      body: params.detail ? `${params.detail.replace(/^transaction/i, 'Transaction')}. Review it in your wallet.` : 'Review the transaction in your wallet, then approve it.',
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
    const required = active?.requiredConfirmations ?? 1;
    return {
      label: params.status === 'included' ? 'Included' : `Confirming · ${count}/${required}`,
      body: `Waiting for ${required} confirmation${required === 1 ? '' : 's'} before the next step.`,
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
    return { label: 'Partially completed', body: 'An earlier step confirmed before the action stopped.', className: 'text-warn', icon: <AlertTriangle className="h-4 w-4" /> };
  }
  return {
    label: 'Action stopped',
    body: userSafeError(params.detail, 'The action could not continue. Check it again before signing.'),
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
  executionCost,
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
  const [networkSwitching, setNetworkSwitching] = useState(false);
  const [reviewContext, setReviewContext] = useState<{ walletAddress: string; chainId?: number; connectionVersion: number } | null>(null);
  const [resumeAfterConnect, setResumeAfterConnect] = useState(false);
  const [previewRoutes, setPreviewRoutes] = useState<PlannedRoute[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
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
  const previewGenerationRef = useRef(0);
  const previewRouteRef = useRef<PlannedRoute | null>(null);
  const previewSeedRef = useRef<{ route: PlannedRoute; walletAddress: string; chainId?: number; connectionVersion: number } | null>(null);
  const mountedRef = useRef(true);
  const liveWalletRef = useRef({
    authenticated: wallet.authenticated,
    address: wallet.address,
    chainId: wallet.chainId,
    connectionVersion: wallet.connectionVersion,
  });
  const onStageChangeRef = useRef(onStageChange);
  onStageChangeRef.current = onStageChange;

  const isCurrentGeneration = useCallback((generation: number) => (
    mountedRef.current && generationRef.current === generation
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

  // Prepare a read-only, debounced route while the editor remains mounted.
  // This supplies useful facts before the primary action, but it never changes
  // stage or opens a wallet. The generation and wallet checks discard late
  // results after input, account, network, or component changes.
  useEffect(() => {
    previewGenerationRef.current += 1;
    const previewGeneration = previewGenerationRef.current;
    const previewWalletAddress = wallet.address?.toLowerCase();
    const previewChainId = wallet.chainId;
    const previewConnectionVersion = wallet.connectionVersion;
    let cancelled = false;
    let running = false;
    let timer: number | undefined;

    const seededPreview = previewSeedRef.current;
    const preserveSeed = stage === 'input' && Boolean(
      seededPreview
      && seededPreview.walletAddress === previewWalletAddress
      && seededPreview.chainId === previewChainId
      && seededPreview.connectionVersion === previewConnectionVersion,
    );
    previewSeedRef.current = null;
    previewRouteRef.current = preserveSeed ? seededPreview!.route : null;
    setPreviewRoutes(preserveSeed ? [seededPreview!.route] : []);
    setPreviewError(null);

    const isVisibleAndOnline = () => (
      (typeof document === 'undefined' || document.visibilityState === 'visible')
      && (typeof navigator === 'undefined' || navigator.onLine !== false)
    );
    const isCurrentPreview = () => {
      const liveWallet = liveWalletRef.current;
      return !cancelled
        && mountedRef.current
        && previewGenerationRef.current === previewGeneration
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
        else schedule(15_000);
      }, delay);
    };
    const load = async () => {
      if (running || !isCurrentPreview()) return;
      if (!isVisibleAndOnline()) {
        schedule(15_000);
        return;
      }
      running = true;
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const prefetched = await prefetchedPlan?.();
        if (!isCurrentPreview()) return;
        const planned = asRoutes(prefetched ?? await planBuilder!());
        if (!isCurrentPreview()) return;
        const { viable } = await prepareRoutesForReview(planned, previewWalletAddress!);
        if (!isCurrentPreview()) return;
        if (!viable.length) throw new Error('No executable route was returned.');
        setPreviewRoutes(viable);
        previewRouteRef.current = viable[0] ?? null;
      } catch {
        if (isCurrentPreview()) {
          setPreviewRoutes([]);
          previewRouteRef.current = null;
          setPreviewError('We could not update the action details. Try again.');
        }
      } finally {
        running = false;
        if (isCurrentPreview()) {
          setPreviewLoading(false);
          schedule(15_000);
        }
      }
    };

    if (stage !== 'input' || !planBuilder || disabled || !wallet.ready || !wallet.authenticated || !previewWalletAddress) {
      setPreviewLoading(false);
      return undefined;
    }
    schedule(preserveSeed ? 15_000 : 350);
    const refreshWhenActive = () => {
      if (!isCurrentPreview() || running || !isVisibleAndOnline()) return;
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
  }, [disabled, planBuilder, prefetchedPlan, previewRetry, stage, wallet.address, wallet.authenticated, wallet.chainId, wallet.connectionVersion, wallet.ready]);

  useEffect(() => {
    previewRouteRef.current = previewRoutes[selectedRoute] ?? previewRoutes[0] ?? null;
  }, [previewRoutes, selectedRoute]);

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
    try {
      const draft = saveSignatureRequiredDraft({
        walletAddress: route.walletAddress,
        chainId: route.chainId,
        operation: route.operation,
        actionKey: draftActionKey ?? signatureDraftActionKey(route),
        resumePath,
        formState: draftState,
      });
      signatureDraftIdRef.current = draft.id;
    } catch {
      // A local storage/draft schema problem must not crash an otherwise
      // simulated review. The route remains fresh and signing-safe; only the
      // optional reload hint is unavailable.
      signatureDraftIdRef.current = null;
    }
  }, [draftActionKey, draftResumePath, draftState, route, stage, wallet.address, wallet.authenticated]);

  const reset = useCallback(() => {
    if (busyRef.current) return;
    generationRef.current += 1;
    if (signatureDraftIdRef.current) {
      cancelSignatureRequiredDraft(signatureDraftIdRef.current);
      signatureDraftIdRef.current = null;
    }
    setStage('input');
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
    setReviewNotice(null);
    setReviewContext(null);
    setResumeAfterConnect(false);
    refreshedRouteRef.current = null;
    previewSeedRef.current = null;
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
    previewSeedRef.current = null;
    setResumeAfterConnect(false);
    setStatus('planning');
    setStatusDetail('');
    setLoading(false);
    setRefreshing(false);
    setNetworkSwitching(false);
    busyRef.current = false;
    setError(message);
  }, []);

  // The route is a snapshot of the wallet, network, and form inputs at review
  // time. Any change invalidates it before another signing prompt can open.
  useEffect(() => {
    if (previousPlanBuilder.current !== planBuilder) {
      previousPlanBuilder.current = planBuilder;
      if (stage === 'review') {
        invalidatePreparedRoute('The inputs changed. Check the action again before signing.');
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
    const connectionChanged = wallet.connectionVersion !== reviewContext.connectionVersion;
    if (walletChanged || chainChanged || connectionChanged) {
      invalidatePreparedRoute(walletChanged
        ? 'The selected wallet changed. Check the action again before signing.'
        : chainChanged
          ? 'The wallet network changed. Check the action again before signing.'
          : 'The wallet connection changed. Check the action again before signing.');
    }
  }, [invalidatePreparedRoute, reviewContext, stage, wallet.address, wallet.authenticated, wallet.chainId, wallet.connectionVersion]);

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
    const assertReviewSession = () => {
      if (!isCurrentGeneration(generation)) return false;
      const liveWallet = liveWalletRef.current;
      if (!liveWallet.authenticated || liveWallet.address?.toLowerCase() !== reviewWalletAddress) {
        throw new Error('The selected wallet changed while preparing the review.');
      }
      if (reviewChainId !== undefined && liveWallet.chainId !== reviewChainId) {
        throw new Error('The wallet network changed while preparing the review.');
      }
      if (liveWallet.connectionVersion !== reviewConnectionVersion) {
        throw new Error('The selected wallet connection changed while preparing the review.');
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
      setReviewNotice(null);
      refreshedRouteRef.current = null;
      // Snapshot the human-readable action with the calldata. Inputs remain
      // visible above the review card, but later form edits must never rename
      // an already reviewed route.
      setReviewTitle(operationLabel ?? viable[0].operation);
      setReviewContext({ walletAddress, chainId: wallet.chainId, connectionVersion: wallet.connectionVersion });
      setStatus('reviewing');
      setStatusDetail('Route ready.');
      setStage('review');
      haptic('selection');
    } catch (cause) {
      if (!isCurrentGeneration(generation)) return;
      setStage('input');
      setStatus('failed');
      setError(userSafeError(cause, 'The transaction could not be prepared. Check the inputs and network, then try again.'));
      haptic('error');
    } finally {
      if (isCurrentGeneration(generation)) {
        busyRef.current = false;
        setLoading(false);
      }
    }
  }, [disabled, isCurrentGeneration, loading, operationLabel, planBuilder, prefetchedPlan, stage, wallet.address, wallet.authenticated, wallet.chainId, wallet.connectionVersion]);

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
    if (!startingRoute || loading || busyRef.current || (!directFromInput && stage !== 'review') || (!directFromInput && status === 'failed') || stepResults.some(hasTransactionHash)) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const executionWalletAddress = startingRoute.walletAddress.toLowerCase();
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
    // Bind direct execution to the wallet session immediately, before the
    // confirm-time rebuild. Deliberate network switching remains valid during
    // execution, while account/reconnect changes invalidate this context.
    setReviewContext({ walletAddress: executionWalletAddress, connectionVersion: executionConnectionVersion });
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
    setStage('executing');
    // Keep the signed route visible while the confirm-time rebuild is pending;
    // a deferred planner must never blank the action card.
    setExecutionRoute(startingRoute);
    setStatus('planning');
    setStatusDetail('Refreshing the selected route before signing.');
    setStepResults([]);
    executionStepsRef.current = [];
    setRefreshing(false);
    // Scope refreshes to the captured review, never the currently selected wallet.
    const refreshWallet = createRouteWalletRefresh(invalidateWalletData);
    let currentRoute = startingRoute;
    let postConfirmReadStarted = false;
    try {
      const recentRefresh = refreshedRouteRef.current;
      const canReuseRecentRefresh = recentRefresh
        && Date.now() - recentRefresh.at <= REFRESHED_ROUTE_REUSE_MS
        && routesMatchForSigning(startingRoute, recentRefresh.route);

      if (!canReuseRecentRefresh) {
        if (!planBuilder) throw new Error('The transaction inputs are no longer available. Check them again.');
        const rebuilt = asRoutes(await planBuilder());
        if (!isCurrentExecution()) throw new Error('The selected wallet changed while refreshing the route.');
        const liveWallet = liveWalletRef.current;
        if (!liveWallet.authenticated || liveWallet.address?.toLowerCase() !== startingRoute.walletAddress.toLowerCase()) {
          throw new Error('The selected wallet changed while refreshing the route.');
        }
        currentRoute = selectRefreshedRoute(startingRoute, rebuilt, selectedRoute);
        if (currentRoute.walletAddress.toLowerCase() !== startingRoute.walletAddress.toLowerCase()) {
          throw new Error('The selected wallet changed while refreshing the route.');
        }
        if (currentRoute.chainId !== startingRoute.chainId || currentRoute.operation !== startingRoute.operation) {
          throw new Error('The refreshed transaction changed network or operation. Check it again.');
        }

        if (!routesMatchForSigning(startingRoute, currentRoute)) {
          setStatus('reviewing');
          setStatusDetail('Checking the refreshed transaction against current chain state.');
          const { viable, failures } = await prepareRoutesForReview([currentRoute], startingRoute.walletAddress);
          if (!isCurrentExecution()) throw new Error('The selected wallet changed while checking the refreshed route.');
          if (!viable.length) {
            throw new Error(`The refreshed transaction could not be simulated: ${failures.join('; ')}`);
          }
          const refreshedRoute = viable[0];
          refreshedRouteRef.current = { route: refreshedRoute, at: Date.now() };
          previewSeedRef.current = {
            route: refreshedRoute,
            walletAddress: startingRoute.walletAddress.toLowerCase(),
            chainId: startingRoute.chainId,
            connectionVersion: executionConnectionVersion,
          };
          setPreviewRoutes([refreshedRoute]);
          previewRouteRef.current = refreshedRoute;
          setRoutes([]);
          setSelectedRoute(0);
          setExecutionRoute(null);
          setReviewNotice('Details changed. Check the updated action before continuing.');
          setStatus('planning');
          setStatusDetail('');
          setError(null);
          setStage('input');
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
            setStage('result');
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
        if (directFromInput) {
          previewSeedRef.current = {
            route: startingRoute,
            walletAddress: executionWalletAddress,
            chainId: startingRoute.chainId,
            connectionVersion: executionConnectionVersion,
          };
          setPreviewRoutes([startingRoute]);
          previewRouteRef.current = startingRoute;
          setExecutionRoute(null);
          setStatus('planning');
          setStage('input');
        } else {
          setStage('review');
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
  }, [draftActionKey, draftResumePath, draftState, invalidateWalletData, isCurrentGeneration, loading, onComplete, planBuilder, reviewTitle, route, selectedRoute, stage, status, stepResults, wallet]);

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

  if (stage === 'input') {
    const progress = statusPresentation({ stage, status, detail: statusDetail, stepResults, stepCount: 0 });
    const disconnected = !wallet.authenticated || !wallet.address;
    const previewAction = previewRoute ? actionButtonLabel(label, operationLabel) : null;
    const trigger = (
      <div className={`${styles.reviewTrigger} reviewTrigger flex flex-col gap-2.5`}>
        {previewRoute && <InlinePreviewSummary
          route={previewRoute}
          alternatives={previewRoutes}
          selectedRoute={selectedRoute}
          onSelect={(index) => {
            setSelectedRoute(index);
            setReviewNotice(null);
          }}
          decisionBefore={decisionBefore}
          gasCost={gasCost}
          executionCost={executionCost}
          updating={previewLoading || gasCost.status === 'refreshing'}
        />}
        {previewError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[rgba(255,194,102,.24)] bg-[var(--warn-dim)] px-3 py-2 text-[12px]">
            <span className="text-warn">{previewError}</span>
            <Button variant="outline" className="shrink-0 px-2.5 py-1.5 text-[11px]" onClick={() => setPreviewRetry((value) => value + 1)} disabled={previewLoading}>Try again</Button>
          </div>
        )}
        {reviewNotice && <p role="status" className="rounded-xl border border-[rgba(255,194,102,.24)] bg-[var(--warn-dim)] px-3 py-2 text-[12px] font-semibold text-warn">{reviewNotice}</p>}
        {error && <InlineError message={error} />}
        {disconnected ? (
          <ConnectWalletButton
            className={`button button-primary glass-press ${styles.primaryAction} flex w-full items-center justify-center`}
            // ConnectWalletButton queues while the provider hydrates; only
            // the action's own disabled state should block that intent.
            disabled={disabled}
            resumeIfConnected
            onConnectStart={() => { setError(null); setResumeAfterConnect(true); }}
            onConnectError={() => setResumeAfterConnect(false)}
          >
            Connect wallet
          </ConnectWalletButton>
        ) : (
          <Button ref={triggerRef} variant={destructive ? 'danger' : 'primary'} className={styles.primaryAction} disabled={!planBuilder || !previewRoute || previewLoading || disabled || !wallet.ready} loading={loading || previewLoading} onClick={() => void execute(previewRoute ?? undefined)}>
            {previewAction ?? (previewLoading ? 'Updating quote' : actionButtonLabel(label, operationLabel))}
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
      <ReviewSurface surface={surface} className={`${styles.reviewCard} ${styles.reviewInlineCard} p-4 sm:p-5`}>
          <div className="flex min-h-56 flex-col items-center justify-center text-center" role="status" aria-live="polite">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
              <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
            </span>
            <h3 data-review-focus tabIndex={-1} className="text-display mt-4 text-[21px] font-semibold outline-none">Preparing transaction</h3>
            <p className="mt-2 max-w-[320px] text-[12px] leading-relaxed text-mut">Building and checking the route.</p>
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
      <ReviewSurface surface={surface} className={`${styles.reviewCard} ${styles.reviewInlineCard} anim-scale-in p-4 sm:p-5`}>
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
          <Button variant="ghost" aria-label="Done" className={`${styles.primaryAction} mt-4`} onClick={reset}>{bridge ? 'Back to Move' : result.status === 'confirmed' ? 'Back to action' : 'Try again'}</Button>
        </div>
      </ReviewSurface>
    );
  }

  if (!route) return null;
  const stepCount = route.transactions.length;
  const approvalCount = route.transactions.filter((transaction) => transaction.kind === 'approval').length;
  const facts = routeFacts(route, gasCost, executionCost);
  const gasEstimateStatus = gasCost.estimate?.status === 'partial'
    ? 'Partial route estimate'
    : gasCost.estimate?.status === 'unavailable'
      ? 'Unavailable; wallet will show final gas'
    : gasCost.estimateIsCurrent
      ? 'Current for reviewed route'
      : gasCost.status === 'refreshing'
        ? 'Refreshing for reviewed route'
        : 'Unavailable; wallet will show final gas';
  addFact(facts, 'Gas quote', gasEstimateStatus);
  const approvals = route.transactions
    .map((transaction) => {
      const approval = approvalFacts(transaction);
      if (!approval) return null;
      const amount = approval.valueLabel === 'Position NFT ID' ? `#${approval.value.toString()}` : formatTokenAmount(approval.value, transaction.to);
      return `${amount} → ${compactAddress(approval.spender)}`;
    })
    .filter((value): value is string => Boolean(value));
  const progress = statusPresentation({ stage, status, detail: statusDetail, stepResults, stepCount, operation: route.operation, refreshing, networkSwitching });
  const showExecutionProgress = stage === 'executing' || stepResults.some(hasTransactionHash);
  const wrongNetwork = wallet.chainId !== undefined && wallet.chainId !== route.chainId;
  const unsupportedNetwork = wallet.chainId === undefined;
  return (
    <ReviewSurface surface={surface} className={`${styles.reviewCard} ${styles.reviewInlineCard} anim-scale-in p-4 sm:p-5`}>
      <button
        type="button"
        disabled={loading}
        onClick={reset}
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl pr-3 text-[12px] font-semibold text-mut disabled:opacity-50"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Edit
      </button>

      <div className="flex items-start gap-3">
        <div>
          <h3 ref={headingRef} data-review-focus tabIndex={-1} className="text-display text-[24px] font-semibold leading-tight outline-none">
            {reviewTitle ?? route.operation}
          </h3>
          <p className="mt-1 text-[12px] text-mut">
            {chainName(route.chainId)} · {stepCount} {stepCount === 1 ? 'transaction' : 'transactions'}
            {approvalCount > 0 ? ` · ${approvalCount} approval${approvalCount === 1 ? '' : 's'}` : ''}
          </p>
        </div>
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
        <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Route options">
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

      <div className="my-4 hairline" />
      <div className={styles.reviewFacts}>
        <ReviewRow label="Network" value={chainName(route.chainId)} />
        <ReviewRow label="Wallet" value={compactAddress(route.walletAddress)} title={route.walletAddress} />
        {facts.map((fact) => <ReviewRow key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.value} title={fact.title} />)}
        {approvals.length > 0 && <ReviewRow label="Approvals" value={approvals.join('; ')} />}
     </div>

      {wrongNetwork && <p role="status" className="mt-2 rounded-xl border border-[rgba(255,194,102,.24)] bg-[var(--warn-dim)] px-3 py-2 text-[11.5px] leading-relaxed text-warn">Wallet is on {chainName(wallet.chainId!)}. Confirmation will switch to {chainName(route.chainId)} before signing.</p>}
      {unsupportedNetwork && <p role="status" className="mt-2 rounded-xl border border-[rgba(255,194,102,.24)] bg-[var(--warn-dim)] px-3 py-2 text-[11.5px] leading-relaxed text-warn">Wallet network is unavailable or unsupported. Confirmation will request {chainName(route.chainId)} before signing.</p>}

      <DecisionContext route={route} facts={facts} beforeFacts={decisionBefore} />

     <AdvancedReviewDetails route={route} />

      <details className="group mt-3 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.02)] px-3" open={stage === 'executing' || showExecutionProgress}>
        <summary id="transaction-steps-heading" className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[12px] font-semibold text-mut">
          <span>{stage === 'executing' ? 'Transaction progress' : `Steps · ${stepCount}`}</span>
          <span className="text-[11px] font-normal text-[var(--mut-2)] group-open:hidden">View steps</span>
        </summary>
        <section className="flex flex-col gap-2 border-t border-[var(--line)] py-3" aria-labelledby="transaction-steps-heading">
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
            {transaction.value > 0n && <p className="mt-1 text-[11px] text-mut">Value sent: {trimDecimal(formatEther(transaction.value))} ETH <span className="text-[var(--mut-2)]">(native transaction value; gas is separate)</span></p>}
            {transaction.kind !== 'approval' && <p className="mt-1 text-[11px] text-mut">Contract <span className="font-mono">{compactAddress(transaction.to)}</span></p>}
            <div className="mt-2 border-t border-[var(--line)] pt-2">
              <ReviewRow label="Contract" value={transaction.to} />
              <ReviewRow label="Nonce" value={transaction.nonce === undefined ? 'Checked before signing' : String(transaction.nonce)} />
              {approval && <ReviewRow label="Approval spender" value={approval.spender} />}
              {approval && <ReviewRow label={approval.valueLabel} value={approval.value.toString()} />}
              <p className="mt-1 font-mono text-[10px] text-mut">Selector: {transaction.data.slice(0, 10)}</p>
              <p className="mt-1 break-all font-mono text-[9px] leading-relaxed text-[var(--mut-2)]">{transaction.data}</p>
            </div>
          </div>
          );
        })}
        </section>
      </details>

      {!showExecutionProgress && <div className="mt-4"><StatusNotice {...progress} /></div>}
      {reviewNotice && <p role="status" className="mt-3 rounded-xl border border-[rgba(255,194,102,.24)] bg-[var(--warn-dim)] px-3 py-2 text-[12px] font-semibold text-warn">{reviewNotice}</p>}
      {error && <div className="mt-3"><InlineError message={error} /></div>}
      {stage === 'review' && (
        <div className={styles.reviewInlineActions}>
          <Button variant={destructive ? 'danger' : 'primary'} disabled={loading || status === 'failed'} loading={loading} className={styles.primaryAction} onClick={() => void execute()}>
            {stepCount === 1 ? 'Confirm in wallet' : `Confirm ${stepCount} transactions`}
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

function InlinePreviewSummary({
  route,
  alternatives = [],
  selectedRoute = 0,
  onSelect,
  decisionBefore,
  gasCost,
  executionCost,
  updating,
}: {
  route: PlannedRoute;
  alternatives?: PlannedRoute[];
  selectedRoute?: number;
  onSelect?: (index: number) => void;
  decisionBefore?: ReviewFact[];
  gasCost: Pick<UseGasCostResult, 'estimate' | 'estimateIsCurrent'>;
  executionCost?: ActionReviewProps['executionCost'];
  updating: boolean;
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const facts = routeFacts(route, gasCost, executionCost);
  const approvals = route.transactions
    .map((transaction) => {
      const approval = approvalFacts(transaction);
      if (!approval) return null;
      const token = tokenForAddress(transaction.to)?.key ?? 'token';
      return `${token} ${approval.valueLabel === 'Position NFT ID' ? `#${approval.value.toString()}` : formatTokenAmount(approval.value, transaction.to)} → ${compactAddress(approval.spender)}`;
    })
    .filter((value): value is string => Boolean(value));
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] px-3 py-3" aria-label="Review details">
      {updating && <p role="status" className="mb-2 text-[11px] font-medium text-mut">Updating quote</p>}
      {alternatives.length > 1 && onSelect && (
        <div className="mb-2.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Transaction options">
          {alternatives.map((candidate, index) => {
            const routeType = candidate.details?.routeType ?? `Option ${index + 1}`;
            const isSelected = index === selectedRoute;
            return <button
              key={`${routeType}-${index}`}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              disabled={updating}
              className={`min-h-11 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${isSelected ? 'border-mint bg-[var(--mint-dim)] text-mint' : 'border-[var(--line)] text-mut'}`}
              onClick={() => onSelect(index)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? alternatives.length - 1
                    : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + alternatives.length) % alternatives.length;
                onSelect(next);
                window.requestAnimationFrame(() => optionRefs.current[next]?.focus());
              }}
            >{routeType}</button>;
          })}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <ReviewRow label="Network" value={chainName(route.chainId)} />
        {facts.map((fact) => <ReviewRow key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.value} title={fact.title} />)}
        {approvals.length > 0 && <ReviewRow label="Approvals" value={approvals.join('; ')} />}
      </div>
      <DecisionContext route={route} facts={facts} beforeFacts={decisionBefore} />
      <AdvancedReviewDetails route={route} />
    </section>
  );
}

function ReviewRow({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  const valueTitle = title ?? (typeof value === 'string' ? value : undefined);
  return <div className="flex items-start justify-between gap-4 text-[12px]"><span className="text-mut">{label}</span><span title={valueTitle} className="max-w-[62%] break-all text-right font-semibold tabular-nums"><ValueOrSkeleton value={value} width="md" label={`Loading ${label.toLowerCase()}`} /></span></div>;
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
      || route.transactions.length > 0
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
        {route.transactions.map((transaction, index) => {
          const approval = approvalFacts(transaction);
          return (
            <div key={`transaction-${index}`} className="border-t border-[var(--line)] pt-2 first:border-t-0 first:pt-0">
              <p className="mb-1 text-[11px] font-semibold text-[var(--text)]">{stepTitle(transaction)} {index + 1}</p>
              <ReviewRow label="Contract" value={transaction.to} />
              {approval && <ReviewRow label="Approval spender" value={approval.spender} />}
              {approval && <ReviewRow label={approval.valueLabel} value={approval.value.toString()} />}
              <ReviewRow label="Selector" value={transaction.data.slice(0, 10)} />
              <ReviewRow label="Calldata" value={transaction.data} />
            </div>
          );
        })}
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
  const source = intent && 'positionId' in intent
    ? (intent.positionId === 0 ? 'New position' : `Position #${intent.positionId}`)
    : null;
  const outcome = intent?.kind === 'position-reduce' && intent.isClosePosition
    ? 'Close position'
    : intent?.kind === 'position-reduce'
      ? 'Reduce position'
      : intent?.kind === 'position-increase'
        ? 'Open or increase position'
        : intent?.kind === 'deposit-and-mint'
          ? 'Change collateral and fxUSD debt'
          : intent?.kind === 'repay-and-withdraw'
            ? 'Repay debt and withdraw collateral'
            : null;
  const hasResultFacts = facts.some((fact) => /^Estimated|^Minimum|^Execution/.test(fact.label));
  const afterFacts = facts.filter((fact) => /^Estimated/.test(fact.label));
  return <details aria-label="What changes" className="group mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3"><summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[12px] font-semibold"><span>What changes</span><span className="text-[11px] font-normal text-[var(--mut-2)] group-open:hidden">Verified state and outcome</span></summary><div className="border-t border-[var(--line)] py-3">{source && <p className="text-[11px] leading-relaxed text-mut"><strong className="text-[var(--text)]">Source:</strong> {source}</p>}{beforeFacts && beforeFacts.length > 0 && <div className="mt-2 grid gap-1">{beforeFacts.map((fact) => <ReviewRow key={`before-${fact.label}`} label={fact.label} value={fact.value} title={fact.title} />)}</div>}{outcome && <p className="mt-2 text-[11px] leading-relaxed text-mut"><strong className="text-[var(--text)]">Outcome:</strong> {outcome}</p>}{afterFacts.length > 0 && <div className="mt-2 grid gap-1">{afterFacts.map((fact) => <ReviewRow key={`after-${fact.label}`} label={fact.label.replace(/^Estimated\s*/, '')} value={fact.value} title={fact.title} />)}</div>}{!hasResultFacts && <p className="mt-2 text-[11px] leading-relaxed text-warn">No verified collateral, debt, or execution estimate was returned. No risk metric is inferred.</p>}</div></details>;
}
