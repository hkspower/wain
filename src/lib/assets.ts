/**
 * Where the shop's pictures live.
 *
 * The base itself is resolved in lib/config.ts; this file only knows the shape
 * of the paths under it.
 */

import { ASSET_BASE } from '@/lib/config';

export { ASSET_BASE };

/**
 * Category artwork.
 *
 * /cats/mobile/, not /cats/. The shop keeps two crops of every tile — a tall
 * one for phones and a wide one for desktop — and the bare /cats/art-men.jpg
 * this asked for before is not a file on the server. It 404'd on every home
 * page load since the app was written, silently: RemoteArt paints the bundled
 * photograph underneath, so the only symptom was that uploading a new tile to
 * the shop never changed anything in the app.
 */
export const categoryArt = (id: string) => `${ASSET_BASE}/cats/mobile/art-${id}.jpg`;

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
