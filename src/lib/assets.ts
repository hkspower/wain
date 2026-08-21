/**
 * Where the shop's pictures live.
 *
 * Derived from API_BASE rather than configured separately, because they are the
 * same host in every deployment and two settings that must agree are one
 * setting people can get wrong. `/api` is stripped: the API answers at
 * https://host/api and the pictures sit at https://host/cats/... beside it.
 *
 * EXPO_PUBLIC_ASSET_BASE overrides it outright, which is what the test rig
 * uses to serve a known image from localhost.
 */

import { API_BASE } from '@/lib/api';

export const ASSET_BASE: string =
  process.env.EXPO_PUBLIC_ASSET_BASE ?? API_BASE.replace(/\/api\/?$/, '');

/** Category artwork: /cats/art-<id>.jpg on the server. */
export const categoryArt = (id: string) => `${ASSET_BASE}/cats/art-${id}.jpg`;

/** Product photography: /products/<slug>.jpg on the server. */
export const productPhoto = (slug: string) => `${ASSET_BASE}/products/${slug}.jpg`;
