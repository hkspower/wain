import { deg, invMercY, mercY, rad, MIN_HALF_SPAN, type LatLng, type MapFrame } from "@/lib/map-frame";

/* The coordinate picker's arithmetic, in a module of its own so /search does
   not carry it. See the header of map-frame.ts. */

/**
 * The inverse of `project`: which coordinate is under this point in the frame.
 *
 * This is what makes picking a location by clicking the map trustworthy. The
 * bbox and the frame are the same shape by construction, so a click maps back
 * to a real coordinate rather than an approximation.
 */
export function unproject(f: MapFrame, x: number, y: number): LatLng {
  return {
    lng: deg(f.cx - f.hx + x * 2 * f.hx),
    lat: invMercY(f.cy + f.hy - y * 2 * f.hy),
  };
}

/**
 * The projected y of 85°, where Web Mercator is conventionally cut off. Beyond
 * it the projection runs away to infinity and tile servers have no tiles.
 */
const MERC_LIMIT = mercY(85);

/**
 * Same centre, zoomed by a factor — >1 zooms out, <1 zooms in.
 *
 * Bounded at BOTH ends. There was a floor and no ceiling, and the ceiling is
 * the one a person can actually reach: the picker's − button multiplies the
 * half-span by two per press, so fifteen presses took the bbox to an east edge
 * of 273° — not a wide map, an invalid one, handed to the embed as fact.
 *
 * The bound is per-axis and taken from where the frame already is: longitude
 * may reach ±180 from the centre it has, latitude ±85. Only `hx` is clamped and
 * `hy` is derived from it, because the frame's aspect must keep matching the
 * bbox exactly — clamping the two independently is precisely how every overlaid
 * pin drifts off its place.
 */
export function zoomFrame(f: MapFrame, factor: number): MapFrame {
  const capX = Math.PI - Math.abs(f.cx);
  const capY = MERC_LIMIT - Math.abs(f.cy);
  const ceiling = Math.max(MIN_HALF_SPAN, Math.min(capX, capY * f.aspect));
  const hx = Math.min(Math.max(f.hx * factor, MIN_HALF_SPAN / 4), ceiling);
  const hy = hx / f.aspect;
  return {
    ...f, hx, hy,
    bbox: [deg(f.cx - hx), invMercY(f.cy - hy), deg(f.cx + hx), invMercY(f.cy + hy)].join(","),
  };
}

/** Re-centre on a coordinate, keeping the current zoom and shape. */
export function centreFrame(f: MapFrame, at: LatLng): MapFrame {
  const cx = rad(at.lng);
  const cy = mercY(at.lat);
  return {
    ...f, cx, cy, centre: at,
    bbox: [deg(cx - f.hx), invMercY(cy - f.hy), deg(cx + f.hx), invMercY(cy + f.hy)].join(","),
  };
}
