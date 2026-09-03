// Browser storage, and whether it is actually working.
//
// Every save in this game was written the same careful way:
//
//     try { localStorage.setItem(KEY, JSON.stringify(g)); } catch {}
//
// which is right about the danger and silent about the consequence. The
// catch is there because localStorage genuinely throws — Safari in
// private browsing, a browser with site data blocked, an embedded
// webview, a full quota — and a save that throws must not take the game
// down with it. But swallowing it whole means the failure has no
// listener at all: the player keeps earning KD, buying parts, beating
// rivals and refuelling, the garage keeps writing, every write keeps
// failing, and nothing anywhere says so. They find out when they reload
// and an hour is gone.
//
// That is the difference this module makes. It does not stop the failure
// — nothing can, the storage is not there — it makes it OBSERVABLE, so
// the game can tell the player once, up front, that progress is not
// being kept. A player who knows can decide to leave private browsing.
// A player who is not told cannot decide anything.
//
// It also probes rather than assuming. `typeof localStorage !== "undefined"`
// is not the question: the object exists in a locked-down browser and
// throws on use, and it exists in Safari private mode and accepts writes
// that silently vanish. The only honest test is to write something, read
// it back, and check it came back.

/** What the browser will actually let us keep. */
export type StorageHealth =
  /** Writes land and read back. */
  | "ok"
  /** No storage at all: server render, or the browser refuses access. */
  | "unavailable"
  /** Storage exists but will not take any more — the quota is spent. */
  | "full";

const PROBE_KEY = "gulf-road-nights-probe";

let health: StorageHealth | null = null;
let sawFailure = false;
const listeners = new Set<(h: StorageHealth) => void>();

/**
 * Test the storage by using it, once per session.
 *
 * The canary is written, read back, compared and removed. Reading it
 * back is the part that matters: a write which throws is easy to catch,
 * and a write which is accepted and discarded — which is what some
 * private modes do — looks like success from the setItem call alone.
 */
export function storageHealth(): StorageHealth {
  if (health) return health;
  try {
    const token = String(Date.now());
    localStorage.setItem(PROBE_KEY, token);
    const back = localStorage.getItem(PROBE_KEY);
    localStorage.removeItem(PROBE_KEY);
    health = back === token ? "ok" : "unavailable";
  } catch (e) {
    // QuotaExceededError is worth separating: the storage works, it is
    // simply out of room, and that is a different sentence to show a
    // player and a different thing for them to do about it.
    health = isQuota(e) ? "full" : "unavailable";
  }
  if (health !== "ok") sawFailure = true;
  return health;
}

function isQuota(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  // Browsers disagree on the name and Firefox on the code, so this asks
  // every way any of them answers.
  const anyE = e as Error & { code?: number };
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    anyE.code === 22 ||
    anyE.code === 1014
  );
}

/** True once anything has failed to persist this session. */
export function storagePersists(): boolean {
  return storageHealth() === "ok" && !sawFailure;
}

/** Told once, the first time a write is found not to have landed. */
export function onStorageTrouble(fn: (h: StorageHealth) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function trouble(h: StorageHealth): void {
  const first = !sawFailure;
  sawFailure = true;
  health = h;
  if (first) for (const fn of listeners) fn(h);
}

/**
 * Read and parse, or hand back the fallback.
 *
 * Corrupt JSON is treated exactly like missing JSON, deliberately. A
 * half-written save is not something a player can act on, and refusing
 * to start is worse than starting fresh.
 */
export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    // Objects and arrays both pass; anything else does not. An array is
    // a real shape here — community.ts keeps the paid-referral list as
    // one — so rejecting them would be this module deciding on a
    // caller's behalf that its save is corrupt. A bare number or string
    // is nothing any caller stores, and is far more likely to be a
    // truncated write than a value.
    if (parsed === null || typeof parsed !== "object") return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

/**
 * Write, and say whether it worked.
 *
 * The return value is the whole point: `false` means the player's
 * progress did not persist, and a caller that ignores it is back where
 * this module started.
 */
export function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    trouble(isQuota(e) ? "full" : "unavailable");
    return false;
  }
}

/** Remove a key. Failing to remove one is not worth alarming anyone. */
export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}

/** For tests: forget what was probed. */
export function __resetStorageHealth(): void {
  health = null;
  sawFailure = false;
}
