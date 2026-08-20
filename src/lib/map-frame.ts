/**
 * Fitting points to an OpenStreetMap embed.
 *
 * Shared by the search map and the place map so there is one implementation of
 * the thing that is easy to get subtly wrong: the embed fits the bbox it is
 * given to the frame it is drawn in, growing whichever axis is short. If the
 * bbox aspect and the frame aspect disagree by even a little, every overlaid
 * pin lands somewhere it does not belong. So the bbox is grown to an aspect
 * the caller then applies to the frame, and both come from here.
 *
 * Projection is Web Mercator, matching the tiles underneath.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
export const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
export const invMercY = (y: number) => deg(2 * Math.atan(Math.exp(y)) - Math.PI / 2);

/**
 * A radian of longitude is about 5550km at Kuwait's latitude, so this floor is
 * roughly a 670m half-span — a 1.3km view for a lone point. Large enough to
 * show the surrounding streets, small enough that it never overrides the real
 * extent of a spread-out set.
 */
export const MIN_HALF_SPAN = 0.00012;

export interface MapFrame {
  /** Centre, in projected units. */
  cx: number;
  cy: number;
  /** Half-spans, in projected units. */
  hx: number;
  hy: number;
  /** Width ÷ height. The frame MUST be rendered at exactly this. */
  aspect: number;
  bbox: string;
  /** Centre back in degrees, for linking out to a full map. */
  centre: LatLng;
}

/**
 * Fit points, taking the frame's shape from how they are actually spread
 * rather than forcing them into a fixed one.
 *
 * `minAspect`/`maxAspect` clamp the result: a single point must not produce a
 * postage stamp, and a very wide spread must not produce a letterbox slot.
 */
export function fitFrame(
  points: LatLng[],
  { padding = 1.15, minAspect = 1.2, maxAspect = 2.4 } = {}
): MapFrame {
  const xs = points.map((p) => rad(p.lng));
  const ys = points.map((p) => mercY(p.lat));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

  const spanX = (Math.max(...xs) - Math.min(...xs)) / 2;
  const spanY = (Math.max(...ys) - Math.min(...ys)) / 2;
  const aspect =
    spanX > 0 && spanY > 0
      ? Math.min(Math.max(spanX / spanY, minAspect), maxAspect)
      : // One point, or several at the same spot: no shape to read.
        Math.min(Math.max(1.5, minAspect), maxAspect);

  let hx = Math.max(spanX * padding, MIN_HALF_SPAN);
  let hy = Math.max(spanY * padding, MIN_HALF_SPAN / aspect);
  if (hx / hy < aspect) hx = hy * aspect;
  else hy = hx / aspect;

  const west = deg(cx - hx);
  const east = deg(cx + hx);
  const south = invMercY(cy - hy);
  const north = invMercY(cy + hy);

  return {
    cx, cy, hx, hy, aspect,
    bbox: [west, south, east, north].join(","),
    centre: { lat: invMercY(cy), lng: deg(cx) },
  };
}

/**
 * Fit around a subject, keeping it dead centre.
 *
 * `fitFrame` centres on the *bounding box* of everything, which puts the
 * subject wherever its neighbours leave it — on a page asking "where exactly
 * is this place", it ended up in a corner. Here the centre is the subject and
 * the half-spans grow symmetrically until the others fit, so the answer to the
 * question is always in the middle of the picture.
 */
export function fitFrameAround(
  subject: LatLng,
  others: LatLng[],
  { padding = 1.25, minAspect = 1.2, maxAspect = 2.0 } = {}
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

  return {
    cx, cy, hx, hy, aspect,
    bbox: [deg(cx - hx), invMercY(cy - hy), deg(cx + hx), invMercY(cy + hy)].join(","),
    centre: { lat: subject.lat, lng: subject.lng },
  };
}

/** Where a point sits in the frame, as fractions of width and height. */
export function project(f: MapFrame, p: LatLng): { x: number; y: number } {
  return {
    x: (rad(p.lng) - (f.cx - f.hx)) / (2 * f.hx),
    y: (f.cy + f.hy - mercY(p.lat)) / (2 * f.hy),
  };
}

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

/** Same centre, zoomed by a factor — >1 zooms out, <1 zooms in. */
export function zoomFrame(f: MapFrame, factor: number): MapFrame {
  const hx = Math.max(f.hx * factor, MIN_HALF_SPAN / 4);
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

/**
 * Nudge overlapping pins apart until each one is clickable, then keep them
 * inside the frame.
 *
 * Two points a few hundred metres apart land on top of each other whenever the
 * view is wide enough to include something far away, and only the last one
 * drawn can be pressed. The push is capped at one pin radius: enough to
 * separate them, small enough that a pin never lands somewhere it isn't.
 * Positions are exact whenever nothing collides, which is the common case.
 *
 * Works in units of frame width, so x and y are comparable on any shape.
 */
export function spreadPins(
  pts: { x: number; y: number }[],
  size: number,
  aspect: number
): { x: number; y: number }[] {
  const out = pts.map((p) => ({ x: p.x, y: p.y / aspect }));
  const home = out.map((p) => ({ ...p }));
  /**
   * How far a pin may be pushed from where the place actually is.
   *
   * Half a pin was too tight to finish the job: the relaxation below needs
   * room to separate a dense cluster, and clamping every pin at 16px pulled
   * them back into overlap as soon as a query matched eleven coastal places
   * instead of ten. A full pin-width still keeps a pin visibly on its own
   * stretch of coast, and the results list beside the map remains the precise
   * index — while overlapping pins cannot be tapped apart at all.
   */
  const maxShift = size;

  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        let dx = out[j].x - out[i].x;
        let dy = out[j].y - out[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= size) continue;
        // Exactly coincident: pick a direction from the index so it is stable.
        if (d < 1e-6) {
          const a = (i * 2.399) % (Math.PI * 2);
          dx = Math.cos(a); dy = Math.sin(a); d = 1;
        }
        const push = (size - d) / 2 / d;
        out[i].x -= dx * push; out[i].y -= dy * push;
        out[j].x += dx * push; out[j].y += dy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const rx = size / 2;
  const ry = size / 2; // still in width units here; converted back below
  const clamp = (v: number, r: number, hi: number) => Math.min(Math.max(v, r), hi - r);

  return out.map((p, i) => {
    const dx = p.x - home[i].x, dy = p.y - home[i].y;
    const d = Math.hypot(dx, dy);
    const k = d > maxShift ? maxShift / d : 1;
    const x = clamp(home[i].x + dx * k, rx, 1);
    // y is in width units, so the frame's height in those units is 1/aspect.
    const y = clamp(home[i].y + dy * k, ry, 1 / aspect);
    return { x, y: y * aspect };
  });
}

/** The OSM embed URL for a frame. `marker` draws the embed's own pin. */
export function embedUrl(f: MapFrame, marker?: LatLng): string {
  const base = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
    f.bbox
  )}&layer=mapnik`;
  return marker ? `${base}&marker=${marker.lat}%2C${marker.lng}` : base;
}

/** A link out to the full, pannable map. */
export function osmLink(p: LatLng, zoom = 15): string {
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=${zoom}/${p.lat}/${p.lng}`;
}
