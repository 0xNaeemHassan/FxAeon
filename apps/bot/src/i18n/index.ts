import path from "path";
import { fileURLToPath } from "url";
import { I18n } from "@grammyjs/i18n";
import type { Context } from "grammy";
import { prisma } from "@fxaeon/db";

/**
 * W-21: single canonical locale dir (`./locales/*.ftl`, Fluent format) wired
 * through @grammyjs/i18n, keyed off `User.language`.
 *
 * Locale negotiation order (fail-soft, never throws into the update path):
 *   1. `User.language` from the DB (set via /settings lang …), cached 60s
 *      per telegramId so we don't add a DB query to every update.
 *   2. Telegram's `from.language_code` for users without a record yet.
 *   3. "en".
 *
 * NOTE: `tsc` does not copy .ftl files — the build script copies
 * `src/i18n/locales` into `dist/i18n/locales` (see package.json).
 */

export const SUPPORTED_LOCALES = ["en", "es", "ja", "ko", "ru", "zh-CN", "tr", "pt"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Map a User.language value or Telegram language_code to a supported locale. */
export function normalizeLocale(input: string | undefined): SupportedLocale {
  if (!input) return "en";
  if ((SUPPORTED_LOCALES as readonly string[]).includes(input)) {
    return input as SupportedLocale;
  }
  const base = input.toLowerCase().split("-")[0];
  if (base === "zh") return "zh-CN"; // zh, zh-TW, zh-Hans, … → zh-CN
  if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) {
    return base as SupportedLocale;
  }
  return "en";
}

// -- per-user locale cache (avoids a DB round-trip on every update) ---------
const LOCALE_CACHE_TTL_MS = 60_000;
const localeCache = new Map<string, { locale: SupportedLocale; expires: number }>();

/** Call after changing User.language so the next update uses the new locale. */
export function invalidateLocaleCache(telegramId: string): void {
  localeCache.delete(telegramId);
}

async function negotiateLocale(ctx: Context): Promise<string | undefined> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return undefined;

  const cached = localeCache.get(telegramId);
  if (cached && cached.expires > Date.now()) return cached.locale;

  let stored: string | undefined;
  try {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      select: { language: true },
    });
    stored = user?.language ?? undefined;
  } catch {
    // DB hiccup: fall back to Telegram's language hint, don't block the update.
  }

  const locale = normalizeLocale(stored ?? ctx.from?.language_code);
  localeCache.set(telegramId, { locale, expires: Date.now() + LOCALE_CACHE_TTL_MS });
  return locale;
}

const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "locales");

export const i18n = new I18n({
  defaultLocale: "en",
  directory: localesDir,
  localeNegotiator: negotiateLocale,
  // No FSI/PDI bidi isolation marks around placeables: Telegram messages are
  // plain text and the invisible marks corrupt copy-pasted values (addresses).
  fluentBundleOptions: { useIsolating: false },
});
