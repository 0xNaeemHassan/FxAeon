'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity as ActivityIcon, CheckCircle2, Clock3, ExternalLink, RefreshCw, XCircle } from 'lucide-react';
import { AppShell, Button, EmptyState, LoadingRegion, Skeleton } from '@/components/ui';
import { getActivity, type ActivityItem } from '@/lib/api';
import { getWebApp } from '@/lib/telegram';
import { useLiveRefresh } from '@/lib/useLiveRefresh';

const LABELS: Record<string, string> = {
  open_long: 'Opened long',
  open_short: 'Opened short',
  increase_position: 'Increased position',
  reduce_position: 'Reduced position',
  close_position: 'Closed position',
  adjust_leverage: 'Adjusted leverage',
  mint: 'Minted fxUSD',
  repay_withdraw: 'Repaid / released collateral',
  fxsave_deposit: 'Deposited to fxSAVE',
  fxsave_withdraw: 'fxSAVE withdrawal',
  fxsave_claim: 'Claimed fxSAVE redemption',
  bridge_eth_to_base: 'Bridged to Base',
  bridge_base_to_eth: 'Bridged to Ethereum',
  withdraw: 'Sent wallet assets',
};

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setItems((await getActivity()).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Activity is unavailable.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);

  return (
    <AppShell title="Activity" subtitle="A wallet-scoped journal of every server-prepared transaction route.">
      {loading ? <LoadingRegion label="Loading transaction activity" className="flex flex-col gap-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></LoadingRegion> : error ? (
        <EmptyState icon={RefreshCw} title="Activity unavailable" body={error} action={<Button onClick={() => void load()}>Retry</Button>} />
      ) : items.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="No transactions yet" body="Actions you confirm in FxAeon will appear here with their real execution status." />
      ) : (
        <div className="stagger flex flex-col gap-2.5">
          {items.map((item) => <ActivityRow key={item.id} item={item} />)}
          <Button variant="ghost" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
        </div>
      )}
    </AppShell>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const confirmed = item.status === 'confirmed';
  const failed = ['failed', 'reverted', 'partial', 'cancelled'].includes(item.status);
  const Icon = confirmed ? CheckCircle2 : failed ? XCircle : Clock3;
  const tone = confirmed ? 'text-success bg-[var(--success-dim)]' : failed ? 'text-danger bg-[var(--danger-dim)]' : 'text-warn bg-[var(--warn-dim)]';
  const hashes = [...new Set([
    ...item.steps.flatMap((step) => step.hash ? [step.hash] : []),
    ...item.hashes,
  ])];
  const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt));
  return (
    <div className="glass min-h-[78px] p-3.5">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon aria-hidden="true" className="h-[19px] w-[19px]" /></span>
        <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{LABELS[item.type] ?? item.type.replaceAll('_', ' ')}</p><p className="mt-1 text-[10px] text-mut">{time} · <span className="capitalize">{item.status}</span> · {item.chainId === 8453 ? 'Base' : 'Ethereum'}</p></div>
      </div>
      {item.message && <p className="mt-3 rounded-xl bg-[rgba(255,255,255,.025)] px-3 py-2 text-[10.5px] leading-relaxed text-mut">{item.message}</p>}
      {item.type.startsWith('bridge') && hashes[0] && (
        <div className="mt-2">
          <button
            type="button"
            aria-label="Track on LayerZero Scan"
            onClick={() => {
              const url = `https://layerzeroscan.com/tx/${hashes[0]}`;
              const tg = getWebApp();
              if (tg?.openLink) tg.openLink(url);
              else window.open(url, '_blank', 'noopener,noreferrer');
            }}
            className="flex min-h-11 w-full items-center justify-between rounded-xl bg-[var(--mint-dim)] px-3 text-[10.5px] font-semibold text-mint"
          >
            <span>Track Cross-Chain Relayer</span>
            <span className="inline-flex items-center gap-1">LayerZero Scan <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></span>
          </button>
        </div>
      )}
      {hashes.length > 0 && (
        <div className="mt-2 grid gap-1.5">
          {hashes.map((hash, index) => {
            const status = item.steps.find((step) => step.hash === hash)?.status ?? item.status;
            return (
              <button
                key={hash}
                type="button"
                aria-label={`Open route step ${index + 1} in ${item.chainId === 8453 ? 'BaseScan' : 'Etherscan'}`}
                onClick={() => {
                  const explorer = item.chainId === 8453 ? 'https://basescan.org' : 'https://etherscan.io';
                  const url = `${explorer}/tx/${hash}`;
                  const tg = getWebApp();
                  if (tg?.openLink) tg.openLink(url);
                  else window.open(url, '_blank', 'noopener,noreferrer');
                }}
                className="flex min-h-11 items-center justify-between rounded-xl bg-[rgba(255,255,255,.035)] px-3 text-[10.5px] text-mut"
              >
                <span>Step {index + 1} · <span className="capitalize">{status}</span></span>
                <span className="inline-flex items-center gap-1 font-semibold">{hash.slice(0, 8)}…{hash.slice(-6)} <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
