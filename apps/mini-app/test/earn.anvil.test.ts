import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import {
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";
import {
  planDepositFxSave,
  planRedeem,
  planWithdrawFxSave,
} from "../src/lib/fx/service";
import { getFxSdk } from "../src/lib/fx/sdk";
import { runTransactionRoute, waitForReceipt } from "../src/lib/fx/runner";
import { FX_TOKENS } from "../src/lib/fx/tokens";
import type { FxPublicClient, PlannedRoute } from "../src/lib/fx/types";

const configuredRpc = process.env.ANVIL_RPC_URL?.trim();
const configuredSuite = process.env.FX_ANVIL_SUITE?.trim().toLowerCase() || "protocol";
const runEarnProof = configuredSuite === "earn" || configuredSuite === "all";
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
  ) throw new Error("ANVIL_RPC_URL must point to localhost without credentials or query parameters");
  return parsed.toString().replace(/\/$/, "");
})();

const client = rpcUrl
  ? createPublicClient({ chain: mainnet, transport: http(rpcUrl, { timeout: 120_000 }) }) as unknown as FxPublicClient
  : undefined;

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function transfer(address recipient,uint256 amount) returns (bool)",
]);
const FXSAVE_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
]);
const INSTANT_REDEEM_ABI = parseAbi([
  "function instantRedeemFromFxSave((address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) fxusdParams,(address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) usdcParams,uint256 amount,address receiver)",
]);
const CONVERTER_ABI = parseAbi([
  "function queryConvert(uint256 amount,uint256 encoding,uint256[] routes) returns (uint256 amountOut)",
]);
const BASE_POOL_EVENTS_ABI = parseAbi([
  "event InstantRedeem(address indexed caller,address indexed receiver,uint256 amountSharesToRedeem,uint256 amountYieldTokenOut,uint256 amountStableTokenOut)",
  "event Redeem(address indexed caller,address indexed receiver,uint256 amountSharesToRedeem,uint256 amountYieldTokenOut,uint256 amountStableTokenOut)",
  "event RequestRedeem(address indexed caller,uint256 shares,uint256 unlockAt)",
]);
const FXSAVE_EVENTS_ABI = parseAbi([
  "event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)",
]);
const TRANSFER_EVENT = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
])[0];

const usdc = FX_TOKENS.USDC.address;
const fxUsd = FX_TOKENS.fxUSD.address;
const basePool = FX_TOKENS.fxUSDBasePool.address;
const fxSave = FX_TOKENS.fxSAVE.address;
const router = "0x33636D49FbefBE798e15e7F356E8DBef543CC708" as Address;
const converter = "0x12AF4529129303D7FbD2563E242C4a2890525912" as Address;
const donorCandidates = [
  "0xc3d688b66703497daa19211eedff47f25384cdc3",
  "0xf977814e90da44bfa03b6295a0616a897441acec",
  "0x55fe002aeff02f77364de339a1292923a15844b8",
] as const satisfies readonly Address[];

async function rpc<T = unknown>(method: string, params: readonly unknown[] = []): Promise<T> {
  if (!rpcUrl) throw new Error("ANVIL_RPC_URL is not configured");
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Anvil RPC HTTP ${response.status}`);
  const payload = await response.json() as { result?: T; error?: { message?: string; data?: unknown } };
  if (payload.error) {
    const data = payload.error.data;
    const suffix = typeof data === "string" && data.length <= 256 ? ` data=${data}` : "";
    throw new Error(`Anvil RPC error: ${payload.error.message ?? "unknown error"}${suffix}`);
  }
  return payload.result as T;
}

function quantity(value: bigint): Hex {
  return `0x${value.toString(16)}` as Hex;
}

async function fundUsdc(recipient: Address, amount: bigint): Promise<{ donor: "redacted"; hash: Hex }> {
  assert.ok(client);
  const before = await client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [recipient] });
  let donor: Address | undefined;
  for (const candidate of donorCandidates) {
    const balance = await client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [candidate] });
    if (balance >= amount) {
      donor = candidate;
      break;
    }
  }
  assert.ok(donor, "no reviewed USDC donor has enough balance at this fork block");
  await rpc("anvil_impersonateAccount", [donor]);
  let hash: Hex;
  try {
    await rpc("anvil_setBalance", [donor, quantity(10n ** 19n)]);
    hash = await rpc<Hex>("eth_sendTransaction", [{
      from: donor,
      to: usdc,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [recipient, amount] }),
      value: "0x0",
    }]);
    const receipt = await waitForReceipt({ client, hash, timeoutMs: 60_000, pollMs: 100 });
    assert.equal(receipt.status, "success", "fork-only USDC funding reverted");
    await rpc("anvil_mine", ["0x1"]);
  } finally {
    await rpc("anvil_stopImpersonatingAccount", [donor]);
  }
  const after = await client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [recipient] });
  assert.equal(after - before, amount, "disposable wallet did not receive exact USDC fixture");
  return { donor: "redacted", hash };
}

async function runRoute(route: PlannedRoute): Promise<Array<{ kind: string; hash: Hex; blockNumber: string }>> {
  assert.ok(client);
  let lastGasEvidence: { estimate: bigint; limit: bigint } | undefined;
  assert.equal(route.chainId, 1);
  const result = await runTransactionRoute({
    route,
    publicClient: client,
    callbacks: {
      requestSignature: async (request) => {
        // Anvil's automatic limit can equal the estimate exactly.  The fork's
        // direct fxSAVE ERC-4626 redeem performs nested base-pool accounting
        // whose execution path can consume a few more units than that exact
        // estimate.  Keep the production simulation gate above, then obtain a
        // fresh estimate for the exact reviewed calldata and add deterministic
        // transport-only headroom.  A failed estimate still fails closed.
        const estimate = BigInt(await rpc<string>("eth_estimateGas", [{
          from: request.from,
          to: request.to,
          data: request.data,
          value: quantity(request.value),
          nonce: quantity(BigInt(request.nonce)),
        }]));
        assert.ok(estimate > 0n, "fork gas estimate must be positive");
        const limit = estimate + (estimate / 5n) + 50_000n;
        lastGasEvidence = { estimate, limit };
        const hash = await rpc<Hex>("eth_sendTransaction", [{
          from: request.from,
          to: request.to,
          data: request.data,
          value: quantity(request.value),
          nonce: quantity(BigInt(request.nonce)),
          gas: quantity(limit),
        }]);
        await waitForReceipt({ client, hash, timeoutMs: 120_000, pollMs: 100 });
        // runTransactionRoute's post-confirm read gate requires a distinct
        // block after every receipt. Anvil only mines on demand here; this is
        // a real empty fork block, never a synthetic receipt.
        await rpc("anvil_mine", ["0x1"]);
        return hash;
      },
    },
    options: { simulate: true, waitForNextBlock: true, receiptTimeoutMs: 120_000, pollMs: 100 },
  });
  if (result.status !== "confirmed") {
    const failedStep = [...result.steps].reverse().find((step) => step.status === "failed");
    if (failedStep?.hash) {
      let trace: unknown;
      let callProbe: unknown;
      try {
        trace = summarizeTrace(await rpc("debug_traceTransaction", [failedStep.hash, { tracer: "callTracer" }]));
      } catch (error) {
        trace = { unavailable: error instanceof Error ? error.message : String(error) };
      }
      try {
        const blockNumber = failedStep.receipt?.blockNumber;
        assert.ok(blockNumber !== undefined && blockNumber > 0n);
        await rpc("eth_call", [{
          from: failedStep.transaction.from,
          to: failedStep.transaction.to,
          data: failedStep.transaction.data,
          value: quantity(failedStep.transaction.value),
        }, quantity(blockNumber - 1n)]);
        callProbe = { success: true };
      } catch (error) {
        callProbe = { error: error instanceof Error ? error.message : String(error) };
      }
      const receipt = failedStep.receipt;
      console.error(JSON.stringify({
        earnFailure: route.operation,
        step: failedStep.index,
        receipt: receipt ? {
          status: receipt.status,
          gasUsed: receipt.gasUsed.toString(),
          blockNumber: receipt.blockNumber.toString(),
          gasEstimate: lastGasEvidence?.estimate.toString(),
          gasLimit: lastGasEvidence?.limit.toString(),
        } : null,
        callProbe,
        trace,
      }));
    }
  }
  assert.equal(result.status, "confirmed", `${route.operation} did not confirm: ${result.error ?? "unknown error"}`);
  assert.ok(result.steps.length > 0, `${route.operation} returned no executable steps`);
  return result.steps.map((step) => {
    assert.equal(step.status, "confirmed", `${route.operation} step did not confirm`);
    assert.ok(step.hash && step.receipt, `${route.operation} step lacks receipt evidence`);
    assert.equal(step.receipt.status, "success");
    return { kind: step.transaction.kind, hash: step.hash, blockNumber: step.receipt.blockNumber.toString() };
  });
}

async function transferEvents(fromBlock: bigint, toBlock: bigint, address: Address, from: Address, to: Address): Promise<number> {
  assert.ok(client);
  const logs = await client.getLogs({ address, event: TRANSFER_EVENT, fromBlock, toBlock, args: { from, to } });
  return logs.length;
}

async function queryConvert(amount: bigint, encoding: bigint, routes: readonly bigint[]): Promise<bigint> {
  assert.ok(client);
  return await client.readContract({
    address: converter,
    abi: CONVERTER_ABI,
    functionName: "queryConvert",
    args: [amount, encoding, [...routes]],
  }) as bigint;
}

async function economicConvert(amount: bigint, encoding: bigint, routes: readonly bigint[]): Promise<bigint> {
  // MultiPathConverter.queryConvert returns zero for the SDK's explicit
  // identity route, while the router's identity branch transfers the input
  // amount unchanged.  Keep raw queryConvert for SDK min-out evidence; use
  // the protocol-semantic amount here for total gross-output conservation.
  if (encoding === 0n && routes.length === 0) return amount;
  return queryConvert(amount, encoding, routes);
}

function summarizeTrace(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object") return undefined;
  const trace = value as { error?: unknown; failed?: unknown; gas?: unknown; returnValue?: unknown; calls?: unknown };
  const summary: Record<string, unknown> = {};
  for (const key of ["error", "failed", "gas", "returnValue"] as const) {
    if (trace[key] !== undefined) {
      const item = trace[key];
      summary[key] = typeof item === "string" && item.length > 128 ? `${item.slice(0, 128)}…` : item;
    }
  }
  if (depth < 4 && Array.isArray(trace.calls)) {
    summary.calls = trace.calls.map((call) => summarizeTrace(call, depth + 1));
  }
  return summary;
}

async function writeManifest(manifest: unknown): Promise<void> {
  const configuredPath = process.env.FX_ANVIL_EARN_MANIFEST_PATH?.trim()
    || process.env.FX_ANVIL_MANIFEST_PATH?.trim()
    || resolve(process.cwd(), "../../artifacts/anvil/earn-proof.json");
  const manifestPath = resolve(configuredPath);
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, manifestPath);
}

async function atForkClock<T>(forkTimestamp: number, action: () => Promise<T>): Promise<T> {
  const originalDateNow = Date.now;
  Date.now = () => forkTimestamp * 1000;
  try {
    return await action();
  } finally {
    Date.now = originalDateNow;
  }
}

test("earn proof: official fxSAVE deposit, redemption, cooldown, and claim on Anvil", {
  skip: !rpcUrl || !runEarnProof,
}, async () => {
  assert.ok(client);
  assert.equal(await rpc<string>("eth_chainId"), "0x1");
  assert.match(await rpc<string>("web3_clientVersion"), /anvil/i);
  const wallet = (await rpc<Address[]>("eth_accounts"))[0];
  assert.ok(wallet, "Anvil must expose an unlocked disposable wallet");
  await rpc("anvil_setBalance", [wallet, quantity(5n * 10n ** 18n)]);
  const forkBlock = BigInt(await rpc<string>("eth_blockNumber"));
  if (process.env.ANVIL_FORK_BLOCK?.trim()) {
    assert.equal(forkBlock, BigInt(process.env.ANVIL_FORK_BLOCK), "fork block is not pinned");
  }
  const snapshot = await rpc<string>("evm_snapshot");
  const forkHeader = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [quantity(forkBlock), false]);
  const forkTimestamp = Number(BigInt(forkHeader.timestamp));
  assert.ok(Number.isSafeInteger(forkTimestamp) && forkTimestamp > 0);
  const sdk = getFxSdk();
  const transactions: Array<{ operation: string; token?: string; transactions: Array<{ kind: string; hash: Hex; blockNumber: string }> }> = [];
  let manifest: unknown;
  let snapshotRestored = false;
  try {
    const funding = parseUnits(process.env.FX_ANVIL_EARN_USDC ?? "1000", 6);
    const fundingEvidence = await fundUsdc(wallet, funding);
    const configBefore = await sdk.getFxSaveConfig({});
    assert.ok(configBefore.cooldownPeriodSeconds > 0n, "fxSAVE cooldown must be positive");
    assert.ok(configBefore.instantRedeemFeeRatio > 0n, "instant redemption fee must be positive");
    const initialUsdc = await client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    const initialFxUsd = await client.readContract({ address: fxUsd, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    const initialBasePool = await client.readContract({ address: basePool, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    const initialShares = await client.readContract({ address: fxSave, abi: FXSAVE_ABI, functionName: "balanceOf", args: [wallet] });
    assert.equal(initialShares, 0n, "fresh Anvil account unexpectedly owns fxSAVE shares");

    const depositRoute = await planDepositFxSave({ userAddress: wallet, tokenIn: "usdc", amount: funding, slippage: 1 });
    assert.equal(depositRoute.policy?.reviewedAction?.kind, "fxsave-deposit");
    const depositFromBlock = await client.getBlockNumber();
    const depositTxs = await runRoute(depositRoute);
    const depositToBlock = await client.getBlockNumber();
    const sharesAfterDeposit = await client.readContract({ address: fxSave, abi: FXSAVE_ABI, functionName: "balanceOf", args: [wallet] });
    assert.ok(sharesAfterDeposit > 0n);
    const afterDepositUsdc = await client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    assert.equal(initialUsdc - afterDepositUsdc, funding, "USDC deposit did not consume the exact funded amount");
    assert.ok(await transferEvents(depositFromBlock, depositToBlock, usdc, wallet, router) > 0, "deposit approval/action emitted no USDC transfer");
    transactions.push({ operation: "depositFxSave", token: "usdc", transactions: depositTxs });
    const configAfterDeposit = await sdk.getFxSaveConfig({});
    assert.ok(configAfterDeposit.totalSupplyWei > configBefore.totalSupplyWei);
    assert.ok(configAfterDeposit.totalAssetsWei > configBefore.totalAssetsWei);

    const instantShares = sharesAfterDeposit / 5n;
    assert.ok(instantShares > 0n);
    const instantBeforeUsdc = await client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    const instantBeforeShares = await client.readContract({ address: fxSave, abi: FXSAVE_ABI, functionName: "balanceOf", args: [wallet] });
    const instantRoute = await planWithdrawFxSave({ userAddress: wallet, tokenOut: "usdc", amount: instantShares, instant: true, slippage: 1 });
    assert.ok((instantRoute.details?.economicLimits ?? []).length >= 2, "instant route lost fee-adjusted minimum outputs");
    const instantAction = instantRoute.transactions.find((transaction) => (
      transaction.kind === "action" && transaction.to.toLowerCase() === router.toLowerCase()
    ));
    assert.ok(instantAction, "instant route did not include the SDK instant redeem action");
    const instantDecoded = decodeFunctionData({ abi: INSTANT_REDEEM_ABI, data: instantAction.data });
    assert.equal(instantDecoded.functionName, "instantRedeemFromFxSave");
    const [fxusdParams, usdcParams, decodedInstantShares] = instantDecoded.args;
    assert.equal(decodedInstantShares, instantShares);
    const indexForInstant = await client.readContract({ address: fxSave, abi: FXSAVE_ABI, functionName: "convertToAssets", args: [10n ** 18n] });
    const instantBasePoolShares = indexForInstant > 0n ? (instantShares * indexForInstant) / (10n ** 18n) : instantShares;
    const [grossYield, grossStable] = await client.readContract({ address: basePool, abi: parseAbi(["function previewRedeem(uint256 shares) view returns (uint256 yieldOut,uint256 stableOut)"]), functionName: "previewRedeem", args: [instantBasePoolShares] });
    const feePrecision = 10n ** 18n;
    const feeRatio = configBefore.instantRedeemFeeRatio;
    const netYield = (grossYield * (feePrecision - feeRatio)) / feePrecision;
    const netStable = (grossStable * (feePrecision - feeRatio)) / feePrecision;
    const quotedYieldToUsdc = await queryConvert(netYield, fxusdParams.encodings, fxusdParams.routes);
    const quotedStableToUsdc = await queryConvert(netStable, usdcParams.encodings, usdcParams.routes);
    const grossYieldToUsdc = await economicConvert(grossYield, fxusdParams.encodings, fxusdParams.routes);
    const grossStableToUsdc = await economicConvert(grossStable, usdcParams.encodings, usdcParams.routes);
    const instantFromBlock = await client.getBlockNumber();
    assert.equal(fxusdParams.minOut, (quotedYieldToUsdc * 9900n) / 10000n, "SDK fxUSD leg quote is not fee/slippage adjusted");
    assert.equal(usdcParams.minOut, (quotedStableToUsdc * 9900n) / 10000n, "SDK USDC leg quote is not fee/slippage adjusted");
    const instantTxs = await runRoute(instantRoute);
    const instantActionReceipt = instantTxs.find((transaction) => transaction.kind === "action");
    const instantActionHash = instantActionReceipt?.hash;
    assert.ok(instantActionHash, "instant route action receipt is missing");
    assert.ok(instantActionReceipt, "instant route action block is missing");
    // The SDK plans with a share-index read taken before the approval and
    // action are mined.  The vault index can accrue between those blocks, so
    // prove the event against the exact pre-state of the action transaction.
    // This also uses the vault's canonical convertToAssets rounding instead
    // of reconstructing it from convertToAssets(1e18).
    const instantActionBlock = BigInt(instantActionReceipt.blockNumber);
    assert.ok(instantActionBlock > 0n);
    const instantExecutionStateBlock = instantActionBlock - 1n;
    const instantExecutionBasePoolShares = await client.readContract({
      address: fxSave,
      abi: FXSAVE_ABI,
      functionName: "convertToAssets",
      args: [instantShares],
      blockNumber: instantExecutionStateBlock,
    });
    const [instantExecutionGrossYield, instantExecutionGrossStable] = await client.readContract({
      address: basePool,
      abi: parseAbi(["function previewRedeem(uint256 shares) view returns (uint256 yieldOut,uint256 stableOut)"]),
      functionName: "previewRedeem",
      args: [instantExecutionBasePoolShares],
      blockNumber: instantExecutionStateBlock,
    });
    const instantExecutionFeeRatio = await client.readContract({
      address: basePool,
      abi: parseAbi(["function instantRedeemFeeRatio() view returns (uint256)"]),
      functionName: "instantRedeemFeeRatio",
      blockNumber: instantExecutionStateBlock,
    });
    // BasePool applies the fee as a separately floored amount, then
    // subtracts it.  This is intentionally distinct from the SDK's quote
    // helper (which floors gross * (1 - fee)); the two can differ by one wei.
    const instantExecutionNetYield = instantExecutionGrossYield - ((instantExecutionGrossYield * instantExecutionFeeRatio) / feePrecision);
    const instantExecutionNetStable = instantExecutionGrossStable - ((instantExecutionGrossStable * instantExecutionFeeRatio) / feePrecision);
    const instantEvents = await client.getLogs({ address: basePool, event: BASE_POOL_EVENTS_ABI[0], fromBlock: instantFromBlock, toBlock: await client.getBlockNumber() });
    const instantEvent = instantEvents.find((event) => event.transactionHash?.toLowerCase() === instantActionHash.toLowerCase());
    assert.ok(instantEvent, "instant redemption did not emit the canonical base-pool event");
    const { amountSharesToRedeem: instantEventShares, amountYieldTokenOut: instantEventYield, amountStableTokenOut: instantEventStable } = instantEvent.args;
    assert.ok(instantEventShares !== undefined && instantEventYield !== undefined && instantEventStable !== undefined, "instant event is missing canonical output arguments");
    assert.equal(instantEventShares, instantExecutionBasePoolShares, "instant event amount does not match action-block vault conversion");
    assert.equal(instantEventYield, instantExecutionNetYield, "instant event yield output does not apply configured fee");
    assert.equal(instantEventStable, instantExecutionNetStable, "instant event stable output does not apply configured fee");
    const instantAfterUsdc = await client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    const instantAfterShares = await client.readContract({ address: fxSave, abi: FXSAVE_ABI, functionName: "balanceOf", args: [wallet] });
    assert.ok(instantAfterUsdc > instantBeforeUsdc, "instant redemption returned no USDC");
    assert.ok(instantAfterUsdc - instantBeforeUsdc >= fxusdParams.minOut + usdcParams.minOut, "instant output fell below SDK fee-adjusted minimums");
    assert.ok(instantAfterUsdc - instantBeforeUsdc < grossYieldToUsdc + grossStableToUsdc, "instant redemption did not reflect the configured fee");
    assert.equal(instantBeforeShares - instantAfterShares, instantShares, "instant redemption burned unexpected shares");
    transactions.push({ operation: "withdrawFxSave.instant", token: "usdc", transactions: instantTxs });

    const directRedeemCandidate = instantAfterShares / 8n;
    const directRedeemLimit = await client.readContract({ address: fxSave, abi: FXSAVE_ABI, functionName: "maxRedeem", args: [wallet] });
    const directRedeemShares = directRedeemCandidate < directRedeemLimit ? directRedeemCandidate : directRedeemLimit;
    assert.ok(directRedeemShares > 0n);
    const directBeforeBasePool = await client.readContract({ address: basePool, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    const directRedeemRoute = await planWithdrawFxSave({ userAddress: wallet, tokenOut: "fxUSDBasePool", amount: directRedeemShares, instant: false });
    const directRedeemFromBlock = await client.getBlockNumber();
    const directRedeemTxs = await runRoute(directRedeemRoute);
    const directRedeemActionHash = directRedeemTxs.find((transaction) => transaction.kind === "action")?.hash;
    assert.ok(directRedeemActionHash, "direct redemption action receipt is missing");
    const directRedeemEvents = await client.getLogs({ address: fxSave, event: FXSAVE_EVENTS_ABI[0], fromBlock: directRedeemFromBlock, toBlock: await client.getBlockNumber() });
    const directRedeemEvent = directRedeemEvents.find((event) => event.transactionHash?.toLowerCase() === directRedeemActionHash.toLowerCase());
    assert.ok(directRedeemEvent, "direct fxSAVE redemption did not emit the canonical vault Withdraw event");
    const { receiver: directEventReceiver, owner: directEventOwner, shares: directEventShares, assets: directEventAssets } = directRedeemEvent.args;
    assert.ok(directEventReceiver && directEventOwner && directEventShares !== undefined && directEventAssets !== undefined, "direct Withdraw event is missing canonical arguments");
    assert.equal(directEventReceiver.toLowerCase(), wallet.toLowerCase());
    assert.equal(directEventOwner.toLowerCase(), wallet.toLowerCase());
    assert.equal(directEventShares, directRedeemShares);
    const directAfterBasePool = await client.readContract({ address: basePool, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    assert.ok(directAfterBasePool > directBeforeBasePool, "direct fxSAVE redeem returned no base-pool shares");
    const directBasePoolAmount = directEventAssets;
    assert.equal(directAfterBasePool - directBeforeBasePool, directBasePoolAmount, "direct fxSAVE redemption event assets differ from received base-pool shares");
    transactions.push({ operation: "withdrawFxSave.directBasePool", token: "fxUSDBasePool", transactions: directRedeemTxs });

    const directDepositBeforeShares = await client.readContract({ address: fxSave, abi: FXSAVE_ABI, functionName: "balanceOf", args: [wallet] });
    const directDepositRoute = await planDepositFxSave({ userAddress: wallet, tokenIn: "fxUSDBasePool", amount: directBasePoolAmount });
    const directDepositTxs = await runRoute(directDepositRoute);
    const directDepositAfterShares = await client.readContract({ address: fxSave, abi: FXSAVE_ABI, functionName: "balanceOf", args: [wallet] });
    assert.equal(
      await client.readContract({ address: basePool, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] }),
      directBeforeBasePool,
      "direct base-pool deposit did not consume exact shares",
    );
    assert.ok(directDepositAfterShares > directDepositBeforeShares);
    transactions.push({ operation: "depositFxSave.directBasePool", token: "fxUSDBasePool", transactions: directDepositTxs });

    const queuedShares = directDepositAfterShares / 3n;
    assert.ok(queuedShares > 0n);
    const queuedBeforeShares = directDepositAfterShares;
    const queuedRoute = await planWithdrawFxSave({ userAddress: wallet, tokenOut: "fxUSD", amount: queuedShares, instant: false });
    const queuedFromBlock = await client.getBlockNumber();
    const queuedTxs = await runRoute(queuedRoute);
    const queuedActionHash = queuedTxs.find((transaction) => transaction.kind === "action")?.hash;
    assert.ok(queuedActionHash, "queued route action receipt is missing");
    const queuedActionReceipt = queuedTxs.find((transaction) => transaction.kind === "action");
    assert.ok(queuedActionReceipt, "queued route action block is missing");
    const queuedActionBlock = BigInt(queuedActionReceipt.blockNumber);
    assert.ok(queuedActionBlock > 0n);
    const queuedExecutionStateBlock = queuedActionBlock - 1n;
    const queuedExecutionBasePoolShares = await client.readContract({
      address: fxSave,
      abi: FXSAVE_ABI,
      functionName: "convertToAssets",
      args: [queuedShares],
      blockNumber: queuedExecutionStateBlock,
    });
    const queuedEvents = await client.getLogs({ address: basePool, event: BASE_POOL_EVENTS_ABI[2], fromBlock: queuedFromBlock, toBlock: await client.getBlockNumber() });
    const queuedEvent = queuedEvents.find((event) => event.transactionHash?.toLowerCase() === queuedActionHash.toLowerCase());
    assert.ok(queuedEvent, "queued redemption did not emit the canonical base-pool event");
    assert.equal(queuedEvent.args.shares, queuedExecutionBasePoolShares, "base-pool request event must use action-block base-pool share units");
    const queuedBasePoolShares = queuedEvent.args.shares;
    const queuedAfterShares = await client.readContract({ address: fxSave, abi: FXSAVE_ABI, functionName: "balanceOf", args: [wallet] });
    assert.equal(queuedBeforeShares - queuedAfterShares, queuedShares);
    const queuedStatus = await atForkClock(forkTimestamp, () => sdk.getFxSaveRedeemStatus({ userAddress: wallet }));
    assert.equal(queuedStatus.hasPendingRedeem, true);
    assert.equal(queuedStatus.pendingSharesWei, queuedBasePoolShares, "SDK pending amount must equal vault-converted base-pool shares");
    assert.equal(queuedStatus.isCooldownComplete, false);
    assert.ok(queuedStatus.redeemableAt && queuedStatus.redeemableAt > forkTimestamp);
    const claimableBefore = await atForkClock(forkTimestamp, () => sdk.getFxSaveClaimable({ userAddress: wallet }));
    assert.ok(claimableBefore.previewReceive?.amountYieldOutWei && claimableBefore.previewReceive.amountYieldOutWei > 0n);
    assert.ok(claimableBefore.previewReceive?.amountStableOutWei && claimableBefore.previewReceive.amountStableOutWei > 0n);
    transactions.push({ operation: "withdrawFxSave.queued", token: "fxUSD", transactions: queuedTxs });

    await rpc("evm_increaseTime", [Number(queuedStatus.cooldownPeriodSeconds) + 1]);
    await rpc("evm_mine", []);
    const advancedHeader = await rpc<{ timestamp: string }>("eth_getBlockByNumber", ["latest", false]);
    const advancedTimestamp = Number(BigInt(advancedHeader.timestamp));
    const claimableReady = await atForkClock(advancedTimestamp, () => sdk.getFxSaveClaimable({ userAddress: wallet }));
    assert.equal(claimableReady.hasPendingRedeem, true);
    assert.equal(claimableReady.isCooldownComplete, true);
    const claimBeforeFxUsd = await client.readContract({ address: fxUsd, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    const claimBeforeUsdc = await client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    const claimRoute = await planRedeem({ userAddress: wallet });
    const claimFromBlock = await client.getBlockNumber();
    const claimTxs = await runRoute(claimRoute);
    const claimActionHash = claimTxs.find((transaction) => transaction.kind === "action")?.hash;
    assert.ok(claimActionHash, "claim action receipt is missing");
    const claimEvents = await client.getLogs({ address: basePool, event: BASE_POOL_EVENTS_ABI[1], fromBlock: claimFromBlock, toBlock: await client.getBlockNumber() });
    assert.ok(claimEvents.some((event) => event.transactionHash?.toLowerCase() === claimActionHash.toLowerCase()), "claim did not emit the canonical base-pool redeem event");
    const claimAfterFxUsd = await client.readContract({ address: fxUsd, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    const claimAfterUsdc = await client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    assert.equal(claimableReady.previewReceive?.amountYieldOutWei, claimAfterFxUsd - claimBeforeFxUsd);
    assert.equal(claimableReady.previewReceive?.amountStableOutWei, claimAfterUsdc - claimBeforeUsdc);
    const finalStatus = await sdk.getFxSaveRedeemStatus({ userAddress: wallet });
    assert.equal(finalStatus.hasPendingRedeem, false);
    transactions.push({ operation: "getRedeemTx", transactions: claimTxs });

    const claimedFxUsd = claimAfterFxUsd - claimBeforeFxUsd;
    assert.ok(claimedFxUsd > 0n, "claim returned no fxUSD for the SDK deposit leg");
    const fxUsdDepositBeforeShares = await client.readContract({ address: fxSave, abi: FXSAVE_ABI, functionName: "balanceOf", args: [wallet] });
    const fxUsdDepositRoute = await planDepositFxSave({ userAddress: wallet, tokenIn: "fxUSD", amount: claimedFxUsd, slippage: 1 });
    const fxUsdDepositTxs = await runRoute(fxUsdDepositRoute);
    const fxUsdDepositAfterShares = await client.readContract({ address: fxSave, abi: FXSAVE_ABI, functionName: "balanceOf", args: [wallet] });
    assert.ok(fxUsdDepositAfterShares > fxUsdDepositBeforeShares, "claimed fxUSD did not produce fxSAVE shares");
    assert.equal(await client.readContract({ address: fxUsd, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] }), 0n, "fxUSD deposit did not consume the claimed amount");
    transactions.push({ operation: "depositFxSave.fxUSD", token: "fxUSD", transactions: fxUsdDepositTxs });

    const finalShares = await client.readContract({ address: fxSave, abi: FXSAVE_ABI, functionName: "balanceOf", args: [wallet] });
    assert.equal(finalShares, fxUsdDepositAfterShares);
    const finalUsdc = await client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] });
    assert.equal(finalUsdc - afterDepositUsdc, (instantAfterUsdc - instantBeforeUsdc) + (claimAfterUsdc - claimBeforeUsdc), "USDC balance conservation across instant/queued claim failed");
    assert.ok((await client.getLogs({ address: fxSave, event: TRANSFER_EVENT, fromBlock: forkBlock, toBlock: await client.getBlockNumber(), args: { to: wallet } })).length > 0, "fxSAVE emitted no authoritative share transfer events");
    manifest = {
      schemaVersion: 1,
      proof: "fxaeon-real-fxsave-fork",
      chainId: 1,
      fork: { requestedBlock: process.env.ANVIL_FORK_BLOCK?.trim() || null, initialBlock: forkBlock.toString(), finalBlock: (await client.getBlockNumber()).toString() },
      wallet: { role: "disposable-anvil-account-0", address: wallet },
      funding: { asset: "USDC", amount: funding.toString(), source: "reviewed high-balance holder impersonated only inside the fork", donorAddress: fundingEvidence.donor },
      config: { cooldownPeriodSeconds: configBefore.cooldownPeriodSeconds.toString(), instantRedeemFeeRatio: configBefore.instantRedeemFeeRatio.toString() },
      feeEvidence: {
        instantRedeemFeeRatio: feeRatio.toString(),
        grossYield: grossYield.toString(), grossStable: grossStable.toString(),
        feeAdjustedYield: netYield.toString(), feeAdjustedStable: netStable.toString(),
        executionGrossYield: instantExecutionGrossYield.toString(),
        executionGrossStable: instantExecutionGrossStable.toString(),
        executionFeeAdjustedYield: instantExecutionNetYield.toString(),
        executionFeeAdjustedStable: instantExecutionNetStable.toString(),
        eventShares: instantEventShares.toString(),
        eventYield: instantEventYield.toString(),
        eventStable: instantEventStable.toString(),
        quotedYieldToUsdc: quotedYieldToUsdc.toString(), quotedStableToUsdc: quotedStableToUsdc.toString(),
        actualUsdc: (instantAfterUsdc - instantBeforeUsdc).toString(),
      },
      assertions: {
        sdkDeposit: true, instantWithdraw: true, queuedWithdraw: true, cooldownObserved: true, claim: true,
        directBasePoolDeposit: true, directBasePoolRedeem: true, balancesVerified: true, sharesVerified: true,
        eventsVerified: true, feesVerified: true, snapshotRevertedAfterProof: true,
        initialBalances: { usdc: initialUsdc.toString(), fxUSD: initialFxUsd.toString(), fxUSDBasePool: initialBasePool.toString() },
      },
      receipts: { funding: fundingEvidence.hash },
      actions: transactions,
      redactions: ["upstream RPC URL", "provider credential", "impersonated donor address", "Anvil private keys"],
    };
  } finally {
    snapshotRestored = await rpc<boolean>("evm_revert", [snapshot]);
  }
  assert.equal(snapshotRestored, true, "fxSAVE proof snapshot did not revert");
  assert.ok(manifest, "fxSAVE proof manifest was not assembled");
  await writeManifest(manifest);
});
