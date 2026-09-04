'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Check, Sliders } from 'lucide-react';
import { AppShell, Button, Skeleton } from '@/components/ui';
import { useLocale } from '@/lib/i18n';
import { haptic } from '@/lib/telegram';
import { SETTINGS_KEY } from '@/lib/settings';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/UtilitySurfaces.module.css';

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
};

const DEFAULT_SETTINGS: SettingsV1 = {
  slippageBps: 50,
};

function readSettings(): SettingsV1 {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<SettingsV1>;
    const slippageBps = SLIPPAGE_PRESETS.includes(parsed.slippageBps as (typeof SLIPPAGE_PRESETS)[number]) ? parsed.slippageBps! : DEFAULT_SETTINGS.slippageBps;
    return { slippageBps };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function SettingsPage() {
  const { t } = useLocale();
  const walletState = usePrivyWallet();
  const [mounted, setMounted] = useState(false);
  const [settings, setSettings] = useState<SettingsV1>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const next = readSettings();
    setSettings(next);
    setMounted(true);
  }, []);

  const update = <K extends keyof SettingsV1>(key: K, value: SettingsV1[K]) => {
    setSaved(false);
    setSaveError('');
    setSettings((current) => ({ ...current, [key]: value }));
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

  if (!mounted) return <AppShell title={t('settings.title')} subtitle="Wallet and preferences"><Skeleton className="h-24" /></AppShell>;

  return (
    <AppShell title={t('settings.title')} subtitle="Wallet and preferences">
      <div className={styles.utilityWorkspace}>
        <div className={styles.utilitySection}>
          <WalletSection />
        </div>

        <section className={styles.utilitySection} aria-labelledby="settings-slippage-title">
          <h2 id="settings-slippage-title" className={styles.sectionLabel}>
            <span className="flex items-center gap-1.5"><Sliders className="h-3.5 w-3.5" aria-hidden="true" /> {t('settings.maxSlippage')}</span>
          </h2>
          <div className={`${styles.utilityCard} p-4`}>
            <p className="text-[13px] leading-relaxed text-mut">Choose the largest change in output you will accept when a route uses slippage protection.</p>
            <ChoiceGrid
              ariaLabel={t('settings.maxSlippage')}
              value={settings.slippageBps}
              options={SLIPPAGE_PRESETS.map((bps) => ({ value: bps, label: `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%` }))}
              onChange={(value) => update('slippageBps', value)}
            />
          </div>
        </section>

        <div className="mt-6">
          <Button onClick={save}>
            {saved ? <><Check className="h-4 w-4" aria-hidden="true" /> {t('common.saved')}</> : t('common.save')}
          </Button>
          {saveError && <p role="alert" className="mt-2 text-center text-[11px] leading-relaxed text-danger">{saveError}</p>}
        </div>

        {walletState.ready && walletState.authenticated && (
          <div className={styles.utilitySection}>
            <LogoutSection />
          </div>
        )}
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
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
              if (!keys.includes(event.key)) return;
              event.preventDefault();
              const current = options.findIndex((item) => item.value === option.value);
              const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
              const next = event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : (current + (backwards ? -1 : 1) + options.length) % options.length;
              onChange(options[next].value);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
            }}
            className={styles.preferenceChoice}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
