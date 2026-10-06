import type { Address } from 'viem';
import {
  canonicalToken,
  classifyActivity,
  type ActivityClassification,
  type ActivityStatus,
  type ActivityTransferInput,
} from './activityClassification';
import type { ActivityCall } from './activityCalls';
import { compactAddress } from './addressPresentation';
import type { RecoveryViewModel } from './fx/recovery';
import type { ProtocolPositionActivity } from './protocolPositionHistory';
import type { WalletPositionTransfer, WalletTransfer } from './walletTransferHistory';

export type WalletActivity = {
  id: string;
  chainId: 1 | 8453;
  hash: string;
  timestamp: number;
  title: string;
  /** Lead token symbol, kept for older consumers; the classification owns the icons. */
  symbol: string;
  status: ActivityStatus;
  statusLabel: string;
  recovery?: RecoveryViewModel;
  positions: ProtocolPositionActivity[];
  transfers: WalletTransfer[];
  positionTransfers: WalletPositionTransfer[];
  call?: ActivityCall;
  classification: ActivityClassification;
  /** Only unverified tokens moved and the wallet did not send the transaction. */
  spamSuspect: boolean;
};

export type WalletActivityEvidence = {
  /** f(x) position NFT movements; they explain rows but never create one. */
  positionTransfers?: readonly WalletPositionTransfer[];
  /** Calldata for transactions without a journal record, keyed by `${chainId}:${hash}`. */
  calls?: Readonly<Record<string, ActivityCall | null | undefined>>;
};

const OPERATION_TITLES: Record<string, string> = {
  increasePosition: 'Open position', reducePosition: 'Reduce position', adjustPositionLeverage: 'Adjust leverage',
  depositAndMint: 'Borrow fxUSD', repayAndWithdraw: 'Repay', depositFxSave: 'Deposit fxSAVE',
  withdrawFxSave: 'Withdraw fxSAVE', getRedeemTx: 'Claim fxSAVE', buildBridgeTx: 'Bridge',
};

/** User-facing title for an unsubmitted draft's SDK operation; unknown operations never leak method names. */
export function operationTitle(operation: string): string {
  return OPERATION_TITLES[operation] ?? 'Transaction';
}

type Group = {
  id: string;
  chainId: 1 | 8453;
  hash: string;
  blockTime?: number;
  view?: RecoveryViewModel;
  positions: ProtocolPositionActivity[];
  transfers: WalletTransfer[];
  nfts: WalletPositionTransfer[];
};

const activityId = (chainId: number, hash: string) => `${chainId}:${hash.toLowerCase()}`;

/** Transactions that need calldata to be explained: every row without a journal record. */
export function activityCallRequests(
  views: readonly RecoveryViewModel[],
  positions: readonly ProtocolPositionActivity[],
  transfers: readonly WalletTransfer[],
): { chainId: 1 | 8453; hash: string }[] {
  const journal = new Set(views.map((view) => activityId(view.record.chainId, view.record.hash)));
  const requests = new Map<string, { chainId: 1 | 8453; hash: string }>();
  for (const item of [...positions, ...transfers]) {
    const id = activityId(item.chainId, item.hash);
    if (!journal.has(id) && !requests.has(id)) requests.set(id, { chainId: item.chainId, hash: item.hash.toLowerCase() });
  }
  return [...requests.values()];
}

function transferInputs(group: Group, wallet: string): ActivityTransferInput[] {
  const indexed = group.transfers.map((transfer): ActivityTransferInput => {
    const out = transfer.from.toLowerCase() === wallet;
    return {
      token: transfer.tokenAddress,
      symbol: transfer.symbol,
      decimals: transfer.decimals ?? null,
      amountRaw: transfer.amountRaw,
      direction: out ? 'out' : 'in',
      counterparty: out ? transfer.to : transfer.from,
      // Rows from before the unverified-token index only ever held canonical assets.
      verified: transfer.verified !== false,
    };
  });
  if (indexed.length) return indexed;
  const view = group.view;
  if (!view) return [];
  const { record } = view;
  if (view.status === 'confirmed' && view.verification === 'receipt') {
    // The index has not reached this transaction: use the receipt's own ERC-20 logs.
    const facts = (view.receiptTransfers ?? []).map((fact): ActivityTransferInput => {
      const canonical = canonicalToken(record.chainId, fact.token);
      const out = fact.from.toLowerCase() === wallet;
      return { token: fact.token, symbol: canonical?.symbol ?? compactAddress(fact.token), decimals: canonical?.decimals ?? null,
        amountRaw: fact.amountRaw, direction: out ? 'out' : 'in', counterparty: out ? fact.to : fact.from, verified: Boolean(canonical) };
    });
    if (view.receiptNativeValueWei && view.receiptNativeValueWei > 0n) {
      facts.push({ token: null, symbol: 'ETH', decimals: 18, amountRaw: view.receiptNativeValueWei, direction: 'out', counterparty: record.to, verified: true });
    }
    return facts;
  }
  if (view.status !== 'pending') return [];
  // A submitted transaction shows what it will move: its native value and, for a bridge, the bridged amount.
  const pending: ActivityTransferInput[] = [];
  const bridge = record.bridge;
  if (bridge && (bridge.bridgeToken === 'fxUSD' || bridge.bridgeToken === 'fxSAVE') && /^[1-9][0-9]*$/.test(bridge.amountLD)) {
    // Both canonical bridge tokens use 18 local decimals; the OFT address is only a netting key.
    pending.push({ token: bridge.sourceOftAddress, symbol: bridge.bridgeToken, decimals: 18, amountRaw: BigInt(bridge.amountLD), direction: 'out', counterparty: record.to, verified: true });
  }
  const value = record.valueWei && /^[0-9]+$/.test(record.valueWei) ? BigInt(record.valueWei) : 0n;
  if (value > 0n) pending.push({ token: null, symbol: 'ETH', decimals: 18, amountRaw: value, direction: 'out', counterparty: record.to, verified: true });
  return pending;
}

function statusOf(group: Group): { status: ActivityStatus; statusLabel: string } {
  const view = group.view;
  if (!view) return group.positions.length ? { status: 'confirmed', statusLabel: 'Confirmed' } : { status: 'indexed', statusLabel: '' };
  const { record } = view;
  if (view.status === 'failed') return { status: 'failed', statusLabel: 'Failed' };
  if (view.status === 'confirmed') {
    return { status: 'confirmed', statusLabel: record.stepKind === 'approval' ? 'Approved' : record.bridge ? 'Source confirmed' : 'Confirmed' };
  }
  return { status: 'pending', statusLabel: view.verification === 'confirming' ? 'Confirming' : 'Submitted' };
}

function toActivity(group: Group, walletAddress: string, calls: WalletActivityEvidence['calls']): WalletActivity {
  const wallet = walletAddress.toLowerCase();
  const { status, statusLabel } = statusOf(group);
  const view = group.view;
  const record = view?.record;
  const indexedCall = !view ? calls?.[group.id] ?? undefined : undefined;
  const classification = classifyActivity({
    chainId: group.chainId,
    hash: group.hash,
    timestamp: group.blockTime ?? record?.submittedAt ?? 0,
    wallet: walletAddress as Address,
    status,
    call: record
      ? { from: record.walletAddress, to: record.to, input: view?.transactionInput ?? null, value: record.valueWei && /^[0-9]+$/.test(record.valueWei) ? BigInt(record.valueWei) : null }
      : indexedCall ? { from: indexedCall.from, to: indexedCall.to, input: indexedCall.input, value: indexedCall.value } : undefined,
    journal: record ? {
      intent: record.intent,
      operation: record.operation,
      stepKind: record.stepKind,
      to: record.to,
      ...(record.bridge ? { bridge: { destinationChainId: record.bridge.destinationChainId, bridgeToken: record.bridge.bridgeToken } } : {}),
    } : undefined,
    protocol: group.positions.map((position) => ({ market: position.market, side: position.side, kind: position.kind, positionId: position.positionId })),
    nfts: group.nfts.map((nft) => {
      const out = nft.from.toLowerCase() === wallet;
      return { pool: nft.pool, tokenId: nft.tokenId, direction: out ? 'out' as const : 'in' as const, counterparty: out ? nft.to : nft.from };
    }),
    transfers: transferInputs(group, wallet),
  });
  return {
    id: group.id,
    chainId: group.chainId,
    hash: group.hash,
    timestamp: group.blockTime ?? record?.submittedAt ?? 0,
    title: classification.title,
    symbol: classification.icons[0] ?? 'ETH',
    status,
    statusLabel,
    ...(view ? { recovery: view } : {}),
    positions: group.positions,
    transfers: group.transfers,
    positionTransfers: group.nfts,
    ...(indexedCall ? { call: indexedCall } : {}),
    classification,
    spamSuspect: classification.spamSuspect,
  };
}

/**
 * One explained row per chain/hash. The journal's receipt status is never
 * overridden by an index, an approval never inherits its route's action, and
 * position NFT movements only add evidence to rows that already exist.
 */
export function mergeWalletActivity(
  views: readonly RecoveryViewModel[],
  positions: readonly ProtocolPositionActivity[],
  transfers: readonly WalletTransfer[] = [],
  walletAddress = '',
  evidence: WalletActivityEvidence = {},
): WalletActivity[] {
  const groups = new Map<string, Group>();
  const groupFor = (chainId: 1 | 8453, hash: string) => {
    const id = activityId(chainId, hash);
    let group = groups.get(id);
    if (!group) {
      group = { id, chainId, hash, positions: [], transfers: [], nfts: [] };
      groups.set(id, group);
    }
    return group;
  };
  for (const view of views) {
    const group = groupFor(view.record.chainId, view.record.hash);
    group.view = view;
    group.hash = view.record.hash;
  }
  for (const position of positions) {
    const existing = groups.get(activityId(position.chainId, position.hash));
    // Indexed events are independently receipt-verified by the history loader.
    // They cannot relabel a token approval, nor overrule a pending or reverted receipt.
    if (existing?.view && (existing.view.record.stepKind === 'approval' || existing.view.status !== 'confirmed')) continue;
    const group = existing ?? groupFor(position.chainId, position.hash);
    group.positions = [...group.positions.filter((item) => item.positionId !== position.positionId
      || item.poolAddress.toLowerCase() !== position.poolAddress.toLowerCase()), position];
    group.blockTime ??= position.timestamp * 1000;
  }
  for (const transfer of transfers) {
    const existing = groups.get(activityId(transfer.chainId, transfer.hash));
    if (existing?.view && (existing.view.status === 'failed' || existing.view.record.stepKind === 'approval')) continue;
    const group = existing ?? groupFor(transfer.chainId, transfer.hash);
    if (!group.transfers.some((item) => item.id === transfer.id)) group.transfers.push(transfer);
    group.blockTime ??= transfer.timestamp;
  }
  for (const nft of evidence.positionTransfers ?? []) {
    const existing = groups.get(activityId(nft.chainId, nft.hash));
    if (!existing || existing.view?.status === 'failed' || existing.view?.record.stepKind === 'approval') continue;
    if (!existing.nfts.some((item) => item.id === nft.id)) existing.nfts.push(nft);
  }
  return [...groups.values()]
    .map((group) => toActivity(group, walletAddress, evidence.calls))
    .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));
}
