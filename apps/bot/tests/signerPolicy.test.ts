import { describe, it, expect, vi } from "vitest";

/**
 * Signer policy tests — Phase 3 extensions.
 * Tests fee collector value-send exception and withdraw exception.
 */

vi.mock("@fxaeon/shared", () => ({
  ADDRESSES: {
    FEE_COLLECTOR: "0xea24f6a870b57455a83387704d7d2a12e3463d84",
    FXUSD: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
    WSTETH: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
    WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    STETH: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
    WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    ETH: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    ROUTER: "0xd0aC91e3353C3b12F031AfC5c63e6E3e63a29cB0",
    FX_MINT_ROUTER: "0x5d0aC91e3353C3b12F031AfC5c63e6E3e63a29cB1",
  },
}));

vi.mock("../src/core/metrics", () => ({
  incr: vi.fn(),
}));

import {
  isFeeCollectorSend,
  isWithdrawException,
  checkRoute,
  ALLOWED_TARGETS,
  type PolicyTx,
} from "../src/core/signerPolicy.js";

describe("isFeeCollectorSend", () => {
  it("identifies valid ETH fee send", () => {
    const tx: PolicyTx = {
      to: "0xea24f6a870b57455a83387704d7d2a12e3463d84",
      data: "0x",
      value: 500_000_000_000_000n, // 0.0005 ETH
    };
    expect(isFeeCollectorSend(tx)).toBe(true);
  });

  it("identifies valid ETH fee send (empty data)", () => {
    const tx: PolicyTx = {
      to: "0xeA24f6a870b57455a83387704d7d2a12e3463d84", // mixed case
      data: "",
      value: 100_000_000_000_000n,
    };
    expect(isFeeCollectorSend(tx)).toBe(true);
  });

  it("rejects zero-value send to fee collector", () => {
    const tx: PolicyTx = {
      to: "0xea24f6a870b57455a83387704d7d2a12e3463d84",
      data: "0x",
      value: 0n,
    };
    expect(isFeeCollectorSend(tx)).toBe(false);
  });

  it("rejects send with calldata (contract call, not value send)", () => {
    const tx: PolicyTx = {
      to: "0xea24f6a870b57455a83387704d7d2a12e3463d84",
      data: "0x095ea7b3" + "0".repeat(128), // approve calldata
      value: 100n,
    };
    expect(isFeeCollectorSend(tx)).toBe(false);
  });

  it("rejects send to wrong address", () => {
    const tx: PolicyTx = {
      to: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      data: "0x",
      value: 100n,
    };
    expect(isFeeCollectorSend(tx)).toBe(false);
  });
});

describe("isWithdrawException", () => {
  it("allows matching intent-scoped recipient", () => {
    const tx: PolicyTx = {
      to: "0x1234567890abcdef1234567890abcdef12345678",
      data: "0x",
      value: 1_000_000_000_000_000_000n,
    };
    expect(
      isWithdrawException(tx, {
        intentScopedRecipient: "0x1234567890abcdef1234567890abcdef12345678",
      })
    ).toBe(true);
  });

  it("rejects when no intent-scoped recipient provided", () => {
    const tx: PolicyTx = {
      to: "0x1234567890abcdef1234567890abcdef12345678",
      data: "0x",
    };
    expect(isWithdrawException(tx, {})).toBe(false);
  });

  it("rejects mismatched recipient", () => {
    const tx: PolicyTx = {
      to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      data: "0x",
    };
    expect(
      isWithdrawException(tx, {
        intentScopedRecipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      })
    ).toBe(false);
  });
});

describe("checkRoute with fee collector", () => {
  it("allows value send to FEE_COLLECTOR (no violations)", () => {
    const route: PolicyTx[] = [
      {
        to: "0xea24f6a870b57455a83387704d7d2a12e3463d84",
        data: "0x",
        value: 500_000_000_000_000n,
      },
    ];
    const violations = checkRoute(route);
    expect(violations).toHaveLength(0);
  });

  it("rejects call to unregistered address", () => {
    const route: PolicyTx[] = [
      {
        to: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        data: "0x12345678",
      },
    ];
    const violations = checkRoute(route);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].reason).toContain("not in the f(x) registry");
  });

  it("allows call to registered contract", () => {
    const route: PolicyTx[] = [
      {
        to: "0x085780639CC2cACd35E474e71f4d000e2405d8f6", // FXUSD
        data: "0x12345678",
      },
    ];
    const violations = checkRoute(route);
    expect(violations).toHaveLength(0);
  });
});

describe("ALLOWED_TARGETS", () => {
  it("includes FEE_COLLECTOR", () => {
    expect(ALLOWED_TARGETS.has("0xea24f6a870b57455a83387704d7d2a12e3463d84")).toBe(true);
  });

  it("includes core f(x) addresses", () => {
    expect(ALLOWED_TARGETS.has("0x085780639cc2cacd35e474e71f4d000e2405d8f6")).toBe(true); // FXUSD
    expect(ALLOWED_TARGETS.has("0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0")).toBe(true); // WSTETH
  });
});
