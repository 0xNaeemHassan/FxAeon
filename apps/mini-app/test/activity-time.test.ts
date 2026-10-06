import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityDayKey, activityDayLabel, activityRelativeTime } from '../src/lib/activityTime';

// Local-time constructors keep these assertions independent of the machine's zone.
const now = new Date(2026, 9, 6, 15, 30).getTime();
const at = (month: number, day: number, hour = 12, minute = 0, year = 2026) => new Date(year, month, day, hour, minute).getTime();

test('day headers read Today, Yesterday, then a short weekday date', () => {
  assert.equal(activityDayLabel(at(9, 6, 0, 5), now), 'Today');
  assert.equal(activityDayLabel(at(9, 5, 23, 59), now), 'Yesterday');
  assert.equal(activityDayLabel(at(9, 4), now), 'Sun, Oct 4');
  assert.equal(activityDayLabel(at(11, 31, 12, 0, 2025), now), 'Wed, Dec 31, 2025');
  assert.equal(activityDayKey(at(9, 6, 0, 1)), activityDayKey(at(9, 6, 23, 59)));
  assert.notEqual(activityDayKey(at(9, 6)), activityDayKey(at(9, 5)));
});

test('row times are relative today and absolute before', () => {
  assert.equal(activityRelativeTime(now - 20_000, now), 'Just now');
  assert.equal(activityRelativeTime(now - 5 * 60_000, now), '5m ago');
  assert.equal(activityRelativeTime(now - 2 * 3_600_000, now), '2h ago');
  assert.equal(activityRelativeTime(at(9, 5, 22), now), 'Yesterday');
  assert.equal(activityRelativeTime(at(9, 4), now), 'Oct 4');
  assert.equal(activityRelativeTime(at(9, 4, 15, 42), now, true), '3:42 PM');
  assert.equal(activityRelativeTime(at(0, 3, 9, 0, 2025), now), 'Jan 3, 2025');
});
