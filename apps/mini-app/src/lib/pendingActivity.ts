'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { JOURNAL_UPDATED_EVENT, isRecoveryJournalStorageKey, readPendingHashJournal } from '@/lib/fx/journal';
import type { PendingActionIntent, PendingHashRecord } from '@/lib/fx/types';

/**
 * Display state for steps this wallet signed: how many are still pending, and
 * a short notice when one settles. Everything here reads the local receipt
 * journal, which never establishes balances or authorizes anything; History
 * remains the place that verifies and explains each transaction.
 */

/** Older pending steps stay in History but stop ringing the wallet. */
export const PENDING_RING_WINDOW_MS = 2 * 60 * 60 * 1_000;
const NOTICE_LIMIT = 3;

export type SettledNotice = {
  id: string;
  status: 'confirmed' | 'failed';
  title: string;
  detail: string;
};

const SETTLED_TITLES: Record<PendingActionIntent, string> = {
  'Open position': 'Position opened',
  'Increase position': 'Position increased',
  'Reduce position': 'Position reduced',
  'Close position': 'Position closed',
  'Adjust leverage': 'Leverage adjusted',
  Borrow: 'fxUSD borrowed',
  'Add collateral': 'Collateral added',
  Repay: 'Debt repaid',
  'Withdraw collateral': 'Collateral withdrawn',
  'Repay and withdraw': 'Repaid and withdrawn',
  Deposit: 'Deposited to fxSAVE',
  Withdraw: 'Withdrawn from fxSAVE',
  'Queue withdrawal': 'Withdrawal queued',
  Claim: 'fxSAVE claimed',
  Bridge: 'Bridge sent',
  Send: 'Sent',
};

const network = (chainId: number) => (chainId === 8453 ? 'Base' : 'Ethereum');
const ownedBy = (record: PendingHashRecord, wallet: string) => record.walletAddress.toLowerCase() === wallet.toLowerCase();

/**
 * Hashes an open review is showing right now. Their outcome is already on
 * screen there, so a notice would only repeat it.
 */
const presentedHashes = new Map<string, number>();

export function presentTransactionHashes(hashes: readonly string[]): () => void {
  const keys = hashes.map((hash) => hash.toLowerCase());
  for (const key of keys) presentedHashes.set(key, (presentedHashes.get(key) ?? 0) + 1);
  return () => {
    for (const key of keys) {
      const remaining = (presentedHashes.get(key) ?? 1) - 1;
      if (remaining > 0) presentedHashes.set(key, remaining);
      else presentedHashes.delete(key);
    }
  };
}

export const isTransactionPresented = (hash: string) => presentedHashes.has(hash.toLowerCase());

/** Keeps notices quiet for the steps the calling surface already shows. */
export function usePresentedTransactions(hashes: readonly (string | undefined)[]): void {
  const key = [...new Set(hashes.flatMap((hash) => (hash ? [hash.toLowerCase()] : [])))].sort().join(',');
  useEffect(() => (key ? presentTransactionHashes(key.split(',')) : undefined), [key]);
}

export function freshPendingCount(records: readonly PendingHashRecord[], wallet: string, now: number): number {
  return records.filter((record) => record.status === 'pending' && ownedBy(record, wallet)
    && now - record.submittedAt < PENDING_RING_WINDOW_MS).length;
}

/** What one settled step tells the user, or null when it is not worth a notice. */
export function noticeFor(record: PendingHashRecord): SettledNotice | null {
  if (record.status === 'pending') return null;
  const approval = record.stepKind === 'approval';
  if (record.status === 'failed') {
    return approval
      ? { id: record.id, status: 'failed', title: 'Approval failed', detail: 'The step after it was not sent.' }
      : { id: record.id, status: 'failed', title: `${record.intent ?? 'Transaction'} failed`, detail: 'Nothing moved except the network fee.' };
  }
  // An approval only prepares the action after it; History leaves it out too.
  if (approval) return null;
  const title = record.intent ? SETTLED_TITLES[record.intent] : 'Transaction confirmed';
  const detail = record.bridge
    ? `Confirmed on ${network(record.chainId)}. Delivery is tracked in History.`
    : `Confirmed on ${network(record.chainId)}.`;
  return { id: record.id, status: 'confirmed', title, detail };
}

/** Steps of this wallet that were pending in `previous` and have settled since, unless already on screen. */
export function settledSince(
  previous: ReadonlyMap<string, PendingHashRecord['status']>,
  records: readonly PendingHashRecord[],
  wallet: string,
  presented: (hash: string) => boolean = () => false,
): SettledNotice[] {
  return records
    .filter((record) => ownedBy(record, wallet) && previous.get(record.id) === 'pending' && record.status !== 'pending' && !presented(record.hash))
    .map(noticeFor)
    .filter((notice): notice is SettledNotice => notice !== null);
}

export function usePendingActivity(wallet: string | undefined) {
  const [records, setRecords] = useState<PendingHashRecord[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [notices, setNotices] = useState<SettledNotice[]>([]);
  const seenRef = useRef<Map<string, PendingHashRecord['status']> | null>(null);

  useEffect(() => {
    seenRef.current = null;
    setNotices([]);
    if (!wallet) {
      setRecords([]);
      return undefined;
    }
    const read = () => {
      const next = readPendingHashJournal();
      // The first read is a baseline: steps that settled before this page
      // opened belong to History, not to a fresh notice.
      if (seenRef.current) {
        const settled = settledSince(seenRef.current, next, wallet, isTransactionPresented);
        if (settled.length) setNotices((current) => [...current.filter((notice) => !settled.some((item) => item.id === notice.id)), ...settled].slice(-NOTICE_LIMIT));
      }
      seenRef.current = new Map(next.map((record) => [record.id, record.status]));
      setRecords(next);
      setNow(Date.now());
    };
    read();
    const onStorage = (event: StorageEvent) => { if (isRecoveryJournalStorageKey(event.key)) read(); };
    window.addEventListener(JOURNAL_UPDATED_EVENT, read);
    window.addEventListener('storage', onStorage);
    // Ages old pending steps out of the ring even when nothing is written.
    const timer = window.setInterval(read, 60_000);
    return () => {
      window.removeEventListener(JOURNAL_UPDATED_EVENT, read);
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
    };
  }, [wallet]);

  const dismiss = useCallback((id: string) => setNotices((current) => current.filter((notice) => notice.id !== id)), []);
  return { pendingCount: wallet ? freshPendingCount(records, wallet, now) : 0, notices, dismiss };
}
