import { filterJournalForWallet, selectRecoveryRecords } from './fx/recovery';
import type { PendingHashRecord } from './fx/types';

/** Focus/online only need unresolved work. A journal storage event can carry a
 * terminal result from another tab, so include the bounded verified-history
 * candidates and make the reconciler prove them again from chain data.
 */
export function selectRecoveryTriggerRecords(
  records: readonly PendingHashRecord[],
  walletAddress: string,
  includeTerminalHistory: boolean,
): PendingHashRecord[] {
  return includeTerminalHistory
    ? selectRecoveryRecords(records, walletAddress)
    : filterJournalForWallet(records, walletAddress).filter((record) => record.status === 'pending');
}

/** Serialize visibility/focus/storage bursts. Any queued request for terminal
 * history wins the next batch, and every caller joins the complete sequence.
 */
export function createRecoveryTriggerQueue(
  run: (includeTerminalHistory: boolean) => Promise<void>,
): (includeTerminalHistory?: boolean) => Promise<void> {
  let active: Promise<void> | null = null;
  let requested = false;
  let requestedTerminalHistory = false;

  return (includeTerminalHistory = false) => {
    requested = true;
    requestedTerminalHistory ||= includeTerminalHistory;
    if (!active) {
      const loop = async () => {
        while (requested) {
          requested = false;
          const currentIncludesHistory = requestedTerminalHistory;
          requestedTerminalHistory = false;
          try { await run(currentIncludesHistory); }
          catch { /* Recovery triggers are best effort and remain retryable. */ }
        }
        active = null;
      };
      // The microtask batches same-tick focus/storage bursts. Install the
      // promise first so synchronous throws and nested triggers still join it.
      active = Promise.resolve().then(loop);
    }
    return active;
  };
}
