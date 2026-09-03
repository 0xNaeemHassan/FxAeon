'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  CircleAlert,
  Clock3,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { decodeFunctionData, formatEther, formatUnits } from 'viem';
import {
  getPublicClient,
  defaultTransactionPolicy,
  FX_TOKENS,
  runTransactionRoute,
  simulatePlannedRoute,
  validateRoute,
  type PlannedRoute,
  type PlannedTransaction,
  type PlanStatus,
  type TransactionExecutionResult,
  type TransactionStepResult,
} from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { getWebApp, haptic } from '@/lib/telegram';
import { Button, Card } from '@/components/ui';
import { userSafeError } from '@/lib/errors';
import { confirmedUpdateCopy, hasTransactionHash, transactionExplorerUrl, transactionStepKind, transactionStepProgress } from '@/lib/transactionProgress';
import { BridgeTracker } from '@/components/BridgeTracker';
import { rawQuoteReviewFacts, routeFinancialReviewFacts, type ReviewFact } from '@/lib/fx/reviewFormatting';
import styles from './FlowWorkspace.module.css';

export type ActionPlanBuilder = () => Promise<PlannedRoute | readonly PlannedRoute[]>;

export interface ActionReviewProps {
  /** Build a fresh SDK route only after the user asks to review it. */
  planBuilder: ActionPlanBuilder | null;
  label?: string;
  disabled?: boolean;
  /** Runs after verified receipts and the required following-block boundary. */
  onComplete?: (result: TransactionExecutionResult, confirmedRoute: PlannedRoute) => void | Promise<void>;
  operationLabel?: string;
}

type Stage = 'input' | 'review' | 'executing' | 'result';

function asRoutes(value: PlannedRoute | readonly PlannedRoute[]): PlannedRoute[] {
  const routes = Array.isArray(value) ? [...value] : [value];
  if (!routes.length) throw new Error('No executable transaction route was returned.');
  return routes;
}

function chainName(chainId: number): string {
  return chainId === 8453 ? 'Base' : chainId === 1 ? 'Ethereum' : `Chain ${chainId}`;
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function trimDecimal(value: string): string {
  return value.includes('.') ? value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : value;
}

function compactAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
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
        addFact(facts, 'Shares', formatTokenAmount(intent.amount, FX_TOKENS.fxSAVE.address));
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

function stepProgress(step: TransactionStepResult | undefined): {
  label: string;
  className: string;
  icon: ReactNode;
} {
  const { state, label } = transactionStepProgress(step);
  if (state === 'confirmed') return { label, className: 'text-success', icon: <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> };
  if (state === 'unknown' || state === 'unverified') return { label, className: 'text-warn', icon: <Clock3 aria-hidden="true" className="h-3.5 w-3.5" /> };
  if (state === 'stopped' || state === 'reverted') return { label, className: 'text-danger', icon: <XCircle aria-hidden="true" className="h-3.5 w-3.5" /> };
  if (state === 'submitted') return { label, className: 'text-mint', icon: <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> };
  return { label, className: 'text-mut', icon: <Circle aria-hidden="true" className="h-3.5 w-3.5" /> };
}

function looksLikeWalletRejection(value: string | undefined): boolean {
  return Boolean(value && /(reject|denied|declin|cancel(?:led|ed)|user refused|user denied)/i.test(value));
}

function resultPresentation(result: TransactionExecutionResult, bridge: boolean): {
  title: string;
  body: string;
  tone: 'success' | 'warning' | 'danger';
  icon: typeof CheckCircle2;
} {
  const submitted = result.steps.filter(hasTransactionHash);
  const confirmationUnknown = submitted.some((step) => step.hash && !step.receipt);
  const verificationIncomplete = submitted.some((step) => transactionStepProgress(step).state === 'unverified');
  const reverted = result.steps.some((step) => step.receipt?.status === 'reverted');

  if (result.status === 'confirmed') {
    return bridge
      ? {
          title: 'Confirmed on source',
          body: 'The source route is confirmed. Destination delivery is verified separately below.',
          tone: 'success',
          icon: CheckCircle2,
        }
      : {
          title: 'Confirmed',
          body: `All transaction steps are confirmed on ${chainName(result.chainId)}.`,
          tone: 'success',
          icon: CheckCircle2,
        };
  }
  if (confirmationUnknown) {
    return {
      title: 'Confirmation unknown',
      body: 'A transaction was submitted, but its receipt could not be verified. Check the explorer or Activity from the wallet profile. Do not submit this action again.',
      tone: 'warning',
      icon: Clock3,
    };
  }
  if (verificationIncomplete) {
    return {
      title: 'Verification incomplete',
      body: 'A receipt exists, but the submitted transaction could not be fully verified. Check the explorer or Activity. Do not submit this action again.',
      tone: 'warning',
      icon: AlertTriangle,
    };
  }
  if (result.status === 'partial') {
    return {
      title: 'Partially completed',
      body: 'At least one earlier transaction confirmed before the route stopped. Do not repeat the full action; review each step below.',
      tone: 'warning',
      icon: AlertTriangle,
    };
  }
  if (reverted) {
    return {
      title: 'Reverted',
      body: 'The submitted transaction reverted on-chain. No later step was submitted.',
      tone: 'danger',
      icon: XCircle,
    };
  }
  if (looksLikeWalletRejection(result.error)) {
    return {
      title: 'Wallet request declined',
      body: 'This transaction was not submitted. No later step was opened.',
      tone: 'danger',
      icon: XCircle,
    };
  }
  return {
    title: 'Not submitted',
    body: userSafeError(result.error, 'The route stopped before a transaction could be confirmed.'),
    tone: 'danger',
    icon: CircleAlert,
  };
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
      body: 'Submission is recorded. Check the explorer or Activity; do not submit this action again.',
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
      body: 'Waiting for on-chain confirmation. Track it below or in Activity; do not submit again.',
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
  label = 'Review action',
  disabled = false,
  onComplete,
  operationLabel,
}: ActionReviewProps) {
  const wallet = usePrivyWallet();
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
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [reviewContext, setReviewContext] = useState<{ walletAddress: string; chainId?: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousPlanBuilder = useRef<ActionPlanBuilder | null>(planBuilder);
  // React state updates are asynchronous; latch before any wallet request so
  // repeated clicks in the same frame cannot start a second execution.
  const busyRef = useRef(false);
  const executionStepsRef = useRef<TransactionStepResult[]>([]);

  const route = (stage === 'executing' || stage === 'result') && executionRoute
    ? executionRoute
    : routes[selectedRoute];

  useEffect(() => {
    if (stage === 'review' || stage === 'result') {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [stage]);

  const reset = useCallback(() => {
    if (busyRef.current) return;
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
    setReviewContext(null);
    setReviewAcknowledged(false);
    setStatus('planning');
    setStatusDetail('');
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

  const invalidatePreparedRoute = useCallback((message: string) => {
    setStage('input');
    setRoutes([]);
    setSelectedRoute(0);
    setResult(null);
    setStepResults([]);
    setExecutionRoute(null);
    setReviewTitle(null);
    setReviewAcknowledged(false);
    setReviewContext(null);
    setStatus('failed');
    setStatusDetail('');
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
    if (!reviewContext || stage !== 'review') return;
    const currentWallet = wallet.address?.toLowerCase();
    const walletChanged = !wallet.authenticated || !currentWallet || currentWallet !== reviewContext.walletAddress;
    const chainChanged = reviewContext.chainId !== undefined
      && wallet.chainId !== undefined
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
    busyRef.current = true;
    setLoading(true);
    setError(null);
    setStatus('planning');
    setStatusDetail('Preparing a fresh route.');
    try {
      const planned = asRoutes(await planBuilder());
      setStatus('reviewing');
      setStatusDetail('Checking the ordered transactions against current chain state.');
      const walletAddress = wallet.address.toLowerCase();
      for (const candidate of planned) {
        if (candidate.walletAddress.toLowerCase() !== walletAddress) {
          throw new Error('The prepared route is not bound to the selected wallet.');
        }
      }
      // Pre-simulate every alternative before displaying a signing action. A
      // route that cannot be simulated is never presented as safe to approve.
      const viable: PlannedRoute[] = [];
      const failures: string[] = [];
      for (const candidate of planned) {
        try {
          validateRoute(candidate, defaultTransactionPolicy(candidate));
          const simulation = await simulatePlannedRoute(candidate, getPublicClient(candidate.chainId));
          if (simulation.success) viable.push(candidate);
          else failures.push(`${candidate.details?.routeType ?? 'route'}: ${simulation.error}`);
        } catch (cause) {
          failures.push(
            `${candidate.details?.routeType ?? 'route'}: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }
      if (!viable.length) {
        throw new Error(`The transaction could not be simulated: ${failures.join('; ')}`);
      }
      setRoutes(viable);
      setSelectedRoute(0);
      setStepResults([]);
      executionStepsRef.current = [];
      setExecutionRoute(null);
      setReviewAcknowledged(false);
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
      setStatus('failed');
      setError(userSafeError(cause, 'The transaction could not be prepared. Check the inputs and network, then try again.'));
      haptic('error');
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, [disabled, loading, operationLabel, planBuilder, stage, wallet.address, wallet.authenticated, wallet.chainId]);

  const execute = useCallback(async () => {
    if (!route || loading || busyRef.current || stage !== 'review' || status === 'failed' || stepResults.some(hasTransactionHash)) return;
    if (!reviewAcknowledged) {
      setError('Confirm that you checked the amounts, limits, recipient, and transaction steps before signing.');
      return;
    }
    busyRef.current = true;
    setLoading(true);
    setError(null);
    setStage('executing');
    setStatus('awaiting-user');
    setStatusDetail('Each transaction opens in your wallet separately.');
    setStepResults([]);
    executionStepsRef.current = [];
    setExecutionRoute(route);
    setRefreshing(false);
    try {
      const execution = await runTransactionRoute({
        route,
        callbacks: {
          ensureChain: (chainId) => wallet.switchChain(chainId),
          requestSignature: async (request) => {
            const signed = await wallet.sendTransaction({
              chainId: request.chainId,
              from: request.from,
              to: request.to,
              data: request.data,
              value: request.value,
              nonce: request.nonce,
            }, {
              action: `${reviewTitle ?? route.operation} · ${request.to}`,
              description: `Review this transaction on ${chainName(request.chainId)}.`,
              buttonText: 'Review transaction',
            });
            return signed.hash;
          },
          onStatus: (next, detail) => {
            setStatus(next);
            setStatusDetail(detail ? userSafeError(detail, 'The transaction could not continue. Check the network and try again.') : '');
          },
          onStep: (step) => {
            const next = [...executionStepsRef.current];
            next[step.index] = step;
            executionStepsRef.current = next;
            setStepResults(next);
          },
          // The runner invokes this only after a receipt and the required
          // following block have both been observed. Keeping the page refresh
          // inside that boundary prevents stale reads from being presented as
          // the result of a completed financial action.
          postConfirmRead: async (confirmedRoute, execution) => {
            if (!onComplete) return;
            setRefreshing(true);
            try {
              await onComplete(execution, confirmedRoute);
            } finally {
              setRefreshing(false);
            }
          },
        },
      });
      setResult(execution);
      setStage('result');
      const uncertain = execution.steps.some((step) => ['unknown', 'unverified'].includes(transactionStepProgress(step).state));
      haptic(execution.status === 'confirmed' ? 'success' : execution.status === 'partial' || uncertain ? 'warning' : 'error');
    } catch (cause) {
      const message = userSafeError(cause, 'The transaction could not continue. No later step was submitted.');
      const submittedSteps = executionStepsRef.current;
      if (submittedSteps.some(hasTransactionHash)) {
        // A UI/observer exception cannot erase a broadcast hash or reopen a
        // signing action. The existing journal remains the recovery authority.
        setResult({
          status: submittedSteps.some((step) => step.status === 'confirmed') ? 'partial' : 'failed',
          operation: route.operation,
          chainId: route.chainId,
          walletAddress: route.walletAddress,
          steps: submittedSteps.map((step) => step.status === 'submitted' ? { ...step, status: 'failed', error: message } : step),
          error: message,
        });
        setStage('result');
      } else {
        setError(message);
        setStage('review');
      }
      setStatus('failed');
      // A failed or stale route must be explicitly reviewed again. This is
      // especially important when the runner rejects a changed minOut,
      // converter path, leverage, or transformed reduction amount.
      setReviewAcknowledged(false);
      haptic(submittedSteps.some(hasTransactionHash) ? 'warning' : 'error');
    } finally {
      busyRef.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, [loading, onComplete, reviewAcknowledged, reviewTitle, route, stage, status, stepResults, wallet]);

  const routeSummaries = useMemo(() => routes.map((candidate) => {
    const routeType = candidate.details?.routeType ?? 'Route';
    const approvals = candidate.transactions.filter((transaction) => transaction.kind === 'approval').length;
    return { routeType, approvals, count: candidate.transactions.length };
  }), [routes]);

  if (stage === 'input') {
    const progress = statusPresentation({ stage, status, detail: statusDetail, stepResults, stepCount: 0 });
    return (
      <div className="flex flex-col gap-2.5">
        {error && <InlineError message={error} />}
        <Button ref={triggerRef} className={styles.primaryAction} disabled={!planBuilder || disabled || !wallet.ready} loading={loading} onClick={() => void review()}>
          <ShieldCheck aria-hidden="true" className="h-4 w-4" /> {label}
        </Button>
        {loading && <StatusNotice {...progress} />}
      </div>
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
      <Card className={`${styles.reviewCard} anim-scale-in p-5`}>
        <div className="flex flex-col items-center text-center">
          <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${tone}`}>
            <ResultIcon className="h-6 w-6" aria-hidden="true" />
          </span>
          <h3 ref={headingRef} tabIndex={-1} className="text-display mt-4 text-[21px] font-semibold outline-none">
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
          <Button variant="ghost" className={`${styles.primaryAction} mt-4`} onClick={reset}>Done</Button>
        </div>
      </Card>
    );
  }

  if (!route) return null;
  const stepCount = route.transactions.length;
  const approvalCount = route.transactions.filter((transaction) => transaction.kind === 'approval').length;
  const facts = primaryReviewFacts(route);
  const progress = statusPresentation({ stage, status, detail: statusDetail, stepResults, stepCount, operation: route.operation, refreshing });
  const showExecutionProgress = stage === 'executing' || stepResults.some(hasTransactionHash);
  return (
    <Card className={`${styles.reviewCard} anim-scale-in p-5`}>
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
          <p className={styles.eyebrow}>Security review</p>
          <h3 ref={headingRef} tabIndex={-1} className="text-display mt-2 text-[24px] font-semibold leading-tight outline-none">
            {reviewTitle ?? route.operation}
          </h3>
          <p className="mt-1 text-[12px] text-mut">
            {chainName(route.chainId)} · {stepCount} {stepCount === 1 ? 'transaction' : 'transactions'}
            {approvalCount > 0 ? ` · ${approvalCount} approval${approvalCount === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><ShieldCheck className="h-5 w-5" /></span>
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
                setReviewAcknowledged(false);
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

      <AdvancedReviewDetails route={route} />

      <div className="mt-4 flex flex-col gap-2" aria-label="Transaction steps">
        <p className="text-[12px] font-medium text-mut">{stage === 'executing' ? 'Transaction steps' : 'What you will approve'}</p>
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
      </div>

      {!showExecutionProgress && <div className="mt-4"><StatusNotice {...progress} /></div>}
      {error && <div className="mt-3"><InlineError message={error} /></div>}
      {stage === 'review' && (
        <>
          <label className="mt-4 flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] p-3 text-[11.5px] leading-relaxed text-mut">
            <input
              type="checkbox"
              checked={reviewAcknowledged}
              onChange={(event) => setReviewAcknowledged(event.target.checked)}
              disabled={loading || status === 'failed'}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--mint)]"
            />
            <span>I have reviewed the amounts and transaction steps above.</span>
          </label>
          <Button disabled={loading || status === 'failed' || !reviewAcknowledged} loading={loading} className={`${styles.primaryAction} mt-3`} onClick={() => void execute()}>
            <ShieldCheck aria-hidden="true" className="h-4 w-4" /> {stepCount === 1 ? 'Confirm in wallet' : `Confirm ${stepCount} transactions`}
          </Button>
        </>
      )}
    </Card>
  );
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

function TransactionHashLink({ step, chainId }: { step: TransactionStepResult; chainId: number }) {
  const url = transactionExplorerUrl(chainId, step.hash);
  if (!url || !step.hash) return null;
  const progress = stepProgress(step);
  const kind = transactionStepKind(step);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${kind} ${step.index + 1}: ${progress.label}. View transaction ${step.hash} on ${chainName(chainId)} explorer (opens in a new tab)`}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const telegram = getWebApp();
        if (telegram?.openLink) {
          try {
            telegram.openLink(url);
            event.preventDefault();
          } catch {
            // The native anchor remains a usable fallback outside Telegram.
          }
        }
      }}
      className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-[var(--mint-dim)] px-3 py-2 text-[11.5px] font-semibold text-mint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mint)]"
    >
      <span className="min-w-0">
        <span className="block">{kind} {step.index + 1} · {shortHash(step.hash)}</span>
        <span className={`mt-1 inline-flex items-center gap-1 text-[10.5px] ${progress.className}`}>{progress.icon}{progress.label}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1">Explorer <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></span>
    </a>
  );
}

function StatusNotice({ label, body, className, icon }: { label: string; body: string; className: string; icon: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="flex items-start gap-2.5 rounded-xl bg-[rgba(255,255,255,.035)] p-3 text-[11.5px] leading-relaxed">
      <span className={`mt-0.5 shrink-0 ${className}`}>{icon}</span>
      <span><span className={`font-semibold ${className}`}>{label}</span><span className="mt-0.5 block text-mut">{body}</span></span>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return <div role="alert" className="flex gap-2.5 rounded-lg border border-[rgba(255,107,118,.2)] bg-[var(--danger-dim)] p-3 text-[11.5px] leading-relaxed text-danger"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>;
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
