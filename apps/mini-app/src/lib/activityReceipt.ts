import type { Hex } from 'viem';
import { assertPublicClientChain, getPublicClient } from './fx/clients';
import type { FxChainId, FxPublicClient } from './fx/types';
export async function loadActivityReceipt(chainId: FxChainId, hash: Hex, client: FxPublicClient = getPublicClient(chainId)) {
  await assertPublicClientChain(client, chainId);
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== 'success' && receipt.status !== 'reverted') throw new Error('Receipt status unavailable');
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || !receipt.blockHash || receipt.blockNumber === null) throw new Error('Receipt unavailable');
  const head = await client.getBlockNumber({ cacheTime: 0 });
  if (head < receipt.blockNumber + 1n) throw new Error('Confirming');
  const final = await client.getTransactionReceipt({ hash });
  if (final.transactionHash.toLowerCase() !== hash.toLowerCase() || final.blockHash !== receipt.blockHash || final.blockNumber !== receipt.blockNumber || final.status !== receipt.status) throw new Error('Receipt changed');
  if (typeof final.gasUsed !== 'bigint' || final.gasUsed < 0n || typeof final.effectiveGasPrice !== 'bigint' || final.effectiveGasPrice < 0n) throw new Error('Receipt cost unavailable');
  return { status: final.status === 'success' ? 'confirmed' as const : 'failed' as const, executionCost: final.gasUsed * final.effectiveGasPrice };
}
