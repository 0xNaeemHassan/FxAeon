import { getPublicClient } from './clients';
import { positionPoolAddress } from './policy';
import { withReadDeadline } from './readFacade';
import { FX_TOKENS } from './tokens';
import type { FxPublicClient, RouteDetails } from './types';
import { parseStEthPerWstEth } from './wstEthRate';

const WSTETH_RATE_ABI = [{ type: 'function', name: 'stEthPerToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;
const POSITION_STATE_ABI = [{
  type: 'function',
  name: 'getPosition',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: 'rawColls', type: 'uint256' }, { name: 'rawDebts', type: 'uint256' }],
}] as const;

/** Long enough for one read; a plan never waits on these beyond it. */
export const ETH_LONG_ACCOUNTING_DEADLINE_MS = 4_000;

export type EthLongAccounting = Pick<RouteDetails, 'stEthPerWstEth' | 'currentColls'>;

/**
 * Read-only figures an ETH long review needs beside its SDK quote: the live
 * wstETH rate (`wstETH.stEthPerToken()`, the rate the PoolManager's rate
 * provider applies) and, for an existing position whose open/add quote mixes
 * units, the stETH collateral it already holds. Planners start this with the
 * SDK call, so it adds no wait in practice. Each read settles alone and the
 * promise never rejects: a missing figure leaves the review on the quote's
 * native unit, never a guessed rate.
 */
export function readEthLongAccounting(options: {
  heldPositionId?: number;
  client?: Pick<FxPublicClient, 'readContract'>;
  deadlineMs?: number;
} = {}): Promise<EthLongAccounting> {
  try {
    const client = options.client ?? getPublicClient(1);
    const deadline = options.deadlineMs ?? ETH_LONG_ACCOUNTING_DEADLINE_MS;
    const settle = (read: Promise<unknown>) => withReadDeadline(read, deadline).catch(() => undefined);
    const rate = settle(client.readContract({ address: FX_TOKENS.wstETH.address, abi: WSTETH_RATE_ABI, functionName: 'stEthPerToken' }));
    const positionId = options.heldPositionId;
    const held = positionId !== undefined && Number.isSafeInteger(positionId) && positionId > 0
      ? settle(client.readContract({ address: positionPoolAddress('ETH', 'long'), abi: POSITION_STATE_ABI, functionName: 'getPosition', args: [BigInt(positionId)] }))
      : Promise.resolve(undefined);
    return Promise.all([rate, held]).then(([rateValue, state]) => {
      const stEthPerWstEth = parseStEthPerWstEth(rateValue);
      const currentColls = Array.isArray(state) && typeof state[0] === 'bigint' && state[0] >= 0n ? state[0] : undefined;
      return {
        ...(stEthPerWstEth === undefined ? {} : { stEthPerWstEth: stEthPerWstEth.toString() }),
        ...(currentColls === undefined ? {} : { currentColls: currentColls.toString() }),
      };
    }, () => ({}));
  } catch {
    return Promise.resolve({});
  }
}
