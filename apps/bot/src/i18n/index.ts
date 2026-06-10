import en from './locales/en.json';
import zh from './locales/zh.json';
import es from './locales/es.json';
import ru from './locales/ru.json';
import ar from './locales/ar.json';
import de from './locales/de.json';

export const locales = { en, zh, es, ru, ar, de } as const;

export type Locale = keyof typeof locales;
export type TranslationKey = keyof typeof en;

export function t(key: TranslationKey, locale: Locale = 'en'): string {
  return locales[locale][key] || locales.en[key] || key;
}

export function getLocaleFromUser(userLanguage?: string): Locale {
  const langMap: Record<string, string> = {
    'en': 'en', 'zh': 'zh', 'zh-CN': 'zh', 'zh-TW': 'zh',
    'es': 'es', 'ru': 'ru', 'ar': 'ar', 'de': 'de',
  };
  return langMap[userLanguage || 'en'] || 'en';
}
