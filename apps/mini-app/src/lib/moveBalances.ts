import type { Address } from 'viem';
import { formatUnits } from 'viem';
import {
  assertAddress,
  assertPublicClientChain,
  getPublicClient,
  resolveBridgeApprovalTokenAddress,
  resolveBridgeTokenAddress,
  type FxChainId,
  type FxPublicClient,
} from '@/lib/fx';

export const CANONICAL_MOVE_ASSETS = ['fxUSD', 'fxSAVE'] as const;
export type CanonicalMoveAsset = (typeof CANONICAL_MOVE_ASSETS)[number];

const ERC20_BALANCE_ABI = [{
  type: 'function',
  name: 'balanceOf',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

export type CanonicalMoveBalance =
  | { status: 'ready'; amount: string }
  | { status: 'unavailable'; reason: string };

export type CanonicalMoveBalanceMap = Readonly<Record<CanonicalMoveAsset, CanonicalMoveBalance>>;

export function canonicalMoveSourceTokenAddress(token: CanonicalMoveAsset, chainId: FxChainId): Address {
  // Ethereum routes approve the underlying ERC-20; Base routes hold the
  // canonical OFT itself. This mirrors the route planner's exact resolver.
  return chainId === 1
    ? resolveBridgeApprovalTokenAddress(token, chainId)
    : resolveBridgeTokenAddress(token, chainId);
}

type BalanceClient = Pick<FxPublicClient, 'getChainId' | 'readContract'> & { chain?: { id?: number } };

export async function readCanonicalMoveBalances({
  walletAddress,
  sourceChainId,
  client = getPublicClient(sourceChainId),
}: {
  walletAddress: string;
  sourceChainId: FxChainId;
  client?: BalanceClient;
}): Promise<{ balances: CanonicalMoveBalanceMap; status: 'ready' | 'unavailable' }> {
  const owner = assertAddress(walletAddress, 'selected wallet');
  await assertPublicClientChain(client, sourceChainId);
  const settled = await Promise.allSettled(CANONICAL_MOVE_ASSETS.map((token) => client.readContract({
    address: canonicalMoveSourceTokenAddress(token, sourceChainId),
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [owner],
  })));
  const next = {} as Record<CanonicalMoveAsset, CanonicalMoveBalance>;
  let successful = 0;
  settled.forEach((result, index) => {
    const token = CANONICAL_MOVE_ASSETS[index];
    if (result.status === 'fulfilled') {
      successful += 1;
      next[token] = { status: 'ready', amount: formatUnits(result.value as bigint, 18) };
    } else {
      next[token] = { status: 'unavailable', reason: 'This source balance could not be read.' };
    }
  });
  return { balances: next, status: successful > 0 ? 'ready' : 'unavailable' };
}

/** Scope asynchronous Move balance reads to one wallet/chain context. */
export function createMoveBalanceReadGuard() {
  let active = true;
  let generation = 0;
  let pending = false;
  return {
    begin: (force = false): number | null => {
      if (!active || (pending && !force)) return null;
      if (force && pending) generation += 1;
      pending = true;
      return ++generation;
    },
    isCurrent: (request: number): boolean => active && request === generation,
    finish: (request: number): void => {
      if (active && request === generation) pending = false;
    },
    activate: (): void => {
      if (active) return;
      active = true;
      pending = false;
      generation += 1;
    },
    invalidate: (): void => { active = false; pending = false; generation += 1; },
  };
}
