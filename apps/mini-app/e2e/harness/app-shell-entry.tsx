import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '@/components/ui';
import { PageHeading } from '@/components/ProductUI';
import MorePage from '@/app/more/page';
import SettingsPage from '@/app/settings/page';
import DocsPage from '@/app/docs/page';
import NotFound from '@/app/not-found';
import RouteError from '@/app/error';
import LoginPage from '@/app/login/page';

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
  // The real More, Settings and Docs routes, against the lab's wallet and router.
  if (path === '/more') return <MorePage />;
  if (path === '/settings') return <SettingsPage />;
  if (path === '/docs') return <DocsPage />;
  // Full-screen stages outside the shell.
  if (path === '/missing') return <NotFound />;
  if (path === '/error') return <RouteError error={new Error('lab')} reset={() => undefined} />;
  if (path === '/login') return <LoginPage />;
  return <AppShell>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeading title="Portfolio" />
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
