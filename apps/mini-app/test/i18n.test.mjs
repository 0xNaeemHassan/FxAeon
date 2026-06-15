/**
 * Mini-app i18n integrity guard.
 *
 * The Mini App ships its own translation catalogs (src/lib/i18n/*.ts), separate
 * from the bot's Fluent catalogs. Before this guard existed there was no check
 * keeping them honest, and the two surfaces silently drifted (the bot reached 8
 * languages while the Mini App was still on 6, so tr/pt users fell back to en in
 * the web app). This test runs under the repo's existing `pnpm test` (turbo)
 * job — no new tooling, no browser, no new workflow — using only Node's built-in
 * test runner.
 *
 * It parses the source files as text (rather than importing the TS/TSX modules)
 * so it stays dependency-free and runs anywhere Node 18+ does.
 *
 * Guards:
 *   1. Every locale catalog has EXACTLY the same keys as en (source of truth).
 *   2. Every key's {placeholder} set matches en (catches dropped/typo'd vars).
 *   3. config.ts LOCALES, the runtime DICT in index.tsx, and the catalog files
 *      on disk all agree on the same locale set.
 *   4. The Mini App's locale set equals the bot's SUPPORTED_LOCALES — the
 *      cross-surface sync invariant that previously broke.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const I18N = join(HERE, '..', 'src', 'lib', 'i18n');
const BOT_I18N_INDEX = join(HERE, '..', '..', 'bot', 'src', 'i18n', 'index.ts');

/** Catalog files the Mini App is expected to ship. Mirrors LOCALES. */
const LOCALE_FILES = {
  en: 'en.ts',
  es: 'es.ts',
  'zh-CN': 'zh-CN.ts',
  ru: 'ru.ts',
  ja: 'ja.ts',
  ko: 'ko.ts',
  tr: 'tr.ts',
  pt: 'pt.ts',
};

/** Extract the top-level message keys from a catalog file (e.g. 'nav.home': '…'). */
function extractKeys(src) {
  const keys = new Set();
  // matches:  'some.key':   (single-quoted key followed by a colon)
  for (const m of src.matchAll(/^\s*'([^']+)'\s*:/gm)) keys.add(m[1]);
  return keys;
}

/** Extract {placeholder} tokens used by a given key's value, across the file. */
function extractEntries(src) {
  const entries = {};
  // key: 'value' | "value" — value may span lines until the closing quote.
  // We keep it simple: capture the quoted string immediately after the key.
  const re = /^\s*'([^']+)'\s*:\s*(['"])([\s\S]*?)\2\s*,?\s*$/gm;
  for (const m of src.matchAll(re)) {
    const key = m[1];
    const val = m[3];
    const vars = new Set([...val.matchAll(/\{(\w+)\}/g)].map((x) => x[1]));
    entries[key] = vars;
  }
  return entries;
}

function readCatalog(file) {
  const p = join(I18N, file);
  assert.ok(existsSync(p), `catalog file missing: ${file}`);
  return readFileSync(p, 'utf8');
}

const enSrc = readCatalog(LOCALE_FILES.en);
const enKeys = extractKeys(enSrc);
const enEntries = extractEntries(enSrc);

test('en is a non-trivial source of truth', () => {
  assert.ok(enKeys.size > 100, `expected >100 keys in en, got ${enKeys.size}`);
});

for (const [locale, file] of Object.entries(LOCALE_FILES)) {
  if (locale === 'en') continue;

  test(`${locale}: key set is identical to en`, () => {
    const keys = extractKeys(readCatalog(file));
    const missing = [...enKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !enKeys.has(k));
    assert.deepEqual(missing, [], `${locale} is missing keys: ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `${locale} has unknown keys: ${extra.join(', ')}`);
  });

  test(`${locale}: {placeholder} variables match en per key`, () => {
    const entries = extractEntries(readCatalog(file));
    const mismatches = [];
    for (const key of Object.keys(enEntries)) {
      const want = enEntries[key];
      const got = entries[key];
      if (!got) continue; // key-parity test above already covers absence
      const a = [...want].sort().join(',');
      const b = [...got].sort().join(',');
      if (a !== b) mismatches.push(`${key} (en: {${a}} ${locale}: {${b}})`);
    }
    assert.deepEqual(mismatches, [], `placeholder drift:\n  ${mismatches.join('\n  ')}`);
  });
}

test('config.ts LOCALES, the DICT, and catalog files all agree', () => {
  const configSrc = readFileSync(join(I18N, 'config.ts'), 'utf8');
  const localesMatch = configSrc.match(/export const LOCALES\s*=\s*\[([^\]]*)\]/);
  assert.ok(localesMatch, 'could not find LOCALES in config.ts');
  const declared = [...localesMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  // The set declared in config must equal the set of catalog files we expect.
  assert.deepEqual(
    [...declared].sort(),
    Object.keys(LOCALE_FILES).sort(),
    'config.ts LOCALES does not match the shipped catalog files'
  );

  // Every declared locale must be wired into the runtime DICT.
  const indexSrc = readFileSync(join(I18N, 'index.tsx'), 'utf8');
  const dictMatch = indexSrc.match(/const DICT[^=]*=\s*\{([\s\S]*?)\};/);
  assert.ok(dictMatch, 'could not find DICT in index.tsx');
  const dictBody = dictMatch[1];
  for (const locale of declared) {
    // accept either `ko,` or `'zh-CN': zhCN,`
    const present =
      new RegExp(`(^|[\\s{,])'${locale.replace(/[-]/g, '\\-')}'\\s*:`).test(dictBody) ||
      new RegExp(`(^|[\\s{,])${locale}\\s*,`).test(dictBody);
    assert.ok(present, `locale '${locale}' is declared in LOCALES but not wired into DICT`);
  }
});

test('Mini App locale set equals the bot SUPPORTED_LOCALES (cross-surface sync)', () => {
  assert.ok(existsSync(BOT_I18N_INDEX), 'bot i18n index not found');
  const botSrc = readFileSync(BOT_I18N_INDEX, 'utf8');
  const m = botSrc.match(/SUPPORTED_LOCALES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'could not find SUPPORTED_LOCALES in bot index.ts');
  const botLocales = [...m[1].matchAll(/"([^"]+)"|'([^']+)'/g)].map((x) => x[1] || x[2]);

  assert.deepEqual(
    [...botLocales].sort(),
    Object.keys(LOCALE_FILES).sort(),
    'bot and Mini App support different locale sets — they must stay in sync'
  );
});
