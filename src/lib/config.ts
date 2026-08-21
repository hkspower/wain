/**
 * Where this build points, decided once.
 *
 * The two bases were resolved in two files with two copies of the precedence
 * rule, and that is exactly where the last bug of this kind came from: api.ts
 * read app.json BEFORE the environment variable, so EXPO_PUBLIC_API_BASE could
 * never win — app.json always has a value — and every build went to production,
 * including the test rig, which then reported the admin panel broken when it was
 * merely pointed at a host it cannot reach.
 *
 * PRECEDENCE, one rule, both bases:
 *
 *   1. EXPO_PUBLIC_* environment variable — an explicit override for one build.
 *   2. app.json `extra` — what ships.
 *   3. The production shop.
 *
 * A caveat that has cost real time here: EXPO_PUBLIC_* values are inlined at
 * TRANSFORM time, so Metro's cache serves the previous value and a rebuild with
 * a new one appears to do nothing. `npx expo export --clear` is not optional
 * when changing them.
 */

import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiBase?: string;
  assetBase?: string;
};

const PRODUCTION_API = 'https://www.sporta.com.kw/api';

/** Trailing slashes are trimmed here so every caller can write `${BASE}/thing`. */
const clean = (url: string) => url.replace(/\/+$/, '');

export const API_BASE: string = clean(
  process.env.EXPO_PUBLIC_API_BASE ?? extra.apiBase ?? PRODUCTION_API,
);

/**
 * Pictures sit beside the API, not inside it: the API answers at
 * https://host/api and the artwork at https://host/cats/... — so the default is
 * derived rather than configured, because two settings that must agree are one
 * setting people get wrong.
 */
export const ASSET_BASE: string = clean(
  process.env.EXPO_PUBLIC_ASSET_BASE ?? extra.assetBase ?? API_BASE.replace(/\/api$/, ''),
);

/** True when this build is talking to the real shop. Used by nothing yet; it is
 *  here so a screen that must not appear in production has something to ask. */
export const IS_PRODUCTION = API_BASE === PRODUCTION_API;
