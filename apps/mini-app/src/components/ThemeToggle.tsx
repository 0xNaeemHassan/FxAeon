'use client';

import { useEffect, useState } from 'react';
import { Moon, Sparkles, Sun } from 'lucide-react';
import { applyTheme, getSavedTheme, type ThemeId } from '@/lib/theme';
import { haptic } from '@/lib/telegram';

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeId>('official');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(getSavedTheme());
    setMounted(true);
    const sync = (event: Event) => setTheme((event as CustomEvent<ThemeId>).detail);
    window.addEventListener('fxaeon:theme', sync);
    return () => window.removeEventListener('fxaeon:theme', sync);
  }, []);

  const next: ThemeId = theme === 'official' ? 'dark' : theme === 'dark' ? 'light' : 'official';
  const Icon = next === 'official' ? Sparkles : next === 'dark' ? Moon : Sun;
  return (
    <button
      type="button"
      disabled={!mounted}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
        haptic('selection');
      }}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={`glass-press flex min-h-11 min-w-11 items-center justify-center rounded-full bg-[var(--surface)] text-mut hover:text-mint ${className}`}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  );
}
