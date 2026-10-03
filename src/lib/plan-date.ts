/**
 * When, exactly, is «باچر»?
 *
 * A hangout link used to carry only the time id (`?when=tomorrow`), and the
 * module that wrote it said so itself: «الحين», «باچر» and «الويكند» are
 * relative to the moment the message was sent, and the link does not carry
 * that moment — so an invite for «الحين» opened three hours later is stale and
 * nothing here can know it. Only the four fixed evening slots could ever be
 * shown as passed. Now the link carries the Kuwait calendar day it was sent
 * (`d=2026-10-03`), and this module turns id + day into a plan with a date:
 * the weekday to print beside «باچر», whether it has gone by, and the hour a
 * calendar entry should carry.
 *
 * Its own module, importing only the clock: `ShareHangout`, the banner and
 * /pick all need it, and so does the calendar builder, which must not drag
 * the planner's voice lines along. Everything below is computed on the UTC+3
 * clock — a link opened in London or Delhi still answers for Kuwait.
 *
 * A link WITHOUT a day behaves exactly as before: `resolvePlan` is only
 * called with one, and `invitePassed` keeps its hour-only branch for the
 * links already in people's chats.
 */
import { kuwaitDay, kuwaitHour } from "@/lib/kuwait-time";

export type WhenId =
  | "now"
  | "soon"
  | "sunset"
  | "tonight-7"
  | "tonight-8"
  | "tonight-9"
  | "tonight-10"
  | "tomorrow"
  | "weekend";

export const DAY_PARAM = "d";

/** `YYYY-MM-DD`, Kuwait's calendar. Compares lexicographically. */
export type Day = string;

/**
 * A day out of a link, or null. The regex alone would accept 2026-02-30, so
 * the parts are round-tripped through Date.UTC and must come back unchanged.
 */
export function parseDay(raw: string | null | undefined): Day | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? raw : null;
}

/** Date arithmetic through Date.UTC, so month, year and leap rollover are free. */
export function addDays(day: Day, n: number): Day {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: Day): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const WEEKDAY_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/**
 * Kuwait City's sunset, mid-month, as [hour, minute] on the UTC+3 clock —
 * APPROXIMATE, within about fifteen minutes across a month, and never
 * presented as the minute the sun goes down. «عقب المغرب» is a phrase, not a
 * clock time; this table exists only so a calendar entry for it lands in the
 * right hour, and the entry says «تقريباً» wherever it shows.
 */
export const SUNSET_KW: ReadonlyArray<readonly [number, number]> = [
  [17, 15], [17, 35], [17, 55], [18, 15], [18, 35], [18, 55],
  [18, 55], [18, 35], [18, 0], [17, 25], [17, 5], [16, 55],
];

/** The hour a calendar gives «باچر» and «الويكند», which name no hour. */
export const EVENING_DEFAULT_HOUR = 20;

/**
 * Where an hour came from, because two of the kinds must be labelled when
 * printed and one must never be printed at all:
 *  - fixed:   the sender chose it («الليلة الساعة ٨»);
 *  - approx:  sunset, from the table — say «تقريباً»;
 *  - default: «باچر» named no hour; 20:00 is the calendar's guess and stays
 *             inside the calendar entry, flagged there;
 *  - none:    «الحين» — the day is known and the hour is not.
 */
export type HourKind = "fixed" | "approx" | "default" | "none";

export type ResolvedPlan = {
  /** The day the plan is for. */
  date: Day;
  hour: number | null;
  minute: number;
  hourKind: HourKind;
  weekday: number;
  weekdayAr: string;
  /** Gone by, judged on Kuwait's clock at `now`. */
  passed: boolean;
};

const TONIGHT: Record<string, number> = { "tonight-7": 19, "tonight-8": 20, "tonight-9": 21, "tonight-10": 22 };

/**
 * The plan a link means, given the day it was sent.
 *
 * «الويكند» said on a Friday means this weekend, not the next one — so Friday
 * resolves to Saturday and every other day to the coming Friday. A day plan
 * has passed once Kuwait's date is past it (the weekend: past its Saturday);
 * a timed plan once the hour is, on its day. Sunset is a window, not an
 * instant, and is judged by the planner's own DAY_ENDS, seven o'clock.
 */
export function resolvePlan(when: WhenId, day: Day, now: Date = new Date()): ResolvedPlan {
  const today = kuwaitDay(now);
  const hour = kuwaitHour(now);
  const at = (date: Day, h: number | null, minute: number, hourKind: HourKind, passed: boolean): ResolvedPlan => {
    const wd = weekday(date);
    return { date, hour: h, minute, hourKind, weekday: wd, weekdayAr: WEEKDAY_AR[wd], passed };
  };
  if (when === "tomorrow") {
    const date = addDays(day, 1);
    return at(date, EVENING_DEFAULT_HOUR, 0, "default", today > date);
  }
  if (when === "weekend") {
    const wd = weekday(day);
    const date = addDays(day, wd === 5 ? 1 : (5 - wd + 7) % 7);
    const saturday = wd === 5 ? date : addDays(date, 1);
    return at(date, EVENING_DEFAULT_HOUR, 0, "default", today > saturday);
  }
  if (when === "sunset") {
    const [h, m] = SUNSET_KW[Number(day.slice(5, 7)) - 1];
    return at(day, h, m, "approx", today > day || (today === day && hour >= 19));
  }
  if (when in TONIGHT) {
    const h = TONIGHT[when];
    return at(day, h, 0, "fixed", today > day || (today === day && hour >= h));
  }
  // «الحين», «بعد ساعة»: the day is known, the hour is not.
  return at(day, null, 0, "none", today > day);
}
