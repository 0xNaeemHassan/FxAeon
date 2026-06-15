/**
 * Mini-app i18n — locale negotiation, kept in sync with the bot's
 * SUPPORTED_LOCALES (apps/bot/src/i18n/index.ts) so a user's saved
 * `User.language` resolves to the same set on both sides.
 */
export const LOCALES = ['en', 'es', 'zh-CN', 'ru', 'ja', 'ko', 'tr', 'pt'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Map a User.language value or Telegram language_code to a supported locale. */
export function normalizeLocale(input: string | undefined | null): Locale {
  if (!input) return DEFAULT_LOCALE;
  if ((LOCALES as readonly string[]).includes(input)) return input as Locale;
  const base = input.toLowerCase().split('-')[0];
  if (base === 'zh') return 'zh-CN'; // zh, zh-TW, zh-hans, … → zh-CN
  const match = (LOCALES as readonly string[]).find((l) => l.split('-')[0] === base);
  return (match as Locale) ?? DEFAULT_LOCALE;
}

/** The translation dictionary shape — every locale provides the same keys. */
export type Messages = Record<string, string>;
