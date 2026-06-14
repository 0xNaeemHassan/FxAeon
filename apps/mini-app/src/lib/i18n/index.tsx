'use client';

/**
 * Mini-app i18n runtime.
 *
 * Locale resolution (client-only; SSR/first paint use 'en' to avoid a
 * hydration mismatch, then the effect upgrades it):
 *   1. an explicit choice persisted in localStorage (set from Settings)
 *   2. the saved User.language, pushed in by pages after getMe() via setLocale
 *   3. Telegram's UI language (initDataUnsafe.user.language_code)
 *   4. 'en'
 *
 * Missing keys fall back to English, then to the raw key — so a half-finished
 * locale degrades gracefully instead of rendering blanks.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getTelegramLanguage } from '@/lib/telegram';
import { DEFAULT_LOCALE, Locale, normalizeLocale } from './config';
import en from './en';
import es from './es';
import zhCN from './zh-CN';
import ru from './ru';
import ja from './ja';
import ko from './ko';
import type { Messages } from './config';

const DICT: Record<Locale, Messages> = {
  en,
  es,
  'zh-CN': zhCN,
  ru,
  ja,
  ko,
};

const STORAGE_KEY = 'fxaeon.locale';

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (input: string | undefined | null) => void;
  t: TFunction;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Start at the default so server and first client render match; upgrade
  // to the real locale in the mount effect below.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    let next: string | null = null;
    try {
      next = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      /* storage blocked — fall through */
    }
    setLocaleState(normalizeLocale(next || getTelegramLanguage()));
  }, []);

  const setLocale = useCallback((input: string | undefined | null) => {
    const resolved = normalizeLocale(input);
    setLocaleState(resolved);
    try {
      window.localStorage.setItem(STORAGE_KEY, resolved);
    } catch {
      /* storage blocked — keep in-memory choice */
    }
  }, []);

  const t = useCallback<TFunction>(
    (key, vars) => {
      const table = DICT[locale] ?? en;
      const template = table[key] ?? en[key] ?? key;
      return interpolate(template, vars);
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    // Defensive fallback so a stray component outside the provider still renders
    // English instead of throwing.
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: (key, vars) => interpolate(en[key] ?? key, vars),
    };
  }
  return ctx;
}

/** Convenience hook: `const t = useT();` then `t('nav.home')`. */
export function useT(): TFunction {
  return useLocale().t;
}

export type { Locale } from './config';
