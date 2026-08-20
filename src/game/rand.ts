/**
 * The world's random number generator.
 *
 * WHY THIS EXISTS
 *
 * The city used to be built from `Math.random()`, so every page load
 * produced a different Kuwait: different building heights, different
 * lit windows, different palm placement, different billboard sides.
 * That is a fine thing for a player and a disaster for anything that
 * measures the game.
 *
 * Over one session it broke four separate checks, each of which looked
 * exactly like a real bug until it was investigated — a building
 * standing in a street about one run in three, a "coast" reading taken
 * inside a tunnel, and two others. Worse than the false alarms: it made
 * before-and-after impossible. Measuring a change to the facade texture
 * meant measuring it against a DIFFERENT CITY, with the buildings in
 * other places and a different number of pixels of them in frame, so
 * the numbers moved for reasons that had nothing to do with the change.
 *
 * A seeded generator fixes both. The same seed builds the same city
 * every time, so a screenshot is comparable with the one taken before
 * the change, and a check that fails means something failed.
 *
 * The generator is mulberry32: thirty-two bits of state, four
 * operations, a period of 2^32 and good enough distribution for
 * scattering windows and palm trees. Nothing here needs cryptography or
 * a long period; it needs to be identical on every machine, which
 * `Math.random()` explicitly is not.
 */

/** The seed the world is built from. Change it to get a different — and
 *  still perfectly repeatable — Kuwait. */
export const WORLD_SEED = 0x6b57_1a1b;

export type Rng = () => number;

/** mulberry32. Returns a function that yields [0, 1). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The world's own stream, reset at the start of every build.
 *
 * A module-level stream rather than a parameter threaded through two
 * hundred call sites: the alternative is touching every function that
 * scatters anything, and a single stream reset once per build gives the
 * same guarantee — same seed in, same city out — as long as the build
 * order does not change. Which it does not, because it is one function.
 */
let stream: Rng = makeRng(WORLD_SEED);

/** Start the world's stream over. Called once, by buildWorld. */
export function resetWorldRng(seed: number = WORLD_SEED): void {
  stream = makeRng(seed);
}

/** The world's random number. Drop-in for Math.random(). */
export function rand(): number {
  return stream();
}
