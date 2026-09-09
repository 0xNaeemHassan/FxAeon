'use client';

import { useEffect } from 'react';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') console.error('FxAeon route error', error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-display text-xl font-semibold">This screen could not load</h1>
      <p className="max-w-sm text-sm text-mut">This screen failed to load. If you started a wallet action, check History before trying again.</p>
      <div className="flex flex-wrap justify-center gap-2"><button type="button" onClick={reset} className="button glass-press rounded-xl px-4 py-3 text-sm font-semibold">Try again</button><a href="/history" className="button glass-press rounded-xl px-4 py-3 text-sm font-semibold">Open History</a><a href="/" className="button glass-press rounded-xl px-4 py-3 text-sm font-semibold">Portfolio</a></div>
    </main>
  );
}
