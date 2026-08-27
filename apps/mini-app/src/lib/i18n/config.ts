/** Only complete, audited interface locales belong in this list. */
export const LOCALES = ['en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Unsupported or incomplete locales fail safely to the complete UI. */
export function normalizeLocale(input: string | undefined | null): Locale {
  if (!input) return DEFAULT_LOCALE;
  if ((LOCALES as readonly string[]).includes(input)) return input as Locale;
  return DEFAULT_LOCALE;
}

/** The translation dictionary shape — every locale provides the same keys. */
export type Messages = Record<string, string>;
