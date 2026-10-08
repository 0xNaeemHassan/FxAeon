'use client';

import type { ReactNode, Ref } from 'react';
import type { TransactionExecutionResult, TransactionStepResult } from '@/lib/fx';
import type { ReceiptPresentation } from '@/lib/receiptPresentation';
import { compactAddress } from '@/lib/addressPresentation';
import { hasTransactionHash } from '@/lib/transactionProgress';
import { Button } from '@/components/ui';
import { ReceiptSummary } from '@/components/review/ActionReviewSummary';
import { chainName, TransactionHashLink } from '@/components/review/ReviewProgress';
import styles from './ActionReviewPresentation.module.css';
import flowStyles from '../FlowWorkspace.module.css';
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
  /** Also the accessible name, so speech and sight name the same action. */
  nextLabel: string;
  onNext: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const ResultIcon = presentation.icon;
  return (
    <div className={styles.result}>
      <span className={styles.resultMark} data-tone={presentation.tone} aria-hidden="true">
        {presentation.tone === 'success'
          // A confirmed receipt draws its check once; nothing else celebrates.
          ? <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="M15.5 27.2 22.6 34.3 37 19.6" /></svg>
          : <ResultIcon className="h-7 w-7" />}
      </span>
      <h3 ref={headingRef} data-review-focus tabIndex={-1} className="text-display mt-4 text-[22px] font-semibold outline-none">{presentation.title}</h3>
      <p className="mt-1.5 max-w-[34ch] text-[14px] leading-snug text-mut">
        {resultBodyDuringRefresh({ status: result.status, refreshing, positionAction, body: presentation.body })}
      </p>
      <p className={styles.resultMeta} title={result.walletAddress}>
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
      {positionLabel && <p className={styles.resultMeta}>Position: {positionLabel}</p>}
      {bridgeTracker}
      <Button variant={presentation.tone === 'danger' ? 'ghost' : 'primary'} className={`mt-5 ${flowStyles.primaryAction}`} onClick={onNext}>{nextLabel}</Button>
    </div>
  );
}
