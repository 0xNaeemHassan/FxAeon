import assert from 'node:assert/strict';
import test from 'node:test';
import { announceSettingsUpdated, DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent, SETTINGS_KEY, SETTINGS_UPDATED_EVENT } from '../src/lib/settings';

test('slippage preference falls back safely when browser storage is unavailable', () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
  try {
    assert.equal(readSlippagePercent(), DEFAULT_SLIPPAGE_PERCENT);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('saving preferences announces the exact device preference payload', () => {
  const events: Event[] = [];
  const originalWindow = globalThis.window;
  const fakeWindow = { dispatchEvent: (event: Event) => { events.push(event); return true; } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  try {
    announceSettingsUpdated(100);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, SETTINGS_UPDATED_EVENT);
    assert.deepEqual((events[0] as CustomEvent<{ slippageBps: number }>).detail, { slippageBps: 100 });
    assert.equal(SETTINGS_KEY, 'fxaeon.settings.v1');
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});
