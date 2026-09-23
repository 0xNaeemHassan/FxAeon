'use client';

import { type ReactNode } from 'react';
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
  type PlannedRoute,
  type PlannedTransaction,
} from '@/lib/fx';
import type { ActionReviewProps } from '@/components/review/actionReviewTypes';
export type { ActionPlanBuilder, ActionReviewProps, ActionReviewStage } from '@/components/review/actionReviewTypes';
import { Button, Card } from '@/components/ui';
import { ValueOrSkeleton } from '@/components/MissingValue';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { compactAddress } from '@/lib/addressPresentation';
import { hasTransactionHash } from '@/lib/transactionProgress';
import { BridgeTracker } from '@/components/BridgeTracker';
import { CalldataDisclosure, InlineError, StatusNotice, stepProgress, chainName } from '@/components/review/ReviewProgress';
import { resultPresentation } from '@/components/review/executionResult';
import { splitReviewFacts } from '@/components/review/reviewSummary';
import { factsOutsideConsequenceSummary, primaryReviewFacts, routeFacts as buildRouteFacts } from '@/components/review/actionReviewPresentation';
import { consequenceSummary, pairVerifiedPositionFacts, reviewActionLabel } from '@/components/review/actionReviewModel';
import { useActionReviewLifecycle } from '@/components/review/useActionReviewLifecycle';
import { selectExecutionTask } from '@/lib/taskState';
import { buildReceiptPresentation, receiptTransfersFromLogs } from '@/lib/receiptPresentation';
import { receiptMintedPositionIdentity } from '@/lib/confirmedPositions';
import { rawQuoteReviewFacts, type ReviewFact } from '@/lib/fx/reviewFormatting';
import { buildStatusPresentation } from '@/components/review/actionReviewStatusModel';
import { PositionOutcomeSummary, TransactionProgressPresentation, UpdatedQuoteSummary } from '@/components/review/ActionReviewSummary';
import { TransactionResultView } from '@/components/review/TransactionResultView';
import { positionPoolAddress } from '@/lib/fx/policy';
import styles from './FlowWorkspace.module.css';
import presentationStyles from './review/ActionReviewPresentation.module.css';

function trimDecimal(value: string): string {
  return value.includes('.') ? value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : value;
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

function statusPresentation(params: Parameters<typeof buildStatusPresentation>[0]) {
  const state = buildStatusPresentation(params);
  const icon = state.icon === 'clock' ? <Clock3 className="h-4 w-4" />
    : state.icon === 'loading' ? <LoaderCircle className="h-4 w-4 animate-spin" />
      : state.icon === 'success' ? <CheckCircle2 className="h-4 w-4" />
        : state.icon === 'warning' ? <AlertTriangle className="h-4 w-4" />
          : <CircleAlert className="h-4 w-4" />;
  return { ...state, icon };
}

export function ActionReview(props: ActionReviewProps) {
  const lifecycle = useActionReviewLifecycle(props);
  const { label = 'Review action', disabled = false, operationLabel, destructive = false, editor, decisionBefore, executionCost, surface = 'card', planBuilder } = props;
  const { canSelectReviewedRoute, endConnectFlow, error, execute, gasCost, headingRef, loading, networkSwitching, quoteChanges, quoteExpired, refreshReviewedQuote, refreshing, reset, result, review, reviewTitle, route, routeSummaries, routes, selectedRoute, selectReviewedRoute, startConnectFlow, stage, status, statusDetail, stepResults, triggerRef, wallet } = lifecycle;

  if (stage === 'input') {
    const progress = statusPresentation({ stage, status, detail: statusDetail, stepResults, stepCount: 0 });
    const disconnected = !wallet.authenticated || !wallet.address;
    const reviewLabel = quoteExpired ? 'Review updated quote' : reviewActionLabel(label, operationLabel);
    const trigger = (
      <div className={`${styles.reviewTrigger} reviewTrigger flex flex-col gap-2.5`}>
        {error && <InlineError message={error} />}
        {disconnected ? (
          <ConnectWalletButton
            className={`button button-primary glass-press ${styles.primaryAction} flex w-full items-center justify-center`}
            // ConnectWalletButton queues while the provider hydrates; only
            // the action's own disabled state should block that intent.
            disabled={disabled}
            resumeIfConnected
            onConnectStart={startConnectFlow}
            onConnectError={endConnectFlow}
          >
            Connect wallet
          </ConnectWalletButton>
        ) : (
          <Button ref={triggerRef} variant={destructive ? 'danger' : 'primary'} className={styles.primaryAction} disabled={!planBuilder || disabled || !wallet.ready} loading={loading} onClick={() => void review()}>
            {reviewLabel}
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
          <button type="button" onClick={reset} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-1 text-[12px] font-semibold text-mut"><ArrowLeft aria-hidden="true" className="h-4 w-4" /> Edit</button>
          <div className="flex min-h-44 flex-col items-center justify-center text-center" role="status" aria-live="polite">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
              <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
            </span>
            <h3 data-review-focus tabIndex={-1} className="text-display mt-4 text-[21px] font-semibold outline-none">Preparing review</h3>
          </div>
      </ReviewSurface>
    );
  }

  if (stage === 'result' && result) {
    const transactionTask = selectExecutionTask(result);
    const bridgeQuote = route?.operation === 'buildBridgeTx' && isBridgeQuote(route.quote) ? route.quote : null;
    const bridge = Boolean(bridgeQuote);
    const presentation = resultPresentation(result, bridge);
    const bridgeStep = bridge
      ? [...result.steps].reverse().find((step) => step.transaction.kind === 'action' && step.hash)
      : undefined;
    const bridgeStatus = bridgeStep?.receipt?.status === 'reverted'
      ? 'failed'
      : bridgeStep?.status === 'confirmed' && bridgeStep.receipt?.status === 'success'
        ? 'source_confirmed'
        : 'pending';
    const positionAction = result.status === 'confirmed' && [
      'increasePosition', 'reducePosition', 'adjustPositionLeverage', 'depositAndMint', 'repayAndWithdraw',
    ].includes(result.operation);
    const positionIntent = route?.policy?.reviewedAction && 'positionId' in route.policy.reviewedAction
      && 'poolAddress' in route.policy.reviewedAction
      ? route.policy.reviewedAction
      : null;
    const poolLocation = positionIntent
      ? (['ETH', 'BTC'] as const).flatMap((market) => (['long', 'short'] as const).map((side) => ({ market, side })))
        .find(({ market, side }) => positionPoolAddress(market, side).toLowerCase() === positionIntent.poolAddress.toLowerCase())
      : undefined;
    const receiptPositionIdentity = result.status === 'confirmed' && route && positionIntent?.positionId === 0
      && (route.operation === 'increasePosition' || route.operation === 'depositAndMint')
      ? receiptMintedPositionIdentity({ route, result })
      : null;
    const positionSide = positionIntent && 'positionType' in positionIntent ? positionIntent.positionType : poolLocation?.side ?? receiptPositionIdentity?.side;
    const positionMarket = poolLocation?.market ?? receiptPositionIdentity?.market;
    const positionId = positionIntent && positionIntent.positionId > 0
      ? positionIntent.positionId
      : receiptPositionIdentity?.positionId;
    const positionLabel = positionAction && result.status === 'confirmed' && positionId !== undefined
      ? `${positionMarket ?? 'Protocol'}${positionSide ? ` ${positionSide}` : ''} · #${positionId}`
      : undefined;
    const positionHref = positionId !== undefined && positionMarket && positionSide
      ? `/positions?position=${encodeURIComponent(`${positionMarket}:${positionSide}:${positionId}`)}&action=${positionIntent?.kind === 'position-reduce' && positionIntent.isClosePosition ? 'close' : positionIntent?.kind === 'position-reduce' || positionIntent?.kind === 'repay-and-withdraw' ? 'reduce' : positionIntent?.kind === 'position-adjust' ? 'leverage' : 'increase'}`
      : undefined;
    const receiptFacts = result.steps.flatMap((step) => {
      if (!hasTransactionHash(step) || !step.receipt) return [];
      const receiptStatus = step.receipt.status === 'success' ? 'success' : 'reverted';
      const effectiveGasPrice = (step.receipt as { effectiveGasPrice?: bigint }).effectiveGasPrice;
      return [buildReceiptPresentation({
        chainId: result.chainId as 1 | 8453,
        walletAddress: result.walletAddress,
        status: receiptStatus,
        transfers: receiptTransfersFromLogs(step.receipt.logs ?? [], result.walletAddress),
        executionCostWei: typeof effectiveGasPrice === 'bigint' ? step.receipt.gasUsed * effectiveGasPrice : undefined,
        nativeValueWei: step.transaction.value,
      })];
    });
    return (
      <ReviewSurface surface={surface} className={`${styles.reviewCard} ${styles.reviewInlineCard} anim-scale-in p-4 sm:p-5`}>
        <TransactionResultView
          result={result}
          presentation={presentation}
          refreshing={refreshing}
          positionAction={positionAction}
          positionLabel={positionLabel}
          receipts={receiptFacts}
          headingRef={headingRef}
          bridgeTracker={bridgeQuote && bridgeStep?.hash ? (
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
          ) : undefined}
          nextAriaLabel={transactionTask ? 'View transaction progress' : positionAction ? 'View position' : 'Done'}
          nextLabel={transactionTask ? 'View transaction progress' : bridge ? 'Back to Move' : positionAction ? 'View position' : result.status === 'confirmed' ? 'Back to action' : 'Try again'}
          onNext={() => transactionTask ? window.location.assign(transactionTask.href) : positionAction ? window.location.assign(positionHref ?? '/positions') : reset()}
        />
      </ReviewSurface>
    );
  }

  if (!route) return null;
  const stepCount = route.transactions.length;
  const approvalCount = route.transactions.filter((transaction) => transaction.kind === 'approval').length;
  const facts = buildRouteFacts(route, gasCost, executionCost);
  const reviewFacts = splitReviewFacts(facts);
  const consequenceFacts = consequenceSummary(primaryReviewFacts(route));
  const positionChanges = pairVerifiedPositionFacts(decisionBefore ?? [], facts);
  const pairedOutcomeLabels = new Set(positionChanges.paired.map((fact) => `estimated ${fact.label.toLowerCase()}`));
  const actionConsequences = consequenceFacts.filter((fact) => !pairedOutcomeLabels.has(fact.label.toLowerCase()));
  const remainingSummaryFacts = factsOutsideConsequenceSummary(reviewFacts.summary, actionConsequences);
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
        className="mb-1 inline-flex min-h-11 items-center gap-1.5 rounded-xl pr-3 text-[12px] font-semibold text-mut disabled:opacity-50"
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
        <div className={presentationStyles.actualProgress}>
          <TransactionProgressPresentation label="Submitted transactions" status={status} stepResults={stepResults} chainId={route.chainId} presentation={progress} />
        </div>
      )}

      {routes.length > 1 && (
        <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Route options">
          <p className="text-[12px] font-medium text-mut">Choose route</p>
          {routes.map((candidate, index) => (
            <button
              type="button"
              role="radio"
              aria-checked={selectedRoute === index}
              disabled={loading || !canSelectReviewedRoute}
              key={`${candidate.operation}-${index}`}
              tabIndex={selectedRoute === index ? 0 : -1}
              onClick={() => selectReviewedRoute(index)}
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
                selectReviewedRoute(next);
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

      <div className="my-3 hairline" />
      <div className={styles.reviewFacts}>
        <p className={presentationStyles.reviewFactsTitle}>Review details</p>
        <ReviewRow label="Wallet" value={compactAddress(route.walletAddress)} title={route.walletAddress} />
        {[...actionConsequences, ...remainingSummaryFacts].map((fact) => <ReviewRow key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.value} title={fact.title} />)}
        {approvals.length > 0 && <ReviewRow label="Approvals" value={approvals.join('; ')} />}
     </div>

      {quoteExpired && <div role="status" className="mt-3 rounded-xl border border-[rgba(255,194,102,.28)] bg-[var(--warn-dim)] px-3 py-2 text-[12px] text-warn">This reviewed quote expired. Refresh and review the updated terms before signing.</div>}
      <UpdatedQuoteSummary changes={quoteChanges} />

      {wrongNetwork && <p role="status" className="mt-2 rounded-xl border border-[rgba(255,194,102,.24)] bg-[var(--warn-dim)] px-3 py-2 text-[11.5px] leading-relaxed text-warn">Wallet is on {chainName(wallet.chainId!)}. Confirmation will switch to {chainName(route.chainId)} before signing.</p>}
      {unsupportedNetwork && <p role="status" className="mt-2 rounded-xl border border-[rgba(255,194,102,.24)] bg-[var(--warn-dim)] px-3 py-2 text-[11.5px] leading-relaxed text-warn">Wallet network is unavailable or unsupported. Confirmation will request {chainName(route.chainId)} before signing.</p>}

      <PositionOutcomeSummary facts={positionChanges.paired} />
      <DecisionContext beforeFacts={positionChanges.remainingBefore.length ? positionChanges.remainingBefore : undefined} />

      <QuoteFactDetails facts={facts} />
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
              <CalldataDisclosure data={transaction.data} />
            </div>
          </div>
          );
        })}
        </section>
      </details>

      {!showExecutionProgress && !(stage === 'review' && status === 'reviewing') && <div className="mt-4"><StatusNotice {...progress} /></div>}
      {error && <div className="mt-3"><InlineError message={error} /></div>}
      {stage === 'review' && (
        <div className={styles.reviewInlineActions}>
          <Button variant={destructive ? 'danger' : 'primary'} disabled={disabled || !planBuilder || loading || (!quoteExpired && status === 'failed')} loading={loading} className={styles.primaryAction} onClick={() => quoteExpired ? void refreshReviewedQuote() : void execute()}>
            {quoteExpired ? 'Review updated quote' : stepCount === 1 ? 'Confirm in wallet' : `Confirm ${stepCount} transactions`}
          </Button>
        </div>
      )}
    </ReviewSurface>
  );

}

function ReviewSurface({ surface, className, children }: { surface: 'card' | 'content'; className: string; children: ReactNode }) {
  if (surface === 'content') return <div className={`${styles.reviewInlineContent} reviewInlineContent anim-scale-in`}>{children}</div>;
  return <Card className={className}>{children}</Card>;
}

function ReviewRow({ label, value, title, className }: { label: string; value: ReactNode; title?: string; className?: string }) {
  const valueTitle = title ?? (typeof value === 'string' ? value : undefined);
  return <div className={`flex items-start justify-between gap-4 text-[12px] ${className ?? ''}`}><span className="text-mut">{label}</span><span title={valueTitle} className="max-w-[62%] break-all text-right font-semibold tabular-nums"><ValueOrSkeleton value={value} width="md" label={`Loading ${label.toLowerCase()}`} /></span></div>;
}

function AdvancedReviewDetails({ route }: { route: PlannedRoute }) {
  const bridgeQuote = isBridgeQuote(route.quote) ? route.quote : null;
  const rawQuoteFacts = rawQuoteReviewFacts(route);
  const hasDetails = Boolean(
    route.details?.requestedAmount
      || route.transactions.length
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
        {route.transactions.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3" aria-label="Prepared transactions">
            <p className="text-[11px] font-semibold text-mut">Prepared transactions</p>
            {route.transactions.map((transaction, index) => {
              const approval = approvalFacts(transaction);
              return (
                <div key={`${transaction.to}-${index}`} className="flex flex-col gap-1.5 rounded-lg border border-[var(--line)] bg-[rgba(255,255,255,.02)] p-2.5">
                  <p className="text-[11px] font-semibold">{stepTitle(transaction)} {index + 1}</p>
                  <ReviewRow label="Contract" value={transaction.to} />
                  <ReviewRow label="Transaction value (wei)" value={transaction.value.toString()} />
                  {approval && <ReviewRow label="Approval spender" value={approval.spender} />}
                  {approval && <ReviewRow label={approval.valueLabel} value={approval.value.toString()} />}
                  <CalldataDisclosure data={transaction.data} />
                </div>
              );
            })}
          </div>
        )}
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
function QuoteFactDetails({ facts }: { facts: ReviewFact[] }) {
  if (!facts.length) return null;
  return <details className="group mt-2 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.02)] px-3">
    <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-3 text-[11px] font-semibold text-mut">
      <span>Quote details</span><span className="text-[10px] font-normal text-[var(--mut-2)] group-open:hidden">Exact values and route</span>
    </summary>
    <div className="flex flex-col gap-1 border-t border-[var(--line)] py-2">
      {facts.map((fact) => <ReviewRow key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.title ?? fact.value} title={fact.title ?? fact.value} />)}
    </div>
  </details>;
}

function DecisionContext({ beforeFacts }: { beforeFacts?: ReviewFact[] }) {
  if (!beforeFacts?.length) return null;
  return <details aria-label="Current position" className="group mt-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3">
    <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-3 text-[11px] font-semibold text-mut"><span>Current position</span><span className="text-[10px] font-normal text-[var(--mut-2)] group-open:hidden">Verified values</span></summary>
    <div className="grid gap-1 border-t border-[var(--line)] py-2">{beforeFacts.map((fact) => <ReviewRow key={`before-${fact.label}`} label={fact.label} value={fact.value} title={fact.title} />)}</div>
  </details>;
}
