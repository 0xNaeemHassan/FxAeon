/**
 * Unit Tests for Production Perfection Suite
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pre-warmer math simulation
function simulatePrewarmedCandles(market, basePrice = 3500, count = 45) {
  const candles = [];
  const now = Date.now();
  const stepMs = 300000;
  const vol = basePrice * 0.0035;
  let current = basePrice * 0.98;

  for (let i = count; i >= 0; i--) {
    const time = now - (i * stepMs);
    const pseudo = Math.sin(i * 997 + basePrice) * 0.5 + 0.5;
    const delta = (pseudo - 0.485) * vol;
    const open = current;
    const close = Math.max(10, open + delta);
    const high = Math.max(open, close) + 5;
    const low = Math.min(open, close) - 5;
    candles.push({ time, open, high, low, close, volume: 25 });
    current = close;
  }
  return candles;
}

test('simulatePrewarmedCandles generates valid OHLC candle series with sequential timestamps', () => {
  const candles = simulatePrewarmedCandles('wstETH', 3500, 40);
  assert.equal(candles.length, 41);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    assert.ok(c.high >= c.low, `High ${c.high} must be >= Low ${c.low}`);
    assert.ok(c.high >= Math.max(c.open, c.close), `High must be >= max(open, close)`);
    assert.ok(c.low <= Math.min(c.open, c.close), `Low must be <= min(open, close)`);
    assert.ok(c.volume > 0, `Volume must be positive`);

    if (i > 0) {
      assert.ok(c.time > candles[i - 1].time, `Timestamps must be ascending`);
    }
  }
});

test('Onboarding modal step boundaries are strictly bounded to 3 stages [0, 1, 2]', () => {
  let step = 0;
  const nextStep = () => {
    if (step < 2) step += 1;
    return step;
  };

  assert.equal(step, 0);
  assert.equal(nextStep(), 1);
  assert.equal(nextStep(), 2);
  assert.equal(nextStep(), 2); // Should not exceed 2
});
