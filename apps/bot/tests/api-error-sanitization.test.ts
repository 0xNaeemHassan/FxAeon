import { describe, expect, it } from "vitest";
import { publicApiError } from "../src/api/index.js";
import { SimulationError, ValidationError } from "../src/middleware/errors.js";

describe("publicApiError", () => {
  it("does not expose upstream RPC credentials or response bodies", () => {
    const upstream = new SimulationError(
      "relay failed via https://rpc-user:rpc-password@node.example/v2/secret-key: { private: true }"
    );
    const result = publicApiError(upstream);
    expect(result).toEqual({
      status: 400,
      code: "SIMULATION_ERROR",
      message: "Transaction simulation failed. Please check your parameters.",
    });
    expect(JSON.stringify(result)).not.toContain("rpc-password");
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("keeps locally generated validation feedback", () => {
    expect(publicApiError(new ValidationError("amount: must be positive"))).toEqual({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "amount: must be positive",
    });
  });

  it("normalizes unknown codes, status values, and messages", () => {
    const error = Object.assign(new Error("postgresql://user:password@host/db"), {
      status: 200,
      code: "bad-code",
    });
    expect(publicApiError(error)).toEqual({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Our team has been notified.",
    });
  });
});
