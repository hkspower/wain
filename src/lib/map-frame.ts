/**
 * Fitting points to an OpenStreetMap embed.
 *
 * The place page's centred fit is `map-frame-around.ts` and the picker's zoom
 * and click arithmetic `map-picker.ts`: /search never calls them, and in one
 * module they shipped to it anyway (7 October, when /search had no budget left
 * for the pin margins below).
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
export const MAX_HEADROOM = 0.35;

/**
 * The gap kept below the southernmost point, as a fraction of frame height.
 *
 * A pin's tip IS its bottom edge, so unlike the top this needs no room for the
 * pin itself — only enough that the tip is not drawn on the frame's own border.
 */
const FOOT_MARGIN = 0.02;

/**
 * The most of the frame either pixel margin below may claim: past it the honest
 * failure is a pin near the edge, not a map zoomed out to the region.
 */
const MAX_SIDE = 0.3;
const MAX_FOOT = 0.15;

/**
 * Pixel margins → fractions of the frame, for a frame `frameW` wide at `aspect`.
 *
 * `side` is the clear room from each side border to the nearest coordinate, and
 * `foot` from the bottom border to the lowest pin's tip. Both were fractions of
 * the span once — 15% padding and a 2% foot — which is a different number of
 * pixels on every frame: on /search's phone map a place at the edge of the
 * spread stood 10px from the border with its 32px pin half over it, and on
 * /pick's 230px strip the lowest pin's tip sat on the frame's own line.
 */
export function pixelMargins(frameW: number, aspect: number, side: number, foot: number) {
  if (frameW <= 0) return { s: 0, ft: FOOT_MARGIN };
  return {
    s: Math.min(side / frameW, MAX_SIDE),
    ft: Math.max(FOOT_MARGIN, Math.min(foot / (frameW / aspect), MAX_FOOT)),
  };
}

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
  {
    padding = 1.15, minAspect = 1.2, maxAspect = 2.4, headroom = 0, frameW = 0,
    side = 0, foot = 0,
  } = {}
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
  const { s, ft } = pixelMargins(frameW, aspect, side, foot);
  if (s > 0) {
    const needX = spanX / (1 - 2 * s);
    if (needX > hx) {
      hx = needX;
      hy = hx / aspect;
    }
  }

  let cyFrame = cy;
  if (frameW > 0) {
    const t = headroom > 0 ? Math.min(headroom / (frameW / aspect), MAX_HEADROOM) : 0;
    const needed = spanY / (1 - t - ft);
    if (needed > hy) {
      hy = needed;
      hx = hy * aspect;
    }
    // Room above is slack + shift, below is slack − shift. Take the shift
    // nearest zero that leaves both enough: north for the pins' heads, and
    // south too now that the foot is pixels and may want more than the top.
    const slack = hy - spanY;
    cyFrame = cy + Math.min(Math.max(0, 2 * t * hy - slack), slack - 2 * ft * hy);
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

/** Where a point sits in the frame, as fractions of width and height. */
export function project(f: MapFrame, p: LatLng): { x: number; y: number } {
  return {
    x: (rad(p.lng) - (f.cx - f.hx)) / (2 * f.hx),
    y: (f.cy + f.hy - mercY(p.lat)) / (2 * f.hy),
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

/* ------------------------------------------------------------------ */
/* Many pins                                                           */
/* ------------------------------------------------------------------ */

/** Grid cell, in container pixels: a little over a pin. */
export const CLUSTER_CELL = 40;
/** Two groups whose centres are closer than this are one: one pin apart. */
export const CLUSTER_MERGE = 32;

export interface Clustered<T> {
  /** Container pixels — the members' centroid. */
  x: number;
  y: number;
  members: T[];
}

/**
 * Points closer than a pin, drawn as one bubble that says how many.
 *
 * `spreadPins` cannot do this, and on the frames where it matters it does
 * nothing at all: its shift is capped at 60m on the ground, which is 0.2–0.5px
 * on a frame showing the whole country. Measured on /search at 390px: «مكيف»
 * put 34 pins in a 370×308 frame, 27 had their centre covered by another, and
 * 17–19 could not be tapped at all; the 52-place map would be 42 of 52. So
 * points are grouped instead — a grid of `CLUSTER_CELL`, then any two groups
 * nearer than `CLUSTER_MERGE` merged, until none are. In container PIXELS,
 * because what overlaps is a drawing, not the ground: the same two places are
 * one bubble on the country and two pins on the street.
 *
 * `apart` keeps a point out of every group — the pin a visitor is pointing at,
 * the result the search ranked first — so the thing being looked at is never
 * swallowed by a number. Deterministic: same points in, same groups out.
 */
export function clusterPoints<T>(
  points: { x: number; y: number; item: T }[],
  apart: (item: T) => boolean = () => false
): Clustered<T>[] {
  // Every group carries the input position of its first member, and the
  // answer comes back in that order. It used to be «groups, then the ones kept
  // apart», so hovering a pin — which keeps it apart — moved it to the end of
  // the overlay, React moved its node, and a pin that moves under the pointer
  // between mousedown and mouseup never receives the click: on a desktop the
  // first click on a pin stopped opening its place.
  type Acc = { sx: number; sy: number; first: number; members: T[] };
  const alone: (Clustered<T> & { first: number })[] = [];
  const cells = new Map<string, Acc>();
  points.forEach((p, i) => {
    if (apart(p.item)) {
      alone.push({ x: p.x, y: p.y, first: i, members: [p.item] });
      return;
    }
    const key = `${Math.floor(p.x / CLUSTER_CELL)},${Math.floor(p.y / CLUSTER_CELL)}`;
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { sx: 0, sy: 0, first: i, members: [] }));
    cell.sx += p.x;
    cell.sy += p.y;
    cell.members.push(p.item);
  });
  const groups = [...cells.values()].map((c) => ({
    x: c.sx / c.members.length,
    y: c.sy / c.members.length,
    first: c.first,
    members: c.members,
  }));
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i];
        const b = groups[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) >= CLUSTER_MERGE) continue;
        const n = a.members.length + b.members.length;
        groups[i] = {
          x: (a.x * a.members.length + b.x * b.members.length) / n,
          y: (a.y * a.members.length + b.y * b.members.length) / n,
          first: Math.min(a.first, b.first),
          members: [...a.members, ...b.members],
        };
        groups.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return [...groups, ...alone]
    .sort((a, b) => a.first - b.first)
    .map(({ x, y, members }) => ({ x, y, members }));
}

/** How far a callout reaches from its pin: about half its widest. */
const CALLOUT_HALF_W = 120;
/** Head, nose and a three-line callout, stacked above the coordinate. */
const CALLOUT_ABOVE = 124;

/**
 * Which way a pin's callout opens, from where the pin stands in PIXELS.
 *
 * It was decided as a fraction of the frame — open downwards in the top 28% —
 * while the callout is a fixed size in pixels, so the rule was right for one
 * frame height and wrong for the rest: 5 of 40 callouts were cut off at 390px
 * and 12 of 40 at 320, the worst showing half its name.
 */
export function calloutSide(
  x: number,
  y: number,
  frameW: number
): { align: "start" | "center" | "end"; below: boolean } {
  return {
    align: x < CALLOUT_HALF_W ? "start" : frameW - x < CALLOUT_HALF_W ? "end" : "center",
    below: y < CALLOUT_ABOVE,
  };
}
