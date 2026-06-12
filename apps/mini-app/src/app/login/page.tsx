'use client';

/**
 * Onboarding — YOUR wallet, your choice, ~four taps.
 *
 *  1. Telegram seamless login with Privy (no email, no password — the signed
 *     Mini App init data IS the login).
 *  2. Create a fresh embedded wallet OR import an existing private key. The
 *     key lives in Privy's TEE; only the user can export it. The FxAeon
 *     backend never sees it and cannot create wallets for anyone.
 *  3. Optionally enable bot trading: a revocable session-signer grant that
 *     lets the bot execute f(x) actions from chat. Skipping it keeps the
 *     Mini App fully functional.
 *  4. Link to the bot, on EVERY launch type:
 *     - keyboard-button launch: initData is EMPTY but sendData() works → send
 *       the signal, the bot links the wallet server-side and replies in chat.
 *     - inline/menu/direct launch: signed initData → POST /onboard.
 *     - plain browser → "Open in Telegram".
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Send } from 'lucide-react';
import { isTMA } from '@/lib/telegram';
import { privyConfigured } from '@/lib/privyConfig';
import { Button, FullScreenSpinner } from '@/components/ui';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';

// PERF (W-20): the Privy SDK is heavy. Loading the flow dynamically keeps it
// out of this page's first-paint bundle — the chunk is only fetched once the
// gates below (inside Telegram + configured build) actually pass.
const PrivyFlow = dynamic(() => import('./PrivyFlow'), {
  ssr: false,
  loading: () => <FullScreenSpinner />,
});

function LoginContent() {
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);

  const referral = useMemo(() => {
    const fromUrl = searchParams.get('ref');
    if (fromUrl && /^[A-Za-z0-9]{4,16}$/.test(fromUrl)) return fromUrl.toUpperCase();
    return undefined;
  }, [searchParams]);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <FullScreenSpinner />;

  if (!isTMA()) {
    return (
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
        <span className="anim-float flex h-16 w-16 items-center justify-center rounded-3xl bg-[var(--mint-dim)]">
          <Send className="h-8 w-8 text-mint" strokeWidth={1.6} />
        </span>
        <h1 className="text-display text-2xl font-semibold">FxAeon runs inside Telegram</h1>
        <p className="text-[13.5px] text-mut">Open the bot and send /start to set up your wallet.</p>
        <a href={`https://t.me/${BOT_USERNAME}`} className="w-full">
          <Button>Open @{BOT_USERNAME}</Button>
        </a>
      </main>
    );
  }

  if (!privyConfigured()) {
    return (
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
        <h1 className="text-display text-2xl font-semibold">Wallet service not configured</h1>
        <p className="text-[13.5px] text-mut">
          This build is missing its Privy app id, so wallet setup can’t run. If you’re the
          operator: set NEXT_PUBLIC_PRIVY_APP_ID (and NEXT_PUBLIC_PRIVY_SIGNER_ID for bot
          trading) and redeploy.
        </p>
      </main>
    );
  }

  return <PrivyFlow referral={referral} />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <LoginContent />
    </Suspense>
  );
}
