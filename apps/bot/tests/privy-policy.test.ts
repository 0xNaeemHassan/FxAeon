import { describe, it, expect } from "vitest";
import { ADDRESSES } from "@fxbot/shared";

describe("Privy Policy", () => {
  const policy = {
    name: "fxBot-automation-policy",
    chain_type: "ethereum",
    rules: [
      {
        name: "allow-fx-router-calls",
        method: "eth_sendTransaction",
        action: "ALLOW",
        conditions: [
          { field_source: "ethereum_transaction", field: "to", operator: "eq", value: ADDRESSES.ROUTER },
          { field_source: "ethereum_transaction", field: "value", operator: "lte", value: "0" }
        ]
      },
      {
        name: "allow-fxsave-harvest",
        method: "eth_sendTransaction",
        action: "ALLOW",
        conditions: [
          { field_source: "ethereum_transaction", field: "to", operator: "eq", value: ADDRESSES.FXSAVE },
          { field_source: "ethereum_calldata", field: "function_selector", operator: "eq", value: "0x4641257d" }
        ]
      },
      {
        name: "allow-limit-order-eip712-sign",
        method: "eth_signTypedData_v4",
        action: "ALLOW",
        conditions: [
          { field_source: "typed_data", field: "domain.name", operator: "eq", value: "f(x) Limit Order Manager" },
          { field_source: "typed_data", field: "domain.verifyingContract", operator: "eq", value: ADDRESSES.LIMIT_ORDER_MANAGER }
        ]
      },
      { name: "deny-all-else", action: "DENY" }
    ]
  };

  it("should have 3 ALLOW rules + 1 DENY rule", () => {
    const allowRules = policy.rules.filter(r => r.action === "ALLOW");
    const denyRules = policy.rules.filter(r => r.action === "DENY");
    expect(allowRules).toHaveLength(3);
    expect(denyRules).toHaveLength(1);
  });

  it("should only allow Router address", () => {
    const routerRule = policy.rules.find(r => r.name === "allow-fx-router-calls");
    expect(routerRule?.conditions?.[0]?.value).toBe(ADDRESSES.ROUTER);
  });

  it("should only allow fxSAVE address", () => {
    const saveRule = policy.rules.find(r => r.name === "allow-fxsave-harvest");
    expect(saveRule?.conditions?.[0]?.value).toBe(ADDRESSES.FXSAVE);
  });

  it("should deny all else", () => {
    const denyRule = policy.rules.find(r => r.name === "deny-all-else");
    expect(denyRule?.action).toBe("DENY");
  });
});
