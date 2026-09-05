'use client';

import { useEffect } from 'react';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') console.error('FxAeon route error', error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-display text-xl font-semibold">This screen could not load</h1>
      <p className="text-sm text-mut">Your wallet and funds are unchanged. Try the screen again or return to the home page.</p>
      <div className="flex gap-2"><button type="button" onClick={reset} className="button glass-press rounded-xl px-4 py-3 text-sm font-semibold">Try again</button><a href="/" className="button glass-press rounded-xl px-4 py-3 text-sm font-semibold">Home</a></div>
    </main>
  );
}
