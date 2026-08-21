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
import { useCallback, useEffect, useState } from 'react';
import { Globe, Sliders, Shield, Check, PlugZap, RefreshCw, Send, Palette, Fingerprint, Volume2 } from 'lucide-react';
import { isTMA, getInitData, haptic } from '@/lib/telegram';
import { apiConfigured, getMe, saveSettings } from '@/lib/api';
import { AppShell, Button, ButtonLink, Card, EmptyState, LoadingRegion, SectionTitle, Skeleton } from '@/components/ui';
import { useLocale } from '@/lib/i18n';
import { THEMES, getSavedTheme, applyTheme, type ThemeId } from '@/lib/theme';
import { biometrics } from '@/lib/biometrics';
import { sound } from '@/lib/sound';
import dynamic from 'next/dynamic';

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
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [lang, setLang] = useState('en');
  const [slippageBps, setSlippageBps] = useState(50);
  const [mev, setMev] = useState<'on' | 'off'>('off');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeId>('violet');
  const [biometricAuth, setBiometricAuth] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    setMounted(true);
    setCurrentTheme(getSavedTheme());
    setBiometricAuth(biometrics.isUserEnabled());
    setSoundEnabled(sound.isEnabled());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const me = await getMe();
      if (me.onboarded) {
        setLang(me.language ?? 'en');
        setLocale(me.language ?? 'en');
        setSlippageBps(me.slippageBps ?? 50);
        setMev((me.mevProtection as 'on' | 'off') ?? 'off');
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [setLocale]);

  useEffect(() => {
    if (!mounted) return;
    if (!isTMA() || !getInitData() || !apiConfigured()) {
      setLoading(false);
      return;
    }
    void load();
  }, [load, mounted]);

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
            <ButtonLink href={`https://t.me/${BOT_USERNAME}`} external>
              {t('common.openBot', { bot: BOT_USERNAME })}
            </ButtonLink>
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
        <LoadingRegion label="Loading settings" className="flex flex-col gap-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-28" />
          <Skeleton className="h-20" />
        </LoadingRegion>
      </AppShell>
    );
  }

  if (loadError) {
    return (
      <AppShell title={t('settings.title')}>
        <EmptyState
          icon={RefreshCw}
          title="Settings unavailable"
          body={loadError}
          action={<Button onClick={() => void load()}>Retry</Button>}
        />
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
        <ChoiceGrid
          ariaLabel={t('settings.language')}
          value={lang}
          options={LANGUAGES.map((language) => ({ value: language.code, label: language.name }))}
          columns="grid-cols-3"
          onChange={(next) => {
            setLang(next);
            setLocale(next);
            touch();
          }}
        />

        <SectionTitle>
          <span className="flex items-center gap-1.5">
            <Sliders className="h-3.5 w-3.5" /> {t('settings.maxSlippage')}
          </span>
        </SectionTitle>
        <ChoiceGrid
          ariaLabel={t('settings.maxSlippage')}
          value={slippageBps}
          options={SLIPPAGE_PRESETS.map((bps) => ({
            value: bps,
            label: `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`,
          }))}
          columns="grid-cols-4"
          onChange={(next) => {
            setSlippageBps(next);
            touch();
          }}
        />

        <SectionTitle>
          <span className="flex items-center gap-1.5">
            <Palette className="h-3.5 w-3.5" /> Cyber Theme Studio
          </span>
        </SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          {(Object.keys(THEMES) as ThemeId[]).map((themeKey) => {
            const th = THEMES[themeKey];
            const active = currentTheme === themeKey;
            return (
              <button
                key={themeKey}
                type="button"
                onClick={() => {
                  sound.confirm();
                  haptic('medium');
                  setCurrentTheme(themeKey);
                  applyTheme(themeKey);
                }}
                className={`flex flex-col text-left p-3 rounded-2xl border transition-all ${
                  active
                    ? 'border-[var(--mint)] bg-[var(--mint-dim)] shadow-[0_0_15px_var(--mint-glow)]'
                    : 'border-[var(--line)] bg-[var(--surface)] hover:border-[rgba(255,255,255,0.2)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-white">{th.name}</span>
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-white/20 shadow"
                    style={{ backgroundColor: th.accent }}
                  />
                </div>
                <span className="mt-1 text-[10.5px] text-mut">{th.subtitle}</span>
              </button>
            );
          })}
        </div>

        <SectionTitle>
          <span className="flex items-center gap-1.5">
            <Fingerprint className="h-3.5 w-3.5" /> Biometric Authentication
          </span>
        </SectionTitle>
        <Card className="flex items-center justify-between">
          <div>
            <p className="text-[14px] font-medium">FaceID / TouchID Confirmation</p>
            <p className="mt-0.5 text-[12px] text-mut">Authorize trades and private key exports using device biometrics</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={biometricAuth}
            aria-label="Biometric confirmation"
            onClick={() => {
              sound.toggle();
              haptic('selection');
              const next = !biometricAuth;
              setBiometricAuth(next);
              biometrics.setUserEnabled(next);
            }}
            className="flex min-h-11 min-w-14 items-center justify-center rounded-xl"
          >
            <span aria-hidden="true" className={`relative h-7 w-12 rounded-full transition-colors ${biometricAuth ? 'bg-mint' : 'bg-[rgba(255,255,255,0.12)]'}`}>
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
                  biometricAuth ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
        </Card>

        <SectionTitle>
          <span className="flex items-center gap-1.5">
            <Volume2 className="h-3.5 w-3.5" /> Procedural Sound FX
          </span>
        </SectionTitle>
        <Card className="flex items-center justify-between">
          <div>
            <p className="text-[14px] font-medium">Web Audio UI Synthesis</p>
            <p className="mt-0.5 text-[12px] text-mut">Subtle audio cues for taps, confirmations, and alerts</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={soundEnabled}
            aria-label="Sound FX"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              sound.setEnabled(next);
              if (next) sound.confirm();
              haptic('selection');
            }}
            className="flex min-h-11 min-w-14 items-center justify-center rounded-xl"
          >
            <span aria-hidden="true" className={`relative h-7 w-12 rounded-full transition-colors ${soundEnabled ? 'bg-mint' : 'bg-[rgba(255,255,255,0.12)]'}`}>
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
                  soundEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
        </Card>

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
            aria-label={t('settings.privateTx')}
            onClick={() => {
              sound.toggle();
              haptic('selection');
              setMev(mev === 'on' ? 'off' : 'on');
              touch();
            }}
            className="flex min-h-11 min-w-14 items-center justify-center rounded-xl"
          >
            <span aria-hidden="true" className={`relative h-7 w-12 rounded-full transition-colors ${mev === 'on' ? 'bg-mint' : 'bg-[rgba(255,255,255,0.12)]'}`}>
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
                  mev === 'on' ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
        </Card>

        {error && (
          <Card className="mt-4 border-[rgba(255, 90, 95,0.35)]">
            <p role="alert" className="text-[13px] text-danger">{error}</p>
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

function ChoiceGrid<T extends string | number>({
  ariaLabel,
  value,
  options,
  columns,
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  columns: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className={`grid ${columns} gap-2`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option, index) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              haptic('selection');
              onChange(option.value);
            }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
              const next = event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : (index + (backwards ? -1 : 1) + options.length) % options.length;
              onChange(options[next].value);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
              haptic('selection');
            }}
            className={`glass glass-press min-h-11 rounded-2xl px-2 py-2.5 text-[13px] ${
              active ? 'border-[rgba(124,92,255,0.45)] bg-[var(--mint-dim)] text-mint' : 'text-mut'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
