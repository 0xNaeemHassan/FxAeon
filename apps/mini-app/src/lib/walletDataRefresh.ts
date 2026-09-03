import type { RecoveryViewModel } from './fx/recovery';
import type { PlannedRoute, TransactionExecutionResult } from './fx/types';

type WalletDataScope = { address: string; chainId: number };
type WalletDataInvalidator = (address: string, chainId: number) => Promise<void>;

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const supportedChain = (chainId: number) => chainId === 1 || chainId === 8453;
const sameHex = (left: unknown, right: unknown) => typeof left === 'string' && typeof right === 'string'
  && left.toLowerCase() === right.toLowerCase();

/** Inclusion can change gas/balances even when a later step fails or reverts.
 * This is only a cache-refresh gate, never proof that the financial action succeeded.
 * The runner remains responsible for RPC-chain and mined-transaction verification.
 */
export function includedRouteWalletScope(
  route: PlannedRoute,
  execution: TransactionExecutionResult,
): WalletDataScope | null {
  if (!supportedChain(route.chainId) || !ADDRESS.test(route.walletAddress)
    || execution.chainId !== route.chainId || execution.operation !== route.operation
    || !sameHex(execution.walletAddress, route.walletAddress)) return null;

  const included = execution.steps.some((step) => {
    const expected = Number.isInteger(step.index) && step.index >= 0 ? route.transactions[step.index] : undefined;
    const transaction = step.transaction;
    const receipt = step.receipt;
    if (!expected || !receipt || !step.hash || !HASH.test(step.hash)
      || transaction.chainId !== route.chainId || expected.chainId !== route.chainId
      || !sameHex(expected.from, route.walletAddress) || !sameHex(transaction.from, expected.from)
      || !sameHex(transaction.to, expected.to) || !sameHex(transaction.data, expected.data)
      || transaction.value !== expected.value || transaction.nonce !== expected.nonce
      || transaction.operation !== expected.operation || transaction.kind !== expected.kind
      || transaction.type !== expected.type) return false;
    return (receipt.status === 'success' || receipt.status === 'reverted')
      && typeof receipt.blockNumber === 'bigint' && receipt.blockNumber >= 0n
      && sameHex(receipt.transactionHash, step.hash)
      && sameHex(receipt.from, route.walletAddress) && sameHex(receipt.to, expected.to);
  });
  return included ? { address: route.walletAddress, chainId: route.chainId } : null;
}

/** One instance per execution joins the normal callback and its error fallback.
 * Failed reads must never change the outcome of a transaction already included.
 */
export function createRouteWalletRefresh(invalidate: WalletDataInvalidator) {
  const refreshes = new Map<string, Promise<void>>();
  return (route: PlannedRoute, execution: TransactionExecutionResult): Promise<void> => {
    const scope = includedRouteWalletScope(route, execution);
    if (!scope) return Promise.resolve();
    const key = `${scope.chainId}:${scope.address.toLowerCase()}`;
    const existing = refreshes.get(key);
    if (existing) return existing;
    const refresh = Promise.resolve()
      .then(() => invalidate(scope.address, scope.chainId))
      .catch(() => undefined);
    refreshes.set(key, refresh);
    return refresh;
  };
}

/** Accept only authoritative reconciler output, never local journal status.
 * Each chain is refreshed once per batch, retaining receipt identities for dedupe.
 */
export function verifiedRecoveryWalletRefreshes(
  views: readonly RecoveryViewModel[],
  walletAddress: string,
  seen: ReadonlySet<string>,
): (WalletDataScope & { receiptKeys: string[] })[] {
  if (!ADDRESS.test(walletAddress)) return [];
  const address = walletAddress.toLowerCase();
  const groups = new Map<number, WalletDataScope & { receiptKeys: string[] }>();
  for (const view of views) {
    const { record } = view;
    if (view.verification !== 'receipt' || (view.status !== 'confirmed' && view.status !== 'failed')
      || typeof view.receiptBlockNumber !== 'bigint' || view.receiptBlockNumber < 0n
      || !supportedChain(record.chainId) || !sameHex(record.walletAddress, address)
      || !HASH.test(record.hash)) continue;
    const key = `${record.chainId}:${address}:${record.hash.toLowerCase()}:${view.receiptBlockNumber}:${view.status}`;
    if (seen.has(key)) continue;
    const group = groups.get(record.chainId) ?? { address, chainId: record.chainId, receiptKeys: [] };
    if (!group.receiptKeys.includes(key)) group.receiptKeys.push(key);
    groups.set(record.chainId, group);
  }
  return [...groups.values()];
}

/** Every recovery surface can establish receipt truth, not only the invisible
 * coordinator. Share its refresh gate without trusting persisted status.
 */
export function createRecoveryWalletRefresh(invalidate: WalletDataInvalidator) {
  const seen = new Set<string>();
  return async (views: readonly RecoveryViewModel[], walletAddress: string, isCurrent: () => boolean): Promise<void> => {
    if (!isCurrent()) return;
    const refreshes = verifiedRecoveryWalletRefreshes(views, walletAddress, seen);
    await Promise.all(refreshes.map(async (scope) => {
      if (!isCurrent()) return;
      scope.receiptKeys.forEach((key) => seen.add(key));
      try { await invalidate(scope.address, scope.chainId); }
      catch { /* Chain truth survives an unavailable cache refresh. */ }
    }));
  };
}

/** A->B->A and overlapping reads must not revive an older response. Select
 * during render to invalidate old callbacks before the next effect starts.
 */
export function createWalletReadScope(walletAddress: string) {
  let selected = walletAddress.toLowerCase();
  let generation = 0;
  return {
    select(address: string) {
      if (selected !== address.toLowerCase()) {
        selected = address.toLowerCase();
        generation += 1;
      }
    },
    start(address: string): (() => boolean) | null {
      const scope = address.toLowerCase();
      if (scope !== selected) return null;
      const request = ++generation;
      return () => request === generation && scope === selected;
    },
    cancel() { generation += 1; },
  };
}
