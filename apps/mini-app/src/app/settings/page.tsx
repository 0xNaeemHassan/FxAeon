'use client';

/**
 * Settings — loads the user's REAL preferences from the bot and saves them
 * back through the authenticated API. (The old screen kept everything in
 * local state and "saved" via a sendData payload the bot rejected — a dead
 * button by design.)
 *
 * Privy context: the root layout intentionally omits PrivyClientProvider
 * (the SDK is heavy). The useLogout() hook MUST run inside a Privy context,
 * so the logout section is isolated into a component rendered inside the
 * same PrivyClientProvider that WalletSection uses. This prevents the hook
 * from running outside the provider and crashing the Settings tab.
 */
import { useEffect, useState } from 'react';
import { Globe, Sliders, Shield, Check, PlugZap, Send, LogOut } from 'lucide-react';
import { isTMA, getInitData, haptic } from '@/lib/telegram';
import { apiConfigured, getMe, saveSettings } from '@/lib/api';
import { AppShell, Button, Card, EmptyState, SectionTitle, Skeleton } from '@/components/ui';
import { useLocale } from '@/lib/i18n';
import dynamic from 'next/dynamic';
import { privyConfigured } from '@/lib/privyConfig';

// PERF (W-20): Settings → Wallet is the only Privy surface outside /login.
// Loading it dynamically keeps the heavy SDK out of this page's bundle.
const WalletSection = dynamic(() => import('@/components/WalletSection'), {
  ssr: false,
  loading: () => <Skeleton className="h-24" />,
});

// Logout section — dynamically loaded so the Privy SDK chunk isn't in the
// Settings page's critical bundle. The component is rendered inside a
// PrivyClientProvider so useLogout() has the context it needs.
const LogoutSection = dynamic(() => import('@/components/LogoutSection'), {
  ssr: false,
  loading: () => <Skeleton className="h-24" />,
});

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: '中文' },
  { code: 'ko', name: '한국어' },
  { code: 'ja', name: '日本語' },
  { code: 'ru', name: 'Русский' },
  { code: 'es', name: 'Español' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'pt', name: 'Português' },
];

const SLIPPAGE_PRESETS = [10, 50, 100, 200]; // bps

export default function SettingsPage() {
  const { t, setLocale } = useLocale();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lang, setLang] = useState('en');
  const [slippageBps, setSlippageBps] = useState(50);
  const [mev, setMev] = useState<'on' | 'off'>('off');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (!isTMA() || !getInitData() || !apiConfigured()) {
      setLoading(false);
      return;
    }
    getMe()
      .then((me) => {
        if (me.onboarded) {
          setLang(me.language ?? 'en');
          setLocale(me.language ?? 'en');
          setSlippageBps(me.slippageBps ?? 50);
          setMev((me.mevProtection as 'on' | 'off') ?? 'off');
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [mounted]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await saveSettings({ language: lang, slippageBps, mevProtection: mev });
      haptic('success');
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      haptic('error');
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const touch = () => {
    setDirty(true);
    setSaved(false);
  };

  if (!mounted) return <AppShell title={t('settings.title')}>{null}</AppShell>;

  if (!isTMA()) {
    return (
      <AppShell title={t('settings.title')} tabs={false}>
        <EmptyState
          icon={Send}
          title={t('settings.openInTgTitle')}
          body={t('settings.openInTgBody')}
          action={
            <a href={`https://t.me/${BOT_USERNAME}`}>
              <Button>{t('common.openBot', { bot: BOT_USERNAME })}</Button>
            </a>
          }
        />
      </AppShell>
    );
  }

  if (!getInitData() || !apiConfigured()) {
    return (
      <AppShell title={t('settings.title')}>
        <EmptyState
          icon={PlugZap}
          title={t('settings.cantSyncTitle')}
          body={!getInitData() ? t('settings.cantSyncNoInit') : t('settings.cantSyncNoBackend')}
        />
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell title={t('settings.title')}>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-28" />
          <Skeleton className="h-20" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={t('settings.title')} subtitle={t('settings.subtitle')}>
      <div className="stagger flex flex-col">
        <WalletSection />

        <SectionTitle>
          <span className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" /> {t('settings.language')}
          </span>
        </SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => {
                haptic('selection');
                setLang(l.code);
                setLocale(l.code);
                touch();
              }}
              className={`glass glass-press rounded-2xl px-2 py-2.5 text-[13px] ${
                lang === l.code ? 'border-[rgba(124, 92, 255,0.45)] bg-[var(--mint-dim)] text-mint' : 'text-mut'
              }`}
            >
              {l.name}
            </button>
          ))}
        </div>

        <SectionTitle>
          <span className="flex items-center gap-1.5">
            <Sliders className="h-3.5 w-3.5" /> {t('settings.maxSlippage')}
          </span>
        </SectionTitle>
        <div className="grid grid-cols-4 gap-2">
          {SLIPPAGE_PRESETS.map((bps) => (
            <button
              key={bps}
              type="button"
              onClick={() => {
                haptic('selection');
                setSlippageBps(bps);
                touch();
              }}
              className={`glass glass-press rounded-2xl py-2.5 text-[13px] font-medium ${
                slippageBps === bps
                  ? 'border-[rgba(124, 92, 255,0.45)] bg-[var(--mint-dim)] text-mint'
                  : 'text-mut'
              }`}
            >
              {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
            </button>
          ))}
        </div>

        <SectionTitle>
          <span className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" /> {t('settings.mevProtection')}
          </span>
        </SectionTitle>
        <Card className="flex items-center justify-between">
          <div>
            <p className="text-[14px] font-medium">{t('settings.privateTx')}</p>
            <p className="mt-0.5 text-[12px] text-mut">{t('settings.privateTxSub')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={mev === 'on'}
            onClick={() => {
              haptic('selection');
              setMev(mev === 'on' ? 'off' : 'on');
              touch();
            }}
            className={`relative h-7 w-12 rounded-full transition-colors ${
              mev === 'on' ? 'bg-mint' : 'bg-[rgba(255,255,255,0.12)]'
            }`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
                mev === 'on' ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </Card>

        {error && (
          <Card className="mt-4 border-[rgba(255, 90, 95,0.35)]">
            <p className="text-[13px] text-danger">{error}</p>
          </Card>
        )}

        <div className="mt-6">
          <Button onClick={save} disabled={!dirty} loading={saving}>
            {saved ? (
              <>
                <Check className="h-4 w-4" /> {t('common.saved')}
              </>
            ) : (
              t('common.save')
            )}
          </Button>
        </div>

        <LogoutSection />
      </div>
    </AppShell>
  );
}
