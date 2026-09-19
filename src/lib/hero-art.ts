/**
 * The shop's own hero banners, bundled in the app.
 *
 * These are the website's slider frames — complete artwork, with the headline,
 * the Arabic line and the Sporta mark already set into the photograph. That is
 * why the home page puts no copy of its own on top of them: the words are in
 * the picture, and a second headline over the first is how a banner turns into
 * a poster nobody can read.
 *
 * Built by scripts/build-hero-art.mjs from sporta-site/public_html/hero/mobile.
 * `require` is resolved by Metro at build time, so the map is written out
 * rather than assembled from the file names.
 *
 * Each one names what it shows, in both languages, because a screen reader
 * gets nothing at all from text baked into a photograph.
 */

export interface HeroBanner {
  /** The file's own name, and the path under /hero/mobile on the server. */
  id: string;
  bundled: number;
  en: string;
  ar: string;
}

export const HERO_BANNERS: HeroBanner[] = [
  {
    id: 'crossfit-men',
    bundled: require('@/assets/hero/crossfit-men.jpg'),
    en: "Men's training — CrossFit",
    ar: 'تدريب رجالي — كروس فيت',
  },
  {
    id: 'cardio-women',
    bundled: require('@/assets/hero/cardio-women.jpg'),
    en: "Women's training — Cardio",
    ar: 'تدريب نسائي — كارديو',
  },
  {
    id: 'bodybuilding-men',
    bundled: require('@/assets/hero/bodybuilding-men.jpg'),
    en: "Men's training — Bodybuilding",
    ar: 'تدريب رجالي — كمال أجسام',
  },
  {
    id: 'cardio-men',
    bundled: require('@/assets/hero/cardio-men.jpg'),
    en: "Men's training — Cardio",
    ar: 'تدريب رجالي — كارديو',
  },
  {
    id: 'bodybuilding-women',
    bundled: require('@/assets/hero/bodybuilding-women.jpg'),
    en: "Women's training — Bodybuilding",
    ar: 'تدريب نسائي — كمال أجسام',
  },
];

/** 1000x396 — the aspect the artwork is composed at. Held here so the band
 *  cannot be given a height that crops the headline out of its own picture. */
export const HERO_ASPECT = 1000 / 396;
