"use client";

import type { Place } from "@/lib/places";
import { GENERIC_LINES, isSummerMonth, summerKey } from "@/lib/voice-lines";
import { kuwaitDay, kuwaitHour, kuwaitMonth } from "@/lib/kuwait-time";
import { DAY_PARAM, parseDay, resolvePlan, type Day, type WhenId } from "@/lib/plan-date";

export type { Day, WhenId } from "@/lib/plan-date";
export { DAY_PARAM, resolvePlan } from "@/lib/plan-date";

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
 *
 * «عقب المغرب» (3 October, on request) is the phrase شوق herself uses for
 * every summer plan, and it was the one time the panel could not send. It
 * sits first among the evening options; it goes at seven, when «الحين» is
 * already after sunset. No clock time is attached to it anywhere a person
 * reads — the calendar entry alone turns it into an hour, and says
 * «تقريباً» when it does (plan-date.ts, SUNSET_KW).
 */
const ALL: (WhenOption & { afterHour?: number })[] = [
  { id: "now", labelAr: "الحين", phraseAr: "الحين" },
  { id: "soon", labelAr: "بعد ساعة", phraseAr: "بعد ساعة" },
  { id: "sunset", labelAr: "عقب المغرب", phraseAr: "عقب المغرب", afterHour: 19 },
  { id: "tonight-7", labelAr: "٧ مساءً", phraseAr: "الليلة الساعة ٧", afterHour: 19 },
  { id: "tonight-8", labelAr: "٨ مساءً", phraseAr: "الليلة الساعة ٨", afterHour: 20 },
  { id: "tonight-9", labelAr: "٩ مساءً", phraseAr: "الليلة الساعة ٩", afterHour: 21 },
  { id: "tonight-10", labelAr: "١٠ مساءً", phraseAr: "الليلة الساعة ١٠", afterHour: 22 },
  { id: "tomorrow", labelAr: "باچر", phraseAr: "باچر" },
  { id: "weekend", labelAr: "الويكند", phraseAr: "الويكند" },
];

// The clock lives in kuwait-time.ts so that a page needing only the hour
// does not carry the hangout planner with it; re-exported, so every caller
// of these names is unchanged.
export { kuwaitDay, kuwaitHour, kuwaitMonth, msToNextKuwaitHour } from "@/lib/kuwait-time";

/**
 * How many places the panel offers to switch between, on /search and in
 * سالم's chat alike. /search had five and the chat offered every result,
 * which on «مطعم» was a row of twenty chips — a menu, not a choice.
 */
export const CHOICE_MAX = 5;

/**
 * Daylight, for the purpose of "would this plan cook them".
 *
 * Nine to seven rather than sunrise to sunset: the point is not astronomical,
 * it is that the tarmac is unbearable across those hours in July, and by seven
 * the outing everybody actually makes has begun.
 */
const DAY_STARTS = 9;
const DAY_ENDS = 19;

/**
 * Does an outing to this place, arriving at this hour, land in the summer sun?
 *
 * `summerOk` is the catalogue's own escape hatch — the causeway is outdoors
 * and fine in August because you are inside an air-conditioned car — so it is
 * honoured here exactly as the spoken path honours it.
 */
function bakesInTheSun(place: Place | undefined, arrivalHour: number, month: number): boolean {
  if (!place || place.summerOk === true || place.setting === "indoor") return false;
  return isSummerMonth(month) && arrivalHour >= DAY_STARTS && arrivalHour < DAY_ENDS;
}

/**
 * The choices worth offering at this hour — and, given a place, at this time
 * of year.
 *
 * The place is optional because the panel has one and the clock does not, but
 * passing it is what stops the share sheet composing a plan the rest of the
 * site would refuse to make. شوق will not send anyone to an unshaded beach at
 * noon in August; `defaultWhen` already declines to *suggest* it. Yet «الحين»
 * sat in the list anyway, one tap away, and the message that came out carried
 * no hint that the plan was a bad one — so the site's most emphatic rule held
 * everywhere except the button that actually sends the plan to five people.
 *
 * Only the daytime slots go, and only for a place that would genuinely bake.
 * In December «الحين» for a beach is the best answer there is, and in any
 * month an indoor place is unaffected.
 */
export function whenOptions(now: Date = new Date(), place?: Place): WhenOption[] {
  const hour = kuwaitHour(now);
  const month = kuwaitMonth(now);
  return ALL.filter((o) => {
    if (o.afterHour !== undefined && hour >= o.afterHour) return false;
    if (o.id === "now" && bakesInTheSun(place, hour, month)) return false;
    if (o.id === "soon" && bakesInTheSun(place, hour + 1, month)) return false;
    return true;
  }).map(({ id, labelAr, phraseAr }) => ({ id, labelAr, phraseAr }));
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
  // In summer an open-air place is proposed for after sunset — the words شوق
  // says about it, and until 3 October the one time this panel could not
  // offer. Before seven only: after it «عقب المغرب» is the present tense.
  if (!daytimeIsFine && isSummerMonth(kuwaitMonth(now)) && options.has("sunset")) return "sunset";
  // Daytime starts at nine, and the lower bound is the whole point of this
  // line. `hour < 12` alone is every hour before noon — including two in the
  // morning, where it proposed «بعد ساعة» for an indoor place and offered the
  // group a mall at three. Nobody sends that. Below nine the next plan anybody
  // would actually propose is the coming evening, which is what the outdoor
  // branch has always given and what these hours now fall through to.
  if (hour >= 9 && hour < 12 && daytimeIsFine && options.has("soon")) return "soon";
  if (options.has("tonight-8")) return "tonight-8";
  if (options.has("tonight-10")) return "tonight-10";
  return "tomorrow";
}

export function phraseFor(id: WhenId): string {
  return ALL.find((o) => o.id === id)?.phraseAr ?? "";
}

/**
 * The phrase with its day, when the day is known: «باچر الخميس», «الويكند —
 * الجمعة». A message is read tomorrow morning and a link is opened days
 * later; «باچر» on its own means a different day to each reader. Only the two
 * day-words gain a weekday — «الليلة الساعة ٨» already says which night, and
 * the hour a calendar guesses for «باچر» is never printed here (plan-date.ts).
 */
export function planPhrase(id: WhenId, day: Day | null | undefined, now: Date = new Date()): string {
  const phrase = phraseFor(id);
  if (!day || !phrase) return phrase;
  const plan = resolvePlan(id, day, now);
  if (id === "tomorrow") return `${phrase} ${plan.weekdayAr}`;
  if (id === "weekend") return `${phrase} — ${plan.weekdayAr}`;
  return phrase;
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
  now?: Date;
}): string {
  const { place, when, url, now = new Date() } = opts;

  /* The heat warning travels with the plan.
   *
   * Dropping «الحين» from the chips stops the worst case, but two of the
   * remaining choices are not times at all: «باچر» and «الويكند» are days, and
   * in July a day means the sun. The group reads this message tomorrow morning
   * and heads out at eleven. So the same sentence شوق says out loud is written
   * into the message, and it is imported from voice-lines rather than retyped
   * so the spoken and the written advice cannot drift apart.
   *
   * The evening slots say nothing: «لا تروح إلا بعد المغرب» underneath a plan
   * that already says «الليلة الساعة ٨» is noise, and noise is what gets a
   * warning ignored the one time it matters. */
  const month = kuwaitMonth(now);
  const hour = kuwaitHour(now);
  const arrival = when === "now" ? hour : when === "soon" ? hour + 1 : DAY_STARTS + 2;
  const daytimePlan = when === "now" || when === "soon" || when === "tomorrow" || when === "weekend";
  // `summerKey`, not «mixed or outdoor»: a market that is over by noon was
  // told «لا تروح إلا عقب المغرب», and the group would have arrived to an
  // empty lot. The morning places get «روح بدري الصبح» here as they do out
  // loud (3 October).
  const heat = daytimePlan && bakesInTheSun(place, arrival, month) ? GENERIC_LINES[summerKey(place)] : "";

  const lines = [
    `${place.nameAr} — ${place.areaAr} 📍`,
    // The message is composed at the moment of sending, so the day is always
    // known here — «باچر الخميس», never a bare «باچر» that means a different
    // day to whoever reads it next morning.
    planPhrase(when, kuwaitDay(now), now),
    "",
    place.taglineAr,
    ...(heat ? [heat] : []),
    "",
    `الموقع: ${mapsUrl(place)}`,
    url,
  ];
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* The invitation, carried by the link itself                          */
/* ------------------------------------------------------------------ */

/**
 * The message carried a time. The link did not — and the link is what gets
 * forwarded.
 *
 * This module opens by saying that «شرايكم؟» with a link is a new thread, and
 * that what ends the argument is a proposal: this place, at this time. The
 * message was built exactly that way, and then the URL inside it was the bare
 * place page. So the first person to forward just the link — which is what
 * people do, because tapping a link and hitting forward is one gesture — sent
 * the group back to «شرايكم؟» with the one thing that made it a plan stripped
 * off. The promise held only for as long as nobody passed it on.
 *
 * Now the time rides in the URL, so whoever opens it is looking at the
 * invitation rather than at a place that happens to be nice.
 */
export const INVITE_PARAM = "when";

/**
 * Built from the slug rather than from the address bar.
 *
 * `window.location.href` was the old source, and it compounds: someone who
 * arrived through an invitation and shared onwards would have produced
 * `?when=tonight-8?when=tomorrow` — or worse, silently kept the first time on
 * a share of the second. A canonical URL cannot drift like that, and it also
 * strips whatever else happens to be in the bar.
 */
export function inviteUrl(place: Place, when: WhenId, origin: string, day?: Day | null): string {
  const base = `${origin.replace(/\/+$/, "")}/places/${place.slug}/?${INVITE_PARAM}=${when}`;
  // The day it was sent, so «باچر» has a date to be tomorrow of and a link
  // opened next week can say the plan has gone (plan-date.ts). Optional, so
  // every link already in a chat keeps meaning what it meant.
  return day ? `${base}&${DAY_PARAM}=${day}` : base;
}

/** The sending day in a link, or null — absent on links from before 3 October. */
export function readInviteDay(search: string): Day | null {
  return parseDay(new URLSearchParams(search).get(DAY_PARAM));
}

/**
 * The time in a link, or null.
 *
 * Validated against the known ids rather than trusted, because this value
 * arrives from whatever anyone chose to paste and is about to be rendered.
 * An unrecognised one is not an error to report — it is simply not an
 * invitation, and the page carries on as an ordinary place page.
 */
export function readInvite(search: string): WhenId | null {
  const raw = new URLSearchParams(search).get(INVITE_PARAM);
  return raw && ALL.some((o) => o.id === raw) ? (raw as WhenId) : null;
}

/**
 * Has the invited hour already gone?
 *
 * Only answerable for the four fixed evening slots, and only those are
 * claimed. «الحين», «باچر» and «الويكند» are relative to the moment the
 * message was sent, and the link does not carry that moment — so an invite
 * for «الحين» opened three hours later is stale and nothing here can know it.
 * Saying so would be inventing a fact; the banner shows those as-sent and
 * lets the reader judge, which is what they would do anyway from the chat
 * timestamp sitting directly above the link.
 */
export function invitePassed(when: WhenId, now: Date = new Date(), day?: Day | null): boolean {
  // With the sending day in hand every kind of plan can be judged — a «باچر»
  // from last week has plainly gone. Without it, the paragraph above holds.
  if (day) return resolvePlan(when, day, now).passed;
  const option = ALL.find((o) => o.id === when);
  if (!option || option.afterHour === undefined) return false;
  return kuwaitHour(now) >= option.afterHour;
}

/**
 * «تمام، أنا معكم» — the reply, as one tap.
 *
 * The invitee's half was missing entirely: they could read the plan and then
 * had to go back to the chat and type. Short on purpose — a confirmation that
 * restates the whole proposal is a second proposal, and the group has already
 * had one.
 */
export function inviteAcceptMessage(place: Place, when: WhenId): string {
  return `تمام، أنا معكم 👍 ${place.nameAr} — ${phraseFor(when)}`;
}

/* ------------------------------------------------------------------ */
/* The shortlist: two or three places, and the group picks             */
/* ------------------------------------------------------------------ */

/**
 * «اختاروا» — when the sender has not decided either.
 *
 * Everything above assumes one person has already chosen the place and the
 * group only answers «تمام». Often nobody has: three of them like three
 * places, and the argument is about which. A single-place proposal sent into
 * that just starts the argument over. So the panel can also send a short list
 * with one time on it, and a link that opens those places on a map where each
 * person sends back the one they want (`/pick`, 3 October, on request).
 *
 * Three at most: «اختاروا من ثمانية» is the argument again, on a screen.
 */
export const SHORTLIST_MAX = 3;
export const SHORTLIST_PARAM = "p";
/** The poll a shortlist's votes are counted under (lib/votes.ts). Random per
 *  message sent, so two groups sent the same three places do not share one
 *  count. A link without it still works — the votes go back by WhatsApp
 *  only, as before 7 October. */
export const POLL_PARAM = "v";
const RE_POLL = /^[a-z0-9]{10,16}$/;

/** A fresh poll id: twelve characters of [a-z0-9]. */
export function newPollId(): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

const ORDINAL_AR = ["١", "٢", "٣"];

/** The times that fit every place on the list — the summer rule, for each. */
export function whenOptionsFor(list: Place[], now: Date = new Date()): WhenOption[] {
  const sets = list.map((p) => new Set(whenOptions(now, p).map((o) => o.id)));
  return whenOptions(now).filter((o) => sets.every((s) => s.has(o.id)));
}

/** The first time to offer for a list: the first place's own default, if it
 * fits them all, else the evening, else tomorrow. */
export function defaultWhenFor(list: Place[], now: Date = new Date()): WhenId {
  const ok = new Set(whenOptionsFor(list, now).map((o) => o.id));
  const first = list[0] ? defaultWhen(list[0], now) : "tomorrow";
  if (ok.has(first)) return first;
  if (ok.has("tonight-8")) return "tonight-8";
  if (ok.has("tonight-10")) return "tonight-10";
  return "tomorrow";
}

/** `/pick/?p=a,b,c&when=…` — canonical, from the slugs, like `inviteUrl`. */
export function shortlistUrl(list: Place[], when: WhenId, origin: string, day?: Day | null, poll?: string | null): string {
  const slugs = list.slice(0, SHORTLIST_MAX).map((p) => p.slug).join(",");
  const base = `${origin.replace(/\/+$/, "")}/pick/?${SHORTLIST_PARAM}=${slugs}&${INVITE_PARAM}=${when}`;
  const dated = day ? `${base}&${DAY_PARAM}=${day}` : base;
  return poll && RE_POLL.test(poll) ? `${dated}&${POLL_PARAM}=${poll}` : dated;
}

/**
 * The slugs and the time in a shortlist link. Each slug is checked against
 * the places that exist (`known`), duplicates dropped, three kept — the link
 * is whatever anyone pasted. Fewer than two left is not a shortlist.
 */
export function readShortlist(
  search: string,
  known: (slug: string) => boolean
): { slugs: string[]; when: WhenId | null; day: Day | null; poll: string | null } {
  const params = new URLSearchParams(search);
  const poll = params.get(POLL_PARAM) ?? "";
  const raw = (params.get(SHORTLIST_PARAM) ?? "").split(",").map((s) => s.trim());
  const slugs: string[] = [];
  for (const s of raw) {
    if (/^[a-z0-9-]+$/.test(s) && known(s) && !slugs.includes(s)) slugs.push(s);
    if (slugs.length === SHORTLIST_MAX) break;
  }
  return {
    slugs: slugs.length >= 2 ? slugs : [],
    when: readInvite(search),
    day: readInviteDay(search),
    poll: RE_POLL.test(poll) ? poll : null,
  };
}

/** The map link the messages carry — directions to the pin, not a search. */
export function mapsUrl(place: Place): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
}

/**
 * The message: one time, the places numbered, and the link to vote.
 *
 * Each place gets the same three lines a single plan gets — what it is, why
 * it is worth it, where it is — because the group chooses from THIS message:
 * a bare «١. سوق المباركية — مدينة الكويت» sent three people off to look the
 * places up before they could answer (3 October, on request). The heat line
 * sits inside the block of the place it is about, every place that would
 * bake, not once for the first: «لا تروح إلا عقب المغرب» floating under the
 * list read as if it were about all three.
 */
export function shortlistMessage(opts: { places: Place[]; when: WhenId; url: string; now?: Date }): string {
  const { places: list, when, url, now = new Date() } = opts;
  const month = kuwaitMonth(now);
  const hour = kuwaitHour(now);
  const arrival = when === "now" ? hour : when === "soon" ? hour + 1 : DAY_STARTS + 2;
  const daytimePlan = when === "now" || when === "soon" || when === "tomorrow" || when === "weekend";
  const blocks = list.slice(0, SHORTLIST_MAX).map((p, i) => {
    const hot = daytimePlan && bakesInTheSun(p, arrival, month);
    return [
      `${ORDINAL_AR[i]}. ${p.nameAr} — ${p.areaAr}`,
      p.taglineAr,
      ...(hot ? [GENERIC_LINES[summerKey(p)]] : []),
      `الموقع: ${mapsUrl(p)}`,
    ].join("\n");
  });
  const lines = [`وين نروح ${planPhrase(when, kuwaitDay(now), now)}؟ اختاروا:`, "", blocks.join("\n\n"), "", `صوّتوا هني: ${url}`];
  return lines.join("\n");
}

/**
 * «أنا مع ٢: سوق المباركية 👍» — a vote, as one tap. With the place's own
 * link under it when the page has one: the group's chat then holds the plan
 * for the winner the way a single-place proposal would have, instead of
 * three names and a vote.
 */
export function shortlistVoteMessage(place: Place, position: number, when: WhenId | null, url?: string, day?: Day | null): string {
  const n = ORDINAL_AR[position] ?? String(position + 1);
  const line = `أنا مع ${n}: ${place.nameAr} 👍${when ? ` — ${planPhrase(when, day)}` : ""}`;
  return url ? `${line}\n${url}` : line;
}

/** The share sheet's title for a list. */
export function shortlistTitle(): string {
  return "وين نروح؟ — وين";
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
      // Not `noopener` as a feature string: with it, window.open returns
      // null on SUCCESS as well as on a blocked popup (that is the spec), so
      // every desktop send fell through to the clipboard and the tab opened
      // anyway. Open, then cut the opener by hand. Found while writing the
      // order's send, 3 October, which uses the same shape.
      const opened = window.open(wa, "_blank");
      if (opened) {
        opened.opener = null;
        return "whatsapp";
      }
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
