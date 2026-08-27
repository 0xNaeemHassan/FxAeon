'use client';

/**
 * Mini-app i18n runtime.
 *
 * FxAeon intentionally ships one complete English interface. The previous
 * locale switch translated navigation/authentication but left financial
 * forms in English, producing a misleading mixed-language transaction UX.
 * Additional locales should return only when every retained financial screen
 * and review state has complete, audited copy.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, Locale, normalizeLocale } from './config';
import en from './en';
import type { Messages } from './config';

const DICT: Record<Locale, Messages> = {
  en,
};

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
  // Keep state so the public context remains stable for existing components;
  // normalizeLocale deliberately resolves every input to English.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    // The server starts in English for hydration safety; keep the document
    // language synchronized once the persisted/Telegram locale resolves so
    // screen readers switch pronunciation rules with the visible copy.
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((input: string | undefined | null) => {
    setLocaleState(normalizeLocale(input));
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
