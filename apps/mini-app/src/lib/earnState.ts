/** Small, protocol-agnostic state helpers for the fxSAVE surface. */

export type EarnReadGuard = ReturnType<typeof createEarnReadGuard>;

/** Scope reads to the currently selected wallet and discard superseded work. */
export function createEarnReadGuard() {
  let active = true;
  let generation = 0;
  let pending = false;

  return {
    begin(force = false): number | null {
      if (!active || (pending && !force)) return null;
      if (force && pending) generation += 1;
      pending = true;
      return ++generation;
    },
    isCurrent(request: number): boolean {
      return active && request === generation;
    },
    finish(request: number): void {
      if (active && request === generation) pending = false;
    },
    invalidate(): void {
      active = false;
      pending = false;
      generation += 1;
    },
    activate(): void {
      if (active) return;
      active = true;
      pending = false;
      generation += 1;
    },
  };
}

export type ClaimableLike = {
  hasPendingRedeem: boolean;
  pendingSharesWei: bigint;
  isCooldownComplete: boolean;
  redeemableAt: number | null;
};

export type ClaimAvailability =
  | { status: 'unavailable'; canReview: false; message: string }
  | { status: 'empty'; canReview: false; message: string }
  | { status: 'cooldown'; canReview: false; message: string }
  | { status: 'ready'; canReview: true; message: string };

/** A true pending request always has a positive share amount. */
export function claimAvailability(claimable: ClaimableLike | null | undefined): ClaimAvailability {
  if (!claimable) return { status: 'unavailable', canReview: false, message: 'Claim status is unavailable. Refresh to try again.' };
  if (!claimable.hasPendingRedeem || claimable.pendingSharesWei <= 0n) {
    return { status: 'empty', canReview: false, message: 'No queued redemption is available to claim.' };
  }
  if (!claimable.isCooldownComplete) {
    return {
      status: 'cooldown',
      canReview: false,
      message: claimable.redeemableAt
        ? `Available after ${new Date(claimable.redeemableAt * 1000).toLocaleString()}.`
        : 'Available after the cooldown completes.',
    };
  }
  return { status: 'ready', canReview: true, message: 'Ready to claim.' };
}

/**
 * Foreground polling is deliberately bounded. The SDK remains authoritative
 * for completion; this only chooses when to ask it again near unlock time.
 */
export function cooldownRefreshDelayMs(redeemableAt: number | null, nowMs = Date.now()): number | null {
  if (redeemableAt == null) return null;
  const remaining = redeemableAt * 1000 - nowMs;
  return Math.min(15_000, Math.max(1_000, remaining + 250));
}
