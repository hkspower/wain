/**
 * The community: who a save is, and the invite that brings a friend in.
 *
 * WHAT AN IDENTITY IS HERE, AND WHAT IT IS NOT
 *
 * There are no accounts in this game. Nobody signs up, nobody signs in,
 * and there is no password to lose. What this file makes is an id for a
 * SAVE — generated once, kept in local storage next to the garage, and
 * sent to the hub so the server can tell one returning player from
 * another. Clear the browser's storage and it is a different save with a
 * different id, the same way clearing it loses the cars.
 *
 * That is worth being blunt about, because a referral system implies a
 * strength it cannot have here. The wallet is a number in local storage:
 * anybody who opens developer tools can set it to a million, and no
 * amount of care about invite codes changes that. What the hub CAN
 * enforce is the part that involves other people — that a code belongs
 * to somebody, that it is not your own, and that it pays out once. It
 * does enforce those, on the server, and it remembers them across
 * restarts. What it cannot do is stop a determined player editing their
 * own save, and nothing in this file pretends otherwise.
 */

const ID_KEY = "gulf-road-nights-player";

/** Ambiguity costs more than entropy here: these codes get read off one
 *  screen and typed into another, so O/0 and I/1/L are all out. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

/** The referral bonus, in KD. Both sides get it: the friend who joined,
 *  and the player whose code they used. Ten is the same as a new save's
 *  whole balance, which is the point — it is a welcome, not a rounding
 *  error. */
export const REFERRAL_KD = 10;

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  // Older browsers, and the odd embedded webview.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * This save's id, created on first use.
 *
 * Returns an empty string when there is no storage at all — a private
 * window with everything locked down, or a server render. Callers treat
 * that as "no community features", which is the honest outcome: an
 * identity that cannot be written down cannot be an identity.
 */
export function playerId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

/**
 * The invite code for an id: six characters, derived deterministically
 * so the same save always shows the same code, on every device it is
 * copied to and after every reload.
 *
 * Derived rather than stored because a stored code is a second source of
 * truth that can drift from the id it is supposed to name. The hub keeps
 * the code-to-id mapping and settles the astronomically unlikely
 * collision by first come, first served.
 */
export function inviteCode(id: string = playerId()): string {
  if (!id) return "";
  // FNV-1a, then walked in two passes so a one-character change in the
  // id moves the whole code rather than its tail.
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET[h % ALPHABET.length];
    // The trailing >>> 0 is not decoration. XOR in JavaScript returns a
    // SIGNED 32-bit integer, so without it `h` goes negative on the
    // first mix, `h % 31` goes negative with it, and ALPHABET[-5] is
    // undefined — which string concatenation happily renders as the
    // word "undefined". The code came out as
    // "XundefinedundefinedKundefined5" on screen, thirty characters
    // long, and every function around it carried on as normal.
    h = (((Math.imul(h, 0x01000193) >>> 0) ^ (h >>> 7)) >>> 0) % 0x100000000;
  }
  return out;
}

/** Anything a human typed: case, spaces and the dashes people add. */
export function normaliseCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LEN);
}

export function isCodeShaped(raw: string): boolean {
  const c = normaliseCode(raw);
  return c.length === CODE_LEN && [...c].every((ch) => ALPHABET.includes(ch));
}

/** A link that carries the code, for sending to somebody. */
export function inviteLink(code: string = inviteCode(), origin?: string): string {
  const base =
    origin ?? (typeof location !== "undefined" ? location.origin : "https://wain.example");
  return `${base}/hub?invite=${code}`;
}

/**
 * What this save has already been paid, so a bonus is never credited
 * twice by a client that reloaded at the wrong moment.
 *
 * The server is the authority on who is owed what; this is only a note
 * of what has been banked, and it is checked against the server's answer
 * rather than trusted on its own.
 */
const PAID_KEY = "gulf-road-nights-referrals-paid";

export function paidReferrals(): string[] {
  try {
    const raw = localStorage.getItem(PAID_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function markReferralPaid(token: string): void {
  try {
    const all = paidReferrals();
    if (all.includes(token)) return;
    all.push(token);
    localStorage.setItem(PAID_KEY, JSON.stringify(all.slice(-200)));
  } catch {}
}
