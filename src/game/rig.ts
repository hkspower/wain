// The skeletons, in one place.
//
// Every figure in the game is posed by the analytic IK in ik.ts rather
// than by canned animation, and a solver is only as portable as the
// numbers it solves against: bone lengths, joint offsets, where the
// wheel sits, where the hands grip it, how far a pedal travels, how far
// a neck turns. Those numbers are the contract. src/game/characters.ts
// builds the rigs from them, engine.ts and world.ts drive them, the UE5
// header generator publishes them, and scripts/check-unreal-sync.mjs
// proves the C++ agrees — so a rig change cannot silently land in one
// engine and not the other.
//
// Metres and radians throughout, matching the web build. Unreal
// multiplies lengths by 100 for centimetres and leaves angles alone.

export const RIG = {
  /** The seated driver: arms to the wheel, feet to the pedals. */
  driver: {
    /** Shoulder joint, from the rig origin at the seat base. */
    shoulderX: 0.16,
    shoulderY: 0.46,
    shoulderZ: -0.04,
    /** Adult arm. The first pass used 0.20/0.19, which cannot reach a
     *  steering wheel from a seat: the solver correctly straightened
     *  the arm and the hand hung 36 cm short of the rim. */
    upperArm: 0.29,
    foreArm: 0.26,

    /** Hip joint, and the thigh/shin that reach the pedal box. */
    hipX: 0.09,
    hipY: 0.17,
    hipZ: 0.05,
    thigh: 0.27,
    shin: 0.27,
    /** Seated rest pose, for a rig that is built but never solved. */
    hipPitch: -1.15,
    kneePitch: 0.95,

    /** Head joint — the aim target for looking into a corner. */
    headY: 0.52,
    headZ: 0.02,

    /** Steering wheel: raked toward the driver like a real column. */
    wheelY: 0.44,
    wheelZ: 0.24,
    wheelRake: -0.42,
    /** How far the driver is thrown sideways at the limit of grip, in
     *  radians of body lean. A belted driver in a road seat moves a few
     *  degrees; a stiff bucket less. Away from the corner, because that
     *  is the direction the force pushes them. */
    leanPerG: 0.115,
    /** And forward under braking. Smaller, because the belts take it. */
    foldPerG: 0.075,
    /** How fast the body follows the load. A person is not a spring on
     *  a car's timescale — they brace. */
    leanRate: 5.5,
    /** The head stays more upright than the torso, because a driver's
     *  neck fights the lean to keep their eyes level. A fraction of the
     *  body's roll, taken back off the head. */
    headCounter: 0.45,
    wheelRadius: 0.16,
    /** Where each hand grips the rim, as an angle in the wheel's own
     *  frame — ten-to-two. Fixed in LOCAL space: the wheel's transform
     *  carries them round as it turns, and adding the wheel angle here
     *  as well would count the rotation twice and orbit the hands at
     *  double the spoke rate. */
    gripLeft: Math.PI * 0.72,
    gripRight: Math.PI * 0.28,
    /** Lock-to-lock: about a turn and a half each way in a road car. */
    steerLock: 2.4,
    /** How fast the shown wheel chases the steering input. */
    wheelRate: 12,

    /** Pedal faces, right-hand drive: throttle outboard, brake inboard. */
    pedalThrottleX: 0.1,
    pedalBrakeX: -0.08,
    pedalY: 0.09,
    pedalZ: 0.46,
    pedalPitch: -0.55,
    /** How far a fully pressed pedal sinks. The foot is solved onto the
     *  moving face, so this travels all the way up the leg. */
    pedalTravelZ: 0.05,
    pedalTravelY: 0.015,

    /** Elbow pole, in the rig's own frame: elbows break outward and
     *  down, or a solved arm bends like a flamingo's knee. */
    armPoleX: 0.51,
    armPoleY: -0.04,
    armPoleZ: -0.06,
    /** Knee pole: knees break up and forward, not out into the tunnel. */
    legPoleX: 0.22,
    legPoleY: 1.1,
    legPoleZ: 0.42,

    /** How far round the rim the hands are CARRIED before they slide.
     *
     *  The grips ride the wheel's own frame, which is right for road
     *  angles and wrong at lock: at 2.4 rad of wheel the left hand has
     *  been carried to the bottom of the rim and the arms cross. A real
     *  driver lets the rim slide through their grip past a comfortable
     *  arc, so past this angle the hand holds its station in the CAR's
     *  frame and the wheel turns underneath it. About sixty degrees —
     *  the arc you can carry without your elbows arguing. */
    gripCarryMax: 1.05,

    /** The handbrake, between the seats on the tunnel — inboard, the
     *  brake-pedal side of a right-hand-drive cab. The lever is bolted
     *  to the CAR (like the wheel and the pedals), pivots at its base,
     *  and rises through `handbrakeThrow` radians at full pull, so the
     *  hand that grips it rides a moving target the same way the feet
     *  ride the pedals. */
    handbrakeX: -0.3,
    handbrakeY: 0.16,
    handbrakeZ: 0.02,
    /** Base-to-grip length of the lever. */
    handbrakeLen: 0.26,
    /** Rest rake, radians back from vertical toward the driver. */
    handbrakeTilt: 1.12,
    /** How far the lever rises at full pull. */
    handbrakeThrow: 0.5,
    /** How fast the hand commits to (and returns from) the lever. Fast
     *  on the way down — a drift starts with a snatch — and the same
     *  ease back, which reads as letting go. */
    handbrakeRate: 10,

    /** The driver looks into the corner, not down the bonnet. */
    lookAheadM: 26,
    lookLatK: 0.4,
    lookHeight: 1.1,
    /** Hinge ranges, degrees of BEND (0 = dead straight). An elbow
     *  neither locks past straight nor folds flat; a knee the same. The
     *  solver used to have no limits at all, and reached a target behind
     *  the shoulder by folding the arm through the torso. */
    elbowMinDeg: 8,
    elbowMaxDeg: 150,
    kneeMinDeg: 12,
    kneeMaxDeg: 140,
    /** Fraction of the arm's span over which full extension is eased
     *  into rather than hit — see TwoBoneOptions.softReach. */
    softReach: 0.08,
    neckYaw: 0.7,
    neckPitch: 0.28,
    neckRate: 5,
  },

  /** What the rival's driver is seen doing, derived from the AI's own
   *  kinematics rather than from inputs it does not have. */
  rival: {
    /** Visible steer per metre of lane change still to be taken. */
    steerPerLat: 0.45,
    steerRate: 4,
    pedalRate: 6,
    /** Accel above this (m/s²) reads as throttle, below the negative
     *  of the brake figure as braking. */
    throttleAccel: 0.3,
    throttleScale: 8,
    brakeAccel: -1,
    brakeScale: 10,
    /** Cruising throttle, so the foot is not lifted at a steady speed. */
    cruiseThrottle: 0.2,
    /** Inside this gap, and offset by at least this much laterally, the
     *  rival looks over at you — the sizing-up before the flash. */
    glanceGapM: 12,
    glanceLatM: 1.2,
  },

  /** Roadside spectators in dishdasha and abaya. */
  spectator: {
    shoulderX: 0.2,
    shoulderY: 1.28,
    /** Arms hang slightly abducted; the wave returns to exactly this,
     *  which is also what keeps the hand clear of the robe. */
    armAbduction: 0.15,
    upperArm: 0.28,
    foreArm: 0.25,
    headY: 1.5,
  },

  /** Racers standing at the grid, helmet worn or carried. */
  racer: {
    shoulderX: 0.19,
    shoulderY: 1.4,
    upperArm: 0.28,
    foreArm: 0.26,
    headY: 1.64,
  },

  /** How the crowd watches, and waves. */
  crowd: {
    /** Nobody cranes at a car three streets away. */
    watchRangeM: 90,
    /** A neck is not a turret; past the limit the body takes the rest. */
    neckYaw: 1.15,
    neckPitch: 0.3,
    neckRate: 6,
    bodyRate: 1.2,
    restRate: 1.5,

    /** Inside this, a free hand goes up. */
    waveRangeM: 45,
    liftUpRate: 2.2,
    liftDownRate: 1.1,
    wagHz: 6.5,
    wagAmp: 0.3,
    /** Fraction of the arm's span the hand is held out at. Holding a
     *  fixed reach and blending the DIRECTION is what keeps the arm
     *  extended: blending the hand's position instead draws a line from
     *  hanging to raised that passes within a hand's width of the
     *  shoulder, and the solver answers that by folding the arm into
     *  the armpit at both ends of every wave. */
    reach: 0.94,
    /** The raised aim: up, and out toward the car. */
    raiseUp: 0.87,
    raiseOut: 0.45,
    /** One in this many never waves — a crowd in lockstep reads as a
     *  stadium routine rather than a roadside. */
    stillEvery: 3,
    /** Elbow pole for the wave, in the watcher's own frame. */
    poleX: 0.6,
    poleY: -0.2,
    poleZ: 0.05,
  },
} as const;

export type Rig = typeof RIG;

/** Flatten to `driverUpperArm: 0.29`-style keys, which is the shape the
 *  UE5 header generator and its contract test both walk. Keeping the
 *  flattening here means neither has to know the nesting. */
export function flatRig(): Record<string, number> {
  const out: Record<string, number> = {};
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  for (const [group, fields] of Object.entries(RIG)) {
    for (const [k, v] of Object.entries(fields as Record<string, number>)) {
      out[cap(group) + cap(k)] = v;
    }
  }
  return out;
}
