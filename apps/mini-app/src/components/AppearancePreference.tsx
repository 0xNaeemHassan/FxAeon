'use client';

import { useEffect, useState } from 'react';
import { Check, Moon, Sun } from 'lucide-react';
import { applyTheme, getSavedTheme, type ThemeId } from '@/lib/theme';
import styles from './UtilitySurfaces.module.css';

const OPTIONS: Array<{ id: ThemeId; label: string; description: string }> = [
  { id: 'dark', label: 'Official dark', description: 'Violet-black canvas' },
  { id: 'light', label: 'Official light', description: 'Soft lavender canvas' },
];

export default function AppearancePreference() {
  const [theme, setTheme] = useState<ThemeId>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(getSavedTheme());
    setMounted(true);
    const sync = (event: Event) => {
      const next = (event as CustomEvent<ThemeId>).detail;
      if (next === 'dark' || next === 'light') setTheme(next);
    };
    window.addEventListener('fxaeon:theme', sync);
    return () => window.removeEventListener('fxaeon:theme', sync);
  }, []);

  return (
    <div className={styles.themePanel} aria-labelledby="appearance-preference-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="appearance-preference-title" className="text-[15px] font-semibold">Appearance</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-mut">Choose the official FxAeon palette for this device.</p>
        </div>
        {mounted && <span className="mt-0.5 text-[12px] font-medium text-mint">{theme === 'dark' ? 'Dark' : 'Light'}</span>}
      </div>
      <div className={styles.themeChoices} role="radiogroup" aria-label="Appearance theme">
        {OPTIONS.map((option) => {
          const active = mounted && theme === option.id;
          const Icon = option.id === 'dark' ? Moon : Sun;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              disabled={!mounted}
              aria-checked={active}
              onClick={() => {
                applyTheme(option.id);
                setTheme(option.id);
              }}
              className={`${styles.themeChoice} ${active ? styles.themeChoiceActive : ''}`}
            >
              <span className={`${styles.themePreview} ${option.id === 'dark' ? styles.themePreviewDark : styles.themePreviewLight}`} aria-hidden="true">
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
