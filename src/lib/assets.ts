/**
 * Where the shop's pictures live.
 *
 * The base itself is resolved in lib/config.ts; this file only knows the shape
 * of the paths under it.
 */

import { ASSET_BASE } from '@/lib/config';

export { ASSET_BASE };

/** Category artwork: /cats/art-<id>.jpg on the server. */
export const categoryArt = (id: string) => `${ASSET_BASE}/cats/art-${id}.jpg`;

/** Product photography: /products/<slug>.jpg on the server. */
export const productPhoto = (slug: string) => `${ASSET_BASE}/products/${slug}.jpg`;
