/**
 * Where the shop's pictures live.
 *
 * The base itself is resolved in lib/config.ts; this file only knows the shape
 * of the paths under it.
 */

import { hasRtlArt } from '@/lib/category-art';
import type { CategoryId } from '@/lib/catalog';
import { ASSET_BASE } from '@/lib/config';

export { ASSET_BASE };

/**
 * Category artwork, in the direction being read.
 *
 * /cats/mobile/, not /cats/. The shop keeps two crops of every tile — a tall
 * one for phones and a wide one for desktop — and the bare /cats/art-men.jpg
 * this asked for before is not a file on the server. It 404'd on every home
 * page load since the app was written, silently: RemoteArt paints the bundled
 * photograph underneath, so the only symptom was that uploading a new tile to
 * the shop never changed anything in the app.
 *
 * THE DIRECTION ARGUMENT IS THE SECOND HALF OF THAT BUG, and it was worse.
 * This used to ask for art-<id>.jpg whatever the language, and RemoteArt paints
 * the remote layer ON TOP of the bundled one — so on an Arabic phone with a
 * network, the English frame covered the Arabic frame the app ships. That is
 * precisely the fault category-art.ts records measuring: "with the English
 * frame in Arabic, the copy landed on the runner herself". The app carried the
 * right picture and then hid it behind the wrong one, everywhere except
 * offline.
 *
 * hasRtlArt() rather than a list here: only men and women have an Arabic
 * composition — a flat-lay and a wall of shelves have no subject standing on
 * one side — and asking the server for art-outlet-rtl.jpg would be a 404 on
 * every load. The answer comes from the same map that owns the bundled frames,
 * so the two cannot disagree.
 */
export const categoryArt = (id: string, dir: 'rtl' | 'ltr' = 'ltr') => {
  const rtl = dir === 'rtl' && hasRtlArt(id as CategoryId);
  return `${ASSET_BASE}/cats/mobile/art-${id}${rtl ? '-rtl' : ''}.jpg`;
};

/**
 * Product photography, as the shop reports it.
 *
 * There is no /products/ directory on the server and there never was. Product
 * pictures live in the database and are served by api.php?r=product_image,
 * which is why the catalogue carries a URL — and why this takes the product
 * rather than its slug: the address is the shop's to decide, not this app's to
 * guess. Undefined when the shop has no photograph, which is the signal
 * RemoteArt needs to skip its remote layer instead of requesting a 404.
 */
export const productPhoto = (product: { photo?: string }) => product.photo;

/**
 * A hero banner on the server. Same folder the website's slider reads, so
 * replacing a frame there replaces it in the app too — the bundled copy is
 * the floor, not the ceiling.
 */
export const heroArt = (id: string) => `${ASSET_BASE}/hero/mobile/${id}.webp`;
