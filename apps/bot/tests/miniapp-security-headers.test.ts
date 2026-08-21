import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function miniAppFile(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../mini-app/${name}`, import.meta.url)), "utf8");
}

describe("Mini App security headers", () => {
  it.each(["public/_headers", "nginx.conf"])("ships CSP and transport hardening in %s", (name) => {
    const config = miniAppFile(name);
    expect(config).toContain("Content-Security-Policy");
    expect(config).toContain("object-src 'none'");
    expect(config).toContain("base-uri 'self'");
    expect(config).toContain("frame-ancestors https://web.telegram.org https://*.telegram.org");
    expect(config).toContain("Strict-Transport-Security");
    expect(config).not.toContain("connect-src *");
  });
});
