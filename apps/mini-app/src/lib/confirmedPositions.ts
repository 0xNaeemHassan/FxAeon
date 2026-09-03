import type { PositionInfo } from '@aladdindao/fx-sdk';
import {
  decodeEventLog,
  isAddress,
  toEventSelector,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import type { UiPosition } from '../app/trade/fxUi';
import { assertPublicClientChain, getEthereumClient } from './fx/clients';
import { capabilityPolicy, positionPoolAddress } from './fx/policy';
import { getFxSdk } from './fx/sdk';
import type { FxPublicClient, FxSdkFacade, PlannedRoute, PlannedTransaction, TransactionExecutionResult } from './fx/types';
import { validateRoute } from './fx/validation';

/** AFPool's ERC-721 event in the pinned fx-sdk@1.0.5 ABI. Not an ERC-20 transfer. */
export const POSITION_TRANSFER_EVENT = {
  type: 'event',
  name: 'Transfer',
  anonymous: false,
  inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'to', type: 'address', indexed: true },
    { name: 'tokenId', type: 'uint256', indexed: true },
  ],
} as const;

const TRANSFER_TOPIC = toEventSelector(POSITION_TRANSFER_EVENT);
const OWNER_ABI = [{
  type: 'function', name: 'ownerOf', stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }],
}] as const;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_TOPIC = /^0x0{24}[0-9a-fA-F]{40}$/;
const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * JSON-safe discovery hint, never a financial snapshot or ownership proof.
 * Even a well-formed restored hint MUST pass verifyConfirmedPositionHint
 * before it is displayed. The originating wallet is never replaced on restore.
 */
export interface ConfirmedPositionHint {
  version: 1;
  chainId: 1;
  operation: 'increasePosition' | 'depositAndMint';
  walletAddress: Address;
  market: 'ETH' | 'BTC';
  side: 'long' | 'short';
  poolAddress: Address;
  positionId: number;
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
}

export interface ConfirmedPositionReadDependencies {
  client?: Pick<FxPublicClient, 'getChainId' | 'getBlockNumber' | 'getTransactionReceipt' | 'readContract'> & { chain?: { id?: number } };
  sdk?: Pick<FxSdkFacade, 'getPositions'>;
}

/** A lagging RPC cannot disprove an otherwise valid receipt-derived hint. */
export class ConfirmedPositionNotReadyError extends Error {
  constructor() {
    super('The block following the confirmed position transaction is not yet observable; retry verification.');
    this.name = 'ConfirmedPositionNotReadyError';
  }
}

const HINT_KEYS = [
  'version', 'chainId', 'operation', 'walletAddress', 'market', 'side',
  'poolAddress', 'positionId', 'transactionHash', 'blockNumber', 'blockHash',
] as const;

function sameAddress(left: unknown, right: unknown): boolean {
  return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
}

function validAddress(value: unknown): value is Address {
  return typeof value === 'string' && isAddress(value, { strict: false }) && !sameAddress(value, zeroAddress);
}

function validHash(value: unknown): value is Hex {
  return typeof value === 'string' && HASH.test(value) && !/^0x0{64}$/i.test(value);
}

/** Validate every untrusted persisted field, including the canonical pool/side pairing. */
export function parseConfirmedPositionHint(value: unknown, walletAddress?: string): ConfirmedPositionHint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.length !== HINT_KEYS.length || !HINT_KEYS.every((key) => Object.hasOwn(candidate, key))) return null;
  if (candidate.version !== 1 || candidate.chainId !== 1) return null;
  if (candidate.operation !== 'increasePosition' && candidate.operation !== 'depositAndMint') return null;
  if (candidate.market !== 'ETH' && candidate.market !== 'BTC') return null;
  if (candidate.side !== 'long' && candidate.side !== 'short') return null;
  if (candidate.operation === 'depositAndMint' && candidate.side !== 'long') return null;
  if (!validAddress(candidate.walletAddress) || !validAddress(candidate.poolAddress)) return null;
  if (walletAddress !== undefined && (!validAddress(walletAddress) || !sameAddress(candidate.walletAddress, walletAddress))) return null;
  if (!sameAddress(candidate.poolAddress, positionPoolAddress(candidate.market, candidate.side))) return null;
  if (typeof candidate.positionId !== 'number' || !Number.isSafeInteger(candidate.positionId) || candidate.positionId <= 0) return null;
  if (!validHash(candidate.transactionHash) || !validHash(candidate.blockHash)) return null;
  if (typeof candidate.blockNumber !== 'string' || !/^[1-9][0-9]{0,77}$/.test(candidate.blockNumber)) return null;
  if (BigInt(candidate.blockNumber) > MAX_UINT256) return null;
  return {
    version: 1,
    chainId: 1,
    operation: candidate.operation,
    walletAddress: candidate.walletAddress.toLowerCase() as Address,
    market: candidate.market,
    side: candidate.side,
    poolAddress: positionPoolAddress(candidate.market, candidate.side),
    positionId: candidate.positionId,
    transactionHash: candidate.transactionHash.toLowerCase() as Hex,
    blockNumber: candidate.blockNumber,
    blockHash: candidate.blockHash.toLowerCase() as Hex,
  };
}

function actionDestination(operation: ConfirmedPositionHint['operation'], walletAddress: Address): Address | undefined {
  return capabilityPolicy({ operation, walletAddress, chainId: 1 }).allowedActionDestinations?.[0];
}

/**
 * Accept only a direct mint or the canonical router's atomic mint-and-deliver
 * path. Every Transfer at this pool must belong to the same exact NFT path;
 * unrelated IDs, extra hops, or reordered/removed events are not evidence.
 */
function mintedPositionId(
  receipt: TransactionReceipt,
  poolAddress: Address,
  walletAddress: Address,
  actionAddress: Address,
): number | null {
  if (!Array.isArray(receipt.logs)) return null;
  const transfers: Array<{ from: Address; to: Address; tokenId: bigint; logIndex: number }> = [];
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, poolAddress)) continue;
    if (!Array.isArray(log.topics) || !sameAddress(log.topics[0], TRANSFER_TOPIC)) continue;
    if (log.removed || log.topics.length !== 4 || log.data !== '0x') return null;
    if (!log.topics.every((topic) => typeof topic === 'string' && HASH.test(topic))) return null;
    if (!ADDRESS_TOPIC.test(log.topics[1]) || !ADDRESS_TOPIC.test(log.topics[2])) return null;
    if (typeof log.logIndex !== 'number' || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0) return null;
    if (transfers.length >= 2 || (transfers.length > 0 && log.logIndex <= transfers[transfers.length - 1].logIndex)) return null;
    if (!sameAddress(log.transactionHash, receipt.transactionHash)
      || !sameAddress(log.blockHash, receipt.blockHash)
      || log.blockNumber !== receipt.blockNumber) return null;
    try {
      const { args } = decodeEventLog({ abi: [POSITION_TRANSFER_EVENT], data: log.data, topics: log.topics, strict: true });
      if (args.tokenId <= 0n || args.tokenId > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      transfers.push({ from: args.from, to: args.to, tokenId: args.tokenId, logIndex: log.logIndex });
    } catch {
      return null;
    }
  }
  const [mint, delivery] = transfers;
  if (!mint || !sameAddress(mint.from, zeroAddress)) return null;
  if (!delivery) return sameAddress(mint.to, walletAddress) ? Number(mint.tokenId) : null;
  if (!sameAddress(mint.to, actionAddress) || !sameAddress(delivery.from, actionAddress)
    || !sameAddress(delivery.to, walletAddress) || delivery.tokenId !== mint.tokenId) return null;
  return Number(mint.tokenId);
}

function sameTransaction(left: PlannedTransaction, right: PlannedTransaction): boolean {
  return left.chainId === right.chainId && left.operation === right.operation && left.kind === right.kind
    && left.type === right.type && left.nonce === right.nonce && left.value === right.value
    && sameAddress(left.from, right.from) && sameAddress(left.to, right.to) && sameAddress(left.data, right.data);
}

/**
 * Derive only an exact new NFT from the confirmed, reviewed action. Approval
 * receipts, changes to existing IDs, other pools, and wallet switches cannot
 * supply discovery hints. This function does not read or fabricate balances.
 */
export function deriveConfirmedPositionHint(params: {
  route: PlannedRoute;
  result: TransactionExecutionResult;
  walletAddress: string;
}): ConfirmedPositionHint | null {
  const { route, result, walletAddress } = params;
  if (!validAddress(walletAddress) || !sameAddress(route.walletAddress, walletAddress)) return null;
  if (route.chainId !== 1 || result.chainId !== 1 || result.status !== 'confirmed') return null;
  if (route.operation !== 'increasePosition' && route.operation !== 'depositAndMint') return null;
  if (result.operation !== route.operation || !sameAddress(result.walletAddress, walletAddress)) return null;
  const intent = route.policy?.reviewedAction;
  if (!intent) return null;
  if (route.operation === 'increasePosition' && intent.kind !== 'position-increase') return null;
  if (route.operation === 'depositAndMint' && intent.kind !== 'deposit-and-mint') return null;
  if (intent.kind !== 'position-increase' && intent.kind !== 'deposit-and-mint') return null;
  if (intent.positionId !== 0) return null;
  const side = intent.kind === 'position-increase' ? intent.positionType : 'long';
  const market = (['ETH', 'BTC'] as const).find((candidate) => sameAddress(intent.poolAddress, positionPoolAddress(candidate, side)));
  if (!market || !route.policy) return null;
  try {
    validateRoute(route, route.policy);
  } catch {
    return null;
  }
  const actions = route.transactions.filter((transaction) => transaction.kind === 'action');
  if (actions.length !== 1 || actions[0] !== route.transactions.at(-1)) return null;
  const action = actions[0];
  if (!sameAddress(action.to, actionDestination(route.operation, walletAddress))) return null;
  if (result.steps.length !== route.transactions.length) return null;
  let previousBlock = 0n;
  for (let index = 0; index < route.transactions.length; index += 1) {
    const step = result.steps[index];
    if (step.index !== index || step.status !== 'confirmed' || !sameTransaction(step.transaction, route.transactions[index])) return null;
    if (!step.receipt || step.receipt.status !== 'success' || !validHash(step.hash)
      || !sameAddress(step.hash, step.receipt.transactionHash)) return null;
    if (typeof step.receipt.blockNumber !== 'bigint' || step.receipt.blockNumber <= 0n
      || step.receipt.blockNumber < previousBlock || !validHash(step.receipt.blockHash)
      || !sameAddress(step.receipt.from, walletAddress) || !sameAddress(step.receipt.to, step.transaction.to)) return null;
    previousBlock = step.receipt.blockNumber;
  }
  const receipt = result.steps.at(-1)!.receipt!;
  if (typeof receipt.blockNumber !== 'bigint' || receipt.blockNumber <= 0n
    || !validHash(receipt.blockHash) || !sameAddress(receipt.from, walletAddress) || !sameAddress(receipt.to, action.to)) return null;
  const positionId = mintedPositionId(receipt, intent.poolAddress, walletAddress, action.to);
  if (positionId === null) return null;
  return parseConfirmedPositionHint({
    version: 1, chainId: 1, operation: route.operation, walletAddress, market, side,
    poolAddress: intent.poolAddress, positionId, transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
  }, walletAddress);
}

/**
 * A stored hint proves nothing until its successful receipt, original mint,
 * current ownership, and at least one following block are rechecked. RPC
 * failures and a not-yet-observable following block reject so callers retain
 * the retry hint; an invalid, reorged, or no-longer-owned hint returns false.
 */
export async function verifyConfirmedPositionHint(
  hint: ConfirmedPositionHint,
  walletAddress: string,
  dependencies: ConfirmedPositionReadDependencies = {},
): Promise<boolean> {
  const parsed = parseConfirmedPositionHint(hint, walletAddress);
  if (!parsed) return false;
  const client = dependencies.client ?? getEthereumClient();
  await assertPublicClientChain(client, 1);
  const [head, receipt] = await Promise.all([
    client.getBlockNumber({ cacheTime: 0 }),
    client.getTransactionReceipt({ hash: parsed.transactionHash }),
  ]);
  if (receipt.status !== 'success') return false;
  if (typeof head !== 'bigint' || head <= BigInt(parsed.blockNumber)) throw new ConfirmedPositionNotReadyError();
  const actionAddress = actionDestination(parsed.operation, parsed.walletAddress);
  if (!actionAddress) return false;
  if (!sameAddress(receipt.transactionHash, parsed.transactionHash)
    || !sameAddress(receipt.blockHash, parsed.blockHash)
    || receipt.blockNumber !== BigInt(parsed.blockNumber)
    || !sameAddress(receipt.from, parsed.walletAddress)
    || !sameAddress(receipt.to, actionAddress)) return false;
  if (mintedPositionId(receipt, parsed.poolAddress, parsed.walletAddress, actionAddress) !== parsed.positionId) return false;
  const owner = await client.readContract({ address: parsed.poolAddress, abi: OWNER_ABI, functionName: 'ownerOf', args: [BigInt(parsed.positionId)] });
  return sameAddress(owner, parsed.walletAddress);
}

function validPositionInfo(info: PositionInfo, hint: ConfirmedPositionHint): boolean {
  // SDK PositionInfo uses pool accounting symbols, not the editable ERC-20
  // input-token symbols: ETH-long collateral is labelled ETH, whereas
  // ETH-short debt is labelled wstETH. Both accounting amounts remain WAD.
  const collateralToken = hint.side === 'short' ? 'fxUSD' : hint.market === 'ETH' ? 'ETH' : 'WBTC';
  const debtToken = hint.side === 'long' ? 'fxUSD' : hint.market === 'ETH' ? 'wstETH' : 'WBTC';
  return info.positionId === hint.positionId
    && typeof info.rawColls === 'bigint' && typeof info.rawDebts === 'bigint'
    && info.rawColls >= 0n && info.rawColls <= MAX_UINT256 && info.rawDebts >= 0n && info.rawDebts <= MAX_UINT256
    && (info.rawColls > 0n || info.rawDebts > 0n)
    && info.rawCollsToken === collateralToken
    && info.rawDebtsToken === debtToken
    && Number.isInteger(info.rawCollsDecimals) && info.rawCollsDecimals >= 0 && info.rawCollsDecimals <= 255
    && Number.isInteger(info.rawDebtsDecimals) && info.rawDebtsDecimals >= 0 && info.rawDebtsDecimals <= 255
    && Number.isFinite(info.currentLeverage) && info.currentLeverage >= 0
    && Number.isFinite(info.lsdLeverage) && info.lsdLeverage >= 0;
}

/**
 * Hydrate just the proven pool, then select only the proven ID. The pinned
 * SDK has NO explicit-ID getPositions option: it still uses its indexer to
 * discover IDs, so null can mean indexing is pending, not an empty portfolio.
 * No SDK internals, guessed leverage, receipt amounts, or indexer overrides.
 */
export async function readConfirmedPosition(
  hint: ConfirmedPositionHint,
  walletAddress: string,
  dependencies: ConfirmedPositionReadDependencies = {},
): Promise<UiPosition | null> {
  const parsed = parseConfirmedPositionHint(hint, walletAddress);
  if (!parsed || !await verifyConfirmedPositionHint(parsed, walletAddress, dependencies)) return null;
  const sdk = dependencies.sdk ?? getFxSdk();
  const positions = await sdk.getPositions({ userAddress: parsed.walletAddress, market: parsed.market, type: parsed.side });
  if (!Array.isArray(positions)) return null;
  const matches = positions.filter((info) => info && info.positionId === parsed.positionId);
  if (matches.length !== 1 || !validPositionInfo(matches[0], parsed)) return null;
  // Indexer/network reads may be slow; do not hydrate an NFT transferred or a
  // receipt reorged while the SDK response was in flight.
  if (!await verifyConfirmedPositionHint(parsed, walletAddress, dependencies)) return null;
  return { market: parsed.market, side: parsed.side, info: matches[0] };
}
