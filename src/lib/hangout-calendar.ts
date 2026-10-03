/**
 * «أضفها للتقويم» — the plan, as a calendar entry, with no server.
 *
 * A proposal that is accepted in the chat dies in the chat: by the time the
 * evening comes nobody can find the message under the two hundred since. The
 * export has nowhere to write a file per plan, so the entry is composed here
 * in the browser (RFC 5545 text, handed over as a download) and, for whoever
 * lives in Google Calendar, as the template link that app accepts.
 *
 * Pure, so it is unit-tested in Node and ported to Dart byte for byte
 * (`flutter_app/lib/share/hangout_calendar.dart`, the parity fixtures replay
 * it). Imports the type of a place and the dates module, nothing else.
 *
 * Two kinds of plan get no entry, on purpose. «الحين» and «بعد ساعة» carry a
 * day and no hour, and a reminder for the next hour reminds nobody. And a
 * plan whose link has no day (sent before 3 October) has no date to put in a
 * calendar — the button simply does not appear.
 */
import type { Place } from "@/lib/places";
import { EVENING_DEFAULT_HOUR, addDays, resolvePlan, type Day, type ResolvedPlan, type WhenId } from "@/lib/plan-date";

export { hasCalendarEntry } from "@/lib/plan-date";

export type CalendarEntry = {
  /** The RFC 5545 text, CRLF line ends, folded at 75 octets. */
  ics: string;
  /** Google Calendar's «add this» page for the same entry. */
  google: string;
  filename: string;
};

const DURATION_MIN = 120;

/** `\ , ;` and newlines, as RFC 5545 wants them in TEXT values. The Arabic
 * comma «،» is not a comma to a calendar and is left alone. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Lines may be 75 OCTETS long, not characters — in Arabic every letter is
 * two — and a fold must not split a code point, or the reader sees a broken
 * letter where the line turned. Continuations begin with one space, which
 * counts against their 75, so they carry 74 of content.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = " ";
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A Kuwait wall-clock moment as the UTC stamp a calendar wants (`…Z`). */
export function kuwaitToUtcStamp(day: Day, hour: number, minute: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, hour - 3, minute));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00Z`;
}

/** `YYYYMMDD`, for an all-day value. */
export const dateStamp = (day: Day): string => day.replace(/-/g, "");

function stampNow(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Deterministic, so the same plan is the same entry wherever it is added. */
export function icsUid(slug: string, when: WhenId, day: Day): string {
  return `${day}-${when}-${slug}@wainkw.com`;
}

export function icsFilename(slug: string, day: Day): string {
  return `wain-${slug}-${day}.ics`;
}

/**
 * The entry for one place at one plan. `phrase` is what the message said —
 * «عقب المغرب», «باچر الخميس» — and is printed as said; the hour a calendar
 * needs is added beside it with the label its kind requires (plan-date.ts).
 */
export function calendarEntry(opts: {
  place: Place;
  when: WhenId;
  day: Day;
  phrase: string;
  url: string;
  mapsUrl: string;
  now?: Date;
}): CalendarEntry {
  const { place, when, day, phrase, url, mapsUrl, now = new Date() } = opts;
  const plan: ResolvedPlan = resolvePlan(when, day, now);
  const hour = plan.hour ?? EVENING_DEFAULT_HOUR;
  const start = kuwaitToUtcStamp(plan.date, hour, plan.minute);
  const end = kuwaitToUtcStamp(plan.date, hour, plan.minute + DURATION_MIN);

  const summary = `طلعة — ${place.nameAr}`;
  const location = `${place.nameAr}، ${place.areaAr}`;
  const note =
    plan.hourKind === "approx"
      ? "الوقت تقريبي — عقب المغرب."
      : plan.hourKind === "default"
        ? "الساعة ٨ افتراضية — الرسالة قالت اليوم بس."
        : "";
  const description = [phrase, note, `الموقع: ${mapsUrl}`, url].filter(Boolean).join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//wain//hangout//AR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${icsUid(place.slug, when, day)}`,
    `DTSTAMP:${stampNow(now)}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(summary)}`,
    `LOCATION:${icsEscape(location)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `GEO:${place.lat};${place.lng}`,
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const ics = lines.map(foldLine).join("\r\n") + "\r\n";

  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: summary,
    dates: `${start}/${end}`,
    details: description,
    location,
    ctz: "Asia/Kuwait",
  });
  return { ics, google: `https://calendar.google.com/calendar/render?${q}`, filename: icsFilename(place.slug, day) };
}

/**
 * Hand the entry to the browser as a file. A Blob and an `<a download>`:
 * Chrome and Firefox save it and most phones offer the calendar from the
 * download; what iOS Safari does with a blob `.ics` is a thing to watch on a
 * phone, not something this code can know — which is why the Google link is
 * drawn beside the button rather than behind a failure.
 */
export function downloadCalendar(entry: CalendarEntry): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([entry.ics], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = entry.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export { addDays };
