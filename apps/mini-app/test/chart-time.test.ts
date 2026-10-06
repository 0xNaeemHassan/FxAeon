import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localTimeShiftSeconds } from '../src/lib/chartTime';

const MIDNIGHT_UTC = Date.UTC(2026, 9, 5) / 1_000;

test('chart times shift east of UTC forward and west of UTC back', () => {
  // UTC+5 reports -300 minutes: 00:00Z must label as 05:00.
  assert.equal(MIDNIGHT_UTC + localTimeShiftSeconds(MIDNIGHT_UTC, () => -300), MIDNIGHT_UTC + 5 * 3_600);
  // UTC-4 reports +240 minutes: 00:00Z must label as 20:00 the previous day.
  assert.equal(MIDNIGHT_UTC + localTimeShiftSeconds(MIDNIGHT_UTC, () => 240), MIDNIGHT_UTC - 4 * 3_600);
  // Half-hour zones keep their half hour.
  assert.equal(localTimeShiftSeconds(MIDNIGHT_UTC, () => -330), 19_800);
});

test('UTC viewers and empty series keep raw times', () => {
  assert.equal(localTimeShiftSeconds(MIDNIGHT_UTC, () => 0), 0);
  assert.equal(localTimeShiftSeconds(undefined, () => -300), 0);
  assert.equal(localTimeShiftSeconds(Number.NaN, () => -300), 0);
});

test('one offset from the newest bar keeps a series ordered across a daylight-saving change', () => {
  // A US fall-back night: 05:30Z is 01:30 EDT and 06:30Z is 01:30 EST.
  const beforeFallBack = Date.UTC(2026, 10, 1, 5, 30) / 1_000;
  const afterFallBack = Date.UTC(2026, 10, 1, 6, 30) / 1_000;
  const newYorkOffsetAt = (epochMs: number) => (epochMs < Date.UTC(2026, 10, 1, 6) ? 240 : 300);
  const shift = localTimeShiftSeconds(afterFallBack, newYorkOffsetAt);
  assert.ok(beforeFallBack + shift < afterFallBack + shift);
  // Per-bar offsets would have produced the same local time twice.
  assert.equal(beforeFallBack - 240 * 60, afterFallBack - 300 * 60);
});
