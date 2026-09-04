'use client';

import { useEffect, useState } from 'react';
import { Check, Moon, Sparkles, Sun } from 'lucide-react';
import { applyTheme, getSavedTheme, type ThemeId } from '@/lib/theme';
import styles from './UtilitySurfaces.module.css';

const OPTIONS: Array<{ id: ThemeId; label: string; description: string }> = [
  { id: 'official', label: 'Official', description: 'Violet canvas' },
  { id: 'dark', label: 'Dark', description: 'Neutral black canvas' },
  { id: 'light', label: 'Light', description: 'White canvas' },
];

export default function AppearancePreference() {
  const [theme, setTheme] = useState<ThemeId>('official');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(getSavedTheme());
    setMounted(true);
    const sync = (event: Event) => {
      const next = (event as CustomEvent<ThemeId>).detail;
      if (next === 'official' || next === 'dark' || next === 'light') setTheme(next);
    };
    window.addEventListener('fxaeon:theme', sync);
    return () => window.removeEventListener('fxaeon:theme', sync);
  }, []);

  return (
    <div className={styles.themePanel} aria-labelledby="appearance-preference-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="appearance-preference-title" className="text-[15px] font-semibold">Appearance</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-mut">Choose a color theme for this device.</p>
        </div>
        {mounted && <span className="mt-0.5 text-[12px] font-medium text-mint">{OPTIONS.find((option) => option.id === theme)?.label}</span>}
      </div>
      <div className={styles.themeChoices} role="radiogroup" aria-label="Appearance theme">
        {OPTIONS.map((option) => {
          const active = mounted && theme === option.id;
          const Icon = option.id === 'official' ? Sparkles : option.id === 'dark' ? Moon : Sun;
          const previewClass = option.id === 'official'
            ? styles.themePreviewOfficial
            : option.id === 'dark'
              ? styles.themePreviewDark
              : styles.themePreviewLight;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              disabled={!mounted}
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                applyTheme(option.id);
                setTheme(option.id);
              }}
              onKeyDown={(event) => {
                const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
                if (!keys.includes(event.key)) return;
                event.preventDefault();
                const current = OPTIONS.findIndex((item) => item.id === option.id);
                const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
                const next = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? OPTIONS.length - 1
                    : (current + (backwards ? -1 : 1) + OPTIONS.length) % OPTIONS.length;
                applyTheme(OPTIONS[next].id);
                setTheme(OPTIONS[next].id);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
              }}
              className={`${styles.themeChoice} ${active ? styles.themeChoiceActive : ''}`}
            >
              <span className={`${styles.themePreview} ${previewClass}`} aria-hidden="true">
                <span className={styles.previewBar} />
                <span className={styles.previewLine} />
              </span>
              <span className="mt-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold"><Icon className="h-3.5 w-3.5 text-mint" aria-hidden="true" />{option.label}</span>
                {active && <Check className="h-4 w-4 text-mint" aria-hidden="true" />}
              </span>
              <span className="mt-0.5 block text-[11px] text-mut">{option.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
