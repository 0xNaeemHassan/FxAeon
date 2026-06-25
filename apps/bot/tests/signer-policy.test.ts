/**
 * Session-signer broadcast policy (PLAN.md Pillar A §3.4).
 *
 * The allow-list is derived from the verified ADDRESSES registry; these tests
 * pin the fail-closed behaviour and prove the declarative policy artifact stays
 * in lockstep with the code-enforced set.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encodeFunctionData, erc20Abi, type Address } from "viem";
import { ADDRESSES } from "@fxaeon/shared";
import {
  ALLOWED_TARGETS,
  checkRoute,
  assertRouteAllowed,
  resolvePolicyMode,
  SignerPolicyError,
  type PolicyTx,
} from "../src/core/signerPolicy.js";

const ROUTER = ADDRESSES.ROUTER as Address;
const FX_MINT_ROUTER = ADDRESSES.FX_MINT_ROUTER as Address;
const USDC = ADDRESSES.USDC as Address;
const WSTETH = ADDRESSES.WSTETH as Address;
const USER = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" as Address;
const ATTACKER = "0x000000000000000000000000000000000000dEaD" as Address;

const approve = (token: Address, spender: Address): PolicyTx => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 1n] }),
  value: 0n,
});
const transfer = (token: Address, to: Address): PolicyTx => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, 1n] }),
  value: 0n,
});
const transferFrom = (token: Address, from: Address, to: Address): PolicyTx => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [from, to, 1n] }),
  value: 0n,
});
// Opaque router call (real trades hand the SDK's calldata straight through).
const routerCall = (to: Address): PolicyTx => ({ to, data: "0xabcdef01", value: 0n });

describe("signer policy — allow-list derivation", () => {
  it("derives the allow-list from every ADDRESSES entry", () => {
    for (const addr of Object.values(ADDRESSES)) {
      expect(ALLOWED_TARGETS.has(addr.toLowerCase())).toBe(true);
    }
    expect(ALLOWED_TARGETS.has(ATTACKER.toLowerCase())).toBe(false);
  });

  it("the declarative signer.policy.json mirrors the enforced set exactly", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const policy = JSON.parse(
      readFileSync(join(here, "../policy/signer.policy.json"), "utf8")
    ) as { allowedTargets: { address: string }[] };
    const fileSet = new Set(policy.allowedTargets.map((t) => t.address.toLowerCase()));
    expect(fileSet).toEqual(ALLOWED_TARGETS);
  });
});

describe("signer policy — checkRoute (pure)", () => {
  it("passes a realistic approve→router route (spender is the router)", () => {
    const route = [approve(USDC, ROUTER), routerCall(ROUTER)];
    expect(checkRoute(route, { walletAddress: USER })).toEqual([]);
  });

  it("passes opaque calls to any registry contract (SDK-built trades)", () => {
    expect(checkRoute([routerCall(FX_MINT_ROUTER)], { walletAddress: USER })).toEqual([]);
  });

  it("blocks a tx whose target is outside the registry", () => {
    const v = checkRoute([routerCall(ATTACKER)], { walletAddress: USER });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toMatch(/not in the f\(x\) registry/);
  });

  it("blocks an approve to a non-allow-listed spender (exfiltration)", () => {
    const v = checkRoute([approve(USDC, ATTACKER)], { walletAddress: USER });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toMatch(/approve spender .* is not allowed/);
  });

  it("allows an approve whose spender is the user's own wallet", () => {
    expect(checkRoute([approve(USDC, USER)], { walletAddress: USER })).toEqual([]);
  });

  it("allows an approve whose spender is another registry contract", () => {
    expect(checkRoute([approve(WSTETH, FX_MINT_ROUTER)], { walletAddress: USER })).toEqual([]);
  });

  it("blocks a transfer to an arbitrary recipient but allows self/registry", () => {
    expect(checkRoute([transfer(USDC, ATTACKER)], { walletAddress: USER })).toHaveLength(1);
    expect(checkRoute([transfer(USDC, USER)], { walletAddress: USER })).toEqual([]);
    expect(checkRoute([transfer(USDC, ROUTER)], { walletAddress: USER })).toEqual([]);
  });

  it("checks the correct argument of transferFrom (recipient = arg #2)", () => {
    // pull from user -> router is fine; -> attacker is blocked
    expect(checkRoute([transferFrom(USDC, USER, ROUTER)], { walletAddress: USER })).toEqual([]);
    expect(checkRoute([transferFrom(USDC, USER, ATTACKER)], { walletAddress: USER })).toHaveLength(1);
  });

  it("reports every violation with its tx index", () => {
    const v = checkRoute([routerCall(ROUTER), approve(USDC, ATTACKER), routerCall(ATTACKER)], {
      walletAddress: USER,
    });
    expect(v.map((x) => x.index)).toEqual([1, 2]);
  });
});

describe("signer policy — assertRouteAllowed (modes)", () => {
  const bad = [approve(USDC, ATTACKER)];

  it("enforce mode throws SignerPolicyError on a violation", () => {
    expect(() => assertRouteAllowed(bad, { walletAddress: USER, mode: "enforce" })).toThrow(
      SignerPolicyError
    );
  });

  it("enforce mode returns [] for a clean route", () => {
    expect(assertRouteAllowed([routerCall(ROUTER)], { walletAddress: USER, mode: "enforce" })).toEqual(
      []
    );
  });

  it("observe mode returns violations without throwing", () => {
    const v = assertRouteAllowed(bad, { walletAddress: USER, mode: "observe" });
    expect(v).toHaveLength(1);
  });

  it("off mode is a no-op even for a malicious route", () => {
    expect(assertRouteAllowed(bad, { walletAddress: USER, mode: "off" })).toEqual([]);
  });

  it("resolvePolicyMode defaults to enforce", () => {
    const prev = process.env.SIGNER_POLICY_MODE;
    delete process.env.SIGNER_POLICY_MODE;
    expect(resolvePolicyMode()).toBe("enforce");
    process.env.SIGNER_POLICY_MODE = "observe";
    expect(resolvePolicyMode()).toBe("observe");
    process.env.SIGNER_POLICY_MODE = "off";
    expect(resolvePolicyMode()).toBe("off");
    if (prev === undefined) delete process.env.SIGNER_POLICY_MODE;
    else process.env.SIGNER_POLICY_MODE = prev;
  });
});
