import { decodeEventLog, type Address, type TransactionReceipt } from 'viem';

/** Ethereum deployment: Router#Diamond in the official f(x) deployment registry. */
export const POSITION_ROUTER_ADDRESS = '0x33636D49FbefBE798e15e7F356E8DBef543CC708' as Address;

/**
 * Position events emitted by the router's long V2 and short operation facets.
 * Short positions use IPositionOperateFacet.PositionOperate rather than the
 * long-only OpenOrAdd/CloseOrRemove events.
 */
export const POSITION_ROUTER_EVENT_ABI = [
  { type: 'event', name: 'OpenOrAdd', anonymous: false, inputs: [
    { name: 'pool', type: 'address', indexed: false },
    { name: 'position', type: 'uint256', indexed: false },
    { name: 'recipient', type: 'address', indexed: false },
    { name: 'colls', type: 'uint256', indexed: false },
    { name: 'debts', type: 'uint256', indexed: false },
    { name: 'borrows', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'CloseOrRemove', anonymous: false, inputs: [
    { name: 'pool', type: 'address', indexed: false },
    { name: 'position', type: 'uint256', indexed: false },
    { name: 'recipient', type: 'address', indexed: false },
    { name: 'colls', type: 'uint256', indexed: false },
    { name: 'debts', type: 'uint256', indexed: false },
    { name: 'borrows', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'PositionOperate', anonymous: false, inputs: [
    { name: 'pool', type: 'address', indexed: true },
    { name: 'positionId', type: 'uint256', indexed: false },
    { name: 'userCollateralsDelta', type: 'int256', indexed: false },
    { name: 'userDebtsDelta', type: 'int256', indexed: false },
    { name: 'newColl', type: 'int256', indexed: false },
    { name: 'newDebt', type: 'int256', indexed: false },
  ] },
] as const;

export const ERC721_POSITION_TRANSFER_ABI = [{
  type: 'event', name: 'Transfer', anonymous: false, inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'to', type: 'address', indexed: true },
    { name: 'tokenId', type: 'uint256', indexed: true },
  ],
}] as const;

export interface DecodedPositionRouterEvent {
  pool: Address;
  positionId: bigint;
  operation: 'open' | 'close';
  /** Long events identify the recipient; PositionOperate requires a receipt transfer proof. */
  recipient: Address | null;
}

/**
 * Normalize official long and short router events without treating unrelated
 * router logs as history. In the short facet, `newColl`/`newDebt` are signed
 * operation deltas, despite their names: nonzero changes are positive on
 * open/add and negative on reduce/close. Either dimension may remain zero.
 */
export function decodePositionRouterEvent(
  log: TransactionReceipt['logs'][number],
): DecodedPositionRouterEvent | null {
  if (log.removed || log.address.toLowerCase() !== POSITION_ROUTER_ADDRESS.toLowerCase()) return null;
  try {
    const event = decodeEventLog({
      abi: POSITION_ROUTER_EVENT_ABI,
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    if (event.eventName === 'OpenOrAdd') {
      return { pool: event.args.pool, positionId: event.args.position, operation: 'open', recipient: event.args.recipient };
    }
    if (event.eventName === 'CloseOrRemove') {
      return { pool: event.args.pool, positionId: event.args.position, operation: 'close', recipient: event.args.recipient };
    }
    const { newColl, newDebt, userCollateralsDelta, userDebtsDelta } = event.args;
    if (newColl > 0n && newDebt >= 0n
      && userCollateralsDelta < 0n && userDebtsDelta === 0n) {
      return { pool: event.args.pool, positionId: event.args.positionId, operation: 'open', recipient: null };
    }
    if (newColl <= 0n && newDebt <= 0n && (newColl < 0n || newDebt < 0n) && userDebtsDelta === 0n) {
      return { pool: event.args.pool, positionId: event.args.positionId, operation: 'close', recipient: null };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Long events bind the wallet in their recipient field. The short facet's
 * PositionOperate omits it, so bind those rows to the same-receipt ERC-721
 * transfer that the facet performs from the router to its recipient.
 */
export function positionRouterEventMatchesRecipient(
  event: DecodedPositionRouterEvent,
  routerEventLog: TransactionReceipt['logs'][number],
  receiptLogs: TransactionReceipt['logs'],
  walletAddress: Address,
): boolean {
  if (event.recipient) return event.recipient.toLowerCase() === walletAddress.toLowerCase();
  return receiptLogs.some((log) => {
    if (log.removed || log.address.toLowerCase() !== event.pool.toLowerCase()) return false;
    try {
      const transfer = decodeEventLog({
        abi: ERC721_POSITION_TRANSFER_ABI,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      return transfer.eventName === 'Transfer'
        && log.transactionHash.toLowerCase() === routerEventLog.transactionHash.toLowerCase()
        && log.blockNumber === routerEventLog.blockNumber
        && log.blockHash.toLowerCase() === routerEventLog.blockHash.toLowerCase()
        && transfer.args.tokenId === event.positionId
        && transfer.args.from.toLowerCase() === POSITION_ROUTER_ADDRESS.toLowerCase()
        && transfer.args.to.toLowerCase() === walletAddress.toLowerCase();
    } catch {
      return false;
    }
  });
}
