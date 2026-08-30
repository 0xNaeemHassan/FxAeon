import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { clearPendingHashJournalForTests } from "../src/lib/fx/journal";
import { runTransactionRoute } from "../src/lib/fx/runner";
import type { FxPublicClient, PlannedRoute, TransactionPolicy } from "../src/lib/fx/types";

const configuredRpc = process.env.ANVIL_RPC_URL?.trim();
const rpcUrl = (() => {
  if (!configuredRpc) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(configuredRpc);
  } catch {
    throw new Error("ANVIL_RPC_URL must be a local HTTP URL");
  }
  if (
    parsed.protocol !== "http:"
    || !["127.0.0.1", "localhost"].includes(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("ANVIL_RPC_URL must point to localhost without credentials or query parameters");
  }
  return parsed.toString().replace(/\/$/, "");
})();

async function rpc<T = unknown>(method: string, params: readonly unknown[] = []): Promise<T> {
  if (!rpcUrl) throw new Error("ANVIL_RPC_URL is not configured");
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Anvil RPC HTTP ${response.status}`);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(`Anvil RPC error: ${payload.error.message ?? "unknown error"}`);
  return payload.result as T;
}

function hexQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}` as Hex;
}

function chaosRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x51f15e;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function envIterations(): number {
  const value = Number.parseInt(process.env.FX_ANVIL_ITERATIONS ?? "24", 10);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100) : 24;
}

test.beforeEach(() => clearPendingHashJournalForTests());
test.afterEach(() => clearPendingHashJournalForTests());

test("Anvil fork proves Ethereum identity and survives randomized snapshot controls", { skip: !rpcUrl }, async () => {
  const chainId = await rpc<string>("eth_chainId");
  assert.equal(chainId, "0x1");
  const blockNumber = BigInt(await rpc<string>("eth_blockNumber"));
  assert.ok(blockNumber > 0n, "fork should start from a non-genesis Ethereum block");

  const accounts = await rpc<Address[]>("eth_accounts");
  assert.ok(accounts.length >= 2, "Anvil must expose at least two unlocked test accounts");
  const wallet = accounts[0];
  const originalBalance = await rpc<string>("eth_getBalance", [wallet, "latest"]);
  const random = chaosRandom(Number(blockNumber & 0xffffn));

  for (let iteration = 0; iteration < envIterations(); iteration += 1) {
    const snapshot = await rpc<string>("evm_snapshot");
    const replacement = BigInt(Math.floor(random() * 100 + 1)) * 10n ** 18n;
    await rpc("anvil_setBalance", [wallet, hexQuantity(replacement)]);
    if (random() > 0.35) await rpc("anvil_mine", [String(1 + Math.floor(random() * 3))]);
    const changed = await rpc<string>("eth_getBalance", [wallet, "latest"]);
    assert.equal(BigInt(changed), replacement);
    assert.equal(await rpc<boolean>("evm_revert", [snapshot]), true);
    assert.equal(await rpc<string>("eth_getBalance", [wallet, "latest"]), originalBalance);
  }
});

test("runner executes randomized ordered routes against the local Anvil fork", { skip: !rpcUrl }, async () => {
  const accounts = await rpc<Address[]>("eth_accounts");
  assert.ok(accounts.length >= 2, "Anvil must expose two unlocked test accounts");
  const wallet = accounts[0];
  const destination = accounts[1];
  const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) }) as unknown as FxPublicClient;
  const policy: TransactionPolicy = {
    walletAddress: wallet,
    chainId: 1,
    allowedDestinations: [destination],
    allowedSelectors: { [destination.toLowerCase()]: ["0x12345678"] },
    maxValueWei: 0n,
  };
  const random = chaosRandom(0xF0A0E0);

  for (let iteration = 0; iteration < envIterations(); iteration += 1) {
    const snapshot = await rpc<string>("evm_snapshot");
    const count = 1 + Math.floor(random() * 3);
    const route: PlannedRoute = {
      operation: "increasePosition",
      chainId: 1,
      walletAddress: wallet,
      transactions: Array.from({ length: count }, (_, index) => ({
        chainId: 1 as const,
        from: wallet,
        to: destination,
        data: (`0x12345678${(iteration * 17 + index).toString(16).padStart(4, "0")}`) as Hex,
        value: 0n,
        kind: "action" as const,
        operation: "increasePosition" as const,
      })),
    };
    let signed = 0;
    const result = await runTransactionRoute({
      route,
      policy,
      publicClient,
      callbacks: {
        requestSignature: async (request) => {
          signed += 1;
          return rpc<Hex>("eth_sendTransaction", [{
            from: request.from,
            to: request.to,
            data: request.data,
            value: hexQuantity(request.value),
            nonce: hexQuantity(BigInt(request.nonce)),
          }]);
        },
        postConfirmRead: async () => {
          const balance = await rpc<string>("eth_getBalance", [wallet, "latest"]);
          assert.ok(BigInt(balance) >= 0n);
        },
      },
      options: {
        simulate: false,
        waitForNextBlock: false,
        receiptTimeoutMs: 30_000,
        pollMs: 25,
      },
    });
    assert.equal(result.status, "confirmed", `Anvil route failed at iteration ${iteration}`);
    assert.equal(signed, count);
    assert.equal(result.steps.length, count);
    assert.equal(result.steps.every((step) => step.status === "confirmed"), true);
    assert.equal(await rpc<boolean>("evm_revert", [snapshot]), true);
  }
});
