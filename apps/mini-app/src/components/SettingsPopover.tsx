'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import { useExitPresence } from '@/lib/useExitPresence';
import styles from './SettingsPopover.module.css';

export function SettingsPopover({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useOverlayDialog<HTMLDivElement>({ open, onClose: () => setOpen(false), triggerRef, initialFocusRef: closeRef });
  const present = useExitPresence(open, 'trade-settings');

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      const minY = (viewport?.offsetTop ?? 0) + 12;
      const nav = document.querySelector<HTMLElement>('[data-fixed-navigation="true"]')?.getBoundingClientRect();
      const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      const maxY = Math.min(viewportBottom, nav && nav.height > 0 ? nav.top : viewportBottom) - 12;
      const width = Math.min(340, (viewport?.width ?? window.innerWidth) - 24);
      const minX = (viewport?.offsetLeft ?? 0) + 12;
      const left = Math.max(minX, Math.min(anchor.right - width, minX + (viewport?.width ?? window.innerWidth) - width - 24));
      const available = Math.max(0, maxY - minY);
      const anchorTop = Math.max(minY, Math.min(anchor.top - 8, maxY));
      const anchorBottom = Math.max(minY, Math.min(anchor.bottom + 8, maxY));
      const below = maxY - anchorBottom;
      const above = anchorTop - minY;
      const upward = below < 220 && above > below;
      const height = Math.min(available, Math.max(80, upward ? above : below));
      setPosition({ width, left, ...(upward
        ? { bottom: window.innerHeight - Math.max(minY + height, anchorTop), maxHeight: height }
        : { top: Math.min(anchorBottom, maxY - height), maxHeight: height }) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" aria-label={`Transaction settings, ${summary}`} aria-haspopup="dialog" aria-expanded={open} className={styles.trigger} onClick={() => setOpen(true)}>
      <span>{summary}</span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path fillRule="evenodd" d="M9.5 2h5l.6 2.8 1.5.9 2.7-.9 2.5 4.4-2.1 1.9v1.8l2.1 1.9-2.5 4.4-2.7-.9-1.5.9-.6 2.8h-5l-.6-2.8-1.5-.9-2.7.9-2.5-4.4 2.1-1.9v-1.8L2.2 9.2l2.5-4.4 2.7.9 1.5-.9L9.5 2Zm6 10a3.5 3.5 0 1 0-7 0 3.5 3.5 0 0 0 7 0Z" clipRule="evenodd" />
      </svg>
    </button>
    {present && typeof document !== 'undefined' && createPortal(<div className={styles.backdrop} data-state={open ? 'open' : 'closed'} inert={!open} aria-hidden={!open || undefined} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Transaction settings" className={styles.panel} style={position}>
        <header><strong>Settings</strong><button ref={closeRef} type="button" aria-label="Close transaction settings" onClick={() => setOpen(false)}><X size={18} aria-hidden="true" /></button></header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>, document.body)}
  </>;
}
