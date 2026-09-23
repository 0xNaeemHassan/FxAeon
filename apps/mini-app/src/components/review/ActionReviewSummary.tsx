import type { ChangedReviewFact } from './actionReviewModel';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';
import type { ReceiptPresentation } from '@/lib/receiptPresentation';
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
    byLabel.get('Gas fee') ?? { label: 'Network fee max', value: '—' },
    byLabel.get('Total cost') ?? { label: 'Total cost max', value: '—' },
  ];
  const metrics = candidates
    .filter((fact): fact is ReviewFact => fact !== undefined)
    .filter((fact, index, all) => all.findIndex((candidate) => candidate.label === fact.label) === index);
  if (!metrics.length) return null;
  return <div className={presentationStyles.quoteMetrics} aria-label="Current quote estimates">
    {metrics.map((fact) => <div className={presentationStyles.quoteMetric} key={fact.label}>
      <span className={presentationStyles.quoteMetricLabel}>{fact.label}</span>
      <span className={presentationStyles.quoteMetricValue} title={fact.title}><ValueOrSkeleton value={fact.value} width="sm" status={gasStatus === 'refreshing' ? 'loading' : 'unavailable'} label={fact.label} /></span>
    </div>)}
  </div>;
}

function SummaryRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div className="grid min-w-0 grid-cols-[minmax(80px,.7fr)_minmax(0,1.3fr)] gap-x-3 py-0.5 text-[11px]">
    <span className="text-mut">{label}</span><span className="min-w-0 break-words font-medium" title={title}>{value}</span>
  </div>;
}

export function UpdatedQuoteSummary({ changes }: { changes: readonly ChangedReviewFact[] }) {
  if (!changes.length) return null;
  return (
    <section className="mt-3 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] px-3 py-2.5" aria-label="Updated transaction consequences">
      <p className="text-[11px] font-semibold text-mut">Changed since your previous review</p>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {changes.map((change) => <div key={change.label} className="grid grid-cols-[minmax(80px,.7fr)_minmax(0,1.3fr)] gap-x-3 text-[11px]">
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
    <section className="mt-3 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.02)] px-3 py-2.5" aria-label="Action consequences">
      <p className="text-[11px] font-semibold text-mut">What changes</p>
      <div className="mt-1.5 flex flex-col gap-1">
        {facts.map((fact) => <SummaryRow key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.value} title={fact.title} />)}
      </div>
    </section>
  );
}

export function PositionOutcomeSummary({ facts }: { facts: readonly { label: string; before: string; after: string }[] }) {
  if (!facts.length) return null;
  return (
    <section className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5" aria-label="Current and expected position values">
      <p className="text-[11px] font-semibold text-mut">Position outcome</p>
      {facts.map((fact) => <div key={fact.label} className="mt-1 grid grid-cols-[minmax(80px,.7fr)_minmax(0,1.3fr)] gap-x-3 text-[11px]">
        <span className="text-mut">{fact.label}</span><span>{fact.before} → {fact.after}</span>
      </div>)}
    </section>
  );
}

export function ReceiptSummary({ receipts }: { receipts: readonly ReceiptPresentation[] }) {
  if (!receipts.length) return null;
  const movements = receipts.flatMap((receipt) => receipt.movements);
  const technicalMovements = receipts.flatMap((receipt) => receipt.technicalMovements);
  return (
    <section className="mt-4 w-full rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] p-3 text-left" aria-label="Verified receipt">
      <p className="text-[12px] font-semibold">Verified receipt</p>
      {movements.map((movement, index) => <p key={`movement-${index}`} className="mt-1 text-[11px] text-mut">{movement}</p>)}
      {movements.length === 0 && <p className="mt-1 text-[11px] text-mut">Token movements could not be established from the verified receipt logs.</p>}
      {technicalMovements.length > 0 && <details className="mt-2 text-[11px]"><summary className="cursor-pointer text-mut">Technical movement details</summary>{technicalMovements.map((movement, index) => <p key={`technical-${index}`} className="mt-1 break-all font-mono text-[10px] text-mut">{movement}</p>)}</details>}
      {receipts.map((receipt, index) => receipt.executionFee && <p key={`fee-${index}`} className="mt-1 text-[11px] text-mut">{receipt.feeLabel}: {receipt.executionFee}{receipt.feeCaveat ? ` · ${receipt.feeCaveat}` : ''}</p>)}
      {receipts.flatMap((receipt) => receipt.nativeValue ? [receipt.nativeValue] : []).map((value, index) => <p key={`native-${index}`} className="mt-1 text-[11px] text-mut">Native value sent: {value}</p>)}
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
