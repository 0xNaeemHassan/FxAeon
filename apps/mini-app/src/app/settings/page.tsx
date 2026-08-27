'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Check, Palette, ShieldCheck, Sliders } from 'lucide-react';
import { AppShell, Button, Card, SectionTitle, Skeleton } from '@/components/ui';
import { useLocale } from '@/lib/i18n';
import { THEMES, applyTheme, type ThemeId } from '@/lib/theme';
import { haptic } from '@/lib/telegram';
import { SETTINGS_KEY } from '@/lib/settings';

const WalletSection = dynamic(() => import('@/components/WalletSection'), {
  ssr: false,
  loading: () => <Skeleton className="h-24" />,
});
const LogoutSection = dynamic(() => import('@/components/LogoutSection'), {
  ssr: false,
  loading: () => <Skeleton className="h-24" />,
});

const SLIPPAGE_PRESETS = [10, 50, 100, 200] as const;
type SettingsV1 = {
  slippageBps: number;
  theme: ThemeId;
};

const DEFAULT_SETTINGS: SettingsV1 = {
  slippageBps: 50,
  theme: 'violet',
};

function readSettings(): SettingsV1 {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<SettingsV1>;
    const slippageBps = SLIPPAGE_PRESETS.includes(parsed.slippageBps as (typeof SLIPPAGE_PRESETS)[number]) ? parsed.slippageBps! : DEFAULT_SETTINGS.slippageBps;
    const theme = parsed.theme && Object.prototype.hasOwnProperty.call(THEMES, parsed.theme) ? parsed.theme : DEFAULT_SETTINGS.theme;
    return { slippageBps, theme };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function SettingsPage() {
  const { t } = useLocale();
  const [mounted, setMounted] = useState(false);
  const [settings, setSettings] = useState<SettingsV1>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const next = readSettings();
    setSettings(next);
    applyTheme(next.theme);
    setMounted(true);
  }, []);

  const update = <K extends keyof SettingsV1>(key: K, value: SettingsV1[K]) => {
    setSaved(false);
    setSaveError('');
    setSettings((current) => ({ ...current, [key]: value }));
    if (key === 'theme') applyTheme(value as ThemeId);
    haptic('selection');
  };

  const save = () => {
    setSaveError('');
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      setSaved(true);
      haptic('success');
      window.setTimeout(() => setSaved(false), 2200);
    } catch {
      setSaved(false);
      setSaveError('This browser blocked local preference storage. Your wallet and on-chain state were not affected.');
      haptic('error');
    }
  };

  if (!mounted) return <AppShell title={t('settings.title')}>{null}</AppShell>;

  return (
    <AppShell title={t('settings.title')} subtitle="Wallet controls and preferences stay on this device.">
      <div className="stagger flex flex-col">
        <WalletSection />

        <SectionTitle>
          <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Wallet authority</span>
        </SectionTitle>
        <Card className="border-[rgba(139,109,255,.22)] bg-[rgba(139,109,255,.06)]">
          <p className="text-[13px] font-medium">You approve every transaction</p>
          <p className="mt-1 text-[12px] leading-relaxed text-mut">FxAeon does not keep a session signer or execute trades in the background. Each SDK transaction opens your wallet confirmation on the selected chain.</p>
        </Card>

        <SectionTitle>
          <span className="flex items-center gap-1.5"><Sliders className="h-3.5 w-3.5" aria-hidden="true" /> {t('settings.maxSlippage')}</span>
        </SectionTitle>
        <ChoiceGrid
          ariaLabel={t('settings.maxSlippage')}
          value={settings.slippageBps}
          options={SLIPPAGE_PRESETS.map((bps) => ({ value: bps, label: `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%` }))}
          onChange={(value) => update('slippageBps', value)}
        />
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-mut">This is a client preference passed to the official SDK. Protocol quotes and transaction data remain authoritative.</p>

        <SectionTitle>
          <span className="flex items-center gap-1.5"><Palette className="h-3.5 w-3.5" aria-hidden="true" /> Appearance</span>
        </SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          {(Object.keys(THEMES) as ThemeId[]).map((themeKey) => {
            const theme = THEMES[themeKey];
            const active = settings.theme === themeKey;
            return (
              <button
                key={themeKey}
                type="button"
                aria-pressed={active}
                onClick={() => update('theme', themeKey)}
                className={`flex min-h-[74px] flex-col rounded-2xl border p-3 text-left transition-colors ${active ? 'border-[var(--mint)] bg-[var(--mint-dim)]' : 'border-[var(--line)] bg-[var(--surface)]'}`}
              >
                <span className="flex items-center justify-between text-[13px] font-semibold"><span>{theme.name}</span><span className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ backgroundColor: theme.accent }} /></span>
                <span className="mt-1 text-[10.5px] text-mut">{theme.subtitle}</span>
              </button>
            );
          })}
        </div>

        <Card className="mt-7 border-[rgba(255,194,102,.22)]">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint" aria-hidden="true" />
            <p className="text-[11.5px] leading-relaxed text-mut">Local preferences are convenience only. They never authorize a transaction or replace blockchain, Privy, or SDK state.</p>
          </div>
        </Card>

        <div className="mt-6">
          <Button onClick={save}>
            {saved ? <><Check className="h-4 w-4" aria-hidden="true" /> {t('common.saved')}</> : t('common.save')}
          </Button>
          {saveError && <p role="alert" className="mt-2 text-center text-[11px] leading-relaxed text-danger">{saveError}</p>}
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
  columns = 'grid-cols-4',
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  columns?: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className={`grid ${columns} gap-2`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`glass glass-press min-h-11 rounded-2xl px-2 py-2.5 text-[13px] ${active ? 'border-[rgba(124,92,255,0.45)] bg-[var(--mint-dim)] text-mint' : 'text-mut'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
