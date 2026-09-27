import assert from 'node:assert/strict';
import test from 'node:test';
import { announceSettingsUpdated, DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent, SETTINGS_KEY, SETTINGS_UPDATED_EVENT } from '../src/lib/settings';

function withWindow(value: unknown, callback: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
  try { callback(); } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete (globalThis as { window?: unknown }).window;
  }
}

test('slippage preference falls back safely when browser storage is unavailable', () => {
  withWindow(undefined, () => {
    assert.equal(readSlippagePercent(), DEFAULT_SLIPPAGE_PERCENT);
  });
});

test('slippage presets are read from device storage as percentages', () => {
  for (const [slippageBps, expected] of [[10, 0.1], [50, 0.5], [100, 1], [200, 2]] as const) {
    withWindow({ localStorage: { getItem: () => JSON.stringify({ slippageBps }) } }, () => {
      assert.equal(readSlippagePercent(), expected);
    });
  }
});

test('invalid, corrupt, out-of-range, and throwing storage use the safe default', () => {
  const values: unknown[] = [
    null,
    '{}',
    JSON.stringify({ slippageBps: 0 }),
    JSON.stringify({ slippageBps: 5 }),
    JSON.stringify({ slippageBps: 500 }),
    JSON.stringify({ slippageBps: '50' }),
    '{corrupt json',
  ];
  for (const stored of values) {
    withWindow({ localStorage: { getItem: () => stored } }, () => {
      assert.equal(readSlippagePercent(), DEFAULT_SLIPPAGE_PERCENT);
    });
  }
  withWindow({ localStorage: { getItem: () => { throw new Error('storage blocked'); } } }, () => {
    assert.equal(readSlippagePercent(), DEFAULT_SLIPPAGE_PERCENT);
  });
});

test('saving preferences announces the exact device preference payload', () => {
  const events: Event[] = [];
  const fakeWindow = { dispatchEvent: (event: Event) => { events.push(event); return true; } };
  withWindow(fakeWindow, () => {
    announceSettingsUpdated(100);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, SETTINGS_UPDATED_EVENT);
    assert.deepEqual((events[0] as CustomEvent<{ slippageBps: number }>).detail, { slippageBps: 100 });
    assert.equal(SETTINGS_KEY, 'fxaeon.settings.v1');
  });
});
