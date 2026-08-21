import { describe, it, expect, vi } from "vitest";

/**
 * Security command tests — Phase 4.
 * Tests the /security surface rendering and callback handling.
 */

vi.mock("../src/core/metrics", () => ({
  incr: vi.fn(),
}));

vi.mock("@fxaeon/db", () => ({
  prisma: {
    botState: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

import { ALLOWED_TARGETS, resolvePolicyMode } from "../src/core/signerPolicy.js";

describe("Security surface data", () => {
  it("ALLOWED_TARGETS has expected count", () => {
    // Should have at least the core addresses
    expect(ALLOWED_TARGETS.size).toBeGreaterThanOrEqual(4);
  });

  it("resolvePolicyMode defaults to enforce", () => {
    const mode = resolvePolicyMode();
    expect(mode).toBe("enforce");
  });

  it("resolvePolicyMode reads env", () => {
    const original = process.env.SIGNER_POLICY_MODE;
    process.env.SIGNER_POLICY_MODE = "observe";
    expect(resolvePolicyMode()).toBe("observe");
    process.env.SIGNER_POLICY_MODE = original;
  });
});
