'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useInvalidateWalletData } from '@/components/WalletDataProvider';
import { createRecoveryWalletRefresh, createWalletReadScope } from '@/lib/walletDataRefresh';
import styles from '@/app/AccountWorkspace.module.css';

export default function RecentActivityPreview({ walletAddress }: { walletAddress: Address }) {
  const identity = walletAddress.toLowerCase();
  const readScope = useRef(createWalletReadScope(walletAddress));
  readScope.current.select(walletAddress);
  const invalidateWalletData = useInvalidateWalletData();
  const refreshWallet = useMemo(() => createRecoveryWalletRefresh(invalidateWalletData), [invalidateWalletData]);
  const [snapshot, setSnapshot] = useState({ identity: '', items: [] as RecoveryViewModel[], loading: true, error: '' });
  const current = snapshot.identity === identity;
  const items = current ? snapshot.items : [];
  const loading = !current || snapshot.loading;
  const loadError = current ? snapshot.error : '';

  const load = useCallback(async () => {
    const isCurrent = readScope.current.start(walletAddress);
    if (!isCurrent) return;
    setSnapshot({ identity, items: [], loading: true, error: '' });
    try {
      const local = readPendingHashJournal().filter((record) => record.walletAddress.toLowerCase() === walletAddress.toLowerCase());
      if (local.length === 0) {
        setSnapshot({ identity, items: [], loading: false, error: '' });
        return;
      }
      const reconciled = await reconcileWalletJournal({ walletAddress, getClient: getPublicClient });
      if (!isCurrent()) return;
      await refreshWallet(reconciled, walletAddress, isCurrent);
      if (!isCurrent()) return;
      if (reconciled.length === 0) {
        setSnapshot({ identity, items: [], loading: false, error: 'Saved history exists on this device, but its chain status could not be reconciled. Retry when RPC access is available.' });
        return;
      }
      setSnapshot({ identity, items: [...reconciled].reverse().slice(0, 3), loading: false, error: '' });
    } catch {
      if (!isCurrent()) return;
      setSnapshot({ identity, items: [], loading: false, error: 'Saved history could not be checked against chain receipts. Nothing was treated as complete or failed.' });
    }
  }, [identity, refreshWallet, walletAddress]);

  useEffect(() => {
    const scope = readScope.current;
    void load();
    return () => scope.cancel();
  }, [load]);

  return (
    <section className={styles.section} aria-labelledby="recent-activity-title">
      <SectionTitle right={(
        <button type="button" aria-label="Refresh recent history" onClick={() => { haptic('light'); void load(); }} className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-lg text-mut hover:text-mint">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      )}>
        <span id="recent-activity-title">Recent history</span>
      </SectionTitle>
      <Card className={`${styles.activityCard} portfolio-activity-card p-0`}>
        {loading ? (
          <div className="space-y-2 p-3" role="status" aria-label="Loading recent history">
            <div className="skeleton h-[58px]" /><div className="skeleton h-[58px]" />
          </div>
        ) : loadError ? (
          <div className="flex items-center gap-3 px-4 py-5" role="status" aria-live="polite">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--warn-dim)] text-warn"><CircleAlert className="h-5 w-5" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-warn">Receipt status is unavailable. Retry before relying on this history.</span>
            <button type="button" aria-label="Retry recent history" onClick={() => { haptic('light'); void load(); }} className="glass-press flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-mut"><RefreshCw className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        ) : items.length ? (
          <>
            {items.some((item) => item.verification === 'rpc-error') && (
              <div role="status" aria-live="polite" className="mx-3 mt-3 flex items-center gap-2 rounded-lg bg-[var(--warn-dim)] px-3 py-2"><span className="min-w-0 flex-1 text-[11px] text-warn">Some receipt details are unavailable.</span><button type="button" aria-label="Retry receipt details" onClick={() => { haptic('light'); void load(); }} className="glass-press flex min-h-9 min-w-9 items-center justify-center rounded-lg text-warn"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /></button></div>
            )}
            <ul className={`${styles.activityList} divide-y divide-[var(--line)] px-3`}>
              {items.map((item) => <ActivityRow key={item.record.id} item={item} />)}
            </ul>
          </>
        ) : (
          <div className={`${styles.activityEmpty} flex items-center gap-3 px-4 py-5`}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-mut"><History className="h-5 w-5" aria-hidden="true" /></span>
            <span><strong className="block text-[12.5px]">No recent FxAeon history</strong><span className="mt-1 block text-[11px] text-mut">Transactions submitted on this device will appear here.</span></span>
          </div>
        )}
        <Link href="/history" className={`${styles.activityLink} glass-press flex min-h-12 items-center justify-between border-t border-[var(--line)] px-4 text-[12px] font-semibold text-mint`}>
          Open full history <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Card>
    </section>
  );
}

function ActivityRow({ item }: { item: RecoveryViewModel }) {
  const status = activityStatus(item);
  const Icon = status.icon;
  return (
    <li className={`${styles.activityRow} flex items-center gap-3 py-3`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] ${status.className}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-[12.5px]">{operationLabel(item.record.operation, item.record.intent)}</strong>
        <span className="mt-1 block truncate text-[10.5px] text-mut">{item.record.chainId === 8453 ? 'Base' : 'Ethereum'} · {new Date(item.record.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </span>
      <span className={`shrink-0 text-[10px] font-semibold ${status.className}`}>{status.label}</span>
    </li>
  );
}

function operationLabel(operation: string, intent?: string): string {
  if (intent) return intent;
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
  if (item.status === 'confirmed') return { label: 'Completed', className: 'text-success', icon: CheckCircle2 };
  if (item.status === 'failed') return { label: 'Failed', className: 'text-danger', icon: XCircle };
  if (item.verification === 'confirming') return { label: 'Confirming', className: 'text-mint', icon: Clock3 };
  if (item.verification === 'rpc-error' || item.verification === 'mismatch') return { label: 'Submitted', className: 'text-warn', icon: CircleAlert };
  return { label: 'Submitted', className: 'text-mint', icon: Clock3 };
}
