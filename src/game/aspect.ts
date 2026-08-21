// What the shape of the window does to the shot.
//
// three.js's `fov` is the VERTICAL angle, and the horizontal follows
// from it: tan(h/2) = tan(v/2) * aspect. So the projection has exactly
// one degree of freedom per aspect ratio. You cannot hold both fields;
// you choose one curve and the other is arithmetic. Everything below is
// about choosing that curve honestly and saying what it costs.
//
// THE THREE CLASSIC ANSWERS, AND WHY NONE OF THEM IS THE ANSWER
//
//   Hor+    hold the vertical, let the horizontal grow. A wider screen
//           shows more world, which is the reason to own one. Uncapped,
//           a 32:9 panel reaches 129 degrees horizontal, where the
//           rectilinear projection stretches the frame edge by 5.4x and
//           a car alongside you smears into a streak.
//   Vert-   hold the horizontal, let the vertical shrink. Bounded
//           distortion, but a wider monitor now shows LESS picture than
//           a narrower one, which is the opposite of what it was for.
//   Fixed   hold the diagonal. Splits the difference and pleases nobody:
//           narrow screens still lose the road, wide ones still stretch.
//
// WHAT THIS DOES INSTEAD
//
// One continuous curve, in tangent space, anchored at 16:9 — the aspect
// the game is framed, shot and tuned at, where the vertical FOV is
// exactly the number views.ts asks for and nothing here happens at all.
//
//   16:9 .. 21:9      pure Hor+. The ultrawide payoff, unmodified.
//   past 21:9         the horizontal keeps growing, but as a power of
//                     the aspect rather than linearly, so the vertical
//                     gives ground SLOWLY instead of being pinned.
//   below 16:9        the vertical opens up to give the horizontal back
//                     — partly, and only to a hard ceiling, because a
//                     wide vertical lens is a fisheye and a portrait
//                     phone would demand 133 degrees of it.
//
// The old rule capped the horizontal at 21.5:9 by shrinking the
// vertical to suit, and that cap is what this replaces: it meant a 32:9
// monitor saw 110.9 x 43.9 degrees where a 21:9 monitor saw 108.9 x 62
// — a wider, more expensive screen showing a shorter slice of the same
// width. The curve here gives that 32:9 monitor 116.6 x 49.4: more than
// the 21:9 on the axis it paid for, less on the axis it did not, and
// monotone the whole way so resizing a window never takes picture away.
//
// AND THE PART THAT IS NOT THE PROJECTION
//
// On a narrow screen the honest answer is not more lens. Widening the
// vertical FOV to hold a 16:9 horizontal field needs 133 degrees on a
// portrait phone, which is not a camera, it is a peephole. The other
// way to see more world is to STAND FURTHER BACK, and for the two
// road-mounted views that costs nothing but the car reading smaller.
// So the compensation is split the way views.ts already splits the
// world: a chase camera dollies back, and a bumper cam — bolted to the
// shell, with nowhere to go — takes what the lens can give it.

/** The aspect everything is measured against: the shape the game is
 *  framed and captured at. At exactly this, nothing here changes. */
export const REFERENCE_ASPECT = 16 / 9;

/** Up to here, wider screens are pure Hor+ and pay nothing. */
export const WIDE_KNEE = 21 / 9;

/**
 * How the horizontal grows past the knee: h_tan scales as
 * (aspect / knee) ^ WIDE_ROLLOFF.
 *
 * 1 would be uncapped Hor+ (and 129 degrees at 32:9). 0 would pin the
 * horizontal and hand the whole aspect back as lost vertical, which is
 * what the old rule did. 0.35 keeps a super-wide screen visibly ahead
 * of an ultrawide one on the axis it bought, while the vertical it
 * spends is sky and bonnet rather than road.
 */
export const WIDE_ROLLOFF = 0.35;

/**
 * How much of the lost horizontal a narrow screen buys back with lens
 * rather than with distance. 1 would hold the 16:9 horizontal exactly
 * and demand a fisheye to do it; 0 would leave a 4:3 screen looking
 * through a letterbox. Half is enough to keep the road in frame, and
 * the dolly below covers the rest where there is a camera free to move.
 */
export const NARROW_GAIN = 0.5;

/** A vertical field wider than this stops being a camera. */
export const MAX_VFOV = 80;

/** ...and a horizontal one wider than this stretches the frame edge by
 *  more than four. A backstop for triple-monitor aspects, not a knob. */
export const MAX_HFOV = 122;

/** How much of what the lens could not give back the camera walks back
 *  to fetch, as an exponent on the shortfall. 1 would restore the world
 *  width exactly and put the car in the middle distance; half keeps the
 *  car readable and the road visible. */
export const DOLLY_GAIN = 0.5;

const DEG = Math.PI / 180;
const tanHalf = (deg: number) => Math.tan((deg * DEG) / 2);
const fromTan = (t: number) => (2 * Math.atan(t)) / DEG;

/**
 * The vertical FOV to actually give three.js, for a view whose designed
 * field is `baseVFovDeg` at 16:9.
 *
 * Continuous and monotone in `aspect`: the horizontal field never falls
 * as the window gets wider, and the vertical never falls as it gets
 * narrower. Both matter more than they sound — a discontinuity is a
 * visible jump while a window is being dragged, and a non-monotone
 * response means somewhere there is a screen shape that is punished for
 * being bigger.
 */
export function verticalFov(baseVFovDeg: number, aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return baseVFovDeg;
  const tv0 = tanHalf(baseVFovDeg);
  let tv: number;

  if (aspect >= REFERENCE_ASPECT) {
    if (aspect <= WIDE_KNEE) {
      tv = tv0; // Hor+, untouched
    } else {
      // h_tan = h_knee * (aspect/knee)^r, and v_tan = h_tan / aspect.
      const grown = tv0 * WIDE_KNEE * Math.pow(aspect / WIDE_KNEE, WIDE_ROLLOFF);
      tv = grown / aspect;
    }
  } else {
    // Give the horizontal back, in part, by opening the vertical.
    tv = tv0 * Math.pow(REFERENCE_ASPECT / aspect, NARROW_GAIN);
    tv = Math.min(tv, tanHalf(MAX_VFOV));
  }

  // Backstop, after everything: a horizontal field this wide is a
  // funhouse mirror whatever the arithmetic wanted.
  const maxTv = tanHalf(MAX_HFOV) / aspect;
  if (tv > maxTv) tv = maxTv;
  return fromTan(tv);
}

/** The horizontal field that comes out the other side. Reported, and
 *  asserted against — the vertical number is a means, not the thing. */
export function horizontalFov(vFovDeg: number, aspect: number): number {
  return fromTan(tanHalf(vFovDeg) * aspect);
}

/**
 * How much further back a camera that CAN move should sit, as a
 * multiplier on its arm.
 *
 * Only on narrow screens, and only for what the lens could not give
 * back: the shortfall is measured as the ratio of the reference
 * horizontal half-field to the one this aspect actually got, and the
 * camera walks back a fraction of it. 1 on anything 16:9 or wider,
 * where there is no shortfall to make up.
 */
export function chaseDolly(baseVFovDeg: number, aspect: number): number {
  if (!Number.isFinite(aspect) || aspect >= REFERENCE_ASPECT) return 1;
  const refTh = tanHalf(baseVFovDeg) * REFERENCE_ASPECT;
  const gotTh = tanHalf(verticalFov(baseVFovDeg, aspect)) * aspect;
  if (gotTh <= 1e-4) return 1;
  return Math.pow(Math.max(1, refTh / gotTh), DOLLY_GAIN);
}

/** Everything about one window shape, for a readout or a test. */
export function aspectReport(baseVFovDeg: number, aspect: number) {
  const v = verticalFov(baseVFovDeg, aspect);
  return {
    aspect: +aspect.toFixed(4),
    vFov: +v.toFixed(2),
    hFov: +horizontalFov(v, aspect).toFixed(2),
    dolly: +chaseDolly(baseVFovDeg, aspect).toFixed(3),
  };
}
