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
 *    stronger one, and it never adds a place the search did not find.
 *  - It may NOT be said or shown. Not by سالم, not on a card, not on a pin —
 *    until the owner has opened that place on Google Maps and checked it
 *    (`docs/google-reviews-checklist.md`), at which point it can be quoted as
 *    «حسب قوقل» with that date. `audit:reviews` fails if anything but the
 *    tool helpers imports this file.
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

export const GOOGLE_FIGURES: Readonly<Record<string, GoogleFigure>> = {
  "abdullah-al-salem-cultural-centre": { rating: 4.6, count: 5550, corroborated: false, verified: false },
  "al-fanar-mall": { rating: 4.1, count: 4615, corroborated: false, verified: false },
  "al-hamra-tower": { rating: 4.5, count: 4613, corroborated: false, verified: false },
  "al-kout-mall": { rating: 4.6, count: 10966, corroborated: true, verified: false },
  "al-salam-palace": { rating: 4.5, count: 235, corroborated: true, verified: false },
  "al-shaheed-park": { rating: 4.6, count: 19267, corroborated: true, verified: false },
  "amricani-cultural-centre": { rating: 4.4, count: 369, corroborated: false, verified: false },
  "aqua-park": { rating: 3.9, count: 400, corroborated: true, verified: false },
  "bait-al-othman": { rating: 4.4, count: 1752, corroborated: true, verified: false },
  "dickson-house": { rating: 4.1, count: 86, corroborated: false, verified: false },
  "failaka-island": { rating: 4.3, count: 289, corroborated: false, verified: false },
  "fish-market": { rating: 4.3, count: 10000, corroborated: false, verified: false },
  "freej-swaileh": { rating: 4.2, count: 12983, corroborated: true, verified: false },
  "friday-market": { rating: 4.2, count: 3700, corroborated: true, verified: false },
  "grand-mosque": { rating: 4.8, count: 3573, corroborated: false, verified: false },
  "green-island": { rating: 4, count: 3700, corroborated: true, verified: false },
  "jacc": { rating: 4.7, count: 4550, corroborated: true, verified: false },
  "kuwait-fairground": { rating: 4.4, count: 1700, corroborated: true, verified: false },
  "kuwait-national-museum": { rating: 4.1, count: null, corroborated: false, verified: false },
  "kuwait-science-centre": { rating: 4.4, count: 5186, corroborated: true, verified: false },
  "kuwait-towers": { rating: 4.5, count: 18656, corroborated: true, verified: false },
  "kuwait-zoo": { rating: 3.9, count: 5876, corroborated: true, verified: false },
  "liberation-tower": { rating: 4.2, count: 4100, corroborated: false, verified: false },
  "mais-alghanim": { rating: 4.5, count: 7056, corroborated: true, verified: false },
  "mall-360": { rating: 4.5, count: 21000, corroborated: true, verified: false },
  "marina-crescent": { rating: 4.4, count: 7495, corroborated: true, verified: false },
  "marina-mall": { rating: 4.4, count: null, corroborated: false, verified: false },
  "messilah-beach": { rating: 4.1, count: 410, corroborated: true, verified: false },
  "mirror-house": { rating: 4.3, count: null, corroborated: true, verified: false },
  "modern-art-museum": { rating: 4.2, count: 204, corroborated: true, verified: false },
  "sadu-house": { rating: 4.4, count: 273, corroborated: true, verified: false },
  "salhia-complex": { rating: 4.5, count: 985, corroborated: false, verified: false },
  "sheikh-jaber-causeway": { rating: 4.7, count: 1623, corroborated: false, verified: false },
  "souq-al-mubarakiya": { rating: 4.4, count: 26500, corroborated: true, verified: false },
  "souq-al-safafeer": { rating: 4.1, count: 685, corroborated: true, verified: false },
  "souq-al-watiya": { rating: 4, count: 4056, corroborated: false, verified: false },
  "souq-sharq": { rating: 4.3, count: 11380, corroborated: true, verified: false },
  "tareq-rajab-museum": { rating: 4.5, count: 244, corroborated: true, verified: false },
};

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
