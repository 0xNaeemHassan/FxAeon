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

/** What a scrubbed chart shows in place of the live price. Display only. */
export type ChartScrubReading = {
  price: number;
  /** Change from the range's first open; null when the range has no usable start. */
  changePercent: number | null;
  /** The hovered bar's real time, without the display shift above. */
  unixSeconds: number;
};

export function scrubChangePercent(firstOpen: number | undefined, price: number): number | null {
  if (firstOpen === undefined || !Number.isFinite(firstOpen) || firstOpen <= 0 || !Number.isFinite(price)) return null;
  return ((price - firstOpen) / firstOpen) * 100;
}

/** The hovered moment in the viewer's own zone: the time within an hour, a date and time beyond it. */
export function formatScrubTime(unixSeconds: number, range: '1H' | '1D' | '7D' | '30D', locale?: string, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = range === '1H'
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(unixSeconds * 1_000));
}
