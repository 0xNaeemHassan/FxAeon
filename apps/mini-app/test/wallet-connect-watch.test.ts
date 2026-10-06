import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONNECT_STALL_TIMEOUT_MS,
  PRIVY_PROMPT_OPEN_GRACE_MS,
  WALLET_ADDRESS_SETTLE_MS,
  WALLET_READY_TIMEOUT_MS,
  WalletConnectCancelledError,
  connectWatchdog,
  isPrivyCancellationCode,
  isWalletConnectCancellation,
  stepPrivyPrompt,
  watchPrivyPrompt,
  type PrivyPromptEvent,
  type PrivyPromptStep,
  type PrivyPromptWatch,
} from '../src/lib/wallet/connectWatch';

/** Feed observations to one request until it settles, as the adapter does. */
function outcomes(modalOpenAtStart: boolean, events: readonly PrivyPromptEvent[]): PrivyPromptStep['outcome'][] {
  let watch: PrivyPromptWatch = watchPrivyPrompt(modalOpenAtStart);
  const seen: PrivyPromptStep['outcome'][] = [];
  for (const event of events) {
    const step = stepPrivyPrompt(watch, event);
    seen.push(step.outcome);
    if (step.outcome !== 'pending') break;
    watch = step.watch;
  }
  return seen;
}

const opened: PrivyPromptEvent = { type: 'modal', open: true };
const closed: PrivyPromptEvent = { type: 'modal', open: false };

test('dismissing the prompt with the backdrop or Escape cancels the request', () => {
  // Privy's connect-only modal reports no callback for either dismissal.
  assert.deepEqual(outcomes(false, [opened, closed]), ['pending', 'cancelled']);
});

test('success settles at once, before Privy closes its modal', () => {
  assert.deepEqual(outcomes(false, [opened, { type: 'success' }, closed]), ['pending', 'resolved']);
});

test("Privy's own close button reports an error first, and the close makes it a cancellation", () => {
  assert.deepEqual(outcomes(false, [
    opened,
    { type: 'error', code: 'generic_connect_wallet_error', modalOpen: true },
    closed,
  ]), ['pending', 'pending', 'cancelled']);
  // Login reports its exit while the modal is still mounted, then closes.
  assert.deepEqual(outcomes(false, [
    opened,
    { type: 'error', code: 'exited_auth_flow', modalOpen: true },
    closed,
  ]), ['pending', 'pending', 'cancelled']);
});

test('an error shown inside the open prompt leaves room for a retry there', () => {
  assert.deepEqual(outcomes(false, [
    opened,
    { type: 'error', code: 'unknown_connect_wallet_error', modalOpen: true },
    { type: 'success' },
  ]), ['pending', 'pending', 'resolved']);
});

test('an error with no prompt on screen settles at once as a failure or a cancellation', () => {
  assert.deepEqual(
    stepPrivyPrompt(watchPrivyPrompt(false), { type: 'error', code: 'allowlist_rejected', modalOpen: false }),
    { outcome: 'failed', code: 'allowlist_rejected' },
  );
  assert.deepEqual(outcomes(false, [{ type: 'error', code: 'exited_auth_flow', modalOpen: false }]), ['cancelled']);
});

test('a prompt that never opens is reported after the grace period instead of spinning', () => {
  assert.deepEqual(outcomes(false, [{ type: 'open-timeout' }]), ['unavailable']);
  // A closed modal that was never open is not a dismissal.
  assert.deepEqual(outcomes(false, [closed, { type: 'open-timeout' }]), ['pending', 'unavailable']);
  // Once the prompt is seen it owns the request; the grace timer is moot.
  assert.deepEqual(outcomes(false, [opened, { type: 'open-timeout' }, closed]), ['pending', 'pending', 'cancelled']);
  assert.deepEqual(outcomes(true, [{ type: 'open-timeout' }, closed]), ['pending', 'cancelled']);
});

test('only exit codes count as the person cancelling', () => {
  for (const code of [
    'exited_auth_flow',
    'exited_link_flow',
    'exited_update_flow',
    'user_exited_set_password_flow',
    'oauth_user_denied',
    'generic_connect_wallet_error',
    'user_rejected',
  ]) {
    assert.equal(isPrivyCancellationCode(code), true, code);
  }
  for (const code of ['unknown_connect_wallet_error', 'allowlist_rejected', 'client_request_timeout', '', undefined, null, 42, new Error('exited_auth_flow')]) {
    assert.equal(isPrivyCancellationCode(code), false, String(code));
  }
});

test('cancellations are recognizable, including across module copies, and nothing else is', () => {
  const cancelled = new WalletConnectCancelledError('Sign-in cancelled.');
  assert.equal(cancelled.message, 'Sign-in cancelled.');
  assert.equal(cancelled.name, 'WalletConnectCancelledError');
  assert.equal(isWalletConnectCancellation(cancelled), true);
  assert.equal(new WalletConnectCancelledError().message, 'Wallet connection was cancelled.');
  const fromAnotherCopy = Object.assign(new Error('Sign-in cancelled.'), { name: 'WalletConnectCancelledError' });
  assert.equal(isWalletConnectCancellation(fromAnotherCopy), true);
  for (const other of [new Error('Wallet connection was cancelled.'), 'exited_auth_flow', undefined, { name: 'WalletConnectCancelledError' }]) {
    assert.equal(isWalletConnectCancellation(other), false);
  }
});

test('a queued click waits a bounded time for the provider before it gives up', () => {
  assert.deepEqual(connectWatchdog({ queued: true, connecting: false, ready: false, promptOpen: false }), { kind: 'provider-ready', ms: WALLET_READY_TIMEOUT_MS });
  // A ready provider starts the request instead, which the stall timer bounds.
  assert.deepEqual(connectWatchdog({ queued: true, connecting: false, ready: true, promptOpen: false }), { kind: 'none' });
  assert.deepEqual(connectWatchdog({ queued: false, connecting: true, ready: true, promptOpen: false }), { kind: 'stall', ms: CONNECT_STALL_TIMEOUT_MS });
});

test('a visible wallet prompt pauses both timers, and an idle button has none', () => {
  assert.deepEqual(connectWatchdog({ queued: false, connecting: true, ready: true, promptOpen: true }), { kind: 'none' });
  // Privy's seamless Telegram sign-in shows its prompt before it reports ready.
  assert.deepEqual(connectWatchdog({ queued: true, connecting: false, ready: false, promptOpen: true }), { kind: 'none' });
  assert.deepEqual(connectWatchdog({ queued: false, connecting: false, ready: true, promptOpen: true }), { kind: 'none' });
  assert.deepEqual(connectWatchdog({ queued: false, connecting: false, ready: false, promptOpen: false }), { kind: 'none' });
});

test('the bounds keep their intended order', () => {
  // The provider gets the same 12s the wallet surfaces already allow.
  assert.equal(WALLET_READY_TIMEOUT_MS, 12_000);
  assert.equal(CONNECT_STALL_TIMEOUT_MS, 120_000);
  // Privy opens its modal 15ms after the call, so the grace period is generous
  // yet far shorter than any wait the person would notice as a hang.
  assert.ok(PRIVY_PROMPT_OPEN_GRACE_MS >= 1_000 && PRIVY_PROMPT_OPEN_GRACE_MS < WALLET_READY_TIMEOUT_MS);
  assert.ok(WALLET_ADDRESS_SETTLE_MS < CONNECT_STALL_TIMEOUT_MS);
});
