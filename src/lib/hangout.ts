"use client";

import type { Place } from "@/lib/places";

/**
 * «رسّلها للربع» — turning a place into a plan the group can act on.
 *
 * The whole site is built on one promise: «خلّ الجروب يرتاح — تخلص من نقاش
 * الجروب». It was a promise with nothing behind it. There was no share button
 * anywhere — not on a place page, not in results — so the only way to tell
 * anybody was to copy the URL out of the address bar. Finding the place was
 * solved; telling five people about it was not, and that is the half the
 * argument actually happens in.
 *
 * A link on its own does not stop the argument either. «شرايكم؟» with a link
 * is a new thread. What ends it is a proposal: this place, at this time, with
 * the map already attached — something the group can answer with «تمام» rather
 * than discuss. So a share from here always carries a when.
 *
 * Nothing is stored and nothing is sent to wain. The message is composed in
 * the browser and handed to whatever the visitor already uses, which in Kuwait
 * is WhatsApp.
 */

export type WhenId =
  | "now"
  | "soon"
  | "tonight-7"
  | "tonight-8"
  | "tonight-9"
  | "tonight-10"
  | "tomorrow"
  | "weekend";

export type WhenOption = { id: WhenId; labelAr: string; phraseAr: string };

/**
 * Kuwait's hours, in the words people use.
 *
 * Not a date picker. A group deciding tonight's outing chooses between «الحين»
 * and «بعد المغرب», and asking them for a calendar date to answer «وين نروح
 * الليلة؟» is the kind of precision that makes a thing slower to use than the
 * chat it replaces. Eight fixed phrases cover what actually gets said.
 *
 * The evening hours drop off the list as they pass — offering «الليلة ٧
 * مساءً» at nine o'clock is offering a plan that already failed.
 */
const ALL: (WhenOption & { afterHour?: number })[] = [
  { id: "now", labelAr: "الحين", phraseAr: "الحين" },
  { id: "soon", labelAr: "بعد ساعة", phraseAr: "بعد ساعة" },
  { id: "tonight-7", labelAr: "٧ مساءً", phraseAr: "الليلة الساعة ٧", afterHour: 19 },
  { id: "tonight-8", labelAr: "٨ مساءً", phraseAr: "الليلة الساعة ٨", afterHour: 20 },
  { id: "tonight-9", labelAr: "٩ مساءً", phraseAr: "الليلة الساعة ٩", afterHour: 21 },
  { id: "tonight-10", labelAr: "١٠ مساءً", phraseAr: "الليلة الساعة ١٠", afterHour: 22 },
  { id: "tomorrow", labelAr: "باچر", phraseAr: "باچر" },
  { id: "weekend", labelAr: "الويكند", phraseAr: "الويكند" },
];

/** Kuwait's wall-clock hour. UTC+3 all year — no daylight saving to drift on. */
export function kuwaitHour(now: Date = new Date()): number {
  return new Date(now.getTime() + 3 * 3600_000).getUTCHours();
}

/** The choices worth offering at this hour. */
export function whenOptions(now: Date = new Date()): WhenOption[] {
  const hour = kuwaitHour(now);
  return ALL.filter((o) => o.afterHour === undefined || hour < o.afterHour).map(
    ({ id, labelAr, phraseAr }) => ({ id, labelAr, phraseAr })
  );
}

/**
 * Which one to offer first.
 *
 * Before the evening, the sensible proposal is the evening — Kuwait does its
 * going-out after dark, and for four months of the year an afternoon outdoors
 * is not a proposal at all, it is a warning. Late at night the next realistic
 * plan is tomorrow.
 */
export function defaultWhen(place: Place, now: Date = new Date()): WhenId {
  const hour = kuwaitHour(now);
  const options = new Set(whenOptions(now).map((o) => o.id));
  // An indoor place at midday is a perfectly good idea; an open-air one is not.
  const daytimeIsFine = place.setting === "indoor" || place.summerOk === true;
  if (hour < 12 && daytimeIsFine && options.has("soon")) return "soon";
  if (options.has("tonight-8")) return "tonight-8";
  if (options.has("tonight-10")) return "tonight-10";
  return "tomorrow";
}

export function phraseFor(id: WhenId): string {
  return ALL.find((o) => o.id === id)?.phraseAr ?? "";
}

/**
 * The message itself.
 *
 * Written as one person talking to their group, not as a site announcing
 * itself: the place, where it is, when, and the two links they will actually
 * tap. The wain link goes last because it is the one that keeps working after
 * the outing — the map link is the one they need in the car.
 *
 * Digits are Arabic-Indic throughout. A message that mixes ٨ and 8 reads like
 * it came from software, which is exactly what a message to your friends
 * should not read like.
 */
export function hangoutMessage(opts: {
  place: Place;
  when: WhenId;
  url: string;
}): string {
  const { place, when, url } = opts;
  const lines = [
    `${place.nameAr} — ${place.areaAr} 📍`,
    phraseFor(when),
    "",
    place.taglineAr,
    "",
    `الموقع: https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`,
    url,
  ];
  return lines.join("\n");
}

/** What the native share sheet shows as the title. */
export function hangoutTitle(place: Place): string {
  return `${place.nameAr} — وين؟`;
}

export type ShareOutcome = "shared" | "whatsapp" | "copied" | "cancelled" | "failed";

/**
 * Hand the message to whatever this device actually has, in that order.
 *
 * 1. The native share sheet. On a Kuwaiti phone this is the right answer every
 *    time: it offers WhatsApp first because that is what the person uses, and
 *    it needs no permission and no new tab.
 * 2. WhatsApp directly. Desktop browsers mostly have no share sheet, and
 *    wa.me opens WhatsApp Web or the desktop app.
 * 3. The clipboard, and tell them it is copied. Never a dead end.
 *
 * A cancelled share sheet is not a failure — the visitor changed their mind,
 * and showing them an error for that would be the site arguing with them.
 * AbortError is how every browser reports it.
 */
export async function shareHangout(opts: {
  text: string;
  title: string;
}): Promise<ShareOutcome> {
  const { text, title } = opts;

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      // `url` is deliberately not passed alongside `text`: several Android
      // browsers then send only the URL and drop the message, which loses the
      // time — the one thing that makes this a plan rather than a link. The
      // URL is already the last line of the text.
      await navigator.share({ title, text });
      return "shared";
    } catch (err) {
      // Backing out of the share sheet is a decision, not a fault, and it gets
      // its own outcome so the interface stays quiet instead of reporting an
      // error at somebody who simply changed their mind.
      if ((err as Error)?.name === "AbortError") return "cancelled";
      // Anything else — a share sheet that refused, a browser that lied about
      // having one — falls through to the next option rather than stopping.
    }
  }

  if (typeof window !== "undefined") {
    try {
      const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
      const opened = window.open(wa, "_blank", "noopener,noreferrer");
      if (opened) return "whatsapp";
    } catch {
      /* popup blocked — the clipboard still works */
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    /* no clipboard permission */
  }
  return "failed";
}
