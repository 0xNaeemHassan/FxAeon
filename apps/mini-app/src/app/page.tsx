'use client';

/**
 * Entry router. Decides where this launch should land:
 *  - inside Telegram with signed initData → check real onboarding state via
 *    the bot API → /portfolio or /login
 *  - inside Telegram via keyboard launch (empty initData) → /login (the
 *    sendData onboarding path)
 *  - plain browser → "Open in Telegram" splash (the app is a Telegram
 *    product; pretending otherwise created dead screens)
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { isTMA, getInitData } from '@/lib/telegram';
import { apiAvailable, getMe } from '@/lib/api';
import { Button, FullScreenSpinner } from '@/components/ui';
import { useT } from '@/lib/i18n';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';

export default function HomePage() {
  const t = useT();
  const router = useRouter();
  const [browser, setBrowser] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isTMA()) {
        setBrowser(true);
        return;
      }
      if (getInitData() && apiAvailable()) {
        try {
          const me = await getMe();
          if (!cancelled) router.replace(me.onboarded ? '/portfolio' : '/login');
          return;
        } catch {
          /* fall through — portfolio renders its own degraded state */
        }
      }
      if (!cancelled) router.replace(getInitData() ? '/portfolio' : '/login');
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (browser) {
    return (
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="stagger flex flex-col items-center gap-4">
          <span className="anim-float flex h-16 w-16 items-center justify-center rounded-3xl bg-[var(--mint-dim)]">
            <Send className="h-8 w-8 text-mint" strokeWidth={1.6} />
          </span>
          <h1 className="text-display text-3xl font-semibold">
            Fx<span className="text-gradient">Aeon</span>
          </h1>
          <p className="text-[14px] leading-relaxed text-mut">{t('splash.tagline')}</p>
          <a href={`https://t.me/${BOT_USERNAME}`} className="w-full">
            <Button>{t('common.openInTelegram')}</Button>
          </a>
        </div>
      </main>
    );
  }

  return <FullScreenSpinner />;
}
