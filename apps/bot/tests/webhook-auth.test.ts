import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { webhookEndpointFromOrigin, webhookSecretFingerprint } from "../src/utils/webhookAuth.js";

describe("webhook secret registration marker", () => {
  it("is deterministic, domain-separated and never persists the secret itself", () => {
    const secret = "s".repeat(64);
    const fingerprint = webhookSecretFingerprint(secret);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain(secret);
    expect(fingerprint).not.toBe(createHash("sha256").update(secret).digest("hex"));
    expect(webhookSecretFingerprint(secret)).toBe(fingerprint);
    expect(webhookSecretFingerprint("t".repeat(64))).not.toBe(fingerprint);
  });
});

describe("webhook endpoint construction", () => {
  it("normalizes an origin to the exact /webhook path", () => {
    expect(webhookEndpointFromOrigin("https://bot.example.com")).toBe("https://bot.example.com/webhook");
    expect(webhookEndpointFromOrigin("https://bot.example.com/")).toBe("https://bot.example.com/webhook");
  });
});
