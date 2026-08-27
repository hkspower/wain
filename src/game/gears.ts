// Gearbox shift points by speed (km/h) — single source of truth for the
// HUD tach/gear readout, the engine-sound RPM model, and the torque
// curve the physics reads. Deliberately free of three.js imports so the
// HUD can use it without pulling in the engine.
export const GEARS = [0, 55, 95, 145, 200, 260, 320];

/** Which gear the box would be in at this speed. 0-indexed: 0 is first. */
export function gearAt(speedKmh: number): number {
  let g = 0;
  while (g < GEARS.length - 2 && speedKmh >= GEARS[g + 1]) g++;
  return g;
}

/**
 * Where the needle sits inside the current gear, 0..1 — idle-ish at the
 * bottom of a gear, on the limiter at the top.
 *
 * This lives here, once, because three separate places need the answer
 * and they must not disagree: the tacho the player reads, the note the
 * engine makes, and the torque the sim applies. Two of those used to
 * carry their own copy of the arithmetic.
 *
 * The floor is not zero. A gearbox never lets an engine fall to idle
 * while it is driving — that is what a clutch and a first gear are for —
 * so the bottom of every gear is a genuine 12% of the range, and the
 * torque curve is never asked about revs the car cannot actually be at.
 */
export function revFraction(speedKmh: number): number {
  return revFractionIn(gearAt(speedKmh), speedKmh);
}

/**
 * The same answer for a gear the caller already knows it is in.
 *
 * The engine holds its own gear, because a box that re-derives the gear
 * from speed every frame changes its mind twice a frame when the car
 * sits on a boundary — and once a shift costs time and torque, that
 * flutter stops being a cosmetic wobble on the needle and becomes a car
 * that cannot accelerate through 55 km/h. So the engine keeps the gear
 * with hysteresis and asks for the revs in THAT gear, and this stays the
 * one place the arithmetic lives.
 */
export function revFractionIn(gear: number, speedKmh: number): number {
  const g = Math.min(Math.max(gear, 0), GEARS.length - 2);
  return Math.min(1, Math.max(0.12, (speedKmh - GEARS[g]) / (GEARS[g + 1] - GEARS[g])));
}
