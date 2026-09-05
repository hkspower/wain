/**
 * The category artwork that ships INSIDE the app.
 *
 * Recovered from the 20 August go-live package — the owner's own photographs,
 * at the 900-wide size the website serves to phones. They are bundled rather
 * than only fetched because a shop whose four tiles are empty until the network
 * answers is a shop that looks broken on a lift, on a plane, and on the first
 * launch in a gym basement. The server copy still wins when it is reachable, so
 * uploading new artwork to /cats/ still changes the app with no release.
 *
 * `require` is not a variable lookup here: Metro resolves these at build time,
 * which is why the map is written out rather than assembled from a template.
 *
 * ARABIC GETS ITS OWN COMPOSITION for men, not a mirrored one. The copy sits on
 * the reading side, so the Arabic frame needs the figure on the left — and a
 * photograph of a person is never flipped to get it. art-men-rtl.jpg is built
 * from the English frame by scripts/make-rtl-art.mjs: the figure copied across
 * unflipped, only the backdrop mirrored. The version in the go-live package was
 * the damaged one, with 40-pixel flat runs and grey-green artefacts across two
 * thirds of the frame; it is not what ships here.
 *
 * Women's is built the same way, and it is not optional: with the English frame
 * in Arabic, the copy landed on the runner herself — measured, not guessed. The
 * one that shipped on the website years ago was deleted for having two thirds
 * of the frame crushed to black; this one is derived from the good English
 * frame, so it cannot drift from it in grade or exposure.
 *
 * Accessories and outlet have no -rtl variant and do not need one: a flat-lay
 * and a wall of shelves have no single subject standing on one side, so there
 * is nothing for the copy to land on.
 */

import type { CategoryId } from '@/lib/catalog';

type Art = { ltr: number; rtl?: number };

const ART: Record<CategoryId, Art> = {
  men: {
    ltr: require('@/assets/cats/art-men.jpg'),
    rtl: require('@/assets/cats/art-men-rtl.jpg'),
  },
  women: {
    ltr: require('@/assets/cats/art-women.jpg'),
    rtl: require('@/assets/cats/art-women-rtl.jpg'),
  },
  accessories: { ltr: require('@/assets/cats/art-accessories.jpg') },
  outlet: { ltr: require('@/assets/cats/art-outlet.jpg') },
};

/** The bundled frame for a category, in the direction being read. */
export const bundledCategoryArt = (id: CategoryId, dir: 'rtl' | 'ltr'): number | undefined => {
  const art = ART[id];
  if (!art) return undefined;
  return dir === 'rtl' ? (art.rtl ?? art.ltr) : art.ltr;
};
