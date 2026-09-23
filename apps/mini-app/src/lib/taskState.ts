import type { RecoveryViewModel } from './fx/recovery';
import type { TransactionExecutionResult } from './fx/types';
import { claimAvailability, type ClaimableLike } from './earnState';

export type WalletTask = {
  id: string;
  kind: 'transaction' | 'withdrawal' | 'valuation';
  state: 'pending' | 'uncertain' | 'ready' | 'partial' | 'unavailable';
  title: string;
  detail: string;
  href: string;
  /** Submitted transaction tasks can only be inspected; they are never retryable. */
  retryable: false;
};

export type WalletTaskSnapshot = {
  walletAddress: string;
  transactions: readonly RecoveryViewModel[];
  claimable?: ClaimableLike | null;
  valuation?: 'complete' | 'partial' | 'unavailable';
};

/**
 * Build actionable task facts from identity-scoped, protocol-verified reads.
 * UI surfaces share this selector so uncertainty never gains a resubmit action.
 */
export function selectWalletTasks(snapshot: WalletTaskSnapshot): WalletTask[] {
  const identity = snapshot.walletAddress.toLowerCase();
  const tasks: WalletTask[] = [];
  for (const transaction of snapshot.transactions) {
    if (transaction.record.walletAddress.toLowerCase() !== identity || transaction.status !== 'pending') continue;
    const uncertain = transaction.verification === 'rpc-error' || transaction.verification === 'mismatch';
    tasks.push({
      id: `transaction:${transaction.record.id}`,
      kind: 'transaction',
      state: uncertain ? 'uncertain' : 'pending',
      title: uncertain ? 'Confirmation could not be verified'
        : transaction.verification === 'confirming' ? 'Transaction included · confirming' : 'Transaction pending',
      detail: transaction.message,
      href: '/history',
      retryable: false,
    });
  }
  const claim = claimAvailability(snapshot.claimable);
  if (claim.status === 'ready') tasks.push({
    id: `withdrawal:${identity}`, kind: 'withdrawal', state: 'ready', title: 'Withdrawal ready to claim',
    detail: 'Review the verified assets available from your fxSAVE withdrawal.', href: '/earn?mode=claim', retryable: false,
  });
  else if (claim.status === 'cooldown') tasks.push({
    id: `withdrawal:${identity}`, kind: 'withdrawal', state: 'pending', title: 'Withdrawal pending',
    detail: claim.message, href: '/earn', retryable: false,
  });
  if (snapshot.valuation === 'partial' || snapshot.valuation === 'unavailable') tasks.push({
    id: `valuation:${identity}`, kind: 'valuation', state: snapshot.valuation,
    title: snapshot.valuation === 'partial' ? 'Some assets could not be valued' : 'Portfolio value unavailable',
    detail: snapshot.valuation === 'partial' ? 'Known balances and values remain visible; unavailable prices are not estimated.'
      : 'Asset quantities remain visible. Refresh portfolio data to check balances and prices.',
    href: '/portfolio#portfolio-assets-heading', retryable: false,
  });
  return tasks;
}

/** Adapt the just-finished runner result into the same submitted-task policy. */
export function selectExecutionTask(result: TransactionExecutionResult): WalletTask | null {
  if (result.status === 'confirmed') return null;
  const submitted = result.steps.filter((step) => Boolean(step.hash && /^0x[0-9a-fA-F]{64}$/.test(step.hash)));
  if (submitted.length === 0) return null;
  const uncertain = submitted.some((step) => !step.receipt || (step.receipt.status !== 'success' && step.receipt.status !== 'reverted'));
  const partial = result.status === 'partial';
  return {
    id: `execution:${result.chainId}:${submitted.map((step) => step.hash).join(':')}`,
    kind: 'transaction',
    state: uncertain ? 'uncertain' : partial ? 'pending' : 'uncertain',
    title: uncertain ? 'Confirmation could not be verified' : partial ? 'Action partially completed' : 'Transaction needs review',
    detail: uncertain ? 'A transaction was submitted. Check History; do not submit this action again.'
      : 'One or more submitted steps need review. Check History before taking another action.',
    href: '/history',
    retryable: false,
  };
}
