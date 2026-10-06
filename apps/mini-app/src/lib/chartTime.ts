/**
 * lightweight-charts formats every axis tick and crosshair time as UTC. Shifting
 * a series by the viewer's UTC offset makes those labels read in local time.
 *
 * One offset, taken at the newest bar, applies to the whole series: per-bar
 * offsets would fold a daylight-saving change into duplicate or reversed times,
 * which the chart rejects.
 */
export function localTimeShiftSeconds(
  newestUnixSeconds: number | undefined,
  timezoneOffsetMinutesAt: (epochMs: number) => number = (epochMs) => new Date(epochMs).getTimezoneOffset(),
): number {
  if (newestUnixSeconds === undefined || !Number.isFinite(newestUnixSeconds)) return 0;
  const offsetMinutes = timezoneOffsetMinutesAt(newestUnixSeconds * 1_000);
  // getTimezoneOffset() is positive west of UTC, so local time is UTC minus it.
  return offsetMinutes === 0 ? 0 : -offsetMinutes * 60;
}
