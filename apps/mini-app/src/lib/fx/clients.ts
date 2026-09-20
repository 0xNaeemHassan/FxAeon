import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { publicActionsL2 } from "viem/op-stack";
import { base, mainnet } from "viem/chains";
import { BASE_CHAIN_ID, ETHEREUM_CHAIN_ID, requireRpcUrl } from "./config";
import type { FxChainId } from "./types";
import type { FxPublicClient } from "./types";

let ethereumClient: FxPublicClient | undefined;
let baseClient: FxPublicClient | undefined;

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
  const chain = expectedChainId === ETHEREUM_CHAIN_ID ? mainnet : base;
  const probe = createPublicClient({ chain, transport: http(rpcUrl) }) as unknown as FxPublicClient;
  await assertPublicClientChain(probe, expectedChainId);
}

export async function assertConfiguredPublicClientChain(chainId: FxChainId): Promise<void> {
  await assertPublicClientChain(getPublicClient(chainId), chainId);
}

/** One read client per supported chain; no browser signer is stored here. */
export function getPublicClient(chainId: FxChainId): FxPublicClient {
  if (chainId === ETHEREUM_CHAIN_ID) {
    if (!ethereumClient) {
      const rpcUrl = requireRpcUrl(ETHEREUM_CHAIN_ID);
      ethereumClient = createPublicClient({
        chain: mainnet,
        transport: http(rpcUrl),
      }) as unknown as FxPublicClient;
    }
    return ethereumClient;
  }

  if (!baseClient) {
    const rpcUrl = requireRpcUrl(BASE_CHAIN_ID);
    const client = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
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
