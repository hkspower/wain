/**
 * Which place شوق names first — one ordering, used by /search and by سالم.
 *
 * Until 3 October the two disagreed about the same question. /search named
 * whatever the search scored highest; /salem passed the same hits through
 * `reorderByReviews` first, so «وين أتعشى» could get one place on the page and
 * another in the chat. And neither knew what month it was: «قهوة» at two in
 * the afternoon in August led with a tea house in an open courtyard, and
 * «مطعم رخيص» led with the dearest grill in the catalogue, because «رخيص» is a
 * word in the query and not a constraint on the answer.
 *
 * So the answer is ordered here, once:
 *
 *  1. The search's own score, which says what MATCHES.
 *  2. The season: in the Kuwaiti summer, by day, a place the sun ruins is
 *     pushed down — an open-air one to 0.6 of its score, a half-covered one
 *     to 0.9 — unless the question asks for the outdoors or the evening
 *     («بحر», «برا», «بالليل», «عشا»…), in which case the visitor has
 *     already chosen the heat or the hour, and is answered as asked. At night
 *     nothing is pushed: the reason has gone down with the sun.
 *  3. The price: «رخيص», «ميزانية», «مو غالي» halve any place above the
 *     cheapest band.
 *  3b. Inside: «داخلي», «مكيّف» push an open-air place to 0.3 of its score and
 *     a half-covered one to 0.7, in any month — the visitor said where they
 *     want to be. Added 3 October for سالم's «داخلي» chip: «قهوة» then
 *     «داخلي» led with the tea houses in an open courtyard, because the word
 *     only nudged the search and the order did not know it was a constraint.
 *  4. Reviews, last and only within a band of near-equal matches
 *     (`reorderByReviews` — see place-reviews.ts for what those figures are
 *     and why they may order but never be quoted).
 *
 * Multipliers rather than filters, for the reason the search's own damping
 * gives: when nothing cheap or shaded fits, the best of the rest is still the
 * answer — it just must not come first.
 *
 * And a question with no topic at all — «وين أروح الحين», «زهقان» — gets a
 * pick for the hour instead of «ما لقيت شي» (`defaultPicks`).
 *
 * Deterministic in (query, month, hour), so a test can name the month and the
 * hour; the callers pass Kuwait's (`kuwaitClock`), never the device's.
 *
 * Takes the live rows as an argument and imports only their TYPE — the
 * catalogue stays where `usePlaces()` already put it.
 */
import type { Place } from "@/lib/places";
import { reorderByReviews } from "@/lib/place-reviews";
import { isKuwaitNight, isSummerMonth, kuwaitHour, kuwaitMonth } from "@/lib/kuwait-time";
import { NEGATORS, isTopicless, normalise, tokenize, type SearchHit, type SearchIndex } from "@/lib/search";

export interface AnswerClock {
  /** Kuwait's month, 0-based. */
  month: number;
  /** Kuwait's hour, 0–23. */
  hour: number;
}

/** Kuwait's month and hour, now — what every caller on a page passes. */
export function kuwaitClock(now: Date = new Date()): AnswerClock {
  return { month: kuwaitMonth(now), hour: kuwaitHour(now) };
}

/** How much the summer takes off a place the sun ruins, by day. */
export const SUMMER_OUTDOOR = 0.6;
export const SUMMER_MIXED = 0.9;
/** How much «رخيص» takes off a place above the cheapest band. */
export const NOT_CHEAP = 0.5;
/** How much «داخلي» takes off a place that is open-air, or half of it. */
export const INSIDE_OUTDOOR = 0.3;
export const INSIDE_MIXED = 0.7;

const fold = (words: string[]) => new Set(words.map(normalise));

/**
 * Words that choose the outdoors or the evening. Folded the way a token
 * arrives; matched with a clitic off too, so «بالليل» and «عالبحر» count.
 */
const ASKS_OUTSIDE = fold([
  // the evening
  "ليل", "ليله", "سهره", "سهر", "اسهر", "نسهر", "مغرب", "غروب", "عشا", "عشاء", "اتعشى", "نتعشى", "تعشى",
  // the outdoors, by name
  "برا", "بره", "مكشوف", "بحر", "شاطئ", "شواطئ", "بيتش", "بر", "كشته", "صحراء", "حديقه", "حدائق",
]);
/** Words that ask to be inside. «مكيّف» folds to «مكيف». */
const ASKS_INSIDE = fold(["داخلي", "داخل", "مكيف", "مكيفه", "مسكر", "مغلق", "indoor"]);
/** And words that ask for the cheap end. «مو غالي» is read below. */
const ASKS_CHEAP = fold(["رخيص", "رخيصه", "ارخص", "ميزانيه", "اقتصادي", "بلاش", "ببلاش"]);
const DEAR = fold(["غالي", "غاليه", "مكلف"]);
const NEGATOR_SET = fold(NEGATORS);

/** A token, and the word under one clitic: «بالليل» → «ليل». */
function readings(t: string): string[] {
  const out = [t];
  const bare = t.replace(/^(عال|بال|وال|لل|[وبلفع])/, "");
  if (bare !== t && bare.length > 1) out.push(bare.startsWith("ال") && bare.length > 3 ? bare.slice(2) : bare);
  return out;
}

/** What the question asks of the answer, beyond what it matches. */
export function readAsks(query: string): { outside: boolean; cheap: boolean; inside: boolean } {
  const raw = tokenize(query);
  const has = (set: Set<string>) => raw.some((t) => readings(t).some((r) => set.has(r)));
  // «مو غالي», «ما أبي شي غالي»: a negator anywhere before a word for dear.
  const notDear = raw.some((t, i) => DEAR.has(t) && raw.slice(0, i).some((w) => NEGATOR_SET.has(w)));
  return { outside: has(ASKS_OUTSIDE), cheap: has(ASKS_CHEAP) || notDear, inside: has(ASKS_INSIDE) };
}

type Rankable = Pick<Place, "slug" | "setting" | "summerOk" | "priceLevel">;

/** The multiplier the season and the price put on one place's score. */
export function answerFactor(
  p: Rankable,
  asks: { outside: boolean; cheap: boolean; inside?: boolean },
  clock: AnswerClock
): number {
  let f = 1;
  if (asks.inside) {
    // Said, not inferred: no season and no `summerOk` changes it — the
    // causeway is fine in August from a car, and still not inside.
    if (p.setting === "outdoor") f *= INSIDE_OUTDOOR;
    else if (p.setting === "mixed") f *= INSIDE_MIXED;
  } else if (isSummerMonth(clock.month) && !isKuwaitNight(clock.hour) && !asks.outside && !p.summerOk) {
    if (p.setting === "outdoor") f *= SUMMER_OUTDOOR;
    else if (p.setting === "mixed") f *= SUMMER_MIXED;
  }
  if (asks.cheap && p.priceLevel > 1) f *= NOT_CHEAP;
  return f;
}

/**
 * A pick for a question with no topic, by the hour and the season, from the
 * catalogue's own tags and best times. The hour decides what kind of outing;
 * the tags find the places; a best time that names this part of the day comes
 * before one that does not — «وين أروح الحين» at two in the afternoon was
 * answered «جرّب الأفنيوز… روح الصبح» until it did; then the rating, then
 * catalogue order.
 *
 *  - Summer, by day: indoors and cooled, with somewhere to eat — the heat is
 *    the whole of the question.
 *  - Evening and night (from five): «سهرة» by the sea — the cafés on the
 *    water are where Kuwait goes after dark.
 *  - Morning: a walk, outdoors, before the day warms up.
 *  - The rest of a mild day: the sea and a promenade.
 */
const SLOTS: { when: (c: AnswerClock) => boolean; tags: string[]; indoorOnly?: boolean; outdoorOnly?: boolean }[] = [
  { when: (c) => isSummerMonth(c.month) && !isKuwaitNight(c.hour), tags: ["مكيّف", "مطاعم"], indoorOnly: true },
  { when: (c) => c.hour >= 17 || c.hour < 5, tags: ["سهرة", "بحر"] },
  { when: (c) => c.hour < 11, tags: ["مشي"], outdoorOnly: true },
  { when: () => true, tags: ["بحر", "ممشى"] },
];

/** The words a best time uses for each part of the day. */
const PART_WORDS: { from: number; to: number; words: RegExp }[] = [
  { from: 5, to: 12, words: /(الصبح|بدري)/ },
  { from: 12, to: 17, words: /(العصر|الظهر|الغدا)/ },
  { from: 17, to: 29, words: /(المغرب|الغروب|الليل|ليالي|العشا)/ },
];
function fitsHour(bestTimeAr: string, hour: number): boolean {
  const h = hour < 5 ? hour + 24 : hour;
  const part = PART_WORDS.find((x) => h >= x.from && h < x.to);
  return part ? part.words.test(bestTimeAr) : false;
}

export function defaultPicks<P extends Rankable & Pick<Place, "tagsAr" | "rating" | "bestTimeAr">>(
  places: P[],
  clock: AnswerClock,
  limit = 8
): P[] {
  const slot = SLOTS.find((s) => s.when(clock))!;
  const scored = places
    .map((p, i) => ({
      p,
      i,
      n: slot.tags.filter((t) => p.tagsAr.includes(t)).length,
      fits: fitsHour(p.bestTimeAr, clock.hour) ? 1 : 0,
    }))
    .filter(
      ({ p, n }) =>
        n > 0 &&
        (!slot.indoorOnly || p.setting === "indoor") &&
        (!slot.outdoorOnly || p.setting !== "indoor")
    );
  scored.sort((a, b) => b.n - a.n || b.fits - a.fits || (b.p.rating ?? 0) - (a.p.rating ?? 0) || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.p);
}

const slugOf = (h: SearchHit) => h.doc.id.replace(/^place:/, "");

/**
 * The search's hits in the order the answer gives them.
 *
 * Only the PLACE hits move, and only among the slots places already hold, so a
 * category or a page stays where the search put it and the list, the map and
 * her answer all read the same first place. A topicless question is answered
 * with `defaultPicks`, drawn from the index's own documents so the list can
 * show them exactly as it shows any other result; `fallback` says so.
 */
export function answerOrder(
  query: string,
  hits: SearchHit[],
  index: SearchIndex,
  places: (Rankable & Pick<Place, "tagsAr" | "rating" | "bestTimeAr">)[],
  clock: AnswerClock = kuwaitClock()
): { hits: SearchHit[]; fallback: boolean } {
  if (isTopicless(query)) {
    const docs = new Map(index.docs.map((d) => [d.id, d]));
    const picked = defaultPicks(places, clock).flatMap((p, i) => {
      const doc = docs.get(`place:${p.slug}`);
      return doc ? [{ doc, score: 1 - i / 100, matched: [] }] : [];
    });
    return { hits: picked, fallback: true };
  }

  const asks = readAsks(query);
  const bySlug = new Map(places.map((p) => [p.slug, p]));
  const scored = hits
    .filter((h) => h.doc.kind === "place")
    .map((h) => {
      const p = bySlug.get(slugOf(h));
      return { h, s: h.score * (p ? answerFactor(p, asks, clock) : 1) };
    })
    // Array#sort is stable, so equal scores keep the search's order.
    .sort((a, b) => b.s - a.s);
  const ordered = reorderByReviews(scored, (x) => x.s, (x) => slugOf(x.h)).map((x) => x.h);
  let k = 0;
  return { hits: hits.map((h) => (h.doc.kind === "place" ? ordered[k++] : h)), fallback: false };
}
