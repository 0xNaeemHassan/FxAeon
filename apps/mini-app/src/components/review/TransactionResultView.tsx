'use client';

import type { ReactNode, Ref } from 'react';
import type { TransactionExecutionResult, TransactionStepResult } from '@/lib/fx';
import type { ReceiptPresentation } from '@/lib/receiptPresentation';
import { compactAddress } from '@/lib/addressPresentation';
import { hasTransactionHash } from '@/lib/transactionProgress';
import { Button } from '@/components/ui';
import { ReceiptSummary } from '@/components/review/ActionReviewSummary';
import { chainName, TransactionHashLink } from '@/components/review/ReviewProgress';
import { resultBodyDuringRefresh, type resultPresentation } from '@/components/review/executionResult';

type ResultPresentation = ReturnType<typeof resultPresentation>;

export function TransactionResultView({
  result,
  presentation,
  refreshing,
  positionAction,
  positionLabel,
  receipts,
  bridgeTracker,
  nextLabel,
  nextAriaLabel,
  onNext,
  headingRef,
}: {
  result: TransactionExecutionResult;
  presentation: ResultPresentation;
  refreshing: boolean;
  positionAction: boolean;
  positionLabel?: string;
  receipts: readonly ReceiptPresentation[];
  bridgeTracker?: ReactNode;
  nextLabel: string;
  nextAriaLabel: string;
  onNext: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const ResultIcon = presentation.icon;
  const tone = presentation.tone === 'success'
    ? 'bg-[var(--success-dim)] text-success'
    : presentation.tone === 'warning'
      ? 'bg-[var(--warn-dim)] text-warn'
      : 'bg-[var(--danger-dim)] text-danger';
  return (
    <div className="flex flex-col items-center text-center">
      <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${tone}`}>
        <ResultIcon className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 ref={headingRef} data-review-focus tabIndex={-1} className="text-display mt-4 text-[21px] font-semibold outline-none">{presentation.title}</h3>
      <p className="mt-1.5 text-[12px] leading-relaxed text-mut">
        {resultBodyDuringRefresh({ status: result.status, refreshing, positionAction, body: presentation.body })}
      </p>
      <p className="mt-2 text-[11px] text-mut" title={result.walletAddress}>
        {chainName(result.chainId)} · Wallet {compactAddress(result.walletAddress)}
      </p>
      {result.steps.some(hasTransactionHash) && (
        <div className="mt-4 flex w-full flex-col gap-2 text-left">
          {result.steps.map((step: TransactionStepResult) => hasTransactionHash(step)
            ? <TransactionHashLink key={`${step.index}-${step.hash}`} step={step} chainId={result.chainId} />
            : null)}
        </div>
      )}
      <ReceiptSummary receipts={receipts} />
      {positionLabel && <p className="mt-2 text-[11px] text-mut">Position: {positionLabel}</p>}
      {bridgeTracker}
      <Button variant="ghost" aria-label={nextAriaLabel} className="mt-4" onClick={onNext}>{nextLabel}</Button>
    </div>
  );
}
