// TEST FIXTURES: These are safe test files, not user input
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("i18n", () => {
  const i18nDir = path.join(__dirname, "../src/i18n");
  const locales = ["en", "zh-CN", "ko", "ja", "ru", "es"];

  it("should have all 6 locale files", () => {
    for (const locale of locales) {
      const filePath = path.join(i18nDir, `${locale}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it("should have consistent keys across locales", () => {
    const enPath = path.join(i18nDir, "en.json");
    const enKeys = Object.keys(JSON.parse(fs.readFileSync(enPath, "utf-8")));

    for (const locale of locales.slice(1)) {
      const filePath = path.join(i18nDir, `${locale}.json`);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const localeKeys = Object.keys(data);
      
      // All English keys should exist in other locales (or at least top-level)
      for (const key of enKeys) {
        expect(localeKeys).toContain(key);
      }
    }
  });

  it("should have required translation keys", () => {
    const requiredKeys = ["start", "portfolio", "trade", "settings", "help", "errors"];
    const enPath = path.join(i18nDir, "en.json");
    const enData = JSON.parse(fs.readFileSync(enPath, "utf-8"));
    
    for (const key of requiredKeys) {
      expect(enData).toHaveProperty(key);
    }
  });
});
