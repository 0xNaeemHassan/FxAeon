'use client';

/** Client-only Privy login and explicit wallet setup. */
import { Suspense, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Wallet } from 'lucide-react';
import { privyConfigured } from '@/lib/privyConfig';
import { Card, FullScreenSpinner } from '@/components/ui';

// The Privy SDK is heavy. Loading the flow dynamically keeps it
// out of this page's first-paint bundle — the chunk is only fetched once the
// configuration gate below passes. The same flow supports web and Telegram.
const PrivyFlow = dynamic(() => import('./PrivyFlow'), {
  ssr: false,
  loading: () => <FullScreenSpinner asMain />,
});

function LoginContent() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    document.title = 'Sign in · FxAeon';
    setMounted(true);
  }, []);

  if (!mounted) return <FullScreenSpinner asMain />;

  if (!privyConfigured()) {
    return (
      <main className="app-shell mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col items-center justify-center px-6 py-10 text-center">
        <Card className="w-full max-w-sm p-6">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] border border-[var(--line)] bg-[var(--surface-2)]">
            <Wallet className="h-7 w-7 text-mint" strokeWidth={1.7} aria-hidden="true" />
          </span>
          <h1 className="text-display mt-5 text-[23px] font-semibold">Wallet setup unavailable</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-mut">Wallet access is not available right now. No wallet will be created or connected.</p>
        </Card>
      </main>
    );
  }

  return <PrivyFlow />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<FullScreenSpinner asMain />}>
      <LoginContent />
    </Suspense>
  );
}
