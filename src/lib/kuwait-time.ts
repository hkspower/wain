/**
 * Kuwait's clock: UTC+3 all year, no daylight saving to drift on.
 *
 * Its own module because two kinds of page need it. The hangout planner does,
 * and so does /find, which needs only the hour and the month — and importing
 * them from hangout.ts carried the planner and its voice lines into /find's
 * chunk, 1.7K gzipped for three lines of arithmetic. Nothing here may import
 * anything.
 */

/** Kuwait's wall-clock hour. UTC+3 all year — no daylight saving to drift on. */
export function kuwaitHour(now: Date = new Date()): number {
  return new Date(now.getTime() + 3 * 3600_000).getUTCHours();
}

/**
 * How long until this list changes.
 *
 * Every expiry above is on the hour, so nothing about the offer changes in
 * between and there is nothing for a ticking interval to see. The panel uses
 * this to wake up once, at the moment the offer actually moves.
 *
 * Computed in Kuwait's own hour rather than the device's: an hour boundary
 * here is not an hour boundary in Tehran or Delhi, and half-hour zones are
 * exactly where a «round it to the next local hour» shortcut goes wrong.
 */
export function msToNextKuwaitHour(now: Date = new Date()): number {
  const kuwait = now.getTime() + 3 * 3600_000;
  return 3600_000 - (((kuwait % 3600_000) + 3600_000) % 3600_000);
}

/** Kuwait's calendar month, 0-based, on the same UTC+3 clock as the hour. */
export function kuwaitMonth(now: Date = new Date()): number {
  return new Date(now.getTime() + 3 * 3600_000).getUTCMonth();
}

/**
 * Kuwait's calendar day as `YYYY-MM-DD`, on the same clock. The hangout link
 * carries this (plan-date.ts), so «باچر» has a date to be tomorrow OF; read
 * off the shifted instant's UTC parts, never off the device's own date.
 */
export function kuwaitDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

/**
 * June to September in Kuwait — daytime highs around 45–50°C, when an open-air
 * recommendation stops being a recommendation. Months are 0-based, as from
 * Date#getMonth.
 */
export function isSummerMonth(month: number): boolean {
  return month >= 5 && month <= 8;
}

/**
 * Seven in the evening to five in the morning: the hours when «don't go
 * until after sunset» has already come true.
 *
 * Asked at nine at night in August, شوق used to say «بس هذي أيام حر — لا
 * تروح إلا بعد المغرب» about a beach the visitor could walk onto that minute,
 * and the search pushed the same beach down as if it were noon. Nineteen is
 * the hangout planner's DAY_ENDS for the same reason — by seven the outing
 * everybody actually makes has begun — and five is before the sun is up.
 */
export function isKuwaitNight(hour: number): boolean {
  return hour >= 19 || hour < 5;
}
