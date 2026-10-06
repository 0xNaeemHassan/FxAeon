/** History reads time in the viewer's own time zone. */

const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

/** Calendar days between a timestamp and now (0 = today, 1 = yesterday). */
function daysAgo(timestamp: number, now: number): number {
  return Math.round((startOfDay(new Date(now)) - startOfDay(new Date(timestamp))) / 86_400_000);
}

/** Stable key for grouping rows by local calendar day. */
export function activityDayKey(timestamp: number): string {
  const day = new Date(timestamp);
  return `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
}

/** Day header: Today, Yesterday, then "Mon, Oct 4" (with the year when it differs). */
export function activityDayLabel(timestamp: number, now = Date.now()): string {
  const difference = daysAgo(timestamp, now);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Yesterday';
  const day = new Date(timestamp);
  return day.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(day.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  });
}

/**
 * Row time. Today reads relatively ("Just now", "5m ago", "2h ago"). Under a
 * day header an older row shows its clock time; without headers it names the day.
 */
export function activityRelativeTime(timestamp: number, now = Date.now(), grouped = false): string {
  const elapsed = now - timestamp;
  const difference = daysAgo(timestamp, now);
  if (difference <= 0) {
    if (elapsed < 60_000) return 'Just now';
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
    return `${Math.floor(elapsed / 3_600_000)}h ago`;
  }
  const day = new Date(timestamp);
  if (grouped) return day.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (difference === 1) return 'Yesterday';
  return day.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    ...(day.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  });
}
