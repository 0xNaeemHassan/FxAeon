import { describe, expect, it } from "vitest";
import { canonicalWithdrawalAmount } from "../src/commands/withdraw";

describe("canonicalWithdrawalAmount", () => {
  it("preserves exact 18-decimal amounts without Number coercion", () => {
    expect(canonicalWithdrawalAmount("9007199254740993.123456789012345678", 18))
      .toBe("9007199254740993.123456789012345678");
    expect(canonicalWithdrawalAmount("0.000000000000000001", 18)).toBe("0.000000000000000001");
  });

  it("canonicalizes harmless zeros while retaining token precision", () => {
    expect(canonicalWithdrawalAmount("00012.340000", 6)).toBe("12.34");
    expect(canonicalWithdrawalAmount("0.000001", 6)).toBe("0.000001");
  });

  it("rejects zero, scientific notation, signs, excess decimals and uint256 overflow", () => {
    for (const raw of ["0", "0.0", "1e-6", "+1", "-1", ".5", "1.0000001"]) {
      expect(canonicalWithdrawalAmount(raw, 6), raw).toBeNull();
    }
    expect(canonicalWithdrawalAmount((1n << 256n).toString(), 0)).toBeNull();
  });
});
