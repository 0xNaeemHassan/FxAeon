import assert from 'node:assert/strict';
import test from 'node:test';
import { claimAvailability, cooldownRefreshDelayMs, createEarnReadGuard } from '../src/lib/earnState';

const pending = {
  hasPendingRedeem: true,
  pendingSharesWei: 2n,
  isCooldownComplete: false,
  redeemableAt: 2_000,
};

test('Earn read guard drops stale wallet reads and prevents automatic overlap', () => {
  const guard = createEarnReadGuard();
  const first = guard.begin();
  assert.ok(first !== null);
  assert.equal(guard.begin(), null);
  guard.invalidate();
  guard.activate();
  const second = guard.begin();
  assert.ok(second !== null);
  assert.equal(guard.isCurrent(first!), false);
  assert.equal(guard.isCurrent(second!), true);
  guard.finish(first!);
  assert.equal(guard.begin(), null, 'an old completion must not release the current read');
  guard.finish(second!);
  assert.ok(guard.begin() !== null);
});

test('a forced foreground refresh supersedes an older request', () => {
  const guard = createEarnReadGuard();
  const first = guard.begin();
  const forced = guard.begin(true);
  assert.ok(first !== null && forced !== null);
  assert.equal(guard.isCurrent(first!), false);
  assert.equal(guard.isCurrent(forced!), true);
});

test('claim requires both a positive pending amount and authoritative cooldown completion', () => {
  assert.equal(claimAvailability(undefined).status, 'unavailable');
  assert.equal(claimAvailability({ ...pending, hasPendingRedeem: false }).status, 'empty');
  assert.equal(claimAvailability({ ...pending, pendingSharesWei: 0n }).status, 'empty');
  assert.equal(claimAvailability(pending).canReview, false);
  assert.equal(claimAvailability({ ...pending, isCooldownComplete: true }).canReview, true);
});

test('cooldown polling is bounded and retries promptly once unlock is due', () => {
  assert.equal(cooldownRefreshDelayMs(null, 0), null);
  assert.equal(cooldownRefreshDelayMs(100, 0), 15_000);
  assert.equal(cooldownRefreshDelayMs(1, 2_000), 1_000);
  assert.equal(cooldownRefreshDelayMs(100, 99_900), 1_000);
});
