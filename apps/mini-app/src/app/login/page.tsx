'use client';

/** Client-only Privy login and explicit wallet setup. */
import { Suspense, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowUpRight, Send, Settings2 } from 'lucide-react';
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
    document.title = 'Connect wallet · FxAeon';
    setMounted(true);
  }, []);

  if (!mounted) return <FullScreenSpinner asMain />;

  if (!isTMA()) {
    return (
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
        <span className="anim-float flex h-16 w-16 items-center justify-center rounded-3xl bg-[var(--mint-dim)]">
          <Send className="h-8 w-8 text-mint" strokeWidth={1.6} />
        </span>
        <h1 className="text-display text-2xl font-semibold">{t('loginGate.tgTitle')}</h1>
        <p className="text-[13.5px] text-mut">{t('loginGate.tgBody')}</p>
        <ButtonLink href={TELEGRAM_APP_URL} external>
          Open FxAeon in Telegram <ArrowUpRight className="h-4 w-4" />
        </ButtonLink>
      </main>
    );
  }

  if (!privyConfigured()) {
    return (
      <main className="app-shell mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col items-center justify-center px-6 py-10 text-center">
        <Card className="w-full rounded-[28px] p-7">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] border border-[var(--line)] bg-[var(--surface-2)]">
            <Settings2 className="h-7 w-7 text-mint" strokeWidth={1.7} />
          </span>
          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-warn">Configuration required</p>
          <h1 className="text-display mt-2 text-2xl font-semibold">{t('loginGate.notConfTitle')}</h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-mut">{t('loginGate.notConfBody')}</p>
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
