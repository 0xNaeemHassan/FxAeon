// W-21: catalog integrity checks — this is the CI guard that keeps the six
// locales honest. Key parity AND variable parity are enforced against en,
// plus runtime translation checks through the real @grammyjs/i18n instance
// (which also catches Fluent syntax errors like broken multiline patterns).
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { i18n, normalizeLocale, SUPPORTED_LOCALES } from "../src/i18n";

const LOCALES_DIR = path.join(__dirname, "../src/i18n/locales");
const LOCALES = ["en", "es", "ja", "ko", "ru", "zh-CN"];

/** Top-level Fluent message IDs in a catalog ("key = ..." at column 0). */
function messageIds(ftl: string): string[] {
  return [...ftl.matchAll(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*=/gm)].map((m) => m[1]);
}

/** Variable references ($var) used inside a single message's pattern. */
function messageVariables(ftl: string): Map<string, Set<string>> {
  const vars = new Map<string, Set<string>>();
  let current: string | null = null;
  for (const line of ftl.split("\n")) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*=/);
    if (m) {
      current = m[1];
      vars.set(current, new Set());
    }
    if (current) {
      for (const v of line.matchAll(/\$([a-zA-Z][a-zA-Z0-9_]*)/g)) {
        vars.get(current)!.add(v[1]);
      }
    }
  }
  return vars;
}

function readCatalog(locale: string): string {
  return fs.readFileSync(path.join(LOCALES_DIR, `${locale}.ftl`), "utf-8");
}

describe("i18n catalogs", () => {
  it("has all 6 locale files in the single canonical dir", () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual([...LOCALES].sort());
    for (const locale of LOCALES) {
      expect(fs.existsSync(path.join(LOCALES_DIR, `${locale}.ftl`))).toBe(true);
    }
    // The stale duplicate JSON catalogs must not come back.
    const stray = fs
      .readdirSync(path.join(__dirname, "../src/i18n"), { recursive: true })
      .filter((f) => String(f).endsWith(".json"));
    expect(stray).toEqual([]);
  });

  it("has identical message IDs across all locales (no missing/extra keys)", () => {
    const enIds = messageIds(readCatalog("en")).sort();
    expect(enIds.length).toBeGreaterThan(0);
    for (const locale of LOCALES.slice(1)) {
      expect(messageIds(readCatalog(locale)).sort(), `locale: ${locale}`).toEqual(enIds);
    }
  });

  it("uses the same variables per message in every locale", () => {
    const enVars = messageVariables(readCatalog("en"));
    for (const locale of LOCALES.slice(1)) {
      const localeVars = messageVariables(readCatalog(locale));
      for (const [id, vars] of enVars) {
        expect([...(localeVars.get(id) ?? [])].sort(), `${locale}:${id}`).toEqual(
          [...vars].sort()
        );
      }
    }
  });

  it("covers the required command groups", () => {
    const ids = messageIds(readCatalog("en"));
    for (const prefix of ["start-", "portfolio-", "trade-", "settings-", "help-", "errors-"]) {
      expect(
        ids.some((id) => id.startsWith(prefix)),
        `missing group: ${prefix}*`
      ).toBe(true);
    }
  });
});

describe("i18n runtime", () => {
  it("loads all locales into the I18n instance", () => {
    expect([...i18n.locales].sort()).toEqual([...LOCALES].sort());
  });

  it("translates with variables in every locale", () => {
    for (const locale of LOCALES) {
      const back = i18n.t(locale, "start-welcome-back", { wallet: "0xAbCd…1234" });
      expect(back, `locale: ${locale}`).toContain("0xAbCd…1234");
      const usage = i18n.t(locale, "trade-usage", { minLev: 1.1, maxLong: 7, maxShort: 5 });
      expect(usage, `locale: ${locale}`).toContain("/trade wstETH long 3x 1ETH");
    }
  });

  it("preserves blank lines in multiline Fluent patterns", () => {
    const msg = i18n.t("en", "start-welcome-new");
    expect(msg).toContain("Welcome to fxBot");
    expect(msg).toContain("\n\n"); // paragraph breaks survive .ftl multiline syntax
    expect(i18n.t("en", "help-body")).toContain("\n\n");
  });

  it("handles plural categories (en one/other, ru one/few/other)", () => {
    expect(i18n.t("en", "start-positions", { count: 1 })).toContain("1 active position");
    expect(i18n.t("en", "start-positions", { count: 2 })).toContain("2 active positions");
    expect(i18n.t("ru", "start-positions", { count: 2 })).toContain("активные позиции");
    expect(i18n.t("ru", "start-positions", { count: 5 })).toContain("активных позиций");
  });

  it("renders the portfolio partial-read variant", () => {
    expect(i18n.t("en", "portfolio-empty", { partial: "yes" })).toContain(
      "in the markets we could read"
    );
    expect(i18n.t("en", "portfolio-empty", { partial: "no" })).toContain("No active positions.");
  });
});

describe("normalizeLocale", () => {
  it("maps Telegram language codes to supported locales", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("zh-TW")).toBe("zh-CN");
    expect(normalizeLocale("es-MX")).toBe("es");
    expect(normalizeLocale("ru-RU")).toBe("ru");
    expect(normalizeLocale("pt-BR")).toBe("en"); // unsupported → en
    expect(normalizeLocale(undefined)).toBe("en");
  });
});
