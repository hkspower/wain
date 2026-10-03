/**
 * What people say about each place on Google — as far as it could be found
 * from here, which is not far — and the one thing it is allowed to do.
 *
 * Asked for on 1 October: «improve سالم's choice of the best places according
 * to people's reviews on Google». Every figure below came from a web search's
 * SUMMARY of some page — Wanderlog, bestofkuwait, a travel listing — quoting
 * a Google rating. No Google page was opened: the Maps listings and the pages
 * quoting them are refused by this sandbox's egress gateway, and searching
 * stopped at its budget. Each place was looked up twice, blind; a third look
 * settled disagreements. So a figure here is somebody's report of Google's
 * number on some undated day, and it is used accordingly:
 *
 *  - It may ORDER places that already answer the question equally well
 *    (`reorderByReviews`). Within a band of near-equal matches, the better
 *    reviewed place is named first. It never lifts a weaker match over a
 *    stronger one, and it never adds a place the search did not find. Since
 *    3 October that is done in one place, `answer-order.ts`, for /search and
 *    for سالم alike — it used to be the chat's alone, so the two disagreed.
 *  - It may NOT be said or shown. Not by سالم, not on a card, not on a pin —
 *    until the owner has opened that place on Google Maps and checked it
 *    (`docs/google-reviews-checklist.md`), at which point it can be quoted as
 *    «حسب قوقل» with that date. `audit:reviews` fails if anything but
 *    answer-order.ts imports this file.
 *
 * Fourteen places are not here: five are not one Google listing (three
 * streets, a row of tea houses, a stretch of cafés), seven were not found at
 * all (the Avenues among them), one came back with readings that disagreed
 * (مزارع الوفرة), and one figure was left out on purpose — المدينة الترفيهية's
 * 3.4 from 59, found by one look-up of three, whose own reader thought it
 * might be a duplicate listing of a park reported closed since 2016.
 *
 * A place with no figure keeps the position the search gave it and is never
 * passed: «nobody found the number» is a fact about this research, not about
 * the place. Scoring those as average was tried first, and it put two beaches
 * with no figure above شاطئ المسيلة for «beach» — demoting the one beach with
 * a real number on the strength of an assumption about the other two.
 *
 * Catalogue-free, like place-kit: keyed by slug, and imports nothing. The
 * module is reached from the /salem chat, and the 52 records must not follow
 * it there.
 */

export interface GoogleFigure {
  /** The star rating as reported, 1–5. */
  rating: number;
  /** Reviews behind it, as reported — the LOWER bound where reports
   *  differed. Null when no source gave a count. */
  count: number | null;
  /** True when both blind look-ups found the same rating; false when only
   *  one found anything. */
  corroborated: boolean;
  /** Nobody has opened the Google Maps listing and checked the number. When
   *  someone does, this becomes `true` and `checkedOn` says when. */
  verified: false;
}

/**
 * The figures as [rating, count, corroborated] — a tuple rather than an
 * object per place, because since 3 October this table rides in /search's
 * own JavaScript (answer-order.ts orders both surfaces) and the object form
 * spelled `corroborated` and `verified` out thirty-eight times: the route went
 * 0.4K over the 175K `audit:js` budget on this table's keys alone. Expanded
 * below to the same shape as before, so nothing that reads it changed.
 */
const FIGURES: Readonly<Record<string, readonly [number, number | null, 0 | 1]>> = {
  "abdullah-al-salem-cultural-centre": [4.6, 5550, 0],
  "al-fanar-mall": [4.1, 4615, 0],
  "al-hamra-tower": [4.5, 4613, 0],
  "al-kout-mall": [4.6, 10966, 1],
  "al-salam-palace": [4.5, 235, 1],
  "al-shaheed-park": [4.6, 19267, 1],
  "amricani-cultural-centre": [4.4, 369, 0],
  "aqua-park": [3.9, 400, 1],
  "bait-al-othman": [4.4, 1752, 1],
  "dickson-house": [4.1, 86, 0],
  "failaka-island": [4.3, 289, 0],
  "fish-market": [4.3, 10000, 0],
  "freej-swaileh": [4.2, 12983, 1],
  "friday-market": [4.2, 3700, 1],
  "grand-mosque": [4.8, 3573, 0],
  "green-island": [4, 3700, 1],
  "jacc": [4.7, 4550, 1],
  "kuwait-fairground": [4.4, 1700, 1],
  "kuwait-national-museum": [4.1, null, 0],
  "kuwait-science-centre": [4.4, 5186, 1],
  "kuwait-towers": [4.5, 18656, 1],
  "kuwait-zoo": [3.9, 5876, 1],
  "liberation-tower": [4.2, 4100, 0],
  "mais-alghanim": [4.5, 7056, 1],
  "mall-360": [4.5, 21000, 1],
  "marina-crescent": [4.4, 7495, 1],
  "marina-mall": [4.4, null, 0],
  "messilah-beach": [4.1, 410, 1],
  "mirror-house": [4.3, null, 1],
  "modern-art-museum": [4.2, 204, 1],
  "sadu-house": [4.4, 273, 1],
  "salhia-complex": [4.5, 985, 0],
  "sheikh-jaber-causeway": [4.7, 1623, 0],
  "souq-al-mubarakiya": [4.4, 26500, 1],
  "souq-al-safafeer": [4.1, 685, 1],
  "souq-al-watiya": [4, 4056, 0],
  "souq-sharq": [4.3, 11380, 1],
  "tareq-rajab-museum": [4.5, 244, 1],
};

export const GOOGLE_FIGURES: Readonly<Record<string, GoogleFigure>> = Object.fromEntries(
  Object.entries(FIGURES).map(([slug, [rating, count, c]]) => [
    slug,
    { rating, count, corroborated: c === 1, verified: false } as const,
  ]),
);

/** The median of the figures above: what «average» means here. */
const PRIOR = 4.4;
/** How many reviews a figure needs before it outweighs that average. */
const PRIOR_WEIGHT = 250;

/**
 * A rating adjusted for how much stands behind it, or null with no figure.
 *
 * 3.4 from 59 reviews and 3.9 from 5,876 are not the same claim: the first
 * is a handful of people and the second is a city. So each figure is pulled
 * towards the average by an amount that shrinks as its count grows — a
 * Bayesian average. A figure only one look-up found counts half its reviews.
 * One with no count says nothing about how many people stand behind it, so
 * it is treated as no figure: scoring it as average let المتحف الوطني pass
 * the zoo for «kids» on a number that was not there.
 */
export function reviewScore(slug: string): number | null {
  const f = GOOGLE_FIGURES[slug];
  if (!f || f.count === null) return null;
  const n = f.count * (f.corroborated ? 1 : 0.5);
  return (PRIOR_WEIGHT * PRIOR + n * f.rating) / (PRIOR_WEIGHT + n);
}

/** A match within this fraction of the best in its band is near-equal. */
export const BAND = 0.85;
/**
 * How much better reviewed a place must be to pass a better match: a tenth
 * of a star. Below that the difference is the rounding of a secondhand
 * number, and without the margin a place nobody found a figure for (scored
 * as average, 4.4) passed دار ديكسون (4.1 from 86 reviews, adjusted to 4.36)
 * for «متحف قديم» — on four hundredths of a star.
 */
export const MIN_GAIN = 0.1;

/**
 * Re-order search hits so that, among matches the search scored as near-
 * equal, the clearly better reviewed place comes first.
 *
 * Bands are cut in relevance order: a band starts at the first hit not yet
 * placed and takes every following hit scoring at least `BAND` of that
 * first one. Order BETWEEN bands is the search's own, so a review can never
 * carry a weak match over a strong one — «قهوة» still answers with coffee,
 * however well a mall is reviewed. Within a band each hit with a figure moves
 * up past the hits it beats by `MIN_GAIN`, and stops at the first it does
 * not beat or that has no figure to compare — so nothing is passed on noise,
 * and nothing is passed on a guess.
 */
export function reorderByReviews<T>(hits: T[], score: (h: T) => number, slugOf: (h: T) => string): T[] {
  const out: T[] = [];
  for (let i = 0; i < hits.length; ) {
    const lead = score(hits[i]);
    let j = i + 1;
    while (j < hits.length && score(hits[j]) >= BAND * lead) j++;
    const band: { h: T; r: number | null }[] = [];
    for (const h of hits.slice(i, j)) {
      const r = reviewScore(slugOf(h));
      let at = band.length;
      if (r !== null) {
        while (at > 0) {
          const ahead = band[at - 1].r;
          if (ahead === null || r - ahead < MIN_GAIN) break;
          at--;
        }
      }
      band.splice(at, 0, { h, r });
    }
    out.push(...band.map((x) => x.h));
    i = j;
  }
  return out;
}
