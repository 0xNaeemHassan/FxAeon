'use client';

import { ArrowUpRight, LoaderCircle, RefreshCw } from 'lucide-react';
import { useProtocolPositions } from './ProtocolPositionProvider';
import { confirmedPositionHintKey } from '@/lib/confirmedPositionStorage';
import { openExternalLink } from '@/lib/telegram';
import TokenIcon from '@/components/TokenIcon';

export function ConfirmedPositionCards({ market }: { market?: 'ETH' | 'BTC' }) {
  const { pendingPositions, checkingConfirmedPositions, refreshConfirmedPositions } = useProtocolPositions();
  const hints = pendingPositions.filter((hint) => !market || hint.market === market);
  if (!hints.length) return null;
  return <div className="flex flex-col gap-2" aria-live="polite">
    {hints.map((hint) => <div key={confirmedPositionHintKey(hint)} data-confirmed-position-key={confirmedPositionHintKey(hint)} aria-busy={checkingConfirmedPositions} className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
      <div className="flex min-w-0 items-start gap-x-3">
        <TokenIcon symbol={hint.market === 'ETH' ? 'ETH' : 'WBTC'} size={34} />
        <div className="min-w-0 flex-1"><p className={`text-display text-[15px] font-semibold ${hint.side === 'long' ? 'text-success' : 'text-danger'}`}>{hint.market} {hint.side === 'long' ? 'Long' : 'Short'}</p><p className="mt-1 text-[12px] text-mut">#{hint.positionId}</p></div>
      </div>
      <div role="status" className="mt-3 flex items-start gap-2.5 border-t border-[var(--line)] pt-3">
        {checkingConfirmedPositions && <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-mint" aria-hidden="true" />}
        <p className="text-[12px] font-semibold">Syncing position details</p>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[var(--line)] pt-1">
        <a href={`https://etherscan.io/tx/${hint.transactionHash}`} target="_blank" rel="noopener noreferrer" onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && openExternalLink(`https://etherscan.io/tx/${hint.transactionHash}`)) event.preventDefault(); }} aria-label="View position transaction" className="glass-press inline-flex min-h-11 items-center gap-1.5 text-[12px] font-semibold text-mint">View transaction<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></a>
        <button type="button" aria-label="Retry position details" disabled={checkingConfirmedPositions} onClick={() => void refreshConfirmedPositions()} className="glass-press inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-mut disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${checkingConfirmedPositions ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
      </div>
    </div>)}
  </div>;
}
