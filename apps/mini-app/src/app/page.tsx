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
import { ArrowLeftRight, ArrowUpRight, ShieldCheck, Sparkles } from 'lucide-react';
import { isTMA, getInitData } from '@/lib/telegram';
import { apiAvailable, getMe } from '@/lib/api';
import { ButtonLink, FullScreenSpinner } from '@/components/ui';
import { useT } from '@/lib/i18n';
import FxLogo from '@/components/FxLogo';

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
      <main className="app-shell mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col items-center justify-center px-6 py-10 text-center">
        <div className="stagger flex w-full flex-col items-center">
          <span className="glass mb-7 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-mut">
            <span className="status-dot" aria-hidden="true" /> Built for Telegram
          </span>
          <div className="brand-orbit anim-float">
            <FxLogo size={58} />
          </div>
          <h1 className="text-display mt-7 text-[40px] font-semibold leading-none tracking-[-0.055em]">
            Fx<span className="text-gradient">Aeon</span>
          </h1>
          <p className="mt-4 max-w-[340px] text-[14px] leading-relaxed text-mut">{t('splash.tagline')}</p>

          <div className="my-7 grid w-full grid-cols-3 gap-2" aria-label="Product highlights">
            {[
              { icon: ShieldCheck, label: 'Self-custody' },
              { icon: Sparkles, label: 'Trade & earn' },
              { icon: ArrowLeftRight, label: 'Bridge both ways' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="glass flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-2xl px-2">
                <Icon className="h-4 w-4 text-mint" strokeWidth={1.8} aria-hidden="true" />
                <span className="text-[10px] font-medium text-mut">{label}</span>
              </div>
            ))}
          </div>

          <ButtonLink href={`https://t.me/${BOT_USERNAME}`} external className="w-full">
            {t('common.openInTelegram')} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
          <p className="mt-4 text-[10.5px] uppercase tracking-[0.14em] text-[var(--mut-2)]">
            Powered by f(x) Protocol · Ethereum + Base
          </p>
        </div>
      </main>
    );
  }

  return <FullScreenSpinner />;
}
