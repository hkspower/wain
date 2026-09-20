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
    /** The accelerations, m/s², at which the lean and the fold reach
     *  their full figure. The lateral one is the same 1.43 g the shell's
     *  roll saturates at (attitude.ts), so the body and the car it sits
     *  in answer one number; both were literals in the solver, out of
     *  reach of the port checks. */
    leanRefAccel: 14,
    foldRefAccel: 10,
    /** How far past foldPerG a spike can throw the torso forward — a
     *  wall, not a brake. The belt stretches, then stops it; the return
     *  is the spring below. Braking itself still saturates at one. */
    foldSpikeK: 2.5,
    /**
     * THE BODY HAS MASS. The torso was a first-order lerp toward the
     * load — it arrived and stopped — while the car under it is a
     * mass-spring-damper that overshoots (attitude.ts). So the person
     * always looked stiffer than the car, which is backwards: a body is
     * the softer of the two. This is the torso as a damped pendulum on
     * the hips and the belt: about 2.2 Hz, ζ ≈ 0.55, one visible
     * overshoot and settled inside a second. A braced driver, not a
     * passenger — a passenger would be ζ 0.3 and still swinging.
     */
    torsoK: 190,
    torsoC: 15,
    /** The head is a second pendulum on the neck, faster and less
     *  damped than the torso: about 3 Hz, ζ ≈ 0.35. That is where the
     *  lag comes from — the shoulders go first and the head follows —
     *  and, on a hit, the whip. */
    neckK: 355,
    neckC: 13,
    /** The head stays more upright than the torso, because a driver's
     *  neck fights the lean to keep their eyes level. A fraction of the
     *  body's roll, taken back off the head — and of the fold, so a
     *  braking driver keeps looking down the road. */
    headCounter: 0.45,
    /** The shoulders turn into the corner a little ahead of the wheel;
     *  radians of torso yaw at full lock. Small, but the arms re-solve
     *  around it and a cabin shot reads it. */
    shoulderYawPerLock: 0.05,
    /**
     * AND THE SHOULDERS HAVE MASS TOO.
     *
     * The lean and the fold are springs; the yaw on the same torso was
     * written straight off the steering input with no filter of any
     * kind — not even the lerp the wheel gets — so the one axis of the
     * body driven by the player's own hands was the one axis that
     * snapped. Now it is the third spring on the torso, and because the
     * arms are solved onto grips bolted to the CAR, a shoulder that
     * overshoots and settles drags both arms through the overshoot with
     * it. That is the whole of the limbs' secondary motion: it comes out
     * of the IK for free, the moment the root of the chain has weight.
     *
     * 3.3 Hz, ζ ≈ 0.6 — stiffer and lighter than the lean, because this
     * is a deliberate muscular turn and not a body being thrown. Sized
     * against the WHEEL: a first-order lag of rate `wheelRate` trails a
     * sweep by 1/wheelRate = 83 ms, and this spring trails one by
     * 2ζ/ωn = 59 ms, so the shoulders still lead the rim the way they
     * always did — they now arrive with a small overshoot instead of
     * arriving flat.
     */
    yawK: 420,
    yawC: 25,
    /** Breathing. Three millimetres of chest rise at a resting rate —
     *  invisible at speed, and the difference between a person and a
     *  mannequin in the showroom and the menu loop, where the car sits
     *  still and the driver used to as well. Kept under the helmet
     *  clearance the cabin fit test allows. */
    breathAmp: 0.003,
    breathHz: 0.27,
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

    /**
     * Pedal faces, in the driver's own frame. Local +x is the car's
     * LEFT — measured, not assumed: the driver's head sits 365 mm along
     * the car's right vector in the negative direction, which is 365 mm
     * to the LEFT of the centreline.
     *
     * So this game's cars are LEFT-HAND DRIVE, which is what a car in
     * Kuwait is: Kuwait drives on the right, and a right-hand-traffic
     * country puts the wheel on the left. The seat has always had this
     * right. Three comments — here, in characters.ts and in the UE5
     * pawn — said "right-hand drive" and were describing a car this
     * game has never built.
     *
     * The PEDALS were built to match those comments rather than the
     * seat, and so came out mirrored: measured on the running car, the
     * throttle sat 160 mm to the LEFT of the brake, which put the
     * driver's left foot on the accelerator and their right foot on the
     * brake. That is not a left- or right-hand-drive question. The
     * accelerator is the rightmost pedal in every production car ever
     * built, in every country, because it is worked by the right foot.
     *
     * Negative is toward the car's centre from a left-hand seat, so the
     * throttle is inboard and the brake sits outboard of it. The 180 mm
     * between them is unchanged; only the handedness was wrong.
     */
    pedalThrottleX: -0.1,
    pedalBrakeX: 0.08,
    /**
     * A third pedal and a footrest, outboard of the brake. The cab has a
     * floor shifter, so it has a clutch; and until it had one the left
     * foot lived on the brake, which made every driver in the game a
     * left-foot braker with the right foot never leaving the throttle —
     * two feet that never met. Now the RIGHT foot works both throttle
     * and brake, moving between them, and the left foot rests on the
     * dead pedal and goes to the clutch for a shift. Reach: the left hip
     * sits at +0.09 and the leg spans 0.54 m, so 0.31 is as far out as
     * a foot can be planted without the knee locking.
     */
    pedalClutchX: 0.21,
    pedalRestX: 0.31,
    /** How fast the right foot swaps between throttle and brake. A foot
     *  crosses the gap in about a tenth of a second. */
    footSwapRate: 14,
    /** Heel-and-toe: on a downshift under braking the foot stays on the
     *  brake and rolls toward the throttle to blip it — this fraction of
     *  the way — while the brake is above this pressure. */
    heelToeReach: 0.45,
    heelToeBrake: 0.2,
    /** How fast the left foot commits to the clutch and comes home. Faster
     *  than the hand's shiftRate: the foot goes down before the hand
     *  moves and is back on the rest as the hand returns. */
    clutchRate: 20,
    pedalY: 0.09,
    pedalZ: 0.46,
    pedalPitch: -0.55,
    /** How far a fully pressed pedal sinks. The foot is solved onto the
     *  moving face, so this travels all the way up the leg. */
    pedalTravelZ: 0.05,
    pedalTravelY: 0.015,
    /**
     * A PEDAL IS NOT A SWITCH.
     *
     * The pedal faces were written straight from the input, and the
     * player's input is a KEY: throttle and brake are 0 or 1 with
     * nothing between them (engine.ts's `throttle`/`brake` getters are
     * the only unsmoothed controls in the game — the steer goes through
     * steerSmooth, and every AI path filters its pedals through
     * RIG.rival.pedalRate). So a tap of the brake teleported the pedal
     * through its full travel in a single frame, and the foot — solved
     * onto the face — teleported with it. A leg that arrives with no
     * time taken is the one thing IK cannot hide.
     *
     * The fix belongs HERE rather than at the one call site, because
     * this is a law about pedals and not about who is pressing them:
     * the face is a mass on its return spring, and every caller gets it.
     * 4.2 Hz, ζ ≈ 0.85 — about four frames of travel at sixty hertz,
     * and no bounce worth the name, because the foot on it is what stops
     * a real pedal ringing.
     */
    pedalK: 700,
    pedalC: 45,

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

    /**
     * The driver looks into the corner, not down the bonnet — and how
     * far into it is a TIME, not a distance.
     *
     * This was a flat 26 m at every speed, and a flat distance is the
     * wrong unit for eyes. Measured on the tightest corner on the lap
     * (s=3060, radius 165 m), the head yawed to exactly 24.0 degrees at
     * 8 m/s and at 80 m/s and at every speed between, because the point
     * being looked at never moved. In time that 26 m is 3.25 seconds of
     * road at a crawl and 0.33 seconds at 80 m/s — so on the fastest
     * stretch in the game the driver was staring at their own bonnet,
     * and in traffic they were gazing into the distance.
     *
     * People do not drive that way. The eyes work about one and a half
     * to three seconds ahead whatever the speed, and a driver pressing
     * on sits at the far end of that. Making it a time is also what
     * makes the head LEAD the hands: at speed the eyes reach a corner
     * well before the wheel does, which is the single most recognisable
     * thing about someone who can drive.
     *
     * Clamped at both ends. The near clamp is so a stopped car still
     * looks down the road rather than at its own number plate, and so
     * the head does not swing wildly through a car park; the far clamp
     * is because a look-ahead longer than this stops tracking the road
     * and starts tracking the horizon.
     */
    lookAheadS: 1.8,
    lookAheadMinM: 18,
    lookAheadMaxM: 110,
    /** And at the rival, when they pull alongside: a glance held this
     *  long, then eyes back on the road for at least this long before
     *  the next. The rival's driver has always looked over (RIG.rival
     *  glanceGapM); the player's never did. */
    glanceHoldS: 0.8,
    glanceRestS: 3,
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

    /**
     * THE GEAR LEVER — the second control a hand leaves the wheel for.
     *
     * The handbrake proved the move: a lever bolted to the car, the
     * inboard hand solved off the rim onto its grip and back. The rig
     * had no gearchange at all, so a car that visibly shifts — the
     * revs fall, the torque cuts, the needle swings — did it with both
     * hands at ten-to-two. A floor shifter on the console, forward of
     * the handbrake, and a quick flick rather than a plant: a real
     * upshift is a quarter of a second and the hand is back on the rim
     * before the needle has settled.
     *
     * Inboard is the driver's right in this left-hand-drive car, which
     * is the hand the handbrake already uses; when both want it the
     * handbrake wins, because a drift is deliberate and a shift is not.
     */
    gearX: -0.24,
    gearY: 0.2,
    gearZ: 0.24,
    gearLen: 0.17,
    /** Rest rake, radians about x. */
    gearTilt: 0.55,
    /** How far it rocks on a shift: forward on an upshift, back on a down. */
    gearThrow: 0.42,
    /** How far the hand commits toward the knob at the peak of the flick;
     *  1 would plant it there, and a plant reads as a stall. */
    shiftReach: 0.75,
    /** Hand and lever blend rate. Faster than the handbrake's 10: a shift
     *  is over in 0.22 s and the blend has to get there and back inside it. */
    shiftRate: 22,
  },

  /** What the rival's driver is seen doing, derived from the AI's own
   *  kinematics rather than from inputs it does not have. */
  rival: {
    /**
     * Visible steer per metre of lane change still to be taken.
     *
     * 0.45 once, and that was a number tuned to carry a whole steering
     * animation on its own: the lane change was the ONLY thing a rival's
     * wheels answered, so it had to be big enough to look like driving.
     * Measured, a 3.5 m lane change at 25 m/s peaked at 0.84 of road
     * lock — 25 degrees on the front wheels, against a road lock of 30.
     * That is a parking manoeuvre, and it happened every time a rival
     * pulled out to overtake.
     *
     * The road term carries the driving now (see aiSteerWant), so this
     * only has to be worth what a lane change is actually worth. At
     * 25 m/s, 3.5 m sideways over a couple of seconds is about 1.75
     * m/s^2, which a 2.8 m wheelbase takes roughly 0.45 degrees of steer
     * to produce — against the 1.0 degree the 165 m corner takes. So a
     * lane change should read as under half a corner, and 0.1 puts it
     * there.
     *
     * Visible steer only. This feeds spinWheels and the driver rig; no
     * AI car's line or speed is decided by it.
     */
    steerPerLat: 0.1,
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

  /**
   * THE VERGE. Every roadside plant is a two-axis spring driven by the
   * wind and by the wake of every car (plants.ts). Lean is in the
   * shader's own unit — 1 is a stem laid over by its full height — and
   * the springs' k and c are per second² and per second.
   */
  plant: {
    /** A shrub: about 2 Hz and lightly damped — a hedge whips. */
    shrubK: 160,
    shrubC: 9,
    /** A palm crown: slow and heavy, under a hertz. */
    palmK: 25,
    palmC: 3.5,
    /** The most a stem can lay over. */
    maxLean: 0.9,
    /** The gust everything feels: a base lean, a slow swell on it, and
     *  a direction that turns through a full circle in two minutes. The
     *  gust is split between a shared lean down the wind (windK) and
     *  each plant's own sway (swayK), offset by its phase. */
    gustBase: 0.05,
    gustAmp: 0.03,
    gustRate: 0.37,
    windTurnRate: 0.05,
    windK: 0.5,
    swayHz: 0.14,
    swayK: 0.5,
    /** A gust front travelling down the road, as a swell on the gust's
     *  size — seen arriving plant after plant. Wavelength is 2π/frontK,
     *  about eighty metres. */
    frontAmp: 0.6,
    frontRate: 0.6,
    frontK: 0.08,
    /** A car's wake: felt this far from its path, at full strength from
     *  this speed, pushing outward beside and ahead of it. */
    wakeR: 9,
    wakeRefSpeed: 55,
    wakeK: 0.55,
    /** How far ahead of the nose the push begins to build. */
    noseM: 3,
    /** Behind the car the air is pulled back in and dragged along the
     *  path — the trailing wash, decaying over tailLenM. That reversal
     *  is what makes a plant whip back after a car has passed. */
    suctionK: 0.3,
    dragK: 0.25,
    tailLenM: 12,
    /** A crown six metres up feels a fraction of a road-level wake. */
    palmWakeK: 0.35,
    /** Shader: how far the tip drops as it leans (a stem arcs, it does
     *  not shear), and how far the normal turns with it. */
    arcDrop: 0.5,
    normalGain: 0.8,
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
