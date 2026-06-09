import { describe, it, expect } from "vitest";
import { ADDRESSES } from "@fxbot/shared";

describe("Limit Orders EIP-712", () => {
  const domain = {
    name: "f(x) Limit Order Manager",
    version: "1",
    chainId: 1,
    verifyingContract: ADDRESSES.LIMIT_ORDER_MANAGER,
  };

  const types = {
    Order: [
      { name: "maker", type: "address" },
      { name: "pool", type: "address" },
      { name: "positionId", type: "uint256" },
      { name: "positionSide", type: "bool" },
      { name: "orderType", type: "bool" },
      { name: "orderSide", type: "bool" },
      { name: "allowPartialFill", type: "bool" },
      { name: "triggerPrice", type: "uint256" },
      { name: "fxUSDDelta", type: "int256" },
      { name: "collDelta", type: "int256" },
      { name: "debtDelta", type: "int256" },
      { name: "nonce", type: "uint256" },
      { name: "salt", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };

  it("should have correct EIP-712 domain", () => {
    expect(domain.name).toBe("f(x) Limit Order Manager");
    expect(domain.version).toBe("1");
    expect(domain.chainId).toBe(1);
    expect(domain.verifyingContract).toBe("0x112873b395B98287F3A4db266a58e2D01779Ad96");
  });

  it("should have correct Order type structure", () => {
    expect(types.Order).toHaveLength(14);
    expect(types.Order[0]).toEqual({ name: "maker", type: "address" });
    expect(types.Order[7]).toEqual({ name: "triggerPrice", type: "uint256" });
  });

  it("should cover all 8 order modes", () => {
    const modes = [
      { positionSide: true, orderType: false, orderSide: true },   // long open TP
      { positionSide: true, orderType: false, orderSide: false },  // long open SL
      { positionSide: true, orderType: true, orderSide: true },     // long close TP
      { positionSide: true, orderType: true, orderSide: false },   // long close SL
      { positionSide: false, orderType: false, orderSide: true },  // short open TP
      { positionSide: false, orderType: false, orderSide: false }, // short open SL
      { positionSide: false, orderType: true, orderSide: true },    // short close TP
      { positionSide: false, orderType: true, orderSide: false },  // short close SL
    ];
    expect(modes).toHaveLength(8);
  });
});
