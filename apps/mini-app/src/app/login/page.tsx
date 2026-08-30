'use client';

/** Client-only Privy login and explicit wallet setup. */
import { Suspense, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowUpRight, Send, Wallet } from 'lucide-react';
import { isTMA } from '@/lib/telegram';
import { privyConfigured } from '@/lib/privyConfig';
import { ButtonLink, Card, FullScreenSpinner } from '@/components/ui';
import { useT } from '@/lib/i18n';

const TELEGRAM_APP_URL = process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || 'https://t.me/FxAeonBot/app';

// The Privy SDK is heavy. Loading the flow dynamically keeps it
// out of this page's first-paint bundle — the chunk is only fetched once the
// gates below (inside Telegram + configured build) actually pass.
const PrivyFlow = dynamic(() => import('./PrivyFlow'), {
  ssr: false,
  loading: () => <FullScreenSpinner asMain />,
});

function LoginContent() {
  const t = useT();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    document.title = 'Sign in · FxAeon';
    setMounted(true);
  }, []);

  if (!mounted) return <FullScreenSpinner asMain />;

  if (!isTMA()) {
    return (
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-[var(--mint-dim)]">
          <Send className="h-8 w-8 text-mint" strokeWidth={1.6} />
        </span>
        <h1 className="text-display text-2xl font-semibold">{t('loginGate.tgTitle')}</h1>
        <p className="max-w-[330px] text-[14px] leading-relaxed text-mut">{t('loginGate.tgBody')}</p>
        <ButtonLink href={TELEGRAM_APP_URL} external>
          Open FxAeon in Telegram <ArrowUpRight className="h-4 w-4" />
        </ButtonLink>
      </main>
    );
  }

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
