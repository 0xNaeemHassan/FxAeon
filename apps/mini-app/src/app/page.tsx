'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function HomePage() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready) {
      if (authenticated) {
        router.replace('/portfolio');
      } else {
        router.replace('/login');
      }
    }
  }, [ready, authenticated, router]);

  // Contentful loading state: text paints immediately (pre-hydration), so
  // slow cold starts show the brand instead of a blank screen. A border-only
  // spinner does NOT count as a contentful paint (NO_FCP).
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-4">
      <h1 className="text-2xl font-bold tracking-tight">fxBot</h1>
      <div
        className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"
        aria-hidden="true"
      />
      <p className="text-sm text-gray-500">Loading f(x) Protocol trading…</p>
    </main>
  );
}
