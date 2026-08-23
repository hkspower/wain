// The tow.
//
// A car at 200 km/h spends nearly all of its power pushing air out of
// the way, and the air it pushes does not close in again straight away.
// Behind it there is a wake: a pocket of moving air where the pressure
// is lower and the relative wind is slower. Sit in it and the drag on
// your own car falls by a third or more. That is the tow, and on a long
// straight it is worth more than any part in the garage.
//
// WHY THIS IS THE MISSING MECHANIC AND NOT JUST ANOTHER NUMBER.
//
// Without it, closing on the car in front is worth exactly nothing until
// the moment you are past. The gap is only a number the referee reads to
// decide whose SP bleeds, so the whole middle of a race — the part where
// you are half a second back and working — has no texture. The tow gives
// that stretch its own decisions: get into the wake, hold it while the
// speed builds, and pull out before the corner, because in the wake your
// nose is in dirty air and the front tyres have less to work with.
//
// That last part is the reason this returns two numbers rather than one.
// A tow that was only free speed would be a button that says "go
// faster", and everyone would hold it forever. The front-grip penalty is
// what makes it a place you choose to be: fast in a straight line,
// vague at the front, and a bad idea to still be sitting there when the
// road bends.
//
// THE SHAPE OF THE WAKE.
//
//   ALONG      Strongest on the bumper and decaying with distance. The
//              decay is exponential rather than linear because that is
//              what a spreading wake does — it is diluted by the air it
//              entrains, and dilution is proportional to what is left.
//
//   ACROSS     As wide as the car making it, plus a little for the
//              vortices coming off its edges, and gone past that. This
//              is what lets a driver break the tow by pulling out, and
//              why a car in the next lane but one gives you nothing.
//
//   WITH SPEED There is no meaningful wake at walking pace. Drag rises
//              with the square of speed, so what the wake is a fraction
//              OF is negligible below about 60 km/h, and pretending
//              otherwise would let cars tow each other out of a car
//              park.
//
// Nothing here reads the scene: it takes a gap, an offset and a speed,
// and returns multipliers. That is deliberate — it is the same shape as
// grip.ts and brakes.ts so the UE5 and Unity ports can be generated from
// it and the contract tests can check all three agree.

import { HANDLING as H } from "./handling";

// The numbers live in handling.ts, which is the one file the UE5 header
// and the Unity table are generated from. A constant declared here
// instead would be a constant the ports cannot see, and the sync check
// says so out loud rather than letting the three builds drift.

/** Past this many metres behind, the wake is not worth modelling. */
export const TOW_REACH = H.towReach;

/** How much of the aerodynamic drag term the deepest tow removes. */
export const TOW_MAX = H.towMax;

/** Half-width of an ordinary car, metres — the default wake half-width. */
export const TOW_DEFAULT_HALF_WIDTH = H.towDefaultHalfWidth;

const TOW_FALLOFF = H.towFalloff;
const DIRTY_AIR = H.towDirtyAir;
const TOW_MIN_SPEED = H.towMinSpeed;
const TOW_FULL_SPEED = H.towFullSpeed;
const TOW_EDGE_SPREAD = H.towEdgeSpread;

export interface TowInput {
  /** Metres from your nose to the tail of the car ahead. Zero or less
   *  means you are alongside or past, and there is no tow. */
  gap: number;
  /** Distance between the two cars' centre lines, metres. */
  lat: number;
  /** Your speed, m/s. */
  speed: number;
  /** Half the width of the car ahead, metres. A wider car throws a wider
   *  wake, which is most of why following a bus works so well. */
  halfWidth?: number;
}

export interface TowResult {
  /** Multiplier on the aerodynamic drag term. 1 in clean air. */
  drag: number;
  /** Multiplier on front-axle grip. 1 in clean air. */
  frontGrip: number;
  /** How deep in the wake, 0..1. For the HUD, and for anything that
   *  wants to react to the tow rather than merely receive it. */
  strength: number;
}

export const NO_TOW: TowResult = { drag: 1, frontGrip: 1, strength: 0 };

/**
 * The wake behind one car, at one point behind it.
 *
 * Returns multipliers, never absolute forces, so the caller's own drag
 * model stays the single place drag is defined.
 */
export function solveTow(input: TowInput): TowResult {
  const { gap, lat, speed } = input;
  const halfWidth = input.halfWidth ?? TOW_DEFAULT_HALF_WIDTH;

  // Not behind anything, or too far back to care.
  if (!(gap > 0) || gap > TOW_REACH) return NO_TOW;

  // Along the wake. exp(-gap/L), rescaled so that a gap of TOW_REACH
  // gives exactly zero rather than a small step down to nothing — a
  // discontinuity at the edge of the reach would show up as the tow
  // indicator flickering on and off at a steady following distance.
  const edge = Math.exp(-TOW_REACH / TOW_FALLOFF);
  const along = (Math.exp(-gap / TOW_FALLOFF) - edge) / (1 - edge);

  // Across it. The wake is the width of the body plus the vortices that
  // roll off its edges; squared so the fall-off is gentle in the middle
  // and quick at the shoulder, which is how it feels to pull out.
  const reachAcross = halfWidth + TOW_EDGE_SPREAD;
  const off = Math.abs(lat) / reachAcross;
  if (off >= 1) return NO_TOW;
  const across = 1 - off * off;

  // With speed.
  const fast = Math.min(
    1,
    Math.max(0, (speed - TOW_MIN_SPEED) / (TOW_FULL_SPEED - TOW_MIN_SPEED))
  );
  if (fast <= 0) return NO_TOW;

  const strength = along * across * fast;
  return {
    drag: 1 - TOW_MAX * strength,
    frontGrip: 1 - DIRTY_AIR * strength,
    strength,
  };
}

/**
 * The best tow available from a field of cars.
 *
 * Wakes do not add up — you are in one car's air or another's, and the
 * one that matters is the strongest. Summing them would let a line of
 * traffic tow a car to an impossible speed, which is exactly the bug a
 * naive implementation ships with.
 */
export function bestTow(candidates: TowInput[]): TowResult {
  let best = NO_TOW;
  for (const c of candidates) {
    const t = solveTow(c);
    if (t.strength > best.strength) best = t;
  }
  return best;
}
