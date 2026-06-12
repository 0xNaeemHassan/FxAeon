/**
 * W-08 — Privy Policy Engine tests.
 *
 * These verify the policy DEFINITION (default-deny shape, exact addresses,
 * calldata constraints) and the fail-closed wallet-creation logic against a
 * mocked PrivyClient. Live verification against the Privy API is an owner
 * action after A1 credential rotation (leaked Privy app secret must be rotated
 * before talking to the real API).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ADDRESSES } from "@fxbot/shared";
import {
  POLICY_NAME,
  buildFxAeonPolicyRules,
  ensureFxAeonPolicy,
  createPolicyGuardedWallet,
  __resetPolicyCacheForTests,
} from "../src/core/walletPolicy.js";
import { __resetConfigForTests } from "../src/middleware/config.js";
import type { PrivyClient } from "@privy-io/server-auth";

function mockPrivy(overrides: Record<string, unknown> = {}): PrivyClient {
  return {
    walletApi: {
      getPolicy: vi.fn(async ({ id }: { id: string }) => ({
        id,
        name: POLICY_NAME,
        version: "1.0",
        chainType: "ethereum",
        rules: buildFxAeonPolicyRules(),
        createdAt: new Date(),
      })),
      updatePolicy: vi.fn(async (input: Record<string, unknown>) => input),
      createPolicy: vi.fn(async (input: Record<string, unknown>) => ({
        ...input,
        id: "pol-created-1",
        createdAt: new Date(),
      })),
      createWallet: vi.fn(async (input: { policyIds?: string[] }) => ({
        id: "wal-1",
        chainType: "ethereum",
        address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        policyIds: input.policyIds ?? [],
        ownerId: "owner-1",
      })),
      ...overrides,
    },
  } as unknown as PrivyClient;
}

beforeEach(() => {
  __resetPolicyCacheForTests();
  __resetConfigForTests();
  // Core env required by getConfig(); policy tests vary the Privy vars per test.
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  delete process.env.PRIVY_POLICY_ID;
});

describe("policy rules — default-deny shape", () => {
  const rules = buildFxAeonPolicyRules();

  it("contains no wildcard method and no exportPrivateKey rule (both stay denied)", () => {
    expect(rules.some((r) => r.method === "*")).toBe(false);
    expect(rules.some((r) => r.method === "exportPrivateKey")).toBe(false);
    expect(rules.every((r) => r.action === "ALLOW")).toBe(true);
    // No rule may be unconditional: an ALLOW with zero conditions would match everything.
    expect(rules.every((r) => r.conditions.length > 0)).toBe(true);
  });

  it("only allows eth_sendTransaction and eth_signTypedData_v4", () => {
    const methods = new Set(rules.map((r) => r.method));
    expect(methods).toEqual(new Set(["eth_sendTransaction", "eth_signTypedData_v4"]));
  });

  it("transaction rules only target Router, FxMintRouter, fxSAVE, LimitOrderManager and approve-constrained tokens", () => {
    const txRules = rules.filter((r) => r.method === "eth_sendTransaction");
    const toValues = txRules.flatMap((r) =>
      r.conditions
        .filter((c) => c.fieldSource === "ethereum_transaction" && c.field === "to")
        .flatMap((c) => (Array.isArray(c.value) ? c.value : [c.value]))
    );
    expect(toValues).toContain(ADDRESSES.ROUTER);
    expect(toValues).toContain(ADDRESSES.FXSAVE);
    expect(toValues).toContain(ADDRESSES.FX_MINT_ROUTER);
    expect(toValues).toContain(ADDRESSES.LIMIT_ORDER_MANAGER);
    // Every allowed `to` is one of the verified addresses — nothing else.
    const allowed = new Set<string>([
      ADDRESSES.ROUTER,
      ADDRESSES.FXSAVE,
      ADDRESSES.FX_MINT_ROUTER,
      ADDRESSES.LIMIT_ORDER_MANAGER,
      ADDRESSES.WSTETH,
      ADDRESSES.WBTC,
      ADDRESSES.FXUSD,
      ADDRESSES.STETH,
      ADDRESSES.USDC,
    ]);
    for (const v of toValues) expect(allowed.has(v)).toBe(true);
  });

  it("token rule is calldata-constrained: approve() spender must be Router, fxSAVE or FxMintRouter", () => {
    const tokenRule = rules.find((r) => r.name.includes("ERC-20 approve"));
    expect(tokenRule).toBeDefined();
    const calldata = tokenRule!.conditions.find((c) => c.fieldSource === "ethereum_calldata");
    expect(calldata).toBeDefined();
    expect(calldata).toMatchObject({
      field: "approve.spender",
      operator: "in",
      value: [ADDRESSES.ROUTER, ADDRESSES.FXSAVE, ADDRESSES.FX_MINT_ROUTER],
    });
    // ABI fragment must actually describe approve(address,uint256)
    const abi = (calldata as { abi: Array<{ name: string; inputs: Array<{ name: string; type: string }> }> }).abi;
    expect(abi[0].name).toBe("approve");
    expect(abi[0].inputs.map((i) => `${i.type} ${i.name}`)).toEqual([
      "address spender",
      "uint256 amount",
    ]);
  });

  it("typed-data rule pins the limit-order domain to mainnet + LimitOrderManager", () => {
    const tdRule = rules.find((r) => r.method === "eth_signTypedData_v4");
    expect(tdRule).toBeDefined();
    expect(tdRule!.conditions).toEqual([
      {
        fieldSource: "ethereum_typed_data_domain",
        field: "verifyingContract",
        operator: "eq",
        value: ADDRESSES.LIMIT_ORDER_MANAGER,
      },
      { fieldSource: "ethereum_typed_data_domain", field: "chainId", operator: "eq", value: "1" },
    ]);
  });
});

describe("ensureFxAeonPolicy", () => {
  it("uses the pinned PRIVY_POLICY_ID when configured and validates it", async () => {
    process.env.PRIVY_POLICY_ID = "pol-pinned";
    const privy = mockPrivy();
    const id = await ensureFxAeonPolicy(privy);
    expect(id).toBe("pol-pinned");
    expect(privy.walletApi.getPolicy).toHaveBeenCalledWith({ id: "pol-pinned" });
    expect(privy.walletApi.createPolicy).not.toHaveBeenCalled();
  });

  it("does not touch a pinned policy that already has all canonical rules", async () => {
    process.env.PRIVY_POLICY_ID = "pol-pinned";
    const privy = mockPrivy();
    await ensureFxAeonPolicy(privy);
    expect(privy.walletApi.updatePolicy).not.toHaveBeenCalled();
  });

  it("syncs a stale pinned policy: missing rules trigger updatePolicy with the full canonical set", async () => {
    process.env.PRIVY_POLICY_ID = "pol-stale";
    // Simulate a policy created before the FxMintRouter release.
    const stale = buildFxAeonPolicyRules().filter((r) => !r.name.includes("FxMintRouter"));
    expect(stale.length).toBeLessThan(buildFxAeonPolicyRules().length);
    const privy = mockPrivy({
      getPolicy: vi.fn(async () => ({
        id: "pol-stale",
        chainType: "ethereum",
        rules: stale,
      })),
    });
    const id = await ensureFxAeonPolicy(privy);
    expect(id).toBe("pol-stale");
    expect(privy.walletApi.updatePolicy).toHaveBeenCalledTimes(1);
    expect(privy.walletApi.updatePolicy).toHaveBeenCalledWith({
      id: "pol-stale",
      rules: buildFxAeonPolicyRules(),
    });
  });

  it("rejects a pinned policy with the wrong chain type", async () => {
    process.env.PRIVY_POLICY_ID = "pol-solana";
    const privy = mockPrivy({
      getPolicy: vi.fn(async () => ({ id: "pol-solana", chainType: "solana", rules: [{}] })),
    });
    await expect(ensureFxAeonPolicy(privy)).rejects.toThrow(/not an Ethereum policy/);
  });

  it("rejects a pinned policy with no rules (would be created unguarded)", async () => {
    process.env.PRIVY_POLICY_ID = "pol-empty";
    const privy = mockPrivy({
      getPolicy: vi.fn(async () => ({ id: "pol-empty", chainType: "ethereum", rules: [] })),
    });
    await expect(ensureFxAeonPolicy(privy)).rejects.toThrow(/no rules/);
  });

  it("creates the policy once and caches the ID when not pinned", async () => {
    const privy = mockPrivy();
    const a = await ensureFxAeonPolicy(privy);
    const b = await ensureFxAeonPolicy(privy);
    expect(a).toBe("pol-created-1");
    expect(b).toBe("pol-created-1");
    expect(privy.walletApi.createPolicy).toHaveBeenCalledTimes(1);
    expect(privy.walletApi.createPolicy).toHaveBeenCalledWith({
      name: POLICY_NAME,
      version: "1.0",
      chainType: "ethereum",
      rules: buildFxAeonPolicyRules(),
    });
  });
});

describe("createPolicyGuardedWallet — fail closed", () => {
  const walletApiEnv = {
    PRIVY_APP_ID: "app",
    PRIVY_APP_SECRET: "secret",
    PRIVY_AUTHORIZATION_KEY: "wallet-auth:key",
  };

  function withEnv<T>(env: Record<string, string>, fn: () => T): T {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      prev[k] = process.env[k];
      process.env[k] = v;
    }
    __resetConfigForTests();
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it("refuses to create a wallet when the wallet API is not configured", async () => {
    delete process.env.PRIVY_AUTHORIZATION_KEY;
    const privy = mockPrivy();
    await expect(createPolicyGuardedWallet(privy, "did:privy:user1")).rejects.toThrow(
      /not configured/
    );
    expect(privy.walletApi.createWallet).not.toHaveBeenCalled();
  });

  it("creates a wallet with the policy attached and a deterministic idempotency key", async () => {
    await withEnv(walletApiEnv, async () => {
      const privy = mockPrivy();
      const wallet = await createPolicyGuardedWallet(privy, "did:privy:user1");
      expect(wallet.address).toBe("0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
      expect(wallet.policyIds).toContain("pol-created-1");
      expect(privy.walletApi.createWallet).toHaveBeenCalledWith({
        chainType: "ethereum",
        policyIds: ["pol-created-1"],
        owner: { userId: "did:privy:user1" },
        idempotencyKey: "fxaeon-wallet-did:privy:user1",
      });
    });
  });

  it("aborts if Privy returns a wallet without the policy attached", async () => {
    await withEnv(walletApiEnv, async () => {
      const privy = mockPrivy({
        createWallet: vi.fn(async () => ({
          id: "wal-bad",
          chainType: "ethereum",
          address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
          policyIds: [],
          ownerId: null,
        })),
      });
      await expect(createPolicyGuardedWallet(privy, "did:privy:user1")).rejects.toThrow(
        /without policy/
      );
    });
  });

  it("aborts on an invalid wallet address (no fabricated '0x...' ever again)", async () => {
    await withEnv(walletApiEnv, async () => {
      const privy = mockPrivy({
        createWallet: vi.fn(async (input: { policyIds?: string[] }) => ({
          id: "wal-fake",
          chainType: "ethereum",
          address: "0x...",
          policyIds: input.policyIds ?? [],
          ownerId: null,
        })),
      });
      await expect(createPolicyGuardedWallet(privy, "did:privy:user1")).rejects.toThrow(
        /invalid address/
      );
    });
  });
});
