/**
 * Everything this app keeps on the device, and the only file that touches
 * AsyncStorage.
 *
 * WHY ONE FILE. The keys were declared in two places — 'sporta.cart.v1' in
 * cart.tsx and 'sporta.admin.token.v1' in admin.ts — with their own copies of
 * the same try/catch, the same JSON.parse, and their own idea of what happens
 * when a read fails. That is how a third feature ends up writing 'cart' or
 * 'sporta.cart' and quietly orphaning a customer's basket. Every key in the app
 * is now in KEYS below, and adding one means adding it here.
 *
 * WHY EVERY READ IS VALIDATED. Storage survives app upgrades. The shape written
 * by version 1 is still on the device when version 2 reads it, and it can also
 * be anything at all — a half-written value from a crash, or hand-edited
 * localStorage on web. `readJson` takes a guard and returns the fallback rather
 * than whatever it found, so a malformed value cannot reach a screen.
 *
 * WHY NOTHING THROWS. A device with no space left, a browser in private mode
 * with storage blocked — none of that is a reason for the shop to stop working.
 * Reads fall back, writes fail silently, and the app runs from memory.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Every key, versioned. The suffix is not decoration: when a stored shape
 * changes incompatibly, bump it rather than writing migration code — the old
 * value is then ignored and eventually cleared, which for a basket or a session
 * token is the right trade.
 */
export const KEYS = {
  cart: 'sporta.cart.v1',
  adminToken: 'sporta.admin.token.v1',
  lang: 'sporta.lang.v1',
} as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];

export async function readString(key: StorageKey): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function writeString(key: StorageKey, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    /* out of space, or storage blocked — the app carries on from memory */
  }
}

export async function remove(key: StorageKey): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* nothing to do: the value is already unreachable */
  }
}

/**
 * Read JSON, but only hand it back if `isValid` recognises it.
 *
 * The guard is required rather than optional on purpose. `readJson<Line[]>(...)`
 * with no check compiles, reads whatever is on disk, and hands a screen a
 * `Line[]` that is actually a number — and TypeScript will not have said a word,
 * because a cast is a promise the compiler cannot keep.
 */
export async function readJson<T>(
  key: StorageKey,
  isValid: (value: unknown) => value is T,
  fallback: T,
): Promise<T> {
  const raw = await readString(key);
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export async function writeJson(key: StorageKey, value: unknown): Promise<void> {
  try {
    await writeString(key, JSON.stringify(value));
  } catch {
    /* a value that cannot be serialised is a bug here, not on the device */
  }
}
