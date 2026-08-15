// The handling model's tuning constants, in one place so the UE5 data
// API and the C++ header generator publish exactly what src/game/engine.ts
// runs. engine.ts keeps its own local copies for hot-path clarity; the
// contract test in scripts/check-unreal-sync.mjs proves they agree.

export const HANDLING = {
  /** Accel-curve ceiling in m/s before per-car bonuses. */
  ceiling: 115,
  /** thrust = thrustK * power * (1 - v/ceiling) */
  thrustK: 19,
  /** drag = dragA * v^2 + dragB, scaled 0.35 while on throttle. */
  dragA: 0.0012,
  dragB: 1.2,
  steerSmoothRate: 7,
  casterRate: 2.4,
  headingClamp: 0.45,
  /** Metres: how close you must be to flash a challenge. */
  flashRangeM: 60,

  driftMinSpeed: 14,
  driftAngleBase: 0.38,
  driftAngleSpeedK: 0.28,
  driftEngageRate: 3.4,
  driftRecoverRate: 2.3,
  /** The old hard ceiling on drift angle.
   *
   *  The web build no longer clamps: driftSpinAngle below replaced it, so
   *  that an angle you cannot hold ends in a spin instead of parking
   *  against an invisible wall. GRNVehiclePawn.cpp still clamps with this,
   *  which means the two builds now drift differently even though every
   *  constant here agrees — the ports carry the numbers but not yet
   *  src/game/drift.ts. Left published for that reason, and only that. */
  driftYawClamp: 0.75,
  driftLatScrub: 0.5,
  driftDriveLoss: 1.1,

  // Drift, the rest of it (src/game/drift.ts). A slide is a balance held
  // on opposite lock, not an angle that settles at a cap.
  /** Angle (rad) past which the car counts as sliding rather than turning. */
  driftEstablished: 0.12,
  /** Extra opposite lock speeds recovery by this much per unit of lock. */
  driftRecoverCounterK: 3.2,
  /** rad/s the angle grows under full lock-into-slide and full throttle. */
  driftOverRotate: 0.42,
  /** rad/s opposite lock takes the angle back. Bigger than overRotate:
   *  a slide must always be catchable by a driver who reacts. */
  driftCounterRate: 2.6,
  /** Beyond this angle (rad) the slide accelerates itself. */
  driftCriticalAngle: 0.72,
  /** How hard it runs away past critical, per rad of excess. */
  driftRunawayRate: 1.6,
  /** Past this angle (rad) it is a spin and no input will save it. */
  driftSpinAngle: 1.05,
  /** Seconds a spin runs before control returns. */
  driftSpinTime: 1.15,
  /** Fraction of speed a spin sheds per second. */
  driftSpinDrag: 0.85,
  /** rad/s the body keeps rotating through a spin, and how far it goes. */
  driftSpinRate: 2.4,
  driftSpinSweep: 2.2,
  /** Sideways scrub: fraction of speed lost per second, plus per rad. */
  driftScrubBase: 0.05,
  driftScrubK: 0.24,

  // Entries beyond the handbrake and the throttle.
  /** Rotation authority (0..1) over which a trailed pedal starts a slide.
   *  Set from the measured curve: a trailed pedal clears it, a buried one
   *  and a coasting entry do not. */
  driftBrakeEntry: 0.12,
  /** Trail-brake entries reach this fraction of the handbrake's angle. */
  driftBrakeAngleK: 0.45,
  /** Feint: lock reversal rate (1/s) and the load that must be on first. */
  driftFeintRate: 4.2,
  driftFeintLoad: 0.3,
  driftFeintMinSpeed: 20,
  /** Seconds a flick keeps the rear light, and how far it sends it. */
  driftFeintWindow: 0.45,
  driftFeintAngleK: 0.55,

  // Scoring. Angle times speed, stepped by linking one slide to the next.
  driftScoreK: 3.2,
  driftScoreMinDeg: 8,
  driftScoreMinSpeed: 12,
  /** Seconds a run stays live through centre — the linking window. */
  driftLinkWindow: 0.9,
  driftChainMax: 5,

  // Brakes (src/game/brakes.ts).
  /** Demand over the tyre's ceiling at which the wheels stop rotating. */
  brakeLockMargin: 1.0,
  /** Sliding friction as a fraction of peak: a locked tyre stops WORSE. */
  brakeSlideFriction: 0.72,
  /** Steering authority left on locked front tyres. */
  brakeLockSteer: 0.25,
  /** How fast lock builds and releases (1/s). */
  brakeLockRate: 12,
  /** ABS holds this fraction of the ceiling, and pulses at this rate. */
  absHold: 0.97,
  absHz: 14,
  /** °C per unit of brake power, and how fast the discs give it back.
   *  Cooling is deliberately slow — a disc sheds heat over tens of
   *  seconds, not fractions of one. Set fast enough to look plausible in
   *  isolation, it held the discs at a steady 60 °C through ten flat-out
   *  stops and fade could never happen at all. */
  brakeHeatK: 0.105,
  brakeCoolBase: 0.008,
  brakeCoolK: 0.0016,
  /** Fade begins here (°C over ambient) and is total by fadeFull. */
  brakeFadeStart: 320,
  brakeFadeFull: 620,
  /** Most pad force fade can take away. */
  brakeFadeMax: 0.45,
  /** Trail braking: rad/s of yaw per unit of rotation authority, and the
   *  speed below which there is no weight worth transferring. */
  brakeRotateK: 0.85,
  brakeRotateMinSpeed: 12,
  /** Engine braking off-throttle, m/s². */
  engineBrakeK: 2.4,

  // Tire model: one grip budget shared by drive, brakes and steering.
  /** Fraction of gripAccel the driven axle transmits at rest… */
  tractionBase: 0.8,
  /** …ramping to full by this speed (m/s). Excess torque is wheelspin. */
  tractionRampSpeed: 22,
  /** Brake ceiling = gripAccel * brakeGripK + brakeForce * brakePadK. */
  brakeGripK: 1.05,
  brakePadK: 0.25,
  /** Friction circle: braking lost to steering demand (and vice versa). */
  trailBrakeK: 0.6,
  latDemandSpeed: 40,
  understeerK: 0.35,
  /** Front tires scrub speed when held near the cornering limit. */
  cornerScrubK: 0.3,
  cornerScrubSpeed: 40,

  // Power-over: wheelspin + steering hangs the tail out sans handbrake.
  powerOverSpin: 1.2,
  powerOverSteer: 0.5,
  powerOverMinSpeed: 18,
  powerOverThrottle: 0.85,
  powerOverAngleK: 0.6,

  // Crashes: severity is the speed component into the obstacle.
  /** Lateral m/s into a wall that counts as a full-severity crash. */
  crashLatFull: 12,
  /** Fraction of speed a full-severity wall hit sheds at impact. */
  crashSpeedLossK: 0.28,
  /** Rebound shove off the barrier at full severity (m/s). */
  crashReboundK: 5,
  /** Closing speed on traffic that counts as a full-severity wreck. */
  trafficClosingFull: 22,
} as const;

export type Handling = typeof HANDLING;
