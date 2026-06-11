/**
 * Explicit transaction state machine (W-11).
 *
 * Every TxRecord.status is one of these states and may only move along the
 * declared edges. Lowercase to stay compatible with the pre-existing
 * 'confirmed'/'reverted' strings already written by tx-notifier.
 *
 *   prepared → simulated → broadcasting → broadcast → confirmed
 *      └→ failed   └→ failed   └→ failed      └→ reverted
 *
 * Notes:
 * - 'broadcast' has NO edge to 'failed': once a signed tx left our hands it
 *   may still land. A watcher timeout leaves the record in 'broadcast' for a
 *   later sweep — it must never be marked failed on a hunch.
 * - Terminal states have no outgoing edges. Retrying a failed trade requires a
 *   NEW idempotency key; we never resurrect a terminal record.
 */

export const TX_STATES = [
  "prepared",
  "simulated",
  "broadcasting",
  "broadcast",
  "confirmed",
  "reverted",
  "failed",
] as const;

export type TxState = (typeof TX_STATES)[number];

const TRANSITIONS: Record<TxState, readonly TxState[]> = {
  prepared: ["simulated", "failed"],
  simulated: ["broadcasting", "failed"],
  broadcasting: ["broadcast", "failed"],
  broadcast: ["confirmed", "reverted"],
  confirmed: [],
  reverted: [],
  failed: [],
};

export function isTxState(value: string): value is TxState {
  return (TX_STATES as readonly string[]).includes(value);
}

export function isTerminal(state: TxState): boolean {
  return TRANSITIONS[state].length === 0;
}

export function canTransition(from: TxState, to: TxState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TxState, to: TxState): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal tx state transition: ${from} → ${to}`);
  }
}
