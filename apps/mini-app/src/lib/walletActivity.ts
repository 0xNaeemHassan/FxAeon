import { FX_TOKENS } from './fx/tokens';
import type { RecoveryViewModel } from './fx/recovery';
import type { ProtocolPositionActivity } from './protocolPositionHistory';
import type { WalletTransfer } from './walletTransferHistory';

export type WalletActivity = {
  id: string;
  chainId: 1 | 8453;
  hash: string;
  timestamp: number;
  title: string;
  symbol: string;
  status: 'confirmed' | 'failed' | 'pending' | 'indexed';
  statusLabel: string;
  recovery?: RecoveryViewModel;
  positions: ProtocolPositionActivity[];
  transfers: WalletTransfer[];
};

const OPERATION_TITLES: Record<string, string> = {
  increasePosition: 'Open position', reducePosition: 'Reduce position', adjustPositionLeverage: 'Adjust leverage',
  depositAndMint: 'Borrow fxUSD', repayAndWithdraw: 'Repay', depositFxSave: 'Deposit fxSAVE',
  withdrawFxSave: 'Withdraw fxSAVE', getRedeemTx: 'Claim fxSAVE', buildBridgeTx: 'Bridge',
};

/** User-facing title for an SDK operation; unknown operations never leak method names. */
export function operationTitle(operation: string): string {
  return OPERATION_TITLES[operation] ?? 'Transaction';
}

export function activityOperation(view: RecoveryViewModel): string {
  if (view.record.stepKind === 'approval') {
    const token = Object.values(FX_TOKENS).find((item) => item.address.toLowerCase() === view.record.to.toLowerCase());
    return `Approve ${token?.key ?? 'token'}`;
  }
  if (view.record.stepKind !== 'action') return 'Transaction';
  return view.record.intent ?? operationTitle(view.record.operation);
}

/** One row per chain/hash. An approval never inherits its route's action label. */
export function mergeWalletActivity(views: readonly RecoveryViewModel[], positions: readonly ProtocolPositionActivity[], transfers: readonly WalletTransfer[] = [], walletAddress = ''): WalletActivity[] {
  const rows = new Map<string, WalletActivity>();
  for (const view of views) {
    const { record } = view;
    const id = `${record.chainId}:${record.hash.toLowerCase()}`;
    const token = record.chainId === 1 ? Object.values(FX_TOKENS).find((item) => item.address.toLowerCase() === record.to.toLowerCase()) : undefined;
    rows.set(id, {
      id, chainId: record.chainId, hash: record.hash, timestamp: record.submittedAt,
      title: activityOperation(view), symbol: record.bridge?.bridgeToken ?? token?.key ?? (/FxSave|Redeem/.test(record.operation) ? 'fxSAVE' : 'ETH'),
      status: view.status, statusLabel: view.status === 'failed' ? 'Failed' : view.status === 'confirmed'
        ? record.stepKind === 'approval' ? 'Approved' : record.bridge ? 'Source confirmed' : 'Confirmed'
        : view.verification === 'confirming' ? 'Confirming' : 'Submitted',
      recovery: view, positions: [], transfers: [],
    });
  }
  for (const position of positions) {
    const id = `${position.chainId}:${position.hash.toLowerCase()}`;
    const previous = rows.get(id);
    // Indexed events are independently receipt-verified by the history loader.
    // They cannot relabel a known token-approval transaction as an action.
    if (previous?.recovery && (previous.recovery.record.stepKind === 'approval' || previous.status !== 'confirmed')) continue;
    const title = `${position.kind === 'close' ? 'Closed' : position.kind === 'reduce' ? 'Reduced' : 'Opened / added'} ${position.market} ${position.side}`;
    const unique = [...(previous?.positions ?? []).filter((item) => item.positionId !== position.positionId || item.poolAddress !== position.poolAddress), position];
    rows.set(id, { ...previous, id, chainId: position.chainId, hash: position.hash, timestamp: position.timestamp * 1000,
      title: unique.length > 1 ? 'Position changes' : title, symbol: position.market === 'BTC' ? 'WBTC' : 'ETH',
      status: 'confirmed', statusLabel: 'Confirmed', positions: unique, transfers: previous?.transfers ?? [] });
  }
  for (const transfer of transfers) {
    const id = `${transfer.chainId}:${transfer.hash.toLowerCase()}`;
    const previous = rows.get(id);
    if (previous?.status === 'failed' || previous?.recovery?.record.stepKind === 'approval') continue;
    const movements = [...(previous?.transfers ?? []).filter((item) => item.id !== transfer.id), transfer];
    const outgoing = movements.some((item) => item.from.toLowerCase() === walletAddress.toLowerCase());
    const incoming = movements.some((item) => item.to.toLowerCase() === walletAddress.toLowerCase());
    rows.set(id, { id, chainId: transfer.chainId, hash: transfer.hash, timestamp: transfer.timestamp,
      title: incoming && outgoing ? 'Transfers' : outgoing ? 'Sent' : 'Received', symbol: transfer.symbol,
      status: 'indexed', statusLabel: '', positions: [], ...previous, transfers: movements });
  }
  return [...rows.values()].sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));
}
