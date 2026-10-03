import type { ChangedReviewFact } from './actionReviewModel';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import { shouldShowReceiptMovementFallback, type ReceiptPresentation } from '@/lib/receiptPresentation';
import { StatusNotice, TransactionHashLink } from '@/components/review/ReviewProgress';
import presentationStyles from './ActionReviewPresentation.module.css';
import { ValueOrSkeleton } from '@/components/MissingValue';

export function CompactQuoteMetrics({ facts, gasStatus }: {
  facts: readonly ReviewFact[];
  gasStatus: 'current' | 'refreshing' | 'unavailable';
}) {
  const byLabel = new Map(facts.map((fact) => [fact.label, fact]));
  const primaryOutcome = facts.find((fact) =>
    fact.label === 'Receive'
    || fact.label === 'Minimum received'
    || fact.label.startsWith('Minimum fxSAVE received'),
  );
  const candidates: Array<ReviewFact | undefined> = [
    primaryOutcome ?? byLabel.get('Estimated collateral'),
    byLabel.get('Gas tier'),
    byLabel.get('Gas fee') ?? { label: 'Network fee max', value: '—' },
  ];
  const metrics = candidates
    .filter((fact): fact is ReviewFact => fact !== undefined)
    .filter((fact, index, all) => all.findIndex((candidate) => candidate.label === fact.label) === index);
  if (!metrics.length) return null;
  return <div className={presentationStyles.quoteMetrics} aria-label="Current quote estimates">
    {metrics.map((fact) => <div className={presentationStyles.quoteMetric} key={fact.label}>
      <span className={presentationStyles.quoteMetricLabel}>{fact.label}</span>
      <span className={presentationStyles.quoteMetricValue} title={fact.title}>{fact.label === 'Gas tier' ? fact.value : <ValueOrSkeleton value={fact.value} width="sm" status={gasStatus === 'refreshing' ? 'loading' : 'unavailable'} label={fact.label} />}</span>
    </div>)}
  </div>;
}

function SummaryRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div className="grid min-w-0 grid-cols-[minmax(76px,.72fr)_minmax(0,1.28fr)] gap-x-2 py-0.5 text-[11px] leading-snug">
    <span className="text-mut">{label}</span><span className="min-w-0 break-words text-right font-medium" title={title}>{value}</span>
  </div>;
}

export function UpdatedQuoteSummary({ changes }: { changes: readonly ChangedReviewFact[] }) {
  // Keep route changes visible without repeating the full review in a second
  // card. Amount, fee, and approval changes still receive explicit comparison.
  const visibleChanges = changes.filter((change) => change.label !== 'Transaction route');
  if (!visibleChanges.length) return changes.length
    ? <p className="mt-2 text-[12px] text-mut" role="status">Route updated. Check the details before confirming.</p>
    : null;
  return (
    <section className="mt-2 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] px-3 py-2" aria-label="Updated transaction consequences">
      <p className="text-[11px] font-semibold text-mut">Changed since your previous review</p>
      <div className="mt-1 flex flex-col gap-1">
        {visibleChanges.map((change) => <div key={change.label} className="grid grid-cols-[minmax(80px,.7fr)_minmax(0,1.3fr)] gap-x-3 text-[11px]">
          <span className="text-mut">{change.label}</span>
          <span>{change.before ? `${change.before} → ` : ''}{change.after ?? 'No longer included'}</span>
        </div>)}
      </div>
    </section>
  );
}

export function ActionConsequenceSummary({ facts }: { facts: readonly ReviewFact[] }) {
  if (!facts.length) return null;
  return (
    <section className="mt-2 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.02)] px-3 py-2" aria-label="Action consequences">
      <p className="text-[11px] font-semibold text-mut">What changes</p>
      <div className="mt-1 flex flex-col gap-0.5">
        {facts.map((fact) => <SummaryRow key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.value} title={fact.title} />)}
      </div>
    </section>
  );
}

export function PositionOutcomeSummary({ facts }: { facts: readonly { label: string; before: string; after: string }[] }) {
  if (!facts.length) return null;
  return (
    <section className={presentationStyles.positionOutcome} aria-label="Current and expected position values">
      <p>Position outcome</p>
      <dl>{facts.map((fact) => <div key={fact.label}>
        <dt>{fact.label}</dt><dd>{fact.before} → {fact.after}</dd>
      </div>)}</dl>
    </section>
  );
}

export function ReceiptSummary({ receipts }: { receipts: readonly ReceiptPresentation[] }) {
  if (!receipts.length) return null;
  const movements = receipts.flatMap((receipt) => receipt.movements);
  const technicalMovements = receipts.flatMap((receipt) => receipt.technicalMovements);
  const showMovementFallback = shouldShowReceiptMovementFallback(receipts);
  return (
    <section className="mt-4 w-full rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] p-3 text-left" aria-label="Verified receipt">
      <p className="text-[12px] font-semibold">Verified receipt</p>
      {movements.map((movement, index) => <p key={`movement-${index}`} className="mt-1 text-[11px] text-mut">{movement}</p>)}
      {movements.length === 0 && showMovementFallback && <p className="mt-1 text-[11px] text-mut">Token movements could not be established from the verified receipt logs.</p>}
      {technicalMovements.length > 0 && <details className="mt-2 text-[11px]"><summary className="cursor-pointer text-mut">Technical movement details</summary>{technicalMovements.map((movement, index) => <p key={`technical-${index}`} className="mt-1 break-all font-mono text-[10px] text-mut">{movement}</p>)}</details>}
      {receipts.map((receipt, index) => <div key={`fees-${index}`} className="mt-1 text-[11px] text-mut">
        {receipt.executionFee && <p>{receipt.feeLabel}: {receipt.executionFee}</p>}
        {receipt.l1DataFee && <p>Base L1 data fee: {receipt.l1DataFee}</p>}
        {receipt.operatorFee && <p>Base operator fee: {receipt.operatorFee}</p>}
        {receipt.totalExecutionFee && receipt.totalFeeLabel && <p>{receipt.totalFeeLabel}: {receipt.totalExecutionFee}</p>}
        {receipt.feeCaveat && <p>{receipt.feeCaveat}</p>}
      </div>)}
      {receipts.map((receipt, index) => receipt.nativeValue && <p key={`native-${index}`} className="mt-1 text-[11px] text-mut">{receipt.nativeValueLabel}: {receipt.nativeValue}</p>)}
    </section>
  );
}

export function TransactionProgressPresentation({
  label,
  status,
  stepResults,
  chainId,
  presentation,
}: {
  label: string;
  status: import('@/lib/fx').PlanStatus;
  stepResults: readonly import('@/lib/fx').TransactionStepResult[];
  chainId: number;
  presentation: { label: string; body: string; className: string; icon: import('react').ReactNode };
}) {
  const submitted = stepResults.filter((step) => Boolean(step.hash));
  if (status !== 'submitted' && status !== 'included' && status !== 'confirming' && status !== 'confirmed' && status !== 'partial' && status !== 'failed' && status !== 'awaiting-user') return null;
  return (
    <section className="mt-4 flex flex-col gap-2" aria-label={label}>
      <StatusNotice {...presentation} />
      {submitted.map((step) => <TransactionHashLink key={`${step.index}-${step.hash}`} step={step} chainId={chainId} />)}
    </section>
  );
}
