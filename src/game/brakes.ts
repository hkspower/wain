// The braking system.
//
// Braking used to be one expression: grip-limited deceleration with a
// friction circle traded against steering. That is the right *ceiling*,
// but a ceiling is not a system — it left the pedal with exactly one
// useful position (flat to the floor) and no way to get it wrong. A
// brake you cannot overdrive is not a skill, it is a speed setting.
//
// Four things make it a system:
//
//   Lock-up.   Past the tyre's limit the wheels stop turning and start
//              sliding, and a sliding tyre stops WORSE than one on the
//              edge of rotating — and steers not at all. Threshold
//              braking is the fastest way to stop; standing on it is not.
//   ABS.       A garage part that modulates pressure just under the lock
//              point. It buys back the distance and all of the steering,
//              at the cost of the pedal pulsing under your foot.
//   Fade.      Discs heat with the energy they absorb and cool with the
//              air over them. Ride them down the corniche and they go
//              long. Carbon takes far more heat before it gives up.
//   Rotation.  Weight moves forward under braking, the rear goes light,
//              and the car turns in harder than grip alone explains.
//              This is the trail-brake entry, and it is what makes
//              braking part of the drifting system rather than its
//              opposite.
//
// Pure functions over a small state object, so the physics test can
// drive them directly and the UE5/Unity ports can mirror the constants
// out of handling.ts.

import { HANDLING as H } from "./handling";

export interface BrakeTune {
  /** Pad force in m/s² before the tyre and heat have their say. */
  brakeForce: number;
  /** Lateral grip, which sets the tyre's share of the ceiling. */
  gripAccel: number;
  /** Heat the discs absorb before fade begins, relative to stock. */
  brakeThermalMult: number;
  /** Anti-lock fitted: pressure is modulated instead of locking. */
  hasAbs: boolean;
}

/** Carried between frames. The engine owns one of these. */
export interface BrakeState {
  /** 0..1 — how fully the tyres have stopped rotating and started sliding. */
  lock: number;
  /** Disc temperature in °C above ambient. */
  temp: number;
  /** ABS modulation phase in radians, for the pedal pulse and its sound. */
  pulse: number;
}

export interface BrakeInput {
  dt: number;
  /** Pedal, 0..1. */
  brake: number;
  /** m/s. */
  speed: number;
  /** 0..1 — how much of the tyre is already spoken for by cornering. */
  latDemand: number;
  /** Lateral grip at this instant, aero included. Optional: without it
   *  the solver falls back to the car's static figure. */
  grip?: number;
  /** Smoothed steering, -1..1 — which way the rotation points. */
  steer: number;
  /** 0..1. Off-throttle in gear, the engine helps slow the car. */
  throttle: number;
  tune: BrakeTune;
}

export interface BrakeResult {
  /** m/s² of retardation to apply this frame. */
  decel: number;
  /** 0..1, for the squeal, the smoke and the HUD. */
  lock: number;
  /** Multiplier on steering authority: locked front tyres do not steer. */
  steerScale: number;
  /** How much rotation the light rear is offering, 0..1 signed by the
   *  steering. Normalised so the drift solver can test it against a
   *  threshold that means the same thing on every car. */
  rotate: number;
  /** The same thing as a yaw rate (rad/s), ready to integrate. */
  yaw: number;
  /** 0..1 of pad force currently lost to heat. */
  fade: number;
  /** True while ABS is modulating — the pedal is pulsing. */
  abs: boolean;
  /** °C above ambient, for the HUD and the glowing-disc shader. */
  temp: number;
}

export function newBrakeState(): BrakeState {
  return { lock: 0, temp: 0, pulse: 0 };
}

/**
 * The most retardation the tyres can take at this steering angle.
 *
 * Exported because the drift solver and the yaw model both need to know
 * how much of the grip budget braking is using, and a second copy of
 * this expression is a second thing to keep in step.
 */
export function brakeCeiling(
  tune: BrakeTune,
  latDemand: number,
  /** Lateral grip as it is RIGHT NOW rather than as the car was built:
   *  aero presses the tyres down harder the faster you are going, and a
   *  wing that helps a car corner helps it stop. Defaults to the static
   *  figure, which is what it was before there was any aero to speak of. */
  gripNow?: number
): number {
  const grip = gripNow ?? tune.gripAccel;
  const flat = grip * H.brakeGripK + tune.brakeForce * H.brakePadK;
  // Friction circle: front tyres steering hard have less left to stop with.
  return flat * Math.sqrt(1 - H.trailBrakeK * latDemand * latDemand);
}

export function solveBrakes(s: BrakeState, i: BrakeInput): BrakeResult {
  const { dt, tune } = i;
  const brake = Math.min(Math.max(i.brake, 0), 1);
  const ceiling = brakeCeiling(tune, Math.min(1, Math.max(0, i.latDemand)), i.grip);

  // --- Fade. Heat is what the discs absorbed; it leaves with the air
  // over them, so a car that keeps moving cools and a car crawling on
  // hot brakes does not.
  const fade =
    Math.min(
      1,
      Math.max(0, (s.temp - H.brakeFadeStart) / (H.brakeFadeFull - H.brakeFadeStart))
    ) * H.brakeFadeMax;
  // Pad force after heat. The tyre's share of the ceiling is untouched:
  // fade is the pads giving up, not the road.
  const padForce = tune.brakeForce * (1 - fade);

  // --- Engine braking. Off the throttle and in gear the engine is a
  // pump being turned by the road. It is small next to the brakes, but
  // it is why lifting mid-corner rotates the car — and it goes into the
  // DEMAND rather than onto the answer, because the tyre does not care
  // which end of the driveshaft a retarding torque came from. Ask for
  // more than it can transmit and it locks, whether that was your foot
  // or your downshift.
  const engineBrake =
    (1 - i.throttle) * H.engineBrakeK * Math.min(1, i.speed / 12);

  // --- What the driver is asking for, against what the road will give.
  const demand = brake * padForce + engineBrake;
  const overDrive = ceiling > 0 ? demand / ceiling : 0;

  let decel: number;
  let absOn = false;
  if (overDrive > H.brakeLockMargin) {
    if (tune.hasAbs) {
      // The controller bleeds pressure off the moment a wheel starts to
      // decelerate faster than the car. It never quite reaches the peak
      // — that last few per cent is the price of never crossing it.
      absOn = true;
      s.pulse += dt * H.absHz * Math.PI * 2;
      decel = ceiling * H.absHold;
      s.lock += (0 - s.lock) * Math.min(1, dt * H.brakeLockRate);
    } else {
      // Over the edge. Lock builds in over a tenth of a second rather
      // than snapping, so the transition is something you can feel
      // coming and ease back out of.
      s.lock += (1 - s.lock) * Math.min(1, dt * H.brakeLockRate);
      decel = ceiling;
    }
  } else {
    s.lock += (0 - s.lock) * Math.min(1, dt * H.brakeLockRate);
    decel = Math.min(demand, ceiling);
  }
  if (s.lock < 1e-3) s.lock = 0;

  // A sliding tyre has a lower coefficient than one at the edge of
  // rotating. This is the whole reason threshold braking exists, and the
  // reason locking the wheels makes the wall arrive sooner, not later.
  decel *= 1 - s.lock * (1 - H.brakeSlideFriction);

  // --- Heat in, heat out. Power into the discs is force times speed;
  // cooling is airflow-proportional with a still-air floor. Only the pads'
  // share heats them — an engine dumps its braking heat into the coolant,
  // which is why you can descend all night on the gearbox and not fade.
  const padShare = demand > 1e-4 ? (brake * padForce) / demand : 0;
  const capacity = Math.max(0.2, tune.brakeThermalMult);
  s.temp += ((decel * padShare * i.speed * H.brakeHeatK) / capacity) * dt;
  s.temp -= s.temp * (H.brakeCoolBase + i.speed * H.brakeCoolK) * dt;
  if (s.temp < 0) s.temp = 0;

  // --- Steering. Locked fronts are erasers, not tyres.
  const steerScale = 1 - s.lock * (1 - H.brakeLockSteer);

  // --- Rotation. The rear goes light under pressure and the car turns in
  // beyond what grip alone would give.
  //
  // It peaks in the MIDDLE of the pedal's travel, not at the end of it,
  // and that is the whole point of the technique. Trail braking is called
  // trailing because you are easing off: some pressure keeps the nose
  // loaded and the tail light, but bury the pedal and the front tyres
  // spend their entire budget stopping, with nothing left to turn with —
  // which is understeer, the exact opposite of what you were after.
  // A model where rotation rises all the way to the stop would reward
  // standing on everything at once, which is the one thing that has never
  // worked in a car.
  //
  // It also needs steering angle to point the rotation somewhere and
  // speed for there to be any weight worth moving, and locked wheels kill
  // it outright: a car sliding on four erasers rotates around nothing.
  // Two factors, and the technique lives in the gap between them:
  //
  //   weight  how far the rear has unloaded — the deceleration actually
  //           achieved, against what the car could do in a straight line.
  //           Rises with the pedal.
  //   spare   how much of the front's grip is still free to turn with.
  //           Falls with the pedal, and is zero once you have asked for
  //           more than the road will give.
  //
  // Their product peaks partway through the travel. Bury the pedal and
  // spare goes to nothing: all the weight in the world on a front tyre
  // with no capacity left is understeer, which is what actually happens
  // and the opposite of what the driver wanted.
  const flat = tune.gripAccel * H.brakeGripK + tune.brakeForce * H.brakePadK;
  const weight = Math.min(1, decel / Math.max(flat, 1e-3));
  const spare = Math.max(0, 1 - Math.min(1, demand / Math.max(ceiling, 1e-3)));
  const rotate =
    Math.sign(i.steer) *
    Math.min(1, Math.abs(i.steer)) *
    weight *
    spare *
    (1 - s.lock) *
    Math.min(1, Math.max(0, i.speed - H.brakeRotateMinSpeed) / 18);

  return {
    decel,
    lock: s.lock,
    steerScale,
    rotate,
    yaw: rotate * H.brakeRotateK,
    fade,
    abs: absOn,
    temp: s.temp,
  };
}
