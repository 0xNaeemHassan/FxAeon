import {
  createPublicClient,
  http,
  fallback,
  shouldThrow as viemShouldThrow,
  type Address,
  type Hex,
} from "viem";
import { publicActionsL2 } from "viem/op-stack";
import { base, mainnet } from "viem/chains";
import { BASE_CHAIN_ID, ETHEREUM_CHAIN_ID, assertSupportedChainId, configuredRpcUrls, isLocalForkMode } from "./config";
import type { FxChainId } from "./types";
import type { FxPublicClient } from "./types";

let ethereumClient: FxPublicClient | undefined;
let baseClient: FxPublicClient | undefined;
const RPC_REQUEST_TIMEOUT_MS = 5_000;
// A local Anvil fork may need longer to answer oracle and multicall reads
// while it fills its state cache. Hosted RPC requests keep the shorter limit.
const LOCAL_FORK_RPC_REQUEST_TIMEOUT_MS = 60_000;
const LOCAL_FORK_CHAIN_PROBE_TIMEOUT_MS = 10_000;
const RPC_ENDPOINT_COOLDOWN_MS = 5_000;
const RPC_ENDPOINTS_PER_FETCH = new WeakMap<typeof fetch, Map<string, { verifiedUntil: number; verification?: Promise<void>; cooldownUntil: number }>>();

function isLocalForkEndpoint(rpcUrl: string): boolean {
  if (!isLocalForkMode()) return false;
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(rpcUrl).hostname);
  } catch {
    return false;
  }
}

function shouldStopRpcFallback(error: Error): boolean {
  if (viemShouldThrow(error)) return true;
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== "object") break;
    const item = current as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
    const message = typeof item.message === "string" ? item.message : "";
    if (/execution reverted|revert(?:ed)?|user rejected|transaction rejected/i.test(message)) return true;
    if (item.code === 4001 || item.code === 4100 || item.code === 4200) return true;
    current = item.cause;
  }
  return false;
}

function chainBoundFetch(expectedChainId: FxChainId, rpcUrl: string, fetchFn: typeof fetch) {
  let states = RPC_ENDPOINTS_PER_FETCH.get(fetchFn);
  if (!states) {
    states = new Map();
    RPC_ENDPOINTS_PER_FETCH.set(fetchFn, states);
  }
  const state = states.get(`${expectedChainId}:${rpcUrl}`) ?? { verifiedUntil: 0, cooldownUntil: 0 };
  states.set(`${expectedChainId}:${rpcUrl}`, state);
  const localFork = isLocalForkEndpoint(rpcUrl);
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (state.cooldownUntil > Date.now()) {
      const error = new Error("RPC endpoint is cooling down after an upstream failure");
      error.name = "HttpRequestError";
      throw error;
    }
    try {
      if (state.verifiedUntil <= Date.now()) {
        state.verification ??= (async () => {
          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(),
            localFork ? LOCAL_FORK_CHAIN_PROBE_TIMEOUT_MS : 1_500,
          );
          try {
            const probe = await fetchFn(rpcUrl, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
              signal: controller.signal,
            });
            if (!probe.ok) throw new Error("RPC chain identity probe failed");
            const payload = await probe.json() as { result?: unknown };
            if (payload.result !== `0x${expectedChainId.toString(16)}`) {
              throw new Error(`RPC endpoint did not prove chain ${expectedChainId}`);
            }
            state.verifiedUntil = Date.now() + 60_000;
          } finally {
            clearTimeout(timer);
          }
        })();
        try { await state.verification; } finally { state.verification = undefined; }
      }
      const response = await fetchFn(input, init);
      if (response.status === 429 || response.status >= 500) state.cooldownUntil = Date.now() + RPC_ENDPOINT_COOLDOWN_MS;
      return response;
    } catch (error) {
      state.cooldownUntil = Date.now() + RPC_ENDPOINT_COOLDOWN_MS;
      throw error;
    }
  };
}

/** Share bounded, chain-pinned HTTP failover across viem read clients. */
export function getRpcTransport(urls: readonly string[], chainId: FxChainId, fetchFn: typeof fetch = fetch) {
  assertSupportedChainId(chainId);
  if (urls.length === 0) throw new Error("at least one reviewed RPC URL is required");
  const transports = urls.map((url) => http(url, {
    timeout: isLocalForkEndpoint(url) ? LOCAL_FORK_RPC_REQUEST_TIMEOUT_MS : RPC_REQUEST_TIMEOUT_MS,
    retryCount: 0,
    fetchFn: chainBoundFetch(chainId, url, fetchFn),
  }));
  return transports.length === 1 ? transports[0] : fallback(transports, {
    retryCount: 0,
    retryDelay: 0,
    shouldThrow: shouldStopRpcFallback,
  });
}

const L1_BLOCK_ADDRESS = "0x4200000000000000000000000000000000000015" as Address;
const L1_BLOCK_OPERATOR_ABI = [
  {
    type: "function",
    name: "operatorFeeScalar",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint32" }],
  },
  {
    type: "function",
    name: "operatorFeeConstant",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
] as const;

/**
 * Prove the remote endpoint's chain identity with eth_chainId. A viem `chain`
 * object is request metadata, not evidence about the server behind an RPC URL.
 * Call this at financial planning, signing, and recovery boundaries.
 */
export async function assertPublicClientChain(
  client: Pick<FxPublicClient, "getChainId"> & { chain?: { id?: number } },
  expectedChainId: FxChainId,
): Promise<void> {
  if (typeof client.getChainId !== "function") {
    throw new Error(`RPC client cannot prove chain identity; expected ${expectedChainId}`);
  }
  const remoteChainId = await client.getChainId();
  if (!Number.isSafeInteger(remoteChainId) || remoteChainId !== expectedChainId) {
    throw new Error(`RPC endpoint returned chain ${String(remoteChainId)}; expected ${expectedChainId}`);
  }
  if (client.chain?.id !== undefined && client.chain.id !== expectedChainId) {
    throw new Error(`public client metadata is for chain ${client.chain.id}; expected ${expectedChainId}`);
  }
}

/** Probe the exact request-local URL used by the SDK bridge methods. */
export async function assertRpcUrlChain(
  rpcUrl: string,
  expectedChainId: FxChainId,
): Promise<void> {
  assertSupportedChainId(expectedChainId);
  const chain = expectedChainId === ETHEREUM_CHAIN_ID ? mainnet : base;
  const probe = createPublicClient({ chain, transport: getRpcTransport([rpcUrl], expectedChainId) }) as unknown as FxPublicClient;
  await assertPublicClientChain(probe, expectedChainId);
}

export async function assertConfiguredPublicClientChain(chainId: FxChainId): Promise<void> {
  await assertPublicClientChain(getPublicClient(chainId), chainId);
}

/** One read client per supported chain; no browser signer is stored here. */
export function getPublicClient(chainId: FxChainId): FxPublicClient {
  assertSupportedChainId(chainId);
  if (chainId === ETHEREUM_CHAIN_ID) {
    if (!ethereumClient) {
      const rpcUrls = configuredRpcUrls(ETHEREUM_CHAIN_ID);
      ethereumClient = createPublicClient({
        chain: mainnet,
        transport: getRpcTransport(rpcUrls, ETHEREUM_CHAIN_ID),
      }) as unknown as FxPublicClient;
    }
    return ethereumClient;
  }

  if (!baseClient) {
    const rpcUrls = configuredRpcUrls(BASE_CHAIN_ID);
    const client = createPublicClient({
      chain: base,
      transport: getRpcTransport(rpcUrls, BASE_CHAIN_ID),
    }).extend(publicActionsL2()) as unknown as FxPublicClient;
    // viem's convenience action intentionally converts any operator predeploy
    // read failure to 0n (it treats the error as a pre-Isthmus chain). That is
    // unsafe for a cost certificate: a provider outage must remain partial.
    // Probe bytecode first, then read both parameters strictly so only an
    // absent predeploy is represented as a genuine zero fee.
    client.estimateOperatorFee = async (args: {
      account?: Address;
      to: Address;
      data?: Hex;
      value?: bigint;
      maxFeePerGas?: bigint;
      maxPriorityFeePerGas?: bigint;
    }): Promise<bigint> => {
      const bytecode = await client.getBytecode({ address: L1_BLOCK_ADDRESS });
      if (bytecode === undefined) throw new Error("could not verify the Base L1Block predeploy");
      if (!bytecode || bytecode === "0x") return 0n;
      const [scalar, constant] = await Promise.all([
        client.readContract({ address: L1_BLOCK_ADDRESS, abi: L1_BLOCK_OPERATOR_ABI, functionName: "operatorFeeScalar" }),
        client.readContract({ address: L1_BLOCK_ADDRESS, abi: L1_BLOCK_OPERATOR_ABI, functionName: "operatorFeeConstant" }),
      ]);
      const estimateGas = client.estimateGas;
      if (!estimateGas) throw new Error("Base RPC client does not expose estimateGas");
      const gasUsed = await estimateGas(args);
      return (gasUsed * BigInt(scalar)) / 1_000_000n + BigInt(constant);
    };
    baseClient = client;
  }
  return baseClient;
}

export function getEthereumClient(): FxPublicClient {
  return getPublicClient(ETHEREUM_CHAIN_ID);
}

export function getBaseClient(): FxPublicClient {
  return getPublicClient(BASE_CHAIN_ID);
}

/**
 * Test-only reset. It intentionally lives in this module rather than exposing
 * mutable client state to product code. Never call it from the Mini App.
 */
export function resetPublicClientForTests(): void {
  ethereumClient = undefined;
  baseClient = undefined;
}
