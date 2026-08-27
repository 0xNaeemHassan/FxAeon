'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  ExternalLink,
  Fuel,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { decodeFunctionData, formatEther, formatUnits } from 'viem';
import {
  getPublicClient,
  defaultTransactionPolicy,
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
import { BridgeTracker } from '@/components/BridgeTracker';

export type ActionPlanBuilder = () => Promise<PlannedRoute | readonly PlannedRoute[]>;

export interface ActionReviewProps {
  /** Build a fresh SDK route only after the user asks to review it. */
  planBuilder: ActionPlanBuilder | null;
  label?: string;
  disabled?: boolean;
  onComplete?: (result: TransactionExecutionResult) => void | Promise<void>;
  operationLabel?: string;
}

type Stage = 'input' | 'review' | 'executing' | 'result';

function asRoutes(value: PlannedRoute | readonly PlannedRoute[]): PlannedRoute[] {
  const routes = Array.isArray(value) ? [...value] : [value];
  if (!routes.length) throw new Error('The SDK returned no executable route.');
  return routes;
}

function chainName(chainId: number): string {
  return chainId === 8453 ? 'Base' : chainId === 1 ? 'Ethereum' : `Chain ${chainId}`;
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function displayBigint(value: bigint): string {
  if (value === 0n) return '0';
  try {
    return formatEther(value);
  } catch {
    return value.toString();
  }
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
  value: string;
} | null {
  if (transaction.kind !== 'approval') return null;
  try {
    const decoded = decodeFunctionData({ abi: APPROVE_ABI, data: transaction.data });
    const [spender, amountOrTokenId] = decoded.args;
    return {
      spender,
      valueLabel: transaction.type === 'approvePosition' ? 'Position NFT ID' : 'Exact amount (raw units)',
      value: amountOrTokenId.toString(),
    };
  } catch {
    return null;
  }
}

function stepProgress(step: TransactionStepResult | undefined): {
  label: string;
  className: string;
  icon: ReactNode;
} {
  if (step?.status === 'confirmed') return { label: 'Confirmed', className: 'text-success', icon: <CheckCircle2 className="h-3.5 w-3.5" /> };
  if (step?.status === 'failed') return { label: 'Stopped', className: 'text-danger', icon: <XCircle className="h-3.5 w-3.5" /> };
  if (step?.status === 'submitted') return { label: 'Submitted', className: 'text-mint', icon: <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> };
  return { label: 'Ready', className: 'text-mut', icon: <Circle className="h-3.5 w-3.5" /> };
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
  const [reviewTitle, setReviewTitle] = useState<string | null>(null);
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const route = routes[selectedRoute];

  useEffect(() => {
    if (stage === 'review' || stage === 'result') {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [stage]);

  const reset = useCallback(() => {
    setStage('input');
    setRoutes([]);
    setSelectedRoute(0);
    setError(null);
    setResult(null);
    setStepResults([]);
    setReviewTitle(null);
    setReviewAcknowledged(false);
    setStatus('planning');
    setStatusDetail('');
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

  const review = useCallback(async () => {
    if (!planBuilder || disabled || loading) return;
    if (!wallet.authenticated || !wallet.address) {
      setError('Connect a Privy wallet before preparing a transaction.');
      return;
    }
    setLoading(true);
    setError(null);
    setStatus('planning');
    setStatusDetail('Building a fresh route from the official f(x) SDK…');
    try {
      const planned = asRoutes(await planBuilder());
      const walletAddress = wallet.address.toLowerCase();
      for (const candidate of planned) {
        if (candidate.walletAddress.toLowerCase() !== walletAddress) {
          throw new Error('The SDK route is not bound to the selected wallet.');
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
        throw new Error(`The SDK route could not be simulated: ${failures.join('; ')}`);
      }
      setRoutes(viable);
      setSelectedRoute(0);
      setStepResults([]);
      setReviewAcknowledged(false);
      // Snapshot the human-readable action with the calldata. Inputs remain
      // visible above the review card, but later form edits must never rename
      // an already reviewed route.
      setReviewTitle(operationLabel ?? viable[0].operation);
      setStatus('reviewing');
      setStatusDetail('Simulation passed. Review the exact ordered transactions.');
      setStage('review');
      haptic('selection');
    } catch (cause) {
      setError(userSafeError(cause, 'The SDK route could not be prepared. Check the inputs and network, then try again.'));
      haptic('error');
    } finally {
      setLoading(false);
    }
  }, [disabled, loading, operationLabel, planBuilder, wallet.address, wallet.authenticated]);

  const execute = useCallback(async () => {
    if (!route || loading) return;
    if (!reviewAcknowledged) {
      setError('Confirm that you reviewed the exact amounts, minimum outputs, route paths, and contracts before signing.');
      return;
    }
    setLoading(true);
    setError(null);
    setStage('executing');
    setStatus('awaiting-user');
    setStatusDetail('Each step will open an explicit wallet confirmation.');
    setStepResults([]);
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
              description: `Review step on ${chainName(request.chainId)} in your wallet.`,
              buttonText: 'Approve transaction',
            });
            return signed.hash;
          },
          onStatus: (next, detail) => {
            setStatus(next);
            setStatusDetail(detail ? userSafeError(detail, 'The route could not continue. Check the chain and try again.') : '');
          },
          onStep: (step) => {
            setStepResults((current) => {
              const next = [...current];
              next[step.index] = step;
              return next;
            });
          },
          // The runner invokes this only after a receipt and the required
          // following block have both been observed. Keeping the page refresh
          // inside that boundary prevents stale reads from being presented as
          // the result of a completed financial action.
          postConfirmRead: async (_confirmedRoute, execution) => {
            await onComplete?.(execution);
          },
        },
      });
      setResult(execution);
      setStage('result');
      haptic(execution.status === 'confirmed' ? 'success' : 'error');
    } catch (cause) {
      setError(userSafeError(cause, 'The transaction route could not continue. No later step was submitted.'));
      setStage('review');
      setStatus('failed');
      // A failed or stale route must be explicitly reviewed again. This is
      // especially important when the runner rejects a changed minOut,
      // converter path, leverage, or transformed reduction amount.
      setReviewAcknowledged(false);
      haptic('error');
    } finally {
      setLoading(false);
    }
  }, [loading, onComplete, reviewAcknowledged, reviewTitle, route, wallet]);

  const routeSummaries = useMemo(() => routes.map((candidate) => {
    const routeType = candidate.details?.routeType ?? 'Official SDK route';
    const approvals = candidate.transactions.filter((transaction) => transaction.kind === 'approval').length;
    return { routeType, approvals, count: candidate.transactions.length };
  }), [routes]);

  if (stage === 'input') {
    return (
      <div className="flex flex-col gap-2.5">
        {error && <InlineError message={error} />}
        <Button ref={triggerRef} disabled={!planBuilder || disabled || !wallet.ready} loading={loading} onClick={() => void review()}>
          <Sparkles aria-hidden="true" className="h-4 w-4" /> {label}
        </Button>
        <p className="px-1 text-center text-[10.5px] leading-relaxed text-mut">
          Nothing is signed yet. The official SDK builds and simulates a fresh route first.
        </p>
      </div>
    );
  }

  if (stage === 'result' && result) {
    const confirmed = result.status === 'confirmed';
    const hashes = result.steps.flatMap((step) => step.hash ? [step.hash] : []);
    return (
      <Card glow className="anim-scale-in p-5">
        <div className="flex flex-col items-center text-center">
          <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${confirmed ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'}`}>
            {confirmed ? <CheckCircle2 className="h-7 w-7" /> : <XCircle className="h-7 w-7" />}
          </span>
          <h3 ref={headingRef} tabIndex={-1} className="text-display mt-4 text-[21px] font-semibold outline-none">
            {confirmed ? 'Confirmed on-chain' : result.status === 'partial' ? 'Route partially completed' : 'Transaction failed'}
          </h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-mut">
            {confirmed ? 'State will refresh from Ethereum/Base after confirmation.' : userSafeError(result.error, 'No later route step was submitted after the failure.')}
          </p>
          {hashes.length > 0 && (
            <div className="mt-4 flex w-full flex-col gap-2 text-left">
              {hashes.map((hash, index) => (
                <HashButton key={hash} hash={hash} chainId={result.chainId} index={index} />
              ))}
            </div>
          )}
          {route?.operation === 'buildBridgeTx' && hashes[0] && isBridgeQuote(route.quote) && (
            <BridgeTracker
              className="mt-4 w-full text-left"
              sourceChain={route.chainId === 1 ? 'Ethereum' : 'Base'}
              destinationChain={route.chainId === 1 ? 'Base' : 'Ethereum'}
              token={route.quote.bridgeToken ?? 'Bridge asset'}
              amount={route.quote.bridgeAmount === undefined ? '' : formatUnits(route.quote.bridgeAmount, 18)}
              sourceTxHash={hashes[hashes.length - 1]}
              status={confirmed ? 'source_confirmed' : 'failed'}
              sourceOftAddress={route.quote.sourceOftAddress}
              destinationOftAddress={route.quote.destinationOftAddress}
              recipient={route.quote.recipient}
              sourceSender={route.walletAddress}
              amountLD={route.quote.amountLD}
              minAmountLD={route.quote.minAmountLD}
              destinationBaselineBlock={route.quote.destinationBaselineBlock}
            />
          )}
          <Button variant="ghost" className="mt-4" onClick={reset}>Done</Button>
        </div>
      </Card>
    );
  }

  if (!route) return null;
  const stepCount = route.transactions.length;
  return (
    <Card glow className="anim-scale-in p-5">
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-mint">Client-side review</p>
          <h3 ref={headingRef} tabIndex={-1} className="text-display mt-1.5 text-[22px] font-semibold leading-tight outline-none">
            {reviewTitle ?? route.operation}
          </h3>
          <p className="mt-1 text-[12px] text-mut">{chainName(route.chainId)} · {stepCount} ordered {stepCount === 1 ? 'transaction' : 'transactions'}</p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><ShieldCheck className="h-5 w-5" /></span>
      </div>

      {routes.length > 1 && (
        <div className="mt-4 flex flex-col gap-2" role="radiogroup" aria-label="SDK route options">
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-mut">Choose route</p>
          {routes.map((candidate, index) => (
            <button
              type="button"
              role="radio"
              aria-checked={selectedRoute === index}
              key={`${candidate.operation}-${index}`}
              tabIndex={selectedRoute === index ? 0 : -1}
              onClick={() => {
                setSelectedRoute(index);
                setStepResults([]);
                setReviewAcknowledged(false);
              }}
              className={`flex min-h-12 items-center justify-between rounded-xl border px-3 text-left ${selectedRoute === index ? 'border-[rgba(139,109,255,.55)] bg-[var(--mint-dim)]' : 'border-[var(--line)] bg-[rgba(255,255,255,.025)]'}`}
            >
              <span className="text-[12px] font-semibold">{routeSummaries[index].routeType}</span>
              <span className="text-[10px] text-mut">{routeSummaries[index].count} tx · {routeSummaries[index].approvals} approval{routeSummaries[index].approvals === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>
      )}

      <div className="my-4 hairline" />
      <div className="flex flex-col gap-2.5">
        <ReviewRow label="Network" value={chainName(route.chainId)} />
        <ReviewRow label="Wallet" value={`${route.walletAddress.slice(0, 6)}…${route.walletAddress.slice(-4)}`} />
        {route.details?.routeType && <ReviewRow label="SDK route" value={route.details.routeType} />}
        {route.details?.requestedAmount && <ReviewRow label="Reviewed input (raw units)" value={route.details.requestedAmount} />}
        {route.details?.requestedLeverage !== undefined && <ReviewRow label="Requested leverage" value={`${route.details.requestedLeverage}×`} />}
        {route.details?.slippagePercent !== undefined && <ReviewRow label="Slippage tolerance" value={`${route.details.slippagePercent}%`} />}
        {route.details?.leverage !== undefined && <ReviewRow label="SDK projected leverage" value={`${route.details.leverage}×`} />}
        {route.details?.executionPrice && <ReviewRow label="SDK execution price" value={route.details.executionPrice} />}
        {route.details?.minOut !== undefined && <ReviewRow label="SDK minimum output" value={route.details.minOut} />}
        {route.details?.colls && <ReviewRow label="SDK projected collateral" value={route.details.colls} />}
        {route.details?.debts && <ReviewRow label="SDK projected debt" value={route.details.debts} />}
        {route.details?.economicLimits?.map((limit, index) => (
          <ReviewRow key={`${limit.label}-${index}`} label={limit.label} value={`${limit.value} raw units`} />
        ))}
        {route.details?.conversionPaths?.map((path, index) => (
          <ReviewRow key={`${path.label}-${index}`} label={`${path.label} path hash`} value={path.fingerprint} />
        ))}
        {route.policy?.reviewedAction?.expectedActionDataFingerprint && (
          <ReviewRow label="Protocol calldata fingerprint" value={route.policy.reviewedAction.expectedActionDataFingerprint} />
        )}
        {isBridgeQuote(route.quote) && <ReviewRow label="LayerZero native fee" value={`${displayBigint(route.quote.nativeFee)} ETH`} />}
        {isBridgeQuote(route.quote) && route.quote.sourceOftAddress && <ReviewRow label="Reviewed source OFT" value={route.quote.sourceOftAddress} />}
        {isBridgeQuote(route.quote) && route.quote.destinationOftAddress && <ReviewRow label="Reviewed destination OFT" value={route.quote.destinationOftAddress} />}
        {isBridgeQuote(route.quote) && route.quote.sourceTokenAddress && <ReviewRow label="Source local token" value={route.quote.sourceTokenAddress} />}
        {isBridgeQuote(route.quote) && route.quote.destinationTokenAddress && <ReviewRow label="Destination local token" value={route.quote.destinationTokenAddress} />}
        {isBridgeQuote(route.quote) && route.quote.sourceApprovalRequired !== undefined && <ReviewRow label="Source approval" value={route.quote.sourceApprovalRequired ? 'Required when allowance is insufficient' : 'Not required'} />}
        {isBridgeQuote(route.quote) && route.quote.destinationApprovalRequired !== undefined && <ReviewRow label="Destination approval" value={route.quote.destinationApprovalRequired ? 'Adapter metadata: required' : 'Not required'} />}
        {isBridgeQuote(route.quote) && route.quote.approvalTokenAddress && <ReviewRow label="Approval token" value={route.quote.approvalTokenAddress} />}
        {isBridgeQuote(route.quote) && route.quote.destinationEid !== undefined && <ReviewRow label="Destination EID" value={String(route.quote.destinationEid)} />}
        {isBridgeQuote(route.quote) && route.quote.recipient && <ReviewRow label="Recipient" value={route.quote.recipient} />}
        {isBridgeQuote(route.quote) && route.quote.recipientBytes32 && <ReviewRow label="Recipient bytes32" value={route.quote.recipientBytes32} />}
        {isBridgeQuote(route.quote) && route.quote.amountLD !== undefined && <ReviewRow label="Bridge amount" value={`${formatUnits(route.quote.amountLD, 18)} tokens`} />}
        {isBridgeQuote(route.quote) && route.quote.minAmountLD !== undefined && <ReviewRow label="Minimum delivered" value={`${formatUnits(route.quote.minAmountLD, 18)} tokens`} />}
        {isBridgeQuote(route.quote) && route.quote.extraOptions !== undefined && <ReviewRow label="LayerZero extra options" value={route.quote.extraOptions} />}
        {isBridgeQuote(route.quote) && route.quote.composeMsg !== undefined && <ReviewRow label="Compose message" value={route.quote.composeMsg} />}
        {isBridgeQuote(route.quote) && route.quote.oftCmd !== undefined && <ReviewRow label="OFT command" value={route.quote.oftCmd} />}
        {isBridgeQuote(route.quote) && route.quote.refundAddress && <ReviewRow label="Fee refund" value={route.quote.refundAddress} />}
      </div>

      <div className="mt-4 flex flex-col gap-2" aria-label="Ordered transaction steps">
        {route.transactions.map((transaction, index) => {
          const approval = approvalFacts(transaction);
          const progress = stepProgress(stepResults[index]);
          return (
          <div key={`${transaction.to}-${index}`} className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold">Step {index + 1} · {transaction.kind === 'approval' ? 'Exact approval' : 'Protocol action'}</span>
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${progress.className}`}>{progress.icon}{progress.label}</span>
            </div>
            <p className="mt-1 break-all font-mono text-[10px] text-mut">Contract: {transaction.to}</p>
            <p className="mt-1 text-[10px] text-mut">{transaction.nonce === undefined ? 'Nonce is checked immediately before signing' : `Reviewed nonce: ${transaction.nonce}`}</p>
            {approval && <p className="mt-1 break-all text-[10px] text-mut">Approval spender: <span className="font-mono">{approval.spender}</span></p>}
            {approval && <p className="mt-1 text-[10px] text-mut">{approval.valueLabel}: <span className="break-all font-mono">{approval.value}</span></p>}
            {transaction.value > 0n && <p className="mt-1 text-[10px] text-mut">Native value: {displayBigint(transaction.value)} ETH</p>}
            <details className="mt-2 border-t border-[var(--line)] pt-1.5">
              <summary className="flex min-h-11 cursor-pointer items-center text-[10px] font-semibold text-mint">Inspect raw transaction</summary>
              <p className="mt-1 font-mono text-[10px] text-mut">Selector: {transaction.data.slice(0, 10)}</p>
              <p className="mt-1 break-all font-mono text-[9px] leading-relaxed text-[var(--mut-2)]">{transaction.data}</p>
            </details>
          </div>
          );
        })}
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="mt-4 flex items-start gap-2.5 rounded-2xl bg-[var(--mint-dim)] p-3 text-[11px] leading-relaxed text-mut">
        <Fuel aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
        <span>{statusDetail || 'Simulation passed. Your wallet will show every transaction before it is sent.'}</span>
      </div>
      {error && <div className="mt-3"><InlineError message={error} /></div>}
      <label className="mt-4 flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] p-3 text-[11px] leading-relaxed text-mut">
        <input
          type="checkbox"
          checked={reviewAcknowledged}
          onChange={(event) => setReviewAcknowledged(event.target.checked)}
          disabled={loading || status === 'failed'}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--mint)]"
        />
        <span>I reviewed the exact transaction amounts, minimum outputs, converter paths, recipient, and contracts above. I understand that each wallet prompt is a separate on-chain approval.</span>
      </label>
      <Button disabled={loading || status === 'failed' || !reviewAcknowledged} loading={loading || stage === 'executing'} className="mt-3" onClick={() => void execute()}>
        <ShieldCheck aria-hidden="true" className="h-4 w-4" /> Confirm each step in wallet
      </Button>
      <p className="mt-2 text-center text-[10px] leading-relaxed text-mut">
        FxAeon never receives your private key. A later step is locked until the previous receipt succeeds.
      </p>
    </Card>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 text-[12px]"><span className="text-mut">{label}</span><span className="max-w-[62%] break-all text-right font-semibold">{value}</span></div>;
}

function HashButton({ hash, chainId, index }: { hash: string; chainId: number; index: number }) {
  const open = () => {
    const base = chainId === 8453 ? 'https://basescan.org' : 'https://etherscan.io';
    const url = `${base}/tx/${hash}`;
    const telegram = getWebApp();
    if (telegram?.openLink) telegram.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };
  return <button type="button" onClick={open} className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-[var(--mint-dim)] px-3 text-[11.5px] font-semibold text-mint"><span>Step {index + 1} · {shortHash(hash)}</span><span className="inline-flex items-center gap-1">Explorer <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></span></button>;
}

function InlineError({ message }: { message: string }) {
  return <div role="alert" className="flex gap-2.5 rounded-2xl border border-[rgba(255,107,118,.2)] bg-[var(--danger-dim)] p-3 text-[11.5px] leading-relaxed text-danger"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>;
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
