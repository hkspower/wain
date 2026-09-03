// What an impact does to a car.
//
// Handling, braking and grip in this model are all systems: a friction
// circle, a brake solver with lock, ABS and fade, load transfer across a
// pitching body, and a spin that is momentum against friction rather
// than an animation. A crash was none of those things. It was a speed
// multiplier and a heading multiplier, written inline in the middle of
// engine.ts's update, and it had two consequences worth naming:
//
//   A CRASH COULD NOT SPIN THE CAR.  drift.ts models a spin properly —
//   the car leaves with a rate set by how fast it was already rotating
//   and how much speed there was to turn into rotation, and four sliding
//   tyres take it back out. Nothing but a slide could ever enter it. So
//   losing the tail at 200 km/h span the car, and putting the same car
//   into a barrier sideways at 200 km/h scaled its heading by 0.4 and
//   drove on. The violent thing was the one that did not rotate.
//
//   AN IMPACT HAD NO LEVER ARM.  A hit is an impulse, and an impulse
//   through anything but the centre of mass turns the car. Which end
//   touches decides which way: clip a barrier with the NOSE and it pushes
//   the nose away, straightening you out along the wall; clip it with the
//   TAIL and the back is thrown out while the nose tucks in, which is the
//   one that ends facing the wrong way. Those are opposite events and the
//   old model could not tell them apart, because it only ever read how
//   fast the car was going sideways.
//
// Pure functions over plain inputs, in the idiom brakes.ts and grip.ts
// already use here: so tests/crash.mjs can drive them without a browser,
// and so the UE5 and Unity ports mirror one set of constants out of
// handling.ts instead of each carrying its own literals. That last part
// was not hypothetical. Every crash number in handling.ts —
// crashLatFull, crashSpeedLossK, crashReboundK, trafficClosingFull — was
// read by NOTHING on the web: engine.ts had 12, 0.28, 5 and 22 typed
// into it, while GRNVehiclePawn.cpp read the published constants by
// name. They agreed by luck. Editing handling.ts moved the ports and
// left the web build alone, silently, which is the same rot the caster
// rate and the road positions were both found in.

import { HANDLING as H } from "./handling";

/** What a hit did. Every field is applied by the caller; nothing here
 *  mutates anything, so the same call can be measured in a test. */
export interface Impact {
  /** 0..1. How hard, in the terms the obstacle deserves: the speed INTO
   *  a barrier, the CLOSING speed onto a bumper. */
  severity: number;
  /** Multiply the car's speed by this. Never above 1 — see the test. */
  speedMul: number;
  /** Heading after the obstacle has deflected the nose, radians. */
  heading: number;
  /** Sideways velocity off the obstacle, m/s. */
  slipVel: number;
  /** Rotation the impact imparts, rad/s, signed the way the car turns. */
  yaw: number;
  /** The same impulse as an ANGLE (radians), for a hit too soft to spin
   *  the car. The drift model holds a non-spinning car as an angle and a
   *  spinning one as a rate, so one of the two has to be converted; doing
   *  it here rather than at the call site keeps it out of the frame loop
   *  and lets the test assert it does not depend on dt. */
  kick: number;
  /** True when that rotation is more than the tyres can answer, and the
   *  car should be handed to the spin solver rather than steered. */
  spin: boolean;
  /** Which end made contact. Only meaningful for a barrier. */
  noseFirst: boolean;
  /** Camera shake, 0..1-ish. */
  shake: number;
  /** Spirit Points lost, before the cage's share is taken off. */
  spLoss: number;
}

export interface WallImpact {
  /** Speed component INTO the barrier, m/s — not the car's speed. */
  into: number;
  /** Body angle relative to the road, radians. */
  heading: number;
  /** Which barrier: +1 for the right-hand side, -1 for the left. */
  side: number;
  /** 0..1 of the impact a cage absorbs. */
  crashResist: number;
}

export interface TrafficImpact {
  /** Closing speed, m/s. Sign is irrelevant; severity uses the size. */
  closing: number;
  /** Body angle relative to the road, radians. */
  heading: number;
  /** Which way the car is kicked off line: +1 or -1. */
  shove: number;
  /** True when we ran into them, false when they ran into us. A rear
   *  shunt turns the car far more than driving into the back of one:
   *  the push is behind the centre of mass. */
  fromBehind: boolean;
  crashResist: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Sustained rubbing along a barrier — the frames between the impacts.
 *
 * Friction scales with how hard the car is pressed into the steel, so
 * this is a rate (fraction of speed per second) and not a flat tax.
 */
export function scrapeDrag(severity: number): number {
  return H.crashScrapeBase + H.crashScrapeK * clamp01(severity);
}

/**
 * The rotation an off-centre impulse imparts.
 *
 * Two terms, and the second is the one that was missing entirely.
 *
 * LEVER — a car sliding dead parallel into a wall is hit through its
 * side, square to the centre of mass, and does not rotate at all; that
 * is a scrape. The more the body is angled, the further up the flank the
 * contact patch moves and the longer the lever arm. So rotation grows
 * with the ANGLE, where severity grows with the SPEED, and the two are
 * genuinely independent: a fast parallel graze is violent and straight,
 * a slow square clip is gentle and turns you.
 *
 * WHICH END — the barrier pushes whatever touches it away from itself.
 * Nose first and the front is shoved off the wall, which rotates the car
 * to lie along the barrier: survivable, and the reason a nose-in clip
 * usually just scrubs speed. Tail first and the back is thrown out while
 * the nose tucks toward the wall, which is the beginning of going round.
 * Same impulse, opposite sign, and the second one is worse — which is
 * why it carries a multiplier rather than being a mirror image.
 */
function wallYaw(severity: number, heading: number, side: number, noseFirst: boolean): number {
  const lever = Math.min(1, Math.abs(heading) / H.crashLeverRef);
  let mag = H.crashYawK * severity * lever;
  if (!noseFirst) mag *= H.crashTailLeverK;
  // Nose contact rotates the car AWAY from the barrier; tail contact
  // swings the nose into it. Opposite signs, from one geometric fact.
  return mag * (noseFirst ? -side : side);
}

/** A barrier. */
export function solveWallImpact(i: WallImpact): Impact {
  const side = Math.sign(i.side) || 1;
  const severity = clamp01(Math.max(0, i.into) / H.crashLatFull);
  const resist = clamp01(i.crashResist);
  // Pointed into the wall means the front corner arrives first.
  const noseFirst = Math.sign(i.heading) === side || i.heading === 0;

  // NOT scaled by the cage. A cage resists damage — it keeps the shell
  // out of the cabin and the car pointing straight afterwards — and
  // rotation is not damage, it is angular momentum. Scaling it here was
  // measured and reverted: at the cage's 0.55 a full-severity tail-first
  // clip fell from 3.74 to 1.68 rad/s, under the spin threshold, so the
  // one part in the catalogue that survives crashes also made the car
  // literally unspinnable by any impact. That is a bigger handling
  // change than the part is sold as, arrived at by accident.
  const yaw = wallYaw(severity, i.heading, side, noseFirst);
  const spin = Math.abs(yaw) > H.crashSpinRate;

  return {
    severity,
    speedMul: 1 - H.crashSpeedLossK * severity * (1 - resist),
    // The barrier turns the nose away. Steeper arrivals keep more of the
    // (reversed) angle, which is what rebounding off one looks like.
    heading:
      Math.sign(i.heading) === side
        ? i.heading * -(H.crashHeadingKeep + H.crashHeadingKeepK * severity)
        : i.heading,
    slipVel: -side * (H.crashSlipBase + H.crashReboundK * severity),
    yaw,
    kick: yaw * H.crashKickTime,
    spin,
    noseFirst,
    shake: H.crashShakeBase + H.crashShakeK * severity,
    spLoss: H.crashSpBase + H.crashSpK * severity,
  };
}

/** Another car. */
export function solveTrafficImpact(i: TrafficImpact): Impact {
  const severity = clamp01(Math.abs(i.closing) / H.trafficClosingFull);
  const shove = Math.sign(i.shove) || 1;
  // crashResist is deliberately unread here. Rotation is not damage, and
  // the two damages a shunt does — the speed it costs and the SP it takes
  // — are both applied by the caller, which already had the cage's share
  // in hand. Taking it off twice is the bug this note exists to prevent.

  // A shunt is never square. Being hit from behind turns the car most —
  // the push is behind the centre of mass, which is the whole principle
  // of a PIT manoeuvre — while running into the back of something is
  // resisted by the front tyres and mostly just stops you.
  const lever = H.trafficLeverBase + H.trafficLeverK * Math.min(1, Math.abs(i.heading) / H.crashLeverRef);
  const yaw =
    shove *
    H.crashYawK *
    severity *
    lever *
    (i.fromBehind ? H.trafficRearLeverK : 1);

  return {
    severity,
    speedMul: 1, // the caller sets speed from the collision itself
    heading: i.heading + shove * H.trafficHeadingK * (0.5 + severity),
    slipVel: 0,
    yaw,
    kick: yaw * H.crashKickTime,
    spin: Math.abs(yaw) > H.crashSpinRate,
    noseFirst: !i.fromBehind,
    shake: H.trafficShakeBase + H.trafficShakeK * severity,
    spLoss: H.trafficSpBase + H.trafficSpK * severity,
  };
}
