'use client';

import { ArrowUpRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { useProtocolPositions } from './ProtocolPositionProvider';
import { confirmedPositionHintKey } from '@/lib/confirmedPositionStorage';

export function ConfirmedPositionCards({ market }: { market?: 'ETH' | 'BTC' }) {
  const { pendingPositions, checkingConfirmedPositions, refreshConfirmedPositions } = useProtocolPositions();
  const hints = pendingPositions.filter((hint) => !market || hint.market === market);
  if (!hints.length) return null;
  return <div className="flex flex-col gap-2" aria-live="polite">
    {hints.map((hint) => <div key={confirmedPositionHintKey(hint)} data-confirmed-position-key={confirmedPositionHintKey(hint)} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[14px] font-semibold">{hint.market} {hint.side === 'long' ? 'Long' : 'Short'} <span className="font-normal text-mut">#{hint.positionId}</span></p><p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-success"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Position confirmed</p></div>
        <button type="button" aria-label="Refresh confirmed position details" disabled={checkingConfirmedPositions} onClick={() => void refreshConfirmedPositions()} className="glass-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-mut disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${checkingConfirmedPositions ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
      </div>
      <p className="mt-2 text-[13px] text-mut">Details updating</p>
      <a href={`https://etherscan.io/tx/${hint.transactionHash}`} target="_blank" rel="noopener noreferrer" aria-label="View confirmed position transaction" className="glass-press mt-1 inline-flex min-h-11 items-center gap-1.5 text-[12px] font-semibold text-mint">View transaction<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></a>
    </div>)}
  </div>;
}
