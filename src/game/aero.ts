// The attack kit's wing moves.
//
// Every one of the six supercars — and the four rivals who bring one —
// wears the swan-neck wing, and it was five loose meshes with no pivot,
// no name and nothing driving them: a decal in three dimensions. A car
// with active aero does two things a viewer can see. Under braking the
// main plane flips up as an airbrake — on a following car it is the
// biggest brake tell there is, larger than the lamps — and at speed it
// trims flatter to shed drag. Both are functions of things the car
// already knows about itself (the brake and the speed), so this is a
// pure solver in the pattern of suspension.ts: state in, state out, no
// engine fields, and the same call for the player and the rival.
//
// The speed term reuses the v² curve grip.ts already uses for the
// downforce a part delivers, against the same reference speed: the
// wing trims flat at the speed its downforce figure is quoted at, not
// at a second threshold invented here.

import { HANDLING as H } from "./handling";

export interface WingInput {
  /** The pivot's current pitch, radians. Positive is the trailing edge
   *  up — the airbrake. */
  angle: number;
  /** Brake pressure 0..1. The same fact the tail lamps light on. */
  brake: number;
  /** m/s. */
  speed: number;
  dt: number;
}

/** Where the wing wants to be for this brake and speed, before the
 *  actuator's rate limit. */
export function wingTarget(brake: number, speed: number): number {
  const v = Math.min(1, speed / H.downforceRefSpeed);
  return brake * H.wingAirbrakeRad - v * v * H.wingTrimRad;
}

/** One frame of the actuator: toward the target at no more than
 *  wingRate radians a second, so a stab of brake is a flip and not a
 *  cut. */
export function solveWing(i: WingInput): number {
  const target = wingTarget(i.brake, i.speed);
  const step = H.wingRate * i.dt;
  const d = target - i.angle;
  return i.angle + (d > step ? step : d < -step ? -step : d);
}
