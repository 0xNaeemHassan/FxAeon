import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";
import { planIncreasePosition } from "../src/lib/fx/service";
import { clampLeverage, readLeverageBounds } from "../src/lib/fx/leverage";
import { positionPoolAddress } from "../src/lib/fx/policy";
import { tokenAddress, type UiMarket, type UiSide } from "../src/app/trade/fxUi";
import { clearPendingHashJournalForTests } from "../src/lib/fx/journal";
import { runTransactionRoute, waitForReceipt } from "../src/lib/fx/runner";
import type { FxPublicClient, PlannedRoute, TransactionPolicy } from "../src/lib/fx/types";

const configuredRpc = process.env.ANVIL_RPC_URL?.trim();
const configuredSuite = process.env.FX_ANVIL_SUITE?.trim().toLowerCase() || "protocol";
if (!(["protocol", "stress", "all"] as const).includes(configuredSuite as "protocol" | "stress" | "all")) {
  throw new Error("FX_ANVIL_SUITE must be protocol, stress, or all");
}
const runProtocolProof = configuredSuite === "protocol" || configuredSuite === "all";
const runStressCampaign = configuredSuite === "stress" || configuredSuite === "all";
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

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

const POSITION_POOL_ABI = [
  {
    type: "function",
    name: "getNextPositionId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "getPosition",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "rawColls", type: "uint256" },
      { name: "rawDebts", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
] as const;

const USDC_DONOR_CANDIDATES = [
  // Compound III USDC, Binance 8, and Circle treasury.
  "0xc3d688b66703497daa19211eedff47f25384cdc3",
  "0xf977814e90da44bfa03b6295a0616a897441acec",
  "0x55fe002aeff02f77364de339a1292923a15844b8",
] as const satisfies readonly Address[];

async function fundWithUsdc(params: {
  publicClient: FxPublicClient;
  recipient: Address;
  amount: bigint;
}): Promise<void> {
  const usdc = tokenAddress("USDC");
  const recipientBalanceBefore = await params.publicClient.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [params.recipient],
  });
  let donor: Address | undefined;
  for (const candidate of USDC_DONOR_CANDIDATES) {
    const balance = await params.publicClient.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [candidate],
    });
    if (balance >= params.amount) {
      donor = candidate;
      break;
    }
  }
  assert.ok(donor, "no reviewed USDC donor has enough balance at this fork block");

  await rpc("anvil_impersonateAccount", [donor]);
  try {
    await rpc("anvil_setBalance", [donor, hexQuantity(10n * 10n ** 18n)]);
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [params.recipient, params.amount],
    });
    const hash = await rpc<Hex>("eth_sendTransaction", [{
      from: donor,
      to: usdc,
      data,
      value: "0x0",
    }]);
    const receipt = await waitForReceipt({
      client: params.publicClient,
      hash,
      timeoutMs: 60_000,
      pollMs: 100,
    });
    assert.equal(receipt.status, "success", "local USDC funding transaction reverted");
  } finally {
    await rpc("anvil_stopImpersonatingAccount", [donor]);
  }

  const fundedBalance = await params.publicClient.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [params.recipient],
  });
  assert.equal(
    fundedBalance - recipientBalanceBefore,
    params.amount,
    "disposable wallet did not receive the exact requested USDC fixture",
  );
}

interface ProtocolPositionProof {
  market: UiMarket;
  side: UiSide;
  pool: Address;
  positionId: number;
  leverage: number;
  rawCollateral: string;
  rawDebt: string;
  transactions: Array<{
    kind: string;
    hash: Hex;
    blockNumber: string;
  }>;
}

async function writeProtocolManifest(manifest: unknown): Promise<void> {
  const configuredPath = process.env.FX_ANVIL_MANIFEST_PATH?.trim();
  if (!configuredPath) return;
  const manifestPath = resolve(configuredPath);
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, manifestPath);
}

test.beforeEach(() => clearPendingHashJournalForTests());
test.afterEach(() => clearPendingHashJournalForTests());

test("stress: Anvil fork proves Ethereum identity and survives randomized snapshot controls", { skip: !rpcUrl || !runStressCampaign }, async () => {
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

test("stress: runner executes randomized dummy routes against the local Anvil fork", { skip: !rpcUrl || !runStressCampaign }, async () => {
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

test("protocol proof: official SDK opens coexisting ETH/BTC long and short positions", { skip: !rpcUrl || !runProtocolProof }, async () => {
  assert.equal(await rpc<string>("eth_chainId"), "0x1", "protocol proof must run on an Ethereum-mainnet fork");
  const accounts = await rpc<Address[]>("eth_accounts");
  assert.ok(accounts.length >= 1, "Anvil must expose an unlocked disposable wallet");
  const wallet = accounts[0];
  const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) }) as unknown as FxPublicClient;
  const fixtureAmount = parseUnits(process.env.FX_ANVIL_POSITION_USDC ?? "1000", 6);
  assert.ok(fixtureAmount > 0n, "FX_ANVIL_POSITION_USDC must be a positive USDC amount");
  const scenarios: Array<{ market: UiMarket; side: UiSide }> = [
    { market: "ETH", side: "long" },
    { market: "ETH", side: "short" },
    { market: "BTC", side: "long" },
    { market: "BTC", side: "short" },
  ];
  const forkBlock = BigInt(await rpc<string>("eth_blockNumber"));
  const requestedForkBlock = process.env.ANVIL_FORK_BLOCK?.trim();
  if (requestedForkBlock) {
    assert.equal(forkBlock, BigInt(requestedForkBlock), "Anvil did not start from the requested pinned fork block");
  }
  const snapshot = await rpc<string>("evm_snapshot");
  let manifest: unknown;

  try {
    await fundWithUsdc({
      publicClient,
      recipient: wallet,
      amount: fixtureAmount * BigInt(scenarios.length),
    });

    const positions: ProtocolPositionProof[] = [];
    for (const scenario of scenarios) {
      const pool = positionPoolAddress(scenario.market, scenario.side);
      const expectedPositionId = Number(await publicClient.readContract({
        address: pool,
        abi: POSITION_POOL_ABI,
        functionName: "getNextPositionId",
      }));
      assert.ok(Number.isSafeInteger(expectedPositionId) && expectedPositionId > 0, `${scenario.market} ${scenario.side} returned an invalid next position ID`);

      const leverageBounds = await readLeverageBounds(scenario.market, scenario.side, publicClient);
      assert.equal(leverageBounds.source, "live", `${scenario.market} ${scenario.side} leverage bounds were not read from the fork`);
      const leverage = clampLeverage(scenario.side === "short" ? 0.5 : 2, leverageBounds);
      const routes = await planIncreasePosition({
        market: scenario.market,
        type: scenario.side,
        positionId: 0,
        // Short requests use LSD leverage; 0.5x maps to 1.5x total protocol
        // leverage and leaves generous room inside the live debt-ratio range.
        leverage,
        inputTokenAddress: tokenAddress("USDC"),
        amount: fixtureAmount,
        slippage: 1,
        userAddress: wallet,
      });
      assert.ok(routes.length > 0, `${scenario.market} ${scenario.side} returned no audited SDK route`);

      const result = await runTransactionRoute({
        route: routes[0],
        publicClient,
        callbacks: {
          requestSignature: (request) => rpc<Hex>("eth_sendTransaction", [{
            from: request.from,
            to: request.to,
            data: request.data,
            value: hexQuantity(request.value),
            nonce: hexQuantity(BigInt(request.nonce)),
          }]),
        },
        options: {
          receiptTimeoutMs: 120_000,
          pollMs: 100,
          // Anvil mines every submitted transaction immediately. Mine the
          // post-confirmation boundary explicitly below so slow fork reads do
          // not advance protocol time while an SDK route is being assembled.
          waitForNextBlock: false,
        },
      });
      assert.equal(result.status, "confirmed", `${scenario.market} ${scenario.side} route did not confirm: ${result.error ?? "unknown error"}`);
      assert.equal(result.steps.every((step) => step.status === "confirmed" && step.receipt?.status === "success"), true);
      const transactions = result.steps.map((step) => {
        assert.ok(step.hash, `${scenario.market} ${scenario.side} route step is missing its transaction hash`);
        assert.ok(step.receipt, `${scenario.market} ${scenario.side} route step is missing its receipt`);
        return {
          kind: step.transaction.kind,
          hash: step.hash,
          blockNumber: step.receipt.blockNumber.toString(),
        };
      });

      await rpc("anvil_mine", ["0x1"]);

      const owner = await publicClient.readContract({
        address: pool,
        abi: POSITION_POOL_ABI,
        functionName: "ownerOf",
        args: [BigInt(expectedPositionId)],
      });
      assert.equal(owner.toLowerCase(), wallet.toLowerCase(), `${scenario.market} ${scenario.side} position owner mismatch`);
      const [rawCollateral, rawDebt] = await publicClient.readContract({
        address: pool,
        abi: POSITION_POOL_ABI,
        functionName: "getPosition",
        args: [BigInt(expectedPositionId)],
      });
      assert.ok(rawCollateral > 0n, `${scenario.market} ${scenario.side} position has no collateral`);
      assert.ok(rawDebt > 0n, `${scenario.market} ${scenario.side} position has no debt`);
      const nextPositionId = Number(await publicClient.readContract({
        address: pool,
        abi: POSITION_POOL_ABI,
        functionName: "getNextPositionId",
      }));
      assert.equal(nextPositionId, expectedPositionId + 1, `${scenario.market} ${scenario.side} position counter did not advance exactly once`);
      positions.push({
        market: scenario.market,
        side: scenario.side,
        pool,
        positionId: expectedPositionId,
        leverage,
        rawCollateral: rawCollateral.toString(),
        rawDebt: rawDebt.toString(),
        transactions,
      });
    }

    assert.equal(positions.length, 4, "real protocol proof must create all four market/side combinations");
    assert.equal(new Set(positions.map((position) => `${position.market}:${position.side}`)).size, 4, "protocol proof contains duplicate scenarios");
    assert.equal(new Set(positions.map((position) => position.pool.toLowerCase())).size, 4, "protocol proof must use four distinct pools");

    // Re-read every position only after all four actions have completed. This
    // proves they coexist in one fork snapshot rather than passing as four
    // isolated fixtures that are reverted between scenarios.
    for (const position of positions) {
      const owner = await publicClient.readContract({
        address: position.pool,
        abi: POSITION_POOL_ABI,
        functionName: "ownerOf",
        args: [BigInt(position.positionId)],
      });
      assert.equal(owner.toLowerCase(), wallet.toLowerCase(), `${position.market} ${position.side} did not coexist under the disposable wallet`);
      const [rawCollateral, rawDebt] = await publicClient.readContract({
        address: position.pool,
        abi: POSITION_POOL_ABI,
        functionName: "getPosition",
        args: [BigInt(position.positionId)],
      });
      assert.equal(rawCollateral.toString(), position.rawCollateral, `${position.market} ${position.side} collateral changed before coexistence verification`);
      assert.equal(rawDebt.toString(), position.rawDebt, `${position.market} ${position.side} debt changed before coexistence verification`);
    }

    manifest = {
      schemaVersion: 1,
      proof: "fxaeon-real-fx-position-fork",
      generatedAt: new Date().toISOString(),
      chainId: 1,
      fork: {
        requestedBlock: process.env.ANVIL_FORK_BLOCK?.trim() || null,
        initialBlock: forkBlock.toString(),
        finalBlock: (await publicClient.getBlockNumber()).toString(),
      },
      wallet: {
        role: "disposable-anvil-account-0",
        address: wallet,
      },
      funding: {
        asset: "USDC",
        amountPerPosition: fixtureAmount.toString(),
        source: "reviewed high-balance holder impersonated only inside the fork",
        donorAddress: "redacted",
      },
      assertions: {
        scenarioCount: positions.length,
        allFourScenarios: true,
        coexistingInSingleSnapshot: true,
        ownershipVerified: true,
        nonzeroCollateralAndDebtVerified: true,
        snapshotRevertedAfterProof: true,
      },
      positions,
      redactions: ["upstream RPC URL", "upstream provider credential", "impersonated donor address", "Anvil private keys"],
    };
  } finally {
    assert.equal(await rpc<boolean>("evm_revert", [snapshot]), true, "real-position fixture snapshot did not revert");
  }
  assert.ok(manifest, "protocol proof manifest was not assembled");
  await writeProtocolManifest(manifest);
});
