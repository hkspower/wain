import {
  MAX_HEADROOM, MIN_HALF_SPAN, deg, invMercY, mercY, pixelMargins, rad,
  type LatLng, type MapFrame,
} from "@/lib/map-frame";

/* The place page's fit, in a module of its own so /search does not carry it.
   See the header of map-frame.ts. */

/**
 * Fit around a subject, keeping it dead centre.
 *
 * `fitFrame` centres on the *bounding box* of everything, which puts the
 * subject wherever its neighbours leave it — on a page asking "where exactly
 * is this place", it ended up in a corner. Here the centre is the subject and
 * the half-spans grow symmetrically until the others fit, so the answer to the
 * question is always in the middle of the picture.
 */
/**
 * `headroom` works as it does in `fitFrame`, with one difference that matters:
 * the view is NOT slid north to find the room. Sliding is what keeps the zoom
 * when a frame is fitted to a bounding box, and it is exactly the thing this
 * function exists to refuse — the subject is centred because the page is
 * asking where the subject is. So the frame widens instead, symmetrically.
 */
export function fitFrameAround(
  subject: LatLng,
  others: LatLng[],
  {
    padding = 1.25, minAspect = 1.2, maxAspect = 2.0, headroom = 0, frameW = 0,
    side = 0, foot = 0,
  } = {}
): MapFrame {
  const cx = rad(subject.lng);
  const cy = mercY(subject.lat);

  // Symmetric reach: the farthest neighbour on each axis, mirrored.
  const spanX = Math.max(0, ...others.map((p) => Math.abs(rad(p.lng) - cx)));
  const spanY = Math.max(0, ...others.map((p) => Math.abs(mercY(p.lat) - cy)));
  const aspect =
    spanX > 0 && spanY > 0
      ? Math.min(Math.max(spanX / spanY, minAspect), maxAspect)
      : Math.min(Math.max(1.5, minAspect), maxAspect);

  let hx = Math.max(spanX * padding, MIN_HALF_SPAN);
  let hy = Math.max(spanY * padding, MIN_HALF_SPAN / aspect);
  if (hx / hy < aspect) hx = hy * aspect;
  else hy = hx / aspect;

  const { s, ft } = pixelMargins(frameW, aspect, side, foot);
  if (s > 0) {
    const needX = spanX / (1 - 2 * s);
    if (needX > hx) {
      hx = needX;
      hy = hx / aspect;
    }
  }

  if (frameW > 0 && (headroom > 0 || foot > 0)) {
    const t = headroom > 0 ? Math.min(headroom / (frameW / aspect), MAX_HEADROOM) : 0;
    // Symmetric, so the larger margin has to be found on both sides at once.
    const needed = spanY / (1 - 2 * Math.max(t, ft));
    if (needed > hy) {
      hy = needed;
      hx = hy * aspect;
    }
  }

  return {
    cx, cy, hx, hy, aspect,
    bbox: [deg(cx - hx), invMercY(cy - hy), deg(cx + hx), invMercY(cy + hy)].join(","),
    centre: { lat: subject.lat, lng: subject.lng },
  };
}
