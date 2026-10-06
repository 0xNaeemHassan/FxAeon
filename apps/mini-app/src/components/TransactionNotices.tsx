'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { CircleCheck, CircleX, X } from 'lucide-react';
import type { SettledNotice } from '@/lib/pendingActivity';
import { haptic } from '@/lib/telegram';
import styles from './TransactionNotices.module.css';

const VISIBLE_MS = 6_000;

/**
 * A step this wallet signed has settled while the app is open, wherever the
 * user is now. Polite and brief: it never takes focus, and it leaves on its
 * own after a few seconds; History keeps the full explanation.
 */
export function TransactionNotices({ notices, onDismiss }: { notices: readonly SettledNotice[]; onDismiss: (id: string) => void }) {
  const [mounted, setMounted] = useState(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const live = new Set(notices.map((notice) => notice.id));
    for (const notice of notices) {
      if (timers.current.has(notice.id)) continue;
      haptic(notice.status === 'confirmed' ? 'success' : 'error');
      timers.current.set(notice.id, setTimeout(() => onDismiss(notice.id), VISIBLE_MS));
    }
    for (const [id, timer] of timers.current) {
      if (live.has(id)) continue;
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, [notices, onDismiss]);
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); }, []);
  if (!mounted) return null;
  // The live region stays mounted so screen readers hear each new notice.
  return createPortal(<div className={styles.region} role="status" aria-live="polite" data-transaction-notices="">
    {notices.map((notice) => {
      const Icon = notice.status === 'confirmed' ? CircleCheck : CircleX;
      return <div key={notice.id} className={styles.notice} data-status={notice.status}>
        <Icon className={styles.icon} aria-hidden="true" />
        <div className={styles.copy}><strong>{notice.title}</strong><span>{notice.detail}</span></div>
        <Link href="/history" className={styles.link} onClick={() => onDismiss(notice.id)}>View</Link>
        <button type="button" className={styles.dismiss} aria-label={`Dismiss: ${notice.title}`} onClick={() => onDismiss(notice.id)}><X size={16} aria-hidden="true" /></button>
      </div>;
    })}
  </div>, document.body);
}
