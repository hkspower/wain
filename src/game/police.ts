// A patrol car that notices.
//
// Until this, a police car in this game was a civilian with a livery and
// a light bar. It held a lane, kept the road's speed, and took no
// interest in the player — and the codebase said so in three places, on
// purpose:
//
//   "A pursuit is a gameplay system — a wanted level, a chase AI,
//    somewhere to be caught — and none of that is what 'police cars on
//    the road' means. It is not here, and it is not half here either."
//
// That objection is worth keeping in mind rather than deleting, because
// it is the specification for this file. What is built here is the
// whole of one behaviour and not a slice of three: race past a patrol
// car and it comes after you; lose it, or stop giving it a reason, and
// it drops off and goes back to work. There is no wanted level, no
// arrest, no fine and nowhere to be caught — and none of those are
// missing, because this is not a smaller version of them. A chase you
// can win by driving is a complete thing.
//
// The law lives in its own module, pure, for the reason policeLamps is
// exported out of cars.ts: a rule that decides whether the player is
// being chased should be checkable without standing up a renderer.

/** What a patrol car can see of the racer. */
export interface PursuitLook {
  /** Signed gap along the road: POSITIVE when the racer is ahead of the
   *  patrol car. Metres. */
  gap: number;
  /** Lateral separation across the road, metres, unsigned. */
  lat: number;
  /** The racer's speed, m/s. */
  speed: number;
}

/**
 * Fast enough that going past is a statement.
 *
 * The traffic on this road runs 21 to 30 m/s (75-108 km/h). A patrol car
 * is not interested in being overtaken — it is interested in being
 * overtaken at a speed nobody could mistake for traffic. 38 m/s is
 * 137 km/h, comfortably clear of the fastest civilian and comfortably
 * under what the player does on a straight, so this fires when you are
 * racing and not when you are driving.
 */
export const PROVOKE_SPEED = 38;
/** How far ahead the racer can be and still have been SEEN doing it.
 *  A pass is the moment of pulling in front, so this is short. */
export const PROVOKE_AHEAD = 30;
/** And how far across the road. Wider than a lane: a patrol car two
 *  lanes over still watched you go by. The road's half width is 7. */
export const PROVOKE_LAT = 7;

/** How long a patrol car keeps coming with no reason to. Seconds. */
export const PATIENCE = 12;
/** Past this gap it has lost you, and the clock runs down. Metres. */
export const LOSE_M = 220;
/** Below this the racer is just driving, and there is nothing to
 *  answer for. Under PROVOKE_SPEED by a margin, so that easing off a
 *  little does not flip the pursuit on and off. */
export const CALM_SPEED = 30;
/**
 * How fast a patrol car goes.
 *
 * Slower than the player's ceiling, and that is the whole design. The
 * player tops out near 92 m/s; a patrol car that could match that would
 * make the chase a timer rather than a thing you drive out of. At 78 a
 * quick car gets away on a straight, a slow one has to use the traffic,
 * and either way the way out is the road.
 */
export const CHASE_TOP = 78;
/** How much quicker than the racer it tries to be while behind. */
export const CHASE_MARGIN = 6;

/**
 * Does this pass provoke a chase?
 *
 * The racer has to be AHEAD — that is what "raced past me" means — and
 * close, and across no more road than a patrol car can see, and quick.
 * All four, or nothing happens.
 */
export function provokes(look: PursuitLook): boolean {
  return (
    look.gap > 0 &&
    look.gap < PROVOKE_AHEAD &&
    look.lat < PROVOKE_LAT &&
    look.speed > PROVOKE_SPEED
  );
}

/**
 * The pursuit clock, one step.
 *
 * Patience refills while the racer is close and still going, and drains
 * whenever they are gone or have calmed down. Returning to full rather
 * than merely not draining is what lets a long chase stay alive through
 * a corner where the gap opens for a second, and what makes the way out
 * a sustained one: you have to be clear of it for a while, or slow for a
 * while, not for an instant.
 */
export function patienceAfter(patience: number, look: PursuitLook, dt: number): number {
  if (patience <= 0) return 0;
  const lost = Math.abs(look.gap) > LOSE_M;
  const calm = look.speed < CALM_SPEED;
  if (!lost && !calm) return PATIENCE;
  return Math.max(0, patience - dt);
}

/**
 * How fast a pursuing car wants to be going.
 *
 * Behind, it runs at the racer's speed plus a margin so it closes. Level
 * or ahead — which happens when the racer brakes hard into traffic — it
 * matches rather than rams, because a patrol car driving through the
 * back of the car it is following is not a chase, it is a collision the
 * player did not author. Capped at CHASE_TOP either way.
 */
export function pursuitSpeed(racerSpeed: number, gap: number, top = CHASE_TOP): number {
  const want = gap > 8 ? racerSpeed + CHASE_MARGIN : racerSpeed;
  return Math.min(top, Math.max(0, want));
}
