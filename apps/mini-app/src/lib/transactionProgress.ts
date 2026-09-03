import type { OfficialFxMethod, TransactionStepResult } from './fx/types';

export type TransactionProgressState = 'ready' | 'submitted' | 'confirmed' | 'reverted' | 'unknown' | 'unverified' | 'stopped';

export function hasTransactionHash(step: TransactionStepResult | undefined): boolean {
  return Boolean(step?.hash && /^0x[0-9a-fA-F]{64}$/.test(step.hash));
}

/** Explorer identity comes from the submitted route, never the active wallet. */
export function transactionExplorerUrl(chainId: number, hash: string | undefined): string | null {
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  const origin = chainId === 1 ? 'https://etherscan.io' : chainId === 8453 ? 'https://basescan.org' : null;
  return origin ? `${origin}/tx/${hash}` : null;
}

export function transactionStepKind(step: TransactionStepResult): string {
  return step.transaction.kind === 'approval' ? 'Approval' : step.transaction.kind === 'action' ? 'Action' : 'Transaction';
}

/** A hash proves submission, not success; only the runner verifies receipts. */
export function transactionStepProgress(step: TransactionStepResult | undefined): {
  state: TransactionProgressState;
  label: string;
} {
  if (!hasTransactionHash(step)) {
    return step?.status === 'failed' ? { state: 'stopped', label: 'Not submitted' } : { state: 'ready', label: 'Ready' };
  }
  if (step?.receipt?.status === 'reverted') return { state: 'reverted', label: 'Reverted' };
  if (step?.status === 'confirmed' && step.receipt?.status === 'success') return { state: 'confirmed', label: 'Confirmed' };
  if (step?.status === 'failed') {
    return step.receipt
      ? { state: 'unverified', label: 'Verification incomplete' }
      : { state: 'unknown', label: 'Confirmation unknown' };
  }
  return { state: 'submitted', label: 'Submitted' };
}

export function confirmedUpdateCopy(operation: OfficialFxMethod | undefined, reading: boolean): {
  label: string;
  body: string;
} {
  if (operation === 'buildBridgeTx') {
    return {
      label: 'Confirmed on source',
      body: reading
        ? 'Checking source state. Destination delivery is tracked separately.'
        : 'Waiting for the next source block. Destination delivery is tracked separately.',
    };
  }
  const position = operation !== undefined && [
    'increasePosition', 'reducePosition', 'adjustPositionLeverage', 'depositAndMint', 'repayAndWithdraw',
  ].includes(operation);
  const subject = position ? 'position' : 'balances';
  return {
    label: `Confirmed · updating ${subject}`,
    body: reading
      ? `Verifying updated ${subject}. No further signature is needed.`
      : `Waiting for the next block before reading updated ${subject}.`,
  };
}
