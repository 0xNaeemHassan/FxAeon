import { describe, it, expect, vi } from "vitest";

/**
 * Security command tests — Phase 4.
 * Tests the /security surface rendering and callback handling.
 */

vi.mock("@fxaeon/shared", () => ({
  ADDRESSES: {
    FEE_COLLECTOR: "0xea24f6a870b57455a83387704d7d2a12e3463d84",
    FXUSD: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
    WSTETH: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
    WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    ROUTER: "0xd0aC91e3353C3b12F031AfC5c63e6E3e63a29cB0",
  },
}));

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
