import { describe, it, expect, vi } from "vitest";

/**
 * Signer policy tests — Phase 3 extensions.
 * Tests fee collector value-send exception and withdraw exception.
 */

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
        recipient: "0x1234567890abcdef1234567890abcdef12345678",
        tokenAddress: null,
        amount: 1_000_000_000_000_000_000n,
      })
    ).toBe(true);
  });

  it("rejects when no intent-scoped recipient provided", () => {
    const tx: PolicyTx = {
      to: "0x1234567890abcdef1234567890abcdef12345678",
      data: "0x",
    };
    expect(isWithdrawException(tx)).toBe(false);
  });

  it("rejects mismatched recipient", () => {
    const tx: PolicyTx = {
      to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      data: "0x",
    };
    expect(
      isWithdrawException(tx, {
        recipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        tokenAddress: null,
        amount: 1n,
      })
    ).toBe(false);
  });

  it("rejects calldata or a zero-value native withdrawal", () => {
    const recipient = "0x1234567890abcdef1234567890abcdef12345678";
    const scope = { recipient, tokenAddress: null, amount: 1n };
    expect(isWithdrawException({ to: recipient, data: "0x1234", value: 1n }, scope)).toBe(false);
    expect(isWithdrawException({ to: recipient, data: "0x", value: 0n }, scope)).toBe(false);
    expect(isWithdrawException({ to: recipient, data: "0x", value: 2n }, scope)).toBe(false);
  });
});

describe("checkRoute with reserved fee collector", () => {
  it("rejects value sends while product fees are dormant", () => {
    const route: PolicyTx[] = [
      {
        to: "0xea24f6a870b57455a83387704d7d2a12e3463d84",
        data: "0x",
        value: 500_000_000_000_000n,
      },
    ];
    const violations = checkRoute(route);
    expect(violations).toHaveLength(1);
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

  it("rejects an unknown selector even on a registered contract", () => {
    const route: PolicyTx[] = [
      {
        to: "0x085780639CC2cACd35E474e71f4d000e2405d8f6", // FXUSD
        data: "0x12345678",
      },
    ];
    const violations = checkRoute(route);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain("selector");
  });
});

describe("ALLOWED_TARGETS", () => {
  it("excludes FEE_COLLECTOR", () => {
    expect(ALLOWED_TARGETS.has("0xea24f6a870b57455a83387704d7d2a12e3463d84")).toBe(false);
  });

  it("includes core f(x) addresses", () => {
    expect(ALLOWED_TARGETS.has("0x085780639cc2cacd35e474e71f4d000e2405d8f6")).toBe(true); // FXUSD
    expect(ALLOWED_TARGETS.has("0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0")).toBe(true); // WSTETH
  });
});
