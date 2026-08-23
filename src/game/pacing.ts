// The delta the simulation actually sees.
//
// A display presents frames on a fixed grid. At 60 Hz the true interval
// between two presented frames is 16.667 ms, or a whole multiple of it
// if one was missed — never 16.1 and never 17.2. But requestAnimationFrame
// hands over a timestamp measured through the compositor, the scheduler
// and whatever else the machine was doing, so the number that arrives
// jitters around the truth by a millisecond either way.
//
// Feeding that jitter straight into the integrator is what makes motion
// shimmer even when the frame rate is pinned. Nothing drops a frame; the
// car simply advances 16.1 ms worth this frame and 17.2 the next, and at
// 200 km/h that is a four-centimetre difference in how far the world
// moved — small, regular, and exactly the scale the eye is best at
// noticing. It reads as a fizz on every edge in the picture.
//
// So this does two things, in order:
//
//   SNAP     If the refresh rate is known and the raw delta is within a
//            millisecond of a whole multiple of its period, use the
//            multiple. That is not an approximation — it is the correct
//            answer, because the frame really was presented on the grid
//            and the jitter is measurement noise on top of it.
//
//   MEDIAN   Only when there is no refresh rate to snap to — a
//            variable-refresh panel, or the moments before the detector
//            has resolved. A median rather than a mean because one long
//            frame should not be smeared across the five that follow it.
//
// A frame that is off the grid WITH a grid to be off is passed through
// as it came. It did not take a whole number of periods, so the
// compositor genuinely missed and the duration is real. Smoothing it
// away does not remove the hitch — the frame was still late and the
// picture still jumped — it only makes the world advance less than the
// wall clock did whenever the machine struggles.
//
// Nothing here introduces bias. Snapping rounds to the nearest grid
// point, which is symmetric; the median of symmetric jitter is its
// centre. A smoother that drifted would make the whole game run fast or
// slow, which is a far worse bug than the shimmer it set out to fix.

/** Longest step the simulation will ever be given, seconds.
 *
 *  A tab that was hidden for a minute comes back with a minute-long
 *  delta, and integrating that in one step puts the car through a wall.
 *  Clamping is not smoothing — it is a hard limit on how wrong one frame
 *  is allowed to be. */
export const MAX_DT = 0.05;

/** How far from a grid point a delta may sit and still be snapped to it,
 *  in milliseconds. Wide enough to cover ordinary scheduler noise, tight
 *  enough that a genuinely different frame time is left alone. */
export const SNAP_MS = 1.0;

/** The largest number of refresh periods a single frame may be snapped
 *  to. Four covers 60 Hz down to 15 fps on a 60 Hz panel; past that the
 *  machine is not really presenting on the grid any more. */
export const MAX_SNAP_MULTIPLE = 4;

/** How many recent frames the median is taken over. Odd, so the median
 *  is a sample rather than an average of two. */
const RING = 5;

export interface PaceState {
  /** Recent RAW deltas, newest last. Seconds. */
  ring: number[];
}

export function newPaceState(): PaceState {
  return { ring: [] };
}

/**
 * One frame's delta, cleaned up.
 *
 * `refreshHz` is the measured panel rate, or 0 while it is still unknown
 * — in which case only the median applies. Returns seconds.
 */
export function paceDelta(s: PaceState, raw: number, refreshHz: number): number {
  // Nonsense first: a negative or zero delta is a clock that went
  // backwards or a duplicate callback, and neither should reach the
  // integrator.
  const safe = raw > 0 ? Math.min(raw, MAX_DT) : 0;

  s.ring.push(safe);
  if (s.ring.length > RING) s.ring.shift();

  if (refreshHz > 0) {
    const period = 1 / refreshHz;
    const tol = SNAP_MS / 1000;
    // Which multiple of the refresh period is this closest to?
    const n = Math.round(safe / period);
    if (n >= 1 && n <= MAX_SNAP_MULTIPLE && Math.abs(safe - n * period) <= tol) {
      return n * period;
    }
  }

  // Off the grid, with a grid to be off.
  //
  // Return it as it came. This frame did not take a whole number of
  // refresh periods, which means the compositor genuinely missed and the
  // duration is real — a shader compile, a GC pause, a texture upload.
  // The median was here first and it was wrong: it reported a 40 ms
  // stall as 16.7 ms, so the world quietly advanced 23 ms less than the
  // wall clock did. Swallowing a stall does not remove it — the frame
  // was still late and the picture still jumped — it just makes the game
  // lose time whenever the machine struggles, which is a worse fault
  // than the one being fixed. MAX_DT above is the only limit a genuine
  // stall gets, and that exists to stop a hidden tab putting the car
  // through a wall rather than to smooth anything.
  if (refreshHz > 0) return safe;

  // No refresh rate known at all: a variable-refresh panel, or the
  // detector has not resolved yet. There is no grid to snap to, so the
  // median is the best available — it halves the variance of the noise
  // and, unlike a mean, does not smear one long frame across the several
  // that follow it.
  if (s.ring.length < 3) return safe;
  const sorted = [...s.ring].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}
