'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, CircleAlert, Clock3, History, RefreshCw, XCircle, type LucideIcon } from 'lucide-react';
import type { Address } from 'viem';
import { Card, SectionTitle } from '@/components/ui';
import {
  getPublicClient,
  readPendingHashJournal,
  reconcileWalletJournal,
  type RecoveryViewModel,
} from '@/lib/fx';
import { haptic } from '@/lib/telegram';

export default function RecentActivityPreview({ walletAddress }: { walletAddress: Address }) {
  const [items, setItems] = useState<RecoveryViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const local = readPendingHashJournal().filter((record) => record.walletAddress.toLowerCase() === walletAddress.toLowerCase());
      if (local.length === 0) {
        setItems([]);
        return;
      }
      const reconciled = await reconcileWalletJournal({ walletAddress, getClient: getPublicClient });
      if (reconciled.length === 0) {
        setItems([]);
        setLoadError('Saved activity exists on this device, but its chain status could not be reconciled. Retry when RPC access is available.');
        return;
      }
      setItems([...reconciled].reverse().slice(0, 3));
    } catch {
      setItems([]);
      setLoadError('Saved activity could not be checked against chain receipts. Nothing was treated as complete or failed.');
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section aria-labelledby="recent-activity-title">
      <SectionTitle right={(
        <button type="button" aria-label="Refresh recent activity" onClick={() => { haptic('light'); void load(); }} className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-lg text-mut hover:text-mint">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      )}>
        <span id="recent-activity-title">Recent activity</span>
      </SectionTitle>
      <Card className="portfolio-activity-card p-0">
        <p className="border-b border-[var(--line)] px-4 py-2 text-[10.5px] leading-relaxed text-mut">Local-device transaction journal · receipt status is verified from Ethereum or Base when RPC access is available.</p>
        {loading ? (
          <div className="space-y-2 p-3" role="status" aria-label="Loading recent activity">
            <div className="skeleton h-[58px]" /><div className="skeleton h-[58px]" />
          </div>
        ) : loadError ? (
          <div className="flex items-start gap-3 px-4 py-5" role="status">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--warn-dim)] text-warn"><CircleAlert className="h-5 w-5" aria-hidden="true" /></span>
            <span><strong className="block text-[12.5px]">Chain status unavailable</strong><span className="mt-1 block text-[11px] leading-relaxed text-mut">{loadError}</span></span>
          </div>
        ) : items.length ? (
          <>
            {items.some((item) => item.verification === 'rpc-error') && (
              <p role="status" className="mx-3 mt-3 rounded-lg bg-[var(--warn-dim)] px-3 py-2 text-[10.5px] leading-relaxed text-warn">Some saved transactions could not be checked against chain receipts. Their local status is not treated as proof.</p>
            )}
            <ul className="divide-y divide-[var(--line)] px-3">
              {items.map((item) => <ActivityRow key={item.record.id} item={item} />)}
            </ul>
          </>
        ) : (
          <div className="flex items-center gap-3 px-4 py-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-mut"><History className="h-5 w-5" aria-hidden="true" /></span>
            <span><strong className="block text-[12.5px]">No recent FxAeon activity</strong><span className="mt-1 block text-[11px] text-mut">Transactions submitted on this device will appear here.</span></span>
          </div>
        )}
        <Link href="/activity" className="glass-press flex min-h-12 items-center justify-between border-t border-[var(--line)] px-4 text-[12px] font-semibold text-mint">
          Open full activity <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Card>
    </section>
  );
}

function ActivityRow({ item }: { item: RecoveryViewModel }) {
  const status = activityStatus(item);
  const Icon = status.icon;
  return (
    <li className="flex min-h-[68px] items-center gap-3 py-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] ${status.className}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-[12.5px]">{operationLabel(item.record.operation)}</strong>
        <span className="mt-1 block truncate text-[10.5px] text-mut">{item.record.chainId === 8453 ? 'Base' : 'Ethereum'} · {new Date(item.record.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </span>
      <span className={`shrink-0 text-[10px] font-semibold ${status.className}`}>{status.label}</span>
    </li>
  );
}

function operationLabel(operation: string): string {
  const labels: Record<string, string> = {
    increasePosition: 'Opened or increased position',
    reducePosition: 'Reduced position',
    adjustPositionLeverage: 'Adjusted leverage',
    depositAndMint: 'Minted fxUSD',
    repayAndWithdraw: 'Repaid and withdrew',
    depositFxSave: 'Deposited to fxSAVE',
    withdrawFxSave: 'Requested fxSAVE withdrawal',
    getRedeemTx: 'Claimed fxSAVE withdrawal',
    buildBridgeTx: 'Moved assets across chains',
  };
  return labels[operation] ?? operation.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase());
}

function activityStatus(item: RecoveryViewModel): { label: string; className: string; icon: LucideIcon } {
  if (item.status === 'confirmed') return { label: 'Confirmed', className: 'text-success', icon: CheckCircle2 };
  if (item.status === 'failed') return { label: 'Reverted', className: 'text-danger', icon: XCircle };
  if (item.verification === 'rpc-error' || item.verification === 'mismatch') return { label: 'Check needed', className: 'text-warn', icon: CircleAlert };
  return { label: 'Pending', className: 'text-mint', icon: Clock3 };
}
