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
 * How much of the frame's height the headroom may ever claim.
 *
 * A pin is a fixed number of pixels tall and a frame can be short, so the two
 * can ask for a view many times wider than the places in it. Past this the
 * honest failure is a clipped pin, not a map of the wrong country.
 */
const MAX_HEADROOM = 0.35;

/**
 * The gap kept below the southernmost point, as a fraction of frame height.
 *
 * A pin's tip IS its bottom edge, so unlike the top this needs no room for the
 * pin itself — only enough that the tip is not drawn on the frame's own border.
 */
const FOOT_MARGIN = 0.02;

/**
 * Fit points, taking the frame's shape from how they are actually spread
 * rather than forcing them into a fixed one.
 *
 * `minAspect`/`maxAspect` clamp the result: a single point must not produce a
 * postage stamp, and a very wide spread must not produce a letterbox slot.
 *
 * `headroom` is how many pixels must stay clear above the northernmost point,
 * measured against a frame `frameW` pixels wide. See `pinHeadroom`: a pin does
 * not sit ON its coordinate, it stands above it, so a frame fitted only to the
 * points cuts the top pin's head off against its own clipped border. Measured
 * on the real catalogue, 79 of 438 drawn pins were clipped that way and the
 * worst lost 23 of its 32 pixels — the place at the top of the map, which is
 * to say a place the search just decided was worth showing, was the one that
 * could not be read or tapped.
 *
 * The room is taken from the bottom margin before it is taken from the zoom.
 * The frame only widens when the two margins cannot both fit at the zoom it
 * already has; otherwise it simply slides north, which costs no detail at all.
 * Over every category at six widths, 32 of 54 frames did not widen and the
 * worst that did widened by 16%.
 */
export function fitFrame(
  points: LatLng[],
  { padding = 1.15, minAspect = 1.2, maxAspect = 2.4, headroom = 0, frameW = 0 } = {}
): MapFrame {
  /**
   * No points is a caller's mistake, and it used to be a silent one.
   *
   * `Math.min(...[])` is Infinity and `Math.max(...[])` is -Infinity, so the
   * centre came out NaN and the frame reached the iframe as
   * `bbox=NaN,NaN,NaN,NaN` — a blank map with nothing anywhere saying why.
   * Every caller today guards this (SearchMap twice, and the other two always
   * pass a point), so this has never fired; it is here so the next caller finds
   * out at the call rather than in a screenshot.
   */
  if (points.length === 0)
    throw new Error("fitFrame: no points to fit — the caller must handle the empty case");

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

  /**
   * Room for the pins to stand in, given to the top and charged to the bottom.
   *
   * `t` and `FOOT_MARGIN` are fractions of the frame's HEIGHT, which is 2·hy,
   * so both margins fit only when hy·(1 − t − foot) ≥ spanY. Widen to that
   * first if need be — hx follows, because the bbox must keep the frame's
   * aspect exactly — then slide north by whatever the top is still short,
   * never past what the bottom can spare.
   */
  let cyFrame = cy;
  if (headroom > 0 && frameW > 0) {
    const t = Math.min(headroom / (frameW / aspect), MAX_HEADROOM);
    const needed = spanY / (1 - t - FOOT_MARGIN);
    if (needed > hy) {
      hy = needed;
      hx = hy * aspect;
    }
    const slack = hy - spanY;
    cyFrame =
      cy + Math.max(0, Math.min(2 * t * hy - slack, slack - 2 * FOOT_MARGIN * hy));
  }

  const west = deg(cx - hx);
  const east = deg(cx + hx);
  const south = invMercY(cyFrame - hy);
  const north = invMercY(cyFrame + hy);

  return {
    cx, cy: cyFrame, hx, hy, aspect,
    bbox: [west, south, east, north].join(","),
    centre: { lat: invMercY(cyFrame), lng: deg(cx) },
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
  { padding = 1.25, minAspect = 1.2, maxAspect = 2.0, headroom = 0, frameW = 0 } = {}
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

  if (headroom > 0 && frameW > 0) {
    const t = Math.min(headroom / (frameW / aspect), MAX_HEADROOM);
    // Symmetric, so the margin has to be found on both sides at once.
    const needed = spanY / (1 - 2 * t);
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
  aspect: number,
  /**
   * How far a pin may be pushed from where the place actually is, in units of
   * frame width. Defaults to one pin width, which is the right budget on a
   * tight view and far too generous on a wide one — pass `pinShiftCap(f, size)`
   * to bound it on the ground as well. See `MAX_PIN_SHIFT_M`.
   */
  maxShift: number = size
): { x: number; y: number }[] {
  const out = pts.map((p) => ({ x: p.x, y: p.y / aspect }));
  const home = out.map((p) => ({ ...p }));

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
    let x = clamp(home[i].x + dx * k, rx, 1);
    // y is in width units, so the frame's height in those units is 1/aspect.
    let y = clamp(home[i].y + dy * k, ry, 1 / aspect);

    /**
     * The clamp can undo the cap, so the cap is applied again after it.
     *
     * Keeping a pin's whole disc inside the frame means pushing any pin whose
     * home sits within half a pin of an edge — and that push is measured from
     * the edge, not from home, so it can move a pin further than `maxShift`
     * allowed. It went unnoticed while the catalogue was 36 places and the
     * frames were roomy; at 44 the frames tightened, more homes landed near an
     * edge, and the worst pin came out at 141m against a 60m cap. The test
     * caught it, which is what the test is for.
     *
     * Re-limiting can leave a pin's disc slightly over the frame edge — by at
     * most half a pin, into padding the frame already has. Being a few pixels
     * over an edge is a smaller lie than being 141m from the place.
     */
    const cdx = x - home[i].x, cdy = y - home[i].y;
    const cd = Math.hypot(cdx, cdy);
    if (cd > maxShift) {
      const back = maxShift / cd;
      x = home[i].x + cdx * back;
      y = home[i].y + cdy * back;
    }
    return { x, y: y * aspect };
  });
}

/** Mean Earth radius, metres — the sphere Web Mercator is drawn on. */
const EARTH_M = 6_371_000;

/**
 * How wide the frame is on the ground, in metres.
 *
 * `hx` is already a half-span in radians of longitude, so the width is that
 * doubled, times the radius of the latitude circle the frame sits on. Good to
 * a fraction of a percent over a view this size, which is far finer than
 * anything it is used to decide.
 */
export function frameWidthMetres(f: MapFrame): number {
  return 2 * f.hx * EARTH_M * Math.cos(rad(invMercY(f.cy)));
}

/**
 * The furthest a pin may ever be drawn from the place it names.
 *
 * `spreadPins` nudges overlapping pins apart, and its only limit used to be
 * one pin width — a distance in SCREEN units. On a tight view that is a few
 * metres and the nudge is invisible. On a wide one it is enormous: measured
 * against this catalogue, a phone-width search map showing every place put a
 * pin 10.9km from its place, and Al-Khiran's page — whose nearest neighbours
 * are tens of kilometres away, so the frame spans 230km — put one 24.5km out.
 * A pin that far from its subject is not a nudge, it is a wrong answer.
 *
 * 60m is taken from the data rather than chosen: the two closest distinct
 * places in the catalogue are the Grand Mosque and Liberation Tower at 68m
 * apart, so 34m each is all it takes to separate the tightest real pair, and
 * every other pair needs less. It is under a seventh of the 412m median gap
 * between neighbours, so a pin stays on its own block.
 *
 * Where the cap bites, pins overlap instead of separating. That is the honest
 * outcome: the results list beside the map is the exact index, and an
 * unreachable pin is a smaller lie than a pin in the wrong neighbourhood.
 */
export const MAX_PIN_SHIFT_M = 60;

/**
 * The shift budget for `spreadPins`: whichever of one pin width and
 * `MAX_PIN_SHIFT_M` is smaller, expressed in units of frame width so it can be
 * handed straight to `spreadPins`.
 */
export function pinShiftCap(f: MapFrame, sizeFrac: number): number {
  return Math.min(sizeFrac, MAX_PIN_SHIFT_M / frameWidthMetres(f));
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
