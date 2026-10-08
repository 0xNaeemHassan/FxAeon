import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, History, QrCode, Settings } from 'lucide-react';
import { AppShell } from '@/components/ui';
import { ActionRow, PageHeading, RowGroup } from '@/components/ProductUI';

/** The shell lab state lives on globalThis so the mocked wallet and router
 * modules (see e2e/overlay-specs/app-shell.spec.ts) read the same store. */
type ShellLab = {
  path: string;
  overlay: 'none' | 'dialog' | 'review';
  subscribe: (listener: () => void) => () => void;
  set: (patch: Record<string, unknown>) => void;
  snapshot: () => { path: string; overlay: string };
};

const lab = (globalThis as typeof globalThis & { __shellLab: ShellLab }).__shellLab;

function Page({ path }: { path: string }) {
  if (path === '/history') return <AppShell title="History"><p>Activity</p></AppShell>;
  if (path === '/trade') {
    return <AppShell><div className="trade-workspace"><header className="trade-page-heading"><div><h1>Trade</h1></div></header><p>Ticket</p></div></AppShell>;
  }
  if (path === '/more') {
    return <AppShell>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PageHeading title="More" />
        <RowGroup title="Account">
          <ActionRow icon={History} title="History" href="/history" />
          <ActionRow icon={QrCode} title="Receive" href="/qr" />
          <ActionRow icon={Settings} title="Settings" href="/settings" />
        </RowGroup>
        <RowGroup title="Resources">
          <ActionRow icon={BookOpen} title="FxAeon docs" href="/docs" />
          <ActionRow icon={BookOpen} title="f(x) Protocol docs" href="https://fxprotocol.gitbook.io/fx-docs" external />
        </RowGroup>
      </div>
    </AppShell>;
  }
  return <AppShell>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeading title={path === '/settings' ? 'Settings' : 'Portfolio'} />
      <p style={{ height: 1200 }}>Holdings</p>
    </div>
  </AppShell>;
}

function Lab() {
  const state = useSyncExternalStore(lab.subscribe, lab.snapshot);
  return <>
    {/* Routes remount their shell, as Next's per-page AppShell does. */}
    <Page key={state.path} path={state.path} />
    {state.overlay === 'dialog' && <div role="dialog" aria-modal="true" aria-label="Lab sheet">Sheet</div>}
    {state.overlay === 'review' && <div data-review-viewport="">Review</div>}
  </>;
}

document.documentElement.dataset.harnessReady = 'true';
createRoot(document.getElementById('root')!).render(<Lab />);
