// Driver handles: a name the game can suggest, so registering is a tap.
//
// THE PROBLEM THIS SOLVES
//
// The hub's join form opened on an empty box and a dead button. Nothing
// on the page moved until the player invented a name, and inventing a
// name is the single hardest thing a sign-up screen can ask for — harder
// than an email, because an email is a fact you already know and a
// handle is a small creative act performed in front of strangers. A
// player who cannot think of one either types "aaa" and feels stupid, or
// closes the tab. Meanwhile the code's own fallback was the word
// "racer", which is what everybody who skipped the form was called.
//
// So the game brings one. The box is filled before the player has read
// it, the button is live on arrival, and the only decision left is
// whether to keep the name or roll another — which is a decision anybody
// can make in half a second, unlike the one it replaced.
//
// HOW THE NAMES ARE BUILT
//
// In the register the rest of the game speaks. rivals.ts has Abu Shanab,
// Bu Machboos, Al-Daboos, Bint Al-Deera — the kunya (bu/abu, "father
// of"), the definite epithet (al-), and the name of a place. A generated
// handle that sounded like a forum tag would sit beside those and
// announce that the player is not really part of this.
//
// Each part carries its Arabic, so what the box offers can be shown in
// both scripts. The profile only stores the Latin form — that is what
// goes over the wire and what the leaderboard prints — but seeing the
// Arabic underneath is what tells somebody who reads it that the name
// means something.

export interface Handle {
  /** What goes in the box and over the wire. */
  en: string;
  /** The same name in Arabic, shown under the box. */
  ar: string;
}

/**
 * Nouns for the kunya pattern: "Bu X", the man known for the X.
 *
 * These are THINGS — what you run, what you leave behind. "Bu Turbo" is
 * a man with a turbo. The turbo is spelled the one way the whole game
 * spells it; see the canon list in scripts/check-arabic.mjs.
 */
const KUNYA: Handle[] = [
  { en: "Turbo", ar: "تيربو" },
  { en: "Neon", ar: "نيون" },
  { en: "Ghubar", ar: "غبار" },
  { en: "Sarookh", ar: "صاروخ" },
  { en: "Nar", ar: "نار" },
  { en: "Deezel", ar: "ديزل" },
  { en: "Dukhan", ar: "دخان" },
  { en: "Shanab", ar: "شنب" },
];

/**
 * Nouns for the epithet pattern: "Al-X", the X itself.
 *
 * These are FORCES and animals — what you are, not what you own. Every
 * one is a word somebody here would actually use about a fast driver,
 * and none of them is a rival's name: a player calling themselves
 * Al-Saqer would be claiming to be somebody the game already has an
 * opinion about.
 */
const EPITHET: Handle[] = [
  { en: "Barq", ar: "برق" },
  { en: "Sahm", ar: "سهم" },
  { en: "Nimr", ar: "نمر" },
  { en: "Wahsh", ar: "وحش" },
  { en: "Reeh", ar: "ريح" },
  { en: "Thil", ar: "ظل" },
  { en: "Shrara", ar: "شرارة" },
  { en: "Ramz", ar: "رمز" },
];

/** Where a driver is from. The same places the road runs through. */
const PLACES: Handle[] = [
  { en: "Al-Khaleej", ar: "الخليج" },
  { en: "Al-Deera", ar: "الديرة" },
  { en: "Salmiya", ar: "السالمية" },
];

/**
 * Every handle the game can offer.
 *
 * Built once as a list rather than rolled from parts on demand, because
 * a list can be counted, printed and checked — a test can assert that
 * none of them collides with a rival and that every one fits the name
 * box. A generator that composes on the fly can only be spot checked.
 */
export const HANDLES: Handle[] = [
  ...KUNYA.map((n) => ({ en: `Bu ${n.en}`, ar: `بو ${n.ar}` })),
  ...EPITHET.map((n) => ({ en: `Al-${n.en}`, ar: `ال${n.ar}` })),
  // "Nimr Al-Khaleej" — the tiger of the Gulf. Noun then place in both
  // scripts, so the two sides read in the same order.
  ...EPITHET.slice(0, 5).flatMap((n) =>
    PLACES.map((p) => ({ en: `${n.en} ${p.en}`, ar: `${n.ar} ${p.ar}` }))
  ),
];

/** How long a name may be. The hub truncates at this, so the box must
 *  refuse past it rather than let the server quietly shorten it. */
export const MAX_HANDLE = 24;

/**
 * A suggestion, never the same one twice running.
 *
 * `avoid` is the handle already in the box. A reroll button that can
 * return what is already there looks broken — the player presses it,
 * nothing changes, and the reasonable conclusion is that the button is
 * dead.
 */
export function rollHandle(avoid?: string): Handle {
  const pool = avoid ? HANDLES.filter((h) => h.en !== avoid) : HANDLES;
  const list = pool.length ? pool : HANDLES;
  return list[Math.floor(Math.random() * list.length)];
}

/** Control characters, as escapes: a source file that contained
 *  literal ones would be a file no reviewer could read. */
const CONTROL = /[\u0000-\u001F\u007F]/g;

/**
 * What the player typed, as the game will actually use it.
 *
 * Collapses runs of whitespace, drops control characters, trims, and
 * cuts to the hub's limit. Called both to decide whether the button is
 * live and to build the name that is sent, so the button can never be
 * live for a name the join would reject — a disabled button with no
 * explanation is the worst thing a form can do, and a button that is
 * enabled and then does nothing is second worst.
 *
 * It does NOT strip Arabic, or anything else somebody might write their
 * own name in. teams.ts learned that one the hard way: the crew tag was
 * filtered to A-Z0-9 in two places, so a crew could not be named in
 * Arabic in an Arabic game, and the tag came back empty with no error.
 */
export function cleanHandle(raw: string): string {
  return raw
    .replace(CONTROL, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_HANDLE);
}
