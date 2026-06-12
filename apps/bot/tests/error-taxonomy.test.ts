/**
 * W-19: error taxonomy — classification and broadcast-state honesty.
 */
import { describe, it, expect } from "vitest";
import { classifyExecutionError, describeExecutionError } from "../src/core/errorTaxonomy";

const HASH = "0x" + "ab".repeat(32);

describe("classifyExecutionError", () => {
  it("classifies broadcast state before cause", () => {
    // A sim failure mentioning a revert is still pre-broadcast.
    expect(classifyExecutionError("simulation failed at tx 0: execution reverted")).toBe("simulation_failed");
    expect(classifyExecutionError("simulation unavailable: tenderly 500")).toBe("simulation_unavailable");
    expect(classifyExecutionError(`tx 2/3 reverted on-chain: ${HASH}`)).toBe("reverted");
  });

  it("classifies common causes", () => {
    expect(classifyExecutionError("err: insufficient funds for gas * price + value")).toBe("insufficient_funds");
    expect(classifyExecutionError("Too little received")).toBe("slippage");
    expect(classifyExecutionError("nonce too low")).toBe("nonce");
    expect(classifyExecutionError("request denied by wallet policy")).toBe("delegation");
    expect(classifyExecutionError("wallet is not delegated to this app")).toBe("delegation");
    expect(classifyExecutionError("no active session signer for wallet")).toBe("delegation");
    expect(classifyExecutionError("429 too many requests")).toBe("rate_limited");
    expect(classifyExecutionError("fetch failed: ETIMEDOUT")).toBe("network");
    expect(classifyExecutionError("???")).toBe("unknown");
    expect(classifyExecutionError(undefined)).toBe("unknown");
  });
});

describe("describeExecutionError honesty", () => {
  it("only promises 'NOT sent' for pre-broadcast failures", () => {
    expect(describeExecutionError("simulation failed at tx 0: x")).toContain("NOT sent");
    expect(describeExecutionError("simulation unavailable")).toContain("NOT sent");
    expect(describeExecutionError(`tx 1/2 reverted on-chain: ${HASH}`)).not.toContain("NOT sent");
  });

  it("preserves tx hashes as etherscan links", () => {
    expect(describeExecutionError(`tx 1/2 reverted on-chain: ${HASH}`)).toContain(`https://etherscan.io/tx/${HASH}`);
  });

  it("adds the likely cause to simulation failures", () => {
    expect(describeExecutionError("simulation failed at tx 1: TRANSFER_FROM_FAILED")).toContain("insufficient balance");
    expect(describeExecutionError("simulation failed: too little received")).toContain("slippage");
  });

  it("unknown errors stay generic without invented causes", () => {
    const copy = describeExecutionError("Error: blob");
    expect(copy).toContain("Something went wrong");
    expect(copy).not.toContain("Likely cause");
  });
});
