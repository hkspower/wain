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
  driftYawClamp: 0.75,
  driftLatScrub: 0.5,
  driftDriveLoss: 1.1,

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
