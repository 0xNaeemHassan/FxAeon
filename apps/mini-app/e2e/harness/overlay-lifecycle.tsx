'use client';

import { useRef, useState } from 'react';
import { useOverlayDialog } from '../../src/lib/useOverlayDialog';
import NetworkSelector from '../../src/components/NetworkSelector';

export default function OverlayLifecycleHarness() {
  const [parentOpen, setParentOpen] = useState(() => Boolean((window as Window & { __overlayInitiallyOpen?: boolean }).__overlayInitiallyOpen));
  const [childOpen, setChildOpen] = useState(false);
  const parentTrigger = useRef<HTMLButtonElement>(null);
  const childTrigger = useRef<HTMLButtonElement>(null);
  const parentCloseRef = useRef<HTMLButtonElement>(null);
  const parentRef = useOverlayDialog<HTMLElement>({ open: parentOpen, onClose: () => setParentOpen(false), triggerRef: parentTrigger, initialFocusRef: parentCloseRef });
  const childRef = useOverlayDialog<HTMLDivElement>({ open: childOpen, onClose: () => setChildOpen(false), triggerRef: childTrigger });

  return <main style={{ padding: 24, minHeight: '150vh' }}>
    <h1>Overlay lifecycle harness</h1>
    <NetworkSelector />
    <button ref={parentTrigger} type="button" onClick={() => setParentOpen(true)}>Open wallet profile</button>
    <button type="button" onClick={() => setParentOpen(true)}>View connected account</button>
    {parentOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 10, display: 'grid', placeItems: 'center', background: '#0009' }}>
      <aside ref={parentRef} role="dialog" aria-modal="true" aria-labelledby="parent-title" tabIndex={-1} data-testid="parent-dialog" style={{ padding: 24, background: 'white', color: 'black' }}>
        <h2 id="parent-title">Wallet profile</h2>
        <button ref={childTrigger} type="button" onClick={() => setChildOpen(true)}>Open asset picker</button>
        <button type="button" onClick={() => { setParentOpen(false); window.setTimeout(() => setParentOpen(true), 0); }}>Close and reopen quickly</button>
        <button ref={parentCloseRef} type="button" onClick={() => setParentOpen(false)}>Close wallet profile</button>
      </aside>
    </div>}
    {childOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center', background: '#0009' }}>
      <div ref={childRef} role="dialog" aria-modal="true" aria-labelledby="child-title" tabIndex={-1} data-testid="child-dialog" style={{ padding: 24, background: 'white', color: 'black' }}>
        <h2 id="child-title">Asset picker</h2>
        <button type="button" onClick={() => setChildOpen(false)}>Close asset picker</button>
        <button type="button" onClick={() => {
          let consumed = false;
          window.dispatchEvent(new CustomEvent('fxaeon:telegram-back', { detail: { consume: () => { consumed = true; }, isConsumed: () => consumed } }));
        }}>Telegram Back</button>
        <a href="#destination">Open history</a>
      </div>
    </div>}
  </main>;
}
