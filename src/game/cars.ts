import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EXHAUSTS, FINISHES, kitAtLeast, type ExhaustSpec, type KitLevel, type PaintFinish } from "./mods";
import type { CarbonLevel } from "./paints";
import { upgradeCarShells, upgradeWheels, upgradeDriver } from "./models";
import { arabicUI, latinDisplay, textTexture } from "./text";
import { kuwaitiDriver } from "./characters";
import { RIG } from "./rig";
import { solveDriverRig } from "./driver";
import { pointGlowTexture, poolGlowTexture } from "./glow";
import { drawTeamLogo, type TeamLogo } from "./teams";

// Procedural sedans with a real silhouette: the body and glasshouse are
// bevel-extruded side profiles (smoothed normals), riding on spoked
// wheels the engine spins with road speed. Built facing +Z; footprint
// stays ~1.9 x 4.4 m so gameplay collision sizes are unchanged.
//
// group.userData: { wheels: Group[4] (fl, fr, rl, rr), tailMat }

/** Silhouette family. "zx" is the long-nose fastback wedge of a Z32
 *  300ZX; "gtr" is the boxy, high-decked muscle of an R34 Skyline. */
export type BodyStyle = "sedan" | "zx" | "gtr" | "rx7" | "hatch" | "pony";

export interface CarColors {
  body: number;
  accent?: number;
  /** Body silhouette; default is the original sedan. */
  style?: BodyStyle;
  /** Neon underglow colour — TXR rival style. */
  underglow?: number;
  /** Skip the fine detailing (seams, trim, interior) — used for traffic. */
  simple?: boolean;
  /** GT wing on the trunk (garage mod). */
  spoiler?: boolean;
  /** The fitted exhaust system: sets the tips and where flame comes out. */
  exhaust?: ExhaustSpec;
  /** Gold rims (garage mod). */
  goldRims?: boolean;
  /**
   * What has been done to the headlamps.
   *
   * - `stock` — as it left the showroom.
   * - `smoked` — tinted lenses. The lamp still lights and still throws
   *   a beam; it just does it through dark glass, so the face reads as
   *   two dark slots by day and two dull ambers at night.
   * - `single` — one lamp taken out and the housing left open. The
   *   one-eye look, and the car really does drive on one beam: the
   *   removed side is not recorded in `lampPositions`, so the engine
   *   has nothing to hang a light on there.
   */
  headlamps?: "stock" | "smoked" | "single";
  /** Window tint, 0-100 per cent. Absent is factory glass. */
  tint?: number;
  /** Lacquer finish: gloss, satin or matte. Absent is gloss. */
  finish?: PaintFinish;
  /**
   * Racing stripes.
   *
   * `single` is the centre bar this build has always had — bonnet, and
   * boot where the body has one.
   *
   * `twin` is the pair that runs OVER THE TOP: up the nose, along the
   * hood, across the roof, down the rear glass and onto the deck, in
   * one unbroken run. It is a different thing from two single stripes,
   * because the whole point of it is that it does not stop at the
   * windscreen — and making it not stop means following whichever shell
   * happens to be the top surface at each point along the car.
   */
  stripes?: "single" | "twin";
  /** Full time-attack aero: swan-neck wing, splitter, canards, vented
   *  hood, skirts, diffuser, bronze six-spokes and teal calipers.
   *  Equivalent to `kit: "attack"`, and kept because most callers only
   *  ever asked the yes/no question. */
  raceKit?: boolean;
  /**
   * How far this car is built: street, sport or attack. Absent means
   * street, which is the weakest step rather than "stock" — there is no
   * stock step, because nothing on this road at two in the morning is
   * stock.
   *
   * Drives the arch flares and the track width, and gates the aero that
   * is not part of the full attack kit.
   */
  kit?: KitLevel;
  /** Rally sticker pack: door roundels, beltline stripes, hood decal,
   *  Kuwait flags on the rear quarters. */
  stickers?: boolean;
  /** Racing number for the roundels; derived from the paint if absent. */
  stickerNumber?: number;
  /** The full-length side graphic: one sticker, nose to tail, following
   *  the body rather than hung off it. Bought on its own — it is not
   *  part of the rally pack and does not arrive with a kit. */
  fullStripe?: boolean;
  /** The car's own name, for the flank wordmark in the sticker pack. */
  name?: string;
  nameAr?: string;
  /** Overall length in metres. When given, the shell is SCALED until it
   *  measures this — see the fit at the end of createCar. */
  lengthM?: number;
  /** The crew this car runs for: emblem and name on the roof.
   *  Absent means a privateer, which is what every car was until now. */
  crew?: { name: string; tag: string; logo: TeamLogo };
  /**
   * The cam cover's colour, or absent for the stock black plastic.
   *
   * Setting this also cuts vents in the bonnet, because a cover under a
   * sealed bonnet is a thing nobody can see. The two are one purchase in
   * the shop and one field here for the same reason.
   */
  engineCover?: number;
  /** How much of the bodywork is cloth rather than steel. */
  carbon?: CarbonLevel;
}

/**
 * How hard the rear lamps burn, in one place.
 *
 * These were six numbers spread across two files: three baked into the
 * materials here and three assigned every frame by the engine's brake
 * flare, with nothing naming them and nothing to stop the two drifting
 * apart. They are also the numbers most likely to be wrong, because
 * emissive intensity is not brightness — it is input to ACES and then to
 * the bloom, and both of them have opinions.
 *
 * Measured from behind the car at night, the old set put 15 to 21% of
 * the lit pixels of a braking lamp at a saturation under 0.3: a red lamp
 * reading white, which is what "too much shine on the back light" looks
 * like from the driver's seat. A brake light is a saturated red source
 * behind a red lens and it should never be white at any distance.
 *
 * The brake step is still a step — that is the whole job of a brake
 * light — it is just a step between two reds now.
 */
export const TAIL = {
  /** Pure red, and it has to be. ACES walks every bright colour toward
   *  white, so the only headroom a lamp has is whatever its green and
   *  blue start at: 0xff2222 begins at 13% of each and was reading
   *  (255, 211, 172) at the old brake intensity. Starting at zero is the
   *  difference between a lamp that goes orange as it brightens and one
   *  that goes white. */
  lensColor: 0xff0000,
  lensIdle: 0.55,
  lensBrake: 1.7,
  /** The filament behind it. A shade hotter, not a different colour:
   *  there is no white-hot element visible through a red lens, because
   *  the lens is red glass and everything behind it comes out red. The
   *  old core was 0xff7048 at intensity 10 and measured (255, 248, 234),
   *  which is not a red lamp at all — it is a white one. */
  coreColor: 0xff1a05,
  coreIdle: 0.9,
  coreBrake: 2.8,
  /** The additive halo hung behind each lens. This is the piece that
   *  grows the lamp's footprint under braking, so it is the piece that
   *  decides whether the back of the car is a pair of lamps or one
   *  bright smear. */
  glowColor: 0xff2a0a,
  glowIdle: 0.16,
  glowBrake: 0.5,
} as const;

let goldRimMat: THREE.MeshStandardMaterial | null = null;
function getGoldRimMat(): THREE.MeshStandardMaterial {
  if (!goldRimMat) {
    goldRimMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.18,
      metalness: 1,
      envMapIntensity: 2.4,
    });
  }
  return goldRimMat;
}

/** Four-point diffraction star — what a bright lamp does to an eye or a
 *  lens. Drawn once and shared by every headlight in the scene. */
let starTexShared: THREE.CanvasTexture | null = null;
function headlightStarTexture(): THREE.CanvasTexture {
  if (starTexShared) return starTexShared;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const mid = S / 2;
  // Spikes: long and thin, horizontal pair longer than the vertical, the
  // asymmetry real headlamp optics and camera irises both produce
  const arm = (len: number, thick: number, angle: number, alpha: number) => {
    ctx.save();
    ctx.translate(mid, mid);
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(-len, 0, len, 0);
    g.addColorStop(0, "rgba(255,238,205,0)");
    g.addColorStop(0.5, `rgba(255,248,230,${alpha})`);
    g.addColorStop(1, "rgba(255,238,205,0)");
    ctx.fillStyle = g;
    // Taper the spike toward its tips so it reads as a ray, not a bar
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(0, -thick);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, thick);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  arm(mid * 0.98, 3.4, 0, 0.95); // horizontal, the dominant flare
  arm(mid * 0.62, 2.6, Math.PI / 2, 0.75); // vertical
  arm(mid * 0.34, 1.8, Math.PI / 4, 0.4); // faint diagonals
  arm(mid * 0.34, 1.8, -Math.PI / 4, 0.4);
  // Blown-out core
  const core = ctx.createRadialGradient(mid, mid, 0.5, mid, mid, mid * 0.28);
  core.addColorStop(0, "rgba(255,255,250,1)");
  core.addColorStop(0.35, "rgba(255,246,215,0.75)");
  core.addColorStop(1, "rgba(255,238,200,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, S, S);
  starTexShared = new THREE.CanvasTexture(c);
  starTexShared.colorSpace = THREE.SRGBColorSpace;
  return starTexShared;
}

// Glow shapes live in glow.ts: a lamp seen directly and a pool of neon
// on the tarmac need opposite falloffs, and they used to share one.

// Soft dark blob under every car — grounds it on the asphalt even where
// the moon shadow falls subtle. Geometry/material shared across all cars
// (created per car they'd leak on rival rematches and remote re-styles).
const contactGeo = new THREE.PlaneGeometry(2.9, 5.8);
let contactMatShared: THREE.MeshBasicMaterial | null = null;
function contactMat(): THREE.MeshBasicMaterial {
  if (!contactMatShared) {
    contactMatShared = new THREE.MeshBasicMaterial({
      map: contactShadowTexture(),
      transparent: true,
      depthWrite: false,
    });
  }
  return contactMatShared;
}

/**
 * How strongly the painted-on contact blob shows, 0..1.
 *
 * The blob was drawn for a game whose cars cast no visible shadow: the
 * key light sat 56 degrees up, every real shadow landed under the floor
 * of the thing casting it, and this decal was the only thing keeping
 * fifteen cars from looking like they were hovering.
 *
 * Now that the key rakes and the shadow is real, the two are painted on
 * the same patch of road and the fake one wins — measured at 40% of the
 * real shadow's area swallowed. So the engine turns it down where a real
 * shadow is being drawn and leaves it at full strength on the tiers that
 * switch shadow casting off, where it is still the only thing there.
 *
 * The material is shared across every car on purpose, so this is one
 * assignment for the whole road.
 */
export function setContactStrength(v: number): void {
  contactMat().opacity = v;
}
let contactTexShared: THREE.CanvasTexture | null = null;
function contactShadowTexture(): THREE.CanvasTexture {
  if (contactTexShared) return contactTexShared;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, "rgba(0,0,0,0.5)");
  g.addColorStop(0.6, "rgba(0,0,0,0.32)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  contactTexShared = new THREE.CanvasTexture(c);
  return contactTexShared;
}

/** Chamfered box. Real sheet metal never meets at a sharp 90 degrees —
 *  every panel edge carries a small radius that catches a bright
 *  specular line, and that highlight is most of what makes a car read as
 *  a car. Built as a rounded rectangle extruded with a bevel, so the
 *  rounding wraps all three axes. */
// seg 4 (was 3): the chamfer is the specular line that sells every panel
// edge; at 4 subdivisions it reads as a true curve at showroom distance.
function roundedBox(w: number, h: number, d: number, r = 0.035, seg = 4): THREE.BufferGeometry {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const shape = new THREE.Shape();
  const hw = w / 2;
  const hh = h / 2;
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-3, d - r * 2),
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r,
    bevelSegments: seg,
    curveSegments: 3,
  });
  geo.translate(0, 0, -(d - r * 2) / 2);
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();
  return geo;
}

/**
 * CROWNING — the pass that makes an extrusion look like bodywork.
 *
 * Every shell in this game is an ExtrudeGeometry: a side profile pushed
 * across the car's width with a bevel round the edge. That gives a
 * rounded EDGE around a perfectly FLAT slab, and a flat slab is what a
 * bar of soap looks like. Real bodywork has none of it:
 *
 *   the roof and the bonnet are CROWNED across, by two or three
 *   centimetres over a metre and a half — which is what puts the long
 *   highlight down the middle of a bonnet instead of a flat grey field;
 *
 *   the flanks BULGE at the shoulder and TUCK at the rocker, so a
 *   cross-section is closer to an egg than to a rectangle;
 *
 *   and the glasshouse leans IN above the belt, which is why a car
 *   photographed head-on is narrower at the roof than at the doors.
 *
 * All three come out of one pass over the vertices, and it works in the
 * car\'s own frame (x across, y up, z along) so the same function can be
 * applied to an authored GLB shell after it loads — see models.ts. If
 * only the procedural build were crowned, the four styles with authored
 * shells would show a flat hero car and curved traffic.
 *
 * The widest point is DELIBERATELY left where it was. Everything hung
 * on the flanks — mirrors, arch lips, side markers, the flag, a crew\'s
 * decal — is anchored against the half-width the profile tables were
 * written with, so a section that bulged outward would leave every one
 * of them sunk inside the paint. Pulling in above and below the
 * shoulder gets the same curvature and can only ever leave a detail a
 * few millimetres proud, which is invisible.
 */
export interface CrownSpec {
  /** How much the section pulls IN at the top and bottom, as a fraction
   *  of the half-width. The shoulder keeps its full width. */
  tuck: number;
  /** How far down the top surface falls at its edges, in metres. */
  roof: number;
  /** Where the widest point sits, 0 at the bottom of the shell and 1 at
   *  the top. A door\'s shoulder is a little above the middle. */
  shoulder: number;
}

export const CROWN: Record<"body" | "canopy" | "roof", CrownSpec> = {
  // The body: bulging doors, tucked rocker, a crowned bonnet and boot.
  body: { tuck: 0.055, roof: 0.03, shoulder: 0.62 },
  // The glasshouse leans in hard — tumblehome is most of what makes a
  // greenhouse read as glass rather than as a box.
  canopy: { tuck: 0.085, roof: 0.026, shoulder: 0.25 },
  // A roof panel is nearly all crown and barely any tuck.
  roof: { tuck: 0.03, roof: 0.034, shoulder: 0.5 },
};

/**
 * The crown, per silhouette.
 *
 * CROWN above is one spec per SHELL TYPE — body, canopy, roof — and
 * every one of the six silhouettes was handed the same three. So a
 * pickup's doors bulged exactly as far as a mid-engined coupe's, and the
 * glasshouse leaned in by the same 85 mm on a saloon as on a low sports
 * car. The cross-section was the one thing about these bodies that did
 * not vary at all; the differences between them came entirely from the
 * side profile.
 *
 * What actually differs between these shapes:
 *
 *   the low coupes tuck hard and lean their glass in hard — tumblehome
 *     is most of what separates a sports car's greenhouse from a box —
 *     and carry the shoulder low down the flank.
 *   a pony coupe is about haunches: less tuck than a sports car, but the
 *     widest point sits HIGH, which is what reads as a shoulder over the
 *     rear wheel.
 *   a saloon is upright. Softer tuck, flatter roof, glass that stands
 *     much nearer vertical.
 *   a hatch and a pickup are nearly slab-sided, and their roofs are
 *     close to flat, because that is what a tall practical body is.
 *
 * Each is the base spec scaled rather than a fresh set of numbers, so
 * the relationship CROWN describes — a body that bulges, a canopy that
 * leans, a roof that is nearly all crown — survives on every car.
 */
const CROWN_BY_STYLE: Record<BodyStyle, Record<"body" | "canopy" | "roof", CrownSpec>> = {
  zx: {
    body: { tuck: 0.075, roof: 0.032, shoulder: 0.58 },
    canopy: { tuck: 0.105, roof: 0.028, shoulder: 0.24 },
    roof: { tuck: 0.034, roof: 0.036, shoulder: 0.5 },
  },
  rx7: {
    body: { tuck: 0.075, roof: 0.032, shoulder: 0.58 },
    canopy: { tuck: 0.105, roof: 0.028, shoulder: 0.24 },
    roof: { tuck: 0.034, roof: 0.036, shoulder: 0.5 },
  },
  gtr: {
    body: { tuck: 0.068, roof: 0.030, shoulder: 0.60 },
    canopy: { tuck: 0.098, roof: 0.027, shoulder: 0.25 },
    roof: { tuck: 0.032, roof: 0.035, shoulder: 0.5 },
  },
  pony: {
    body: { tuck: 0.062, roof: 0.028, shoulder: 0.68 },
    canopy: { tuck: 0.090, roof: 0.026, shoulder: 0.27 },
    roof: { tuck: 0.030, roof: 0.032, shoulder: 0.5 },
  },
  sedan: {
    body: { tuck: 0.045, roof: 0.026, shoulder: 0.62 },
    canopy: { tuck: 0.072, roof: 0.024, shoulder: 0.28 },
    roof: { tuck: 0.026, roof: 0.028, shoulder: 0.5 },
  },
  hatch: {
    body: { tuck: 0.034, roof: 0.022, shoulder: 0.64 },
    canopy: { tuck: 0.060, roof: 0.022, shoulder: 0.30 },
    roof: { tuck: 0.022, roof: 0.024, shoulder: 0.5 },
  },
};

/**
 * The cross-section a shell of this silhouette is given.
 *
 * Exported because models.ts crowns the Blender-authored shells at load
 * time and was doing it with the shared CROWN — the one spec the whole
 * fleet used before the silhouettes were given their own. A hero car
 * crowned by the old table in front of traffic crowned by the new one is
 * the same bug the per-style table was written to end, one layer up.
 */
export function crownFor(style: BodyStyle, slot: string): CrownSpec {
  const set = CROWN_BY_STYLE[style] ?? CROWN_BY_STYLE.sedan;
  return slot === "canopy" ? set.canopy : slot === "roof" ? set.roof : set.body;
}



/**
 * Reshape a shell\'s cross-section in place. Car frame: x across, y up,
 * z along the length.
 *
 * Stationed along the length rather than applied globally, because the
 * shell\'s height changes from nose to tail: doming "the top" by a fixed
 * amount would dome the bonnet and the roof by the same absolute drop
 * even though one is half the width of the other. Each station gets its
 * own half-width and its own top, and the crown is measured against
 * those.
 */
export function crownShell(geo: THREE.BufferGeometry, c: CrownSpec): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  if (!n) return geo;

  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const z0 = bb.min.z;
  const z1 = bb.max.z;
  const span = z1 - z0;
  if (!(span > 1e-4)) return geo;

  // Thirty-two stations along the car: fine enough that a windscreen
  // base and a roof do not share one, coarse enough that a single stray
  // vertex cannot define a station on its own.
  const N = 32;
  const maxX = new Float32Array(N).fill(1e-4);
  const maxY = new Float32Array(N).fill(-1e9);
  const minY = new Float32Array(N).fill(1e9);
  const station = (z: number) =>
    Math.min(N - 1, Math.max(0, Math.floor(((z - z0) / span) * N)));

  for (let i = 0; i < n; i++) {
    const k = station(pos.getZ(i));
    const ax = Math.abs(pos.getX(i));
    if (ax > maxX[k]) maxX[k] = ax;
    const y = pos.getY(i);
    if (y > maxY[k]) maxY[k] = y;
    if (y < minY[k]) minY[k] = y;
  }
  // Smooth the station profile. A station that happened to catch only
  // the inside of a wheel arch reports a half-width of nothing, and an
  // unsmoothed pass would pinch the car\'s waist there.
  const sm = (a: Float32Array, fill: number) => {
    const out = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      let sum = 0;
      let w = 0;
      for (let d = -1; d <= 1; d++) {
        const j = k + d;
        if (j < 0 || j >= N) continue;
        if (!Number.isFinite(a[j]) || a[j] === fill) continue;
        sum += a[j];
        w++;
      }
      out[k] = w ? sum / w : a[k];
    }
    return out;
  };
  const halfW = sm(maxX, 1e-4);
  const topY = sm(maxY, -1e9);
  const botY = sm(minY, 1e9);

  for (let i = 0; i < n; i++) {
    const k = station(pos.getZ(i));
    const hw = halfW[k];
    const hi = topY[k];
    const lo = botY[k];
    if (!(hw > 1e-3) || !(hi - lo > 1e-3)) continue;

    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = Math.min(1, Math.abs(x) / hw);                  // across
    const t = Math.min(1, Math.max(0, (y - lo) / (hi - lo))); // up

    // Flank: full width at the shoulder, pulled in above and below it.
    // Cosine rather than a sine bump so the widest point is a smooth
    // maximum instead of a crease.
    const d = (t - c.shoulder) / (t >= c.shoulder ? 1 - c.shoulder : c.shoulder || 1);
    const pull = c.tuck * (1 - Math.cos(Math.min(1, Math.abs(d)) * Math.PI)) * 0.5;
    pos.setX(i, x * (1 - pull));

    // Top surface: dome it. Weighted by how near the top of ITS OWN
    // station the vertex is, so the rocker is untouched and the roof
    // takes the full drop, and by u squared so the fall is a parabola
    // across the car — which is the shape a stamped panel actually is.
    if (t > 0.5) {
      const w = (t - 0.5) / 0.5;
      pos.setY(i, y - c.roof * u * u * w * w);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Extrude a side profile (x = length, y = height) across the car's width.
 *
 * Sheet metal is never a polyline: the whole top run — nose, hood,
 * roofline, tail — is threaded through a Catmull-Rom spline so the
 * silhouette is one continuous curve, while the rocker line along the
 * bottom stays dead straight. `bottomPoints` is how many trailing points
 * belong to that straight underbody run.
 */
function extrudeProfile(
  points: Array<[number, number]>,
  width: number,
  bevel: number,
  bottomPoints = 2,
  /** Which crown to give the finished section. Omitted leaves the old
   *  flat-sided extrusion, which is right for anything that genuinely
   *  is a slab. */
  crown?: CrownSpec
): THREE.BufferGeometry {
  // Every profile is authored as if the car sat on the wheels it used to
  // have; BODY_DROP is what puts it back on the ones it has now.
  points = points.map(([x, y]) => [x, y - BODY_DROP] as [number, number]);
  const shape = new THREE.Shape();
  const top = points.slice(0, points.length - bottomPoints);
  shape.moveTo(top[0][0], top[0][1]);
  // Uniform Catmull-Rom, which is what splineThru is — and MEASURED
  // against the centripetal variant, which is the textbook cure for
  // Catmull-Rom overshoot and was proposed here for exactly that.
  // Sampled 800 points per shell on the authored profiles, overshoot
  // above the crest went the wrong way on nearly every one: roof caps
  // 0.1 -> 9.3 mm (zx), 1.1 -> 11.3 (pony), 3.7 -> 24.5 (gtr), 0.4 ->
  // 11.4 (rx7), 3.7 -> 29.3 (hatch); canopies 30 -> 31 (zx), 47 -> 57
  // (gtr). Only the pony and rx7 canopies improved. The reason is the
  // spacing: these profiles are authored with near-even spans, which is
  // the case uniform parameterisation is right for, and centripetal
  // trades that for robustness on spacing these profiles do not have.
  shape.splineThru(top.slice(1).map(([x, y]) => new THREE.Vector2(x, y)));
  for (let i = points.length - bottomPoints; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    // 9, not 5. The bevel IS the panel edge, and the panel edge is
    // where the specular line lives — at 5 segments a headlight sweeping
    // along a flank walks across the facets one at a time instead of
    // running along them. These geometries are shared by every instance
    // of a silhouette, player car and thirty traffic cars alike, so the
    // extra vertices are paid once each rather than once per car.
    bevelSegments: 9,
    // The spline spans the whole body top, so it needs real sampling
    // density or the curve degenerates back into a polyline.
    curveSegments: 28,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  // Merged BEFORE crowning, not after. Crowning moves vertices by a few
  // millimetres, and a 1e-3 weld applied afterwards would fuse pairs the
  // crown had just pushed apart — which shows up as a torn normal along
  // the shoulder line.
  geo = mergeVertices(geo, 1e-3);
  // Profile length axis (x) onto the car's forward axis (+Z)
  geo.rotateY(-Math.PI / 2);
  if (crown) crownShell(geo, crown);
  else geo.computeVertexNormals();
  /**
   * The forwardmost point of the roof, recorded on the geometry.
   *
   * On a canopy this is the windscreen header — where the screen stops
   * being a screen and the roof starts — and it is the one landmark in
   * a cabin that says where the person in it goes: a driver's head sits
   * a fixed distance behind the header on every car ever built, because
   * that is what a windscreen has to clear.
   *
   * Taken as the most forward of the control points within 60 mm of the
   * profile's highest, rather than the highest point outright. On the
   * fastbacks the highest point IS the header, but a saloon's roof
   * peaks over the back seat and a hatch's over the rear axle, and
   * seating a driver at those puts him in the boot. Recorded here, in
   * the shifted coordinates the shell is actually built in, so it can
   * never drift from the profile the way a hand-copied number does.
   */
  const topY = Math.max(...points.map(([, y]) => y));
  const header = points
    .filter(([, y]) => y >= topY - 0.06)
    .reduce((a, b) => (b[0] > a[0] ? b : a));
  geo.userData.headerZ = header[0];
  geo.userData.headerY = header[1];
  return geo;
}

/**
 * How far the whole body sits down from where it was authored.
 *
 * This exists BECAUSE of the number above, and the two only make sense
 * together. Fitting a smaller wheel drops the axle by the radius lost —
 * 35 mm — but it does NOT drop the body, which is authored in absolute
 * coordinates with y=0 at the road. The tyre's crown falls twice that,
 * 70 mm, so the arch gap opens by 70 mm and the car ends up looking
 * jacked up on small wheels. That is also what happens to a real car
 * fitted with smaller rims and nothing else, which is why people fit
 * bigger ones to fill the arch.
 *
 * So the body comes down by more than the tyre's own 70 mm: the car sits
 * 51 mm closer to its own axles than it did — a lowered car on smaller
 * wheels, which is the shape this game is about. Ground clearance goes
 * from 190 mm to 104 mm, a lowered street car rather than a scraped one.
 *
 * 86 rather than 70 because 70 only HOLDS the gap, and holding it is not
 * enough: the same daylight over a smaller tyre is a bigger fraction of
 * its radius, and gap/radius landed on the 0.30 ceiling with two cars
 * tipping over it. The extra 16 mm closes the gap to about 84 mm and
 * puts the fleet mid-band instead of against the wall.
 *
 * It is applied in two places and both are needed: the profile points in
 * extrudeProfile, which are the shells, and STYLE_DIMS, which is every
 * anchor hung off them — beltline, crease, lights, mirrors, dash, roof.
 * Dropping one without the other slides the details up the bodywork.
 */
const BODY_DROP = 0.086;

/**
 * Where the driver sits, and how much air is over his head.
 *
 * He used to be put at `dashY - 0.34` and one of two fixed stations —
 * `bCabBack ? -0.28 : 0.08` — for all six silhouettes. Both halves of
 * that were wrong, and the check that was supposed to catch it could not
 * see either: tests/ik.mjs took the highest shell VERTEX inside a 0.8 m
 * box around the seat, and an extruded shell carries vertices only at
 * its profile points and bevel rings, so the number it returned was
 * whichever ring fell in the box rather than the ceiling over the head.
 *
 * Asked of the surface directly, at the driver's own x, the fleet read:
 *
 *   pony    187 mm THROUGH the glass — seated 420 mm forward of its own
 *           roof peak, under the steep screen, head out in the weather
 *   zx       23 mm through
 *   hatch     0 mm — scalp on the glass
 *   rx7      12 mm of clearance
 *   gtr      64 mm
 *   sedan   221 mm, sunk so low his shoulders sat BELOW the door line
 *
 * So stop placing him by hand. The canopy records its own windscreen
 * header, a driver's head goes a fixed distance behind it, and the seat
 * drops until the helmet clears the skin measured at that exact point.
 * Every silhouette then gets the same air over the helmet whatever its
 * roof does, and a new body inherits the fit instead of needing a
 * number.
 */
const DRIVER_X = 0.38;
/** Head centre behind the windscreen header. A screen has to clear the
 *  head it rakes over, so this distance is a property of people and
 *  windscreens rather than of any one car. */
const CABIN_HEAD_BACK = 0.2;
/** Air between the top of the helmet and the glass. */
const CABIN_HEADROOM = 0.06;

/**
 * How far the top of a driver's helmet sits above the seat he is bolted
 * to. Measured off a rig rather than written down: the figure is built
 * in characters.ts, and a helmet that grew there would otherwise quietly
 * push every head in the game back through a roof. One throwaway rig for
 * the life of the process.
 */
let driverHeadTopM: number | null = null;
function driverHeadTop(): number {
  if (driverHeadTopM === null) {
    const probe = kuwaitiDriver(0x000000, undefined, true);
    driverHeadTopM = new THREE.Box3().setFromObject(probe.group).max.y;
  }
  return driverHeadTopM;
}

/**
 * The radius on a panel edge, in metres.
 *
 * These were 0.13 to 0.17 on the bodies — a 130 to 170 mm roll on an
 * edge that a real car turns in ten or twenty. At that radius there is
 * no edge left to catch a light: the shoulder line is a slow gradient
 * across a sixth of the car's width, which is why the fleet read as
 * soap. Measured before the change, only 19 to 26% of a body faced
 * squarely out of its own side.
 *
 * Not zero, and not one number for everything. The bevel is where the
 * specular line lives, so it has to be wide enough for a headlight
 * sweeping past to run ALONG it rather than pop across it — with the 9
 * segments extrudeProfile uses, 50 mm is five and a half millimetres a
 * facet, which is finer than the shell's own curvature elsewhere. And
 * the three shells are different things: a body has real panel edges, a
 * canopy is glass in a frame, a roof is a pressing that genuinely rolls.
 *
 * What this costs, measured rather than left to be rediscovered: the
 * bevel expands the profile outward in EVERY direction, so tightening it
 * makes the painted shell SHORTER — sedan 4.82 to 4.64 m, rx7 4.89 to
 * 4.65. At the beltline the loss is bigger again, because a tight corner
 * lets the body fall away at that height instead of being carried out by
 * a fat roll: the rx7's run at the side graphic's height went 4.63 to
 * 3.65 m, and the graphic's share of the whole car with it, 94-96% down
 * to 78-90%. It still covers 99% of the body available at its own
 * height, which is all it claims, and the stretch it gave up is the
 * extreme nose and tail where a side graphic does not go on a real car
 * either. Overall car length is untouched — lengthM normalises the shell
 * after this.
 */
/*
 * Halved again, and this time against a shoulder measurement that works.
 *
 * caredges.mjs claimed 1 to 6 mm of roll on every body in the fleet,
 * which would have been sharper than any car ever pressed. It was
 * reporting its own sampling step: the walk started at the widest sample
 * — a spike on the last ring before the surface turns over — and stopped
 * one step later. Measured properly, from the flat of the bonnet down to
 * the flank, these bevels were rolling the shoulder over 40 to 61 mm.
 *
 * A real car turns its bonnet shoulder in fifteen to twenty-five
 * millimetres. The bevel still has nine segments across it whatever its
 * width, so the specular line a headlight draws still runs ALONG the
 * edge instead of popping across it — that argument was always about
 * segment count and never about millimetres.
 */
const BODY_EDGE = 0.026;
const CANOPY_EDGE = 0.021;
const ROOF_EDGE = 0.016;

// Beltline-down body: bumper > hood wedge > trunk, with rounded edges
const bodyGeo = extrudeProfile(
  [
    [2.2, 0.34],
    [2.26, 0.62],
    [2.12, 0.78],
    [1.35, 0.9],
    [0.4, 0.97],
    [-1.45, 0.95],
    [-2.18, 0.86],
    [-2.27, 0.62],
    [-2.2, 0.34],
    [-1.85, 0.24],
    [1.85, 0.24],
  ],
  1.840,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.sedan.body,
);

/**
 * How wide a cabin is, and how wide the roof that caps it is.
 *
 * These were twelve unrelated numbers, and every roof came out at about
 * 89% of the glass it sat on. Measured on the built cars, that left 69
 * to 103 mm of glass showing down EACH SIDE of every painted roof in the
 * fleet — a strip of window running the full length of the roof, where a
 * real car has a rail. It is the same mistake six times, which is what a
 * pair of numbers that ought to be related but are typed separately
 * always turns into.
 *
 * So the roof is derived from the cabin. A roof meets the side glass at
 * a rail and stops; the only glass that should show past it is the seal.
 */
const ROOF_SEAL = 0.015;
const roofWidth = (cabin: number): number => cabin - ROOF_SEAL * 2;

const SEDAN_CABIN_W = 1.6;
const ZX_CABIN_W = 1.776;
const PONY_CABIN_W = 1.63;
const GTR_CABIN_W = 1.701;
const RX7_CABIN_W = 1.635;
const HATCH_CABIN_W = 1.556;

// Raked glasshouse: windshield, roofline, rear window
const canopyGeo = extrudeProfile(
  [
    [1.02, 0.93],
    [0.42, 1.4],
    [-0.78, 1.42],
    [-1.5, 0.94],
  ],
  SEDAN_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.sedan.canopy,
);

// Painted roof panel over the glass
const roofGeo = extrudeProfile(
  [
    [0.38, 1.41],
    [0.28, 1.47],
    [-0.68, 1.48],
    [-0.76, 1.42],
  ],
  roofWidth(SEDAN_CABIN_W),
  ROOF_EDGE,
  0,
  CROWN_BY_STYLE.sedan.roof,
);

// ---- Z32-style wedge: long flat nose, cab-back glasshouse, fastback
// tail. The whole car sits lower and the glass flows almost to the tail.
const zxBodyGeo = extrudeProfile(
  [
    [2.36, 0.3],
    [2.42, 0.54], // slim, flush nose — no upright grille face
    [2.3, 0.64],
    [1.0, 0.78], // the long hood
    [0.2, 0.87],
    [-1.6, 0.86], // rear haunch
    [-2.26, 0.76], // kicked tail
    [-2.34, 0.48],
    [-2.26, 0.28],
    [-1.9, 0.2],
    [1.95, 0.2],
  ],
  2.080,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.zx.body,
);
const zxCanopyGeo = extrudeProfile(
  [
    [0.48, 0.84],
    [-0.12, 1.24], // peak just over the driver
    [-0.95, 1.19],
    [-2.0, 0.78], // fastback all the way down
  ],
  ZX_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.zx.canopy,
);
const zxRoofGeo = extrudeProfile(
  [
    [-0.16, 1.24],
    [-0.24, 1.29],
    [-0.82, 1.25],
    [-0.9, 1.2],
  ],
  roofWidth(ZX_CABIN_W),
  ROOF_EDGE,
  0,
  CROWN_BY_STYLE.zx.roof,
);

// ---- The American pony coupe: a very long, very low nose, a windscreen
// that starts almost over the front wheels, and a fastback that runs
// unbroken from the roof to a short high deck. Wide at the hips.
//
// The proportion that makes this silhouette is the DASH-TO-AXLE: the
// cowl sits a long way back, so two thirds of the car is in front of
// the driver. Nothing else here does that — the zx is long-nosed but
// its glasshouse sits further forward, and the gtr is upright.
const ponyBodyGeo = extrudeProfile(
  [
    [2.42, 0.26], // the nose is LOW: this car looks along the road, not over it
    [2.47, 0.42],
    [2.38, 0.55],
    [1.62, 0.66], // the long flat hood
    [0.52, 0.79], // cowl, a long way back
    [-0.62, 0.86],
    [-1.72, 0.885], // rear haunch, the widest and highest point of the body
    [-2.32, 0.85], // short deck
    [-2.45, 0.58],
    [-2.38, 0.3],
    [-2.0, 0.2],
    [2.0, 0.2],
  ],
  1.92,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.pony.body,
);
const ponyCanopyGeo = extrudeProfile(
  [
    [0.64, 0.79], // the windscreen starts here, and it is steep
    [-0.32, 1.26], // roof peak, over the driver's head
    [-0.98, 1.235],
    [-2.16, 0.87], // and the hatch glass runs all the way to the deck
  ],
  PONY_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.pony.canopy,
);
const ponyRoofGeo = extrudeProfile(
  [
    [-0.36, 1.26],
    [-0.44, 1.31],
    [-0.9, 1.29],
    [-0.98, 1.24],
  ],
  roofWidth(PONY_CABIN_W),
  ROOF_EDGE,
  0,
  CROWN_BY_STYLE.pony.roof,
);

// ---- R34-style coupe: short deck up high, upright glasshouse, thick
// haunches. The silhouette is a brick with intent.
const gtrBodyGeo = extrudeProfile(
  [
    [2.28, 0.3],
    [2.36, 0.68], // deep bumper face
    [2.18, 0.82],
    [1.1, 0.94], // short power-bulge hood
    [0.45, 1.0],
    [-1.3, 1.0], // dead-flat beltline
    [-2.1, 0.97], // the high R34 trunk deck
    [-2.28, 0.66],
    [-2.2, 0.32],
    [-1.88, 0.22],
    [1.88, 0.22],
  ],
  1.985,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.gtr.body,
);
const gtrCanopyGeo = extrudeProfile(
  [
    [1.0, 0.97],
    [0.34, 1.42],
    [-0.66, 1.44],
    [-1.32, 0.99],
  ],
  GTR_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.gtr.canopy,
);
const gtrRoofGeo = extrudeProfile(
  [
    [0.3, 1.43],
    [0.2, 1.49],
    [-0.56, 1.5],
    [-0.64, 1.44],
  ],
  roofWidth(GTR_CABIN_W),
  ROOF_EDGE,
  0,
  CROWN_BY_STYLE.gtr.roof,
);

// ---- FD-style curves: a low pop-up nose, a bubble glasshouse and
// haunches that roll into a short rounded tail. The spline profile is
// where this body earns its keep — almost no straight lines anywhere.
const rx7BodyGeo = extrudeProfile(
  [
    [2.28, 0.28],
    [2.34, 0.48], // low, flush nose
    [2.22, 0.58],
    [1.3, 0.7], // the pop-up shelf
    [0.5, 0.85],
    [-1.1, 0.88], // rear haunch peak
    [-1.95, 0.78],
    [-2.2, 0.52], // rounded kick
    [-2.14, 0.28],
    [-1.82, 0.2],
    [1.88, 0.2],
  ],
  1.961,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.rx7.body,
);
const rx7CanopyGeo = extrudeProfile(
  [
    [0.8, 0.83],
    [0.1, 1.28], // bubble peak over the driver
    // The roof-chord midpoint, collinear by construction. The glasshouse
    // was drawn with straight lines and two hard knuckles — 35 degrees
    // at the header, 23 at the C-pillar — because the spline only ever
    // ran through the first two points and lineTo'd the rest. One
    // derived pin with near-equal spacing either side keeps uniform
    // Catmull-Rom tame while the whole run curves; measured on the built
    // geometry, the screen bows 38.7 mm off its chord (the fleet runs
    // 37-54) and the glass peak stays under the painted cap.
    [-0.31, 1.26],
    [-0.72, 1.24],
    [-1.68, 0.78], // long rounded hatch glass
  ],
  RX7_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.rx7.canopy,
);
const rx7RoofGeo = extrudeProfile(
  [
    [0.06, 1.28],
    [-0.02, 1.33],
    [-0.6, 1.3],
    [-0.68, 1.25],
  ],
  roofWidth(RX7_CABIN_W),
  ROOF_EDGE,
  // 0, like the sedan/zx/pony/gtr roofs already pass: the painted cap
  // must balloon WITH the glass. Flipping the canopy alone left the
  // glass skin 6.8 mm proud of a straight-chord cap at z=-0.31.
  0,
  CROWN_BY_STYLE.rx7.roof,
);

// ---- Hot hatch: the shape a fast three-door has had for fifty years.
// Everything that makes it read as a hatch rather than as a short saloon
// is at the two ends — almost no overhang past either axle, and a
// tailgate that comes down nearly vertically instead of running out into
// a boot. The cabin sits tall and upright over it, which is why these
// cars look small and roomy at the same time.
const hatchBodyGeo = extrudeProfile(
  [
    [2.02, 0.34],
    [2.12, 0.68], // blunt, upright bumper face — the overhang is tiny
    [1.98, 0.84],
    [1.52, 0.94], // the bonnet is SHORT and climbs fast
    [1.04, 1.0], // cowl, well forward — this is what makes it a hatch
    [-1.38, 1.0], // beltline dead flat the length of the cabin
    [-1.94, 0.97], // haunch over the rear axle
    [-2.08, 0.64], // tailgate drops away almost vertically
    [-2.0, 0.34],
    [-1.7, 0.22],
    [1.7, 0.22],
  ],
  1.811,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.hatch.body,
);
// The cabin sits FORWARD. Authored first with the screen base back at
// z 0.74 it came out with a long bonnet and the glasshouse pushed over
// the rear axle, which is coupe proportion — the shape read as a short
// muscle car rather than a hatch. A hot hatch puts its windscreen where
// a saloon puts the back of its bonnet, and spends everything it saves
// on roof.
const hatchCanopyGeo = extrudeProfile(
  [
    // Pinned, then splined. The profile used to be a pure polyline —
    // with bottomPoints=2 the "spline" ran through exactly two points,
    // which is a straight line — so the header carried a 35-degree
    // crease and the C-pillar a 26, across the widest flat surfaces on
    // the car. Every pin below sits ON an authored chord (the exact 1/3
    // and 2/3 points of the roof, the screen and tailgate chords at
    // their own y), so the roof stays dead flat between them and the
    // curve deviates only at the two former knuckles, by 10-14 mm —
    // which is the fillet a real header has. The authored corners stay
    // authored: headerZ still finds [0.40, 1.44], so the driver's
    // seating anchor does not move.
    [1.02, 0.99],
    [0.65, 1.2585], // on the screen chord
    [0.40, 1.44], // short, steep screen
    [-0.05, 1.4467], // roof chord, 1/3
    [-0.50, 1.4533], // roof chord, 2/3
    [-0.95, 1.46], // long flat roof
    [-1.40, 1.2523], // on the tailgate chord
    [-1.86, 1.04], // hatch glass, raked but still upright
  ],
  HATCH_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.hatch.canopy,
);
const hatchRoofGeo = extrudeProfile(
  [
    [0.34, 1.44],
    [0.24, 1.5],
    [-0.82, 1.49],
    [-0.92, 1.43],
  ],
  roofWidth(HATCH_CABIN_W),
  ROOF_EDGE,
  // 0, matching the other four roofs: a faceted painted sliver over a
  // curved glasshouse reads as a plank laid on a dome.
  0,
  CROWN_BY_STYLE.hatch.roof,
);

/**
 * Per-silhouette scale. The RATIOS between styles come from the real
 * cars each shape evokes — a generic saloon (4.70 x 1.80 m), a Z32
 * 300ZX (4.31 x 1.80), an R34 Skyline (4.60 x 1.79), an FD RX-7
 * (4.30 x 1.76) — so the Z still parks visibly shorter than the R34.
 * The whole fleet then wears a 1.12 presence factor on top: from the
 * chase camera a spec-sheet car reads small and distant, and every
 * arcade racer up-sizes its metal for exactly this reason. Applied to
 * the whole group in createCar; collision constants in the engine were
 * re-margined for it (traffic hitbox and knock-out spacing).
 */
// Was 1.12: a flat up-size over the whole fleet so a spec-sheet car did
// not read small from the chase camera. It is 1 now, because every car
// in the showroom carries a real length in metres and is fitted to it —
// see the scale at the end of createCar — and a car that is 12% longer
// than the machine it evokes is not that machine. What is left below is
// the fallback for a shell built without a length: traffic, and the
// showroom capture tool.
const PRESENCE = 1;
const STYLE_SCALE: Record<BodyStyle, number> = {
  sedan: 0.934 * PRESENCE,
  zx: 0.825 * PRESENCE,
  // Base 0.912 (was 0.926): the R34 measured +11% on height, the worst
  // residual in the fleet. Trading a little length brings the roof down
  // while width lands within 1% of proportion — the closest a uniform
  // scale can get this profile to 4.60 x 1.79 x 1.36.
  gtr: 0.895 * PRESENCE,
  rx7: 0.853 * PRESENCE,
  // The pony shell is authored at 4.92 m raw; every car on it carries a
  // real lengthM, so this is only the fallback for a shell built
  // without one.
  pony: 0.9 * PRESENCE,
  // A hot hatch is the small car in this fleet and has to park like one:
  // 4.28 x 1.79 x 1.47 m, which is 40 cm shorter than the saloon and
  // 10 cm taller. The profile is authored close to those numbers, so the
  // factor here is near one.
  hatch: 0.935 * PRESENCE,
};

/**
 * How wide the machine each silhouette evokes actually is.
 *
 * Width used to be a side effect. buildCar fits a car to the length on
 * its card with a UNIFORM scale, so a short car came out narrow and a
 * long one came out wide, in exact proportion — and real cars do not
 * work like that at all. A 3.95 m hatch and a 4.28 m hatch are within
 * 30 mm of each other across the doors; ours were 190 mm apart, and the
 * Sharq Hatch ended up 1.56 m wide, narrower across the body than a
 * Fiat 500. The saloons spread from 1.63 m to 1.89 m for the same
 * reason. Nobody chose any of those numbers.
 *
 * STYLE_SCALE's own comment on the gtr says it out loud — "the closest a
 * uniform scale can get this profile to 4.60 x 1.79 x 1.36" — because a
 * uniform scale has one degree of freedom and there are two numbers to
 * hit.
 *
 * So width gets its own fit. It is not simply held constant per
 * silhouette either: a longer car in a class IS a little wider, just
 * nothing like proportionally. The exponent is the whole law — 0 would
 * make every saloon exactly as wide as every other, 1 is the uniform
 * scale this replaces, and a third is what the real fleets do.
 */
export const STYLE_REAL: Record<BodyStyle, { l: number; w: number }> = {
  sedan: { l: 4.7, w: 1.8 },
  zx: { l: 4.31, w: 1.8 },
  gtr: { l: 4.6, w: 1.79 },
  rx7: { l: 4.3, w: 1.76 },
  hatch: { l: 4.28, w: 1.79 },
  pony: { l: 4.9, w: 1.88 },
};
export const WIDTH_FOLLOWS_LENGTH = 1 / 3;

/** The body width, across the doors, a car of this silhouette and this
 *  length should be built to. */
export function bodyWidthFor(style: BodyStyle, lengthM: number): number {
  const r = STYLE_REAL[style] ?? STYLE_REAL.sedan;
  return r.w * Math.pow(lengthM / r.l, WIDTH_FOLLOWS_LENGTH);
}

/** Per-silhouette anchor points so every detail lands on its body. */
interface StyleDims {
  nose: number;
  tail: number;
  /** Sunroof / antenna anchors on the roof panel: [z, y]. */
  roof: [number, number];
  noseTopY: number; // headlight centre height
  grilleY: number;
  beltY: number; // chrome beltline
  hoodY: number; // hood surface (shut lines, wipers)
  tailY: number; // tail light centre height
  deckY: number; // trunk deck (wing base)
  /** Side mirror: how far PROUD of the flank, then its height and how
   *  far forward. The first number used to be an absolute x, which meant
   *  it had to be re-derived by hand every time a body changed width. */
  mirror: [number, number, number];
  dashY: number;
  wiperZ: number;
  bPillar: [number, number, number];
  creaseY: number;
}
const STYLE_DIMS: Record<BodyStyle, StyleDims> = {
  sedan: {
    nose: 2.37, tail: -2.38, roof: [-0.2, 1.49], noseTopY: 0.7, grilleY: 0.52, beltY: 0.94,
    hoodY: 0.98, tailY: 0.78, deckY: 0.96, mirror: [0.03, 1.04, 0.82],
    dashY: 1.0, wiperZ: 0.93, bPillar: [0.77, 1.14, -0.2], creaseY: 0.72,
  },
  zx: {
    nose: 2.5, tail: -2.44, roof: [-0.53, 1.3], noseTopY: 0.56, grilleY: 0.42, beltY: 0.85,
    hoodY: 0.82, tailY: 0.66, deckY: 0.79, mirror: [0.03, 0.92, 0.4],
    dashY: 0.9, wiperZ: 0.5, bPillar: [0.8, 1.02, -0.75], creaseY: 0.6,
  },
  rx7: {
    nose: 2.44, tail: -2.32, roof: [-0.31, 1.34], noseTopY: 0.5, grilleY: 0.38,
    beltY: 0.8, hoodY: 0.72, tailY: 0.6, deckY: 0.76, mirror: [0.03, 0.9, 0.35],
    dashY: 0.86, wiperZ: 0.45, bPillar: [0.78, 0.98, -0.6], creaseY: 0.55,
  },
  gtr: {
    nose: 2.46, tail: -2.4, roof: [-0.18, 1.51], noseTopY: 0.76, grilleY: 0.5, beltY: 0.99,
    hoodY: 1.0, tailY: 0.84, deckY: 0.98, mirror: [0.03, 1.08, 0.85],
    dashY: 1.02, wiperZ: 0.95, bPillar: [0.79, 1.16, -0.16], creaseY: 0.76,
  },
  // The lamps sit high and the cabin sits forward: a hatch puts its
  // windscreen where a saloon puts its bonnet.
  hatch: {
    nose: 2.18, tail: -2.12, roof: [-0.3, 1.47], noseTopY: 0.76, grilleY: 0.56, beltY: 1.0,
    hoodY: 0.96, tailY: 0.84, deckY: 0.99, mirror: [0.03, 1.1, 0.86],
    dashY: 1.06, wiperZ: 1.12, bPillar: [0.78, 1.22, -0.32], creaseY: 0.76,
  },
  // Everything on this one sits LOW. The lamps are almost in the bumper,
  // the belt is under a metre, and the mirror is level with a saloon's
  // door handle.
  pony: {
    nose: 2.47, tail: -2.45, roof: [-0.44, 1.31], noseTopY: 0.5, grilleY: 0.38, beltY: 0.9,
    hoodY: 0.7, tailY: 0.78, deckY: 0.85, mirror: [0.03, 0.94, 0.62],
    dashY: 0.9, wiperZ: 0.6, bPillar: [0.73, 1.06, -0.52], creaseY: 0.6,
  },
};

/**
 * The rolling radius, in the CAR'S OWN units, before the silhouette's
 * scale and its length fit are applied.
 *
 * It is a contract rather than a number: ride height, wheel arches,
 * brake glow, skid marks and the authored GLB wheel are all dimensioned
 * against it (see public/models/README.md). Exported because something
 * outside this file has to know how fast to turn it, and guessing
 * produced a game whose wheels skidded.
 *
 * It was 0.36, and that was too small — measurably, not as a matter of
 * taste. tools/shots/wheels.mjs builds every car and divides its body
 * length by its wheel diameter, which is the ratio a real car fixes
 * within a narrow range whatever else about it changes:
 *
 *   Skyline R34 on 245/40R18   4600 / 653 = 7.0
 *   Supra A80 on 255/40R17     4514 / 636 = 7.1
 *   RX-7 FD on 225/50R16       4295 / 631 = 6.8
 *   Huracan on 305/30R20       4459 / 691 = 6.5
 *
 * Every car in this game came back at 8.05 — the same answer on all
 * sixteen, because the wheel was one fixed size and the bodies had been
 * fitted to real metres around it. 8.05 is a 4.5 m car on 560 mm
 * wheels, which is why they read as castors under it. The seven low
 * silhouettes were worse still on the other ratio: wheel diameter over
 * body height came out at 0.42 where a modern coupe is about 0.49.
 *
 * 0.41 puts the fleet at 7.07 and 0.48. The section below is unchanged —
 * it is still a real tyre's section — it is simply fitted to a bigger
 * wheel, which is what the whole SECTION_R / WHEEL_R_K pair exists to
 * express.
 */
export const TIRE_RADIUS = 0.375;

/*
 * Two things about the paragraph above, both measured since it was
 * written, for whoever comes at this next.
 *
 * The 7.07 is stale. It came from the measurement wheels.mjs was later
 * found to be making wrong — the body box counted the contact-shadow
 * decal and the whip aerial, inflating the car's length and flattering
 * the ratio. Corrected, the fleet sits at 6.13 to 6.15
 * length-over-diameter, one hundredth above the 6.1 floor that same tool
 * enforces. Real cars run 6.5 to 7.2 (a GT-R 6.5, a Golf 6.8, a Camry
 * 7.2), so the wheels are modestly LARGE and every car reads a little
 * stubby for it. That is a real deficit, not a rounding one.
 *
 * And it cannot be fixed by editing this number, which the comment above
 * implies it can because ARCH_Y and ARCH_MESH_Y are offsets from it.
 * Tried: 0.41 -> 0.375 puts length-over-diameter at a correct ~6.7 and
 * breaks 23 other measurements. dia/height drops under its band on seven
 * cars, and the arch gap goes out on all sixteen in BOTH directions at
 * once — 0.03 on the low silhouettes where the floor is 0.08, and 0.43 on
 * the tall ones where the ceiling is 0.3. The arch opening is cut into
 * the body, so moving the wheel down moves it into a different part of
 * each profile; the offsets keep the arch attached to the wheel, they do
 * not keep the CUT the right size. Trimming the wheels means re-cutting
 * the arches on all five silhouettes, which is a much larger job than
 * this constant makes it look.
 */

/**
 * How fat the tyre is, as a half width.
 *
 * It grows less than the radius does — 6% against 14%. That is not a
 * compromise, it is the constraint the same tool measured: the tyre's
 * outer wall already stands 10 to 20 mm proud of the bodywork over it,
 * which is flush fitment and looks right, and a tyre widened in
 * proportion to its new diameter would hang out of the arch instead.
 * The arch moves out by the same 8 mm to keep that gap where it was.
 */
export const TIRE_HALF_W = 0.1325;

/**
 * The radius and half width TIRE_SECTION below is AUTHORED at, and the
 * scale from there to the wheel actually fitted.
 *
 * Keeping the section in real millimetres and stating the fitment
 * separately means the profile stays readable as a tyre's profile — the
 * alternative, normalising every number to a fraction of the radius,
 * turns a bead at 218 mm into 0.6056 and makes the one thing this data
 * is FOR impossible to check by eye.
 *
 * Everything else in the wheel — barrel, spokes, hub, rotor, lugs — is
 * written the same way: the authored number, times the scale.
 */
const SECTION_R = 0.36;
const SECTION_HALF_W = 0.13;
const WHEEL_R_K = TIRE_RADIUS / SECTION_R;
const WHEEL_W_K = TIRE_HALF_W / SECTION_HALF_W;
export { WHEEL_R_K, WHEEL_W_K };

// The traffic tire: the same section, revolved coarsely.
//
// It used to be a bare barrel, which meant it read the tread band of the
// texture across its whole width and sampled the sidewall bands at its
// edges — hence the remapV(0.2, 0.8) that used to live here to shove the
// tread back into the middle. Sharing the hero's profile makes that
// unnecessary: the lathe puts the tread where the texture expects it,
// and a background car gets a shouldered tire for the same one draw.
//
// Declared after tireLathe, so the definition order is: section, lathe
// helper, then the two tires that use it.
let tireGeo: THREE.BufferGeometry;

/**
 * The hero tire, as a LATHED CROSS-SECTION rather than a barrel with two
 * rings stuck on it.
 *
 * What was here: a straight 30-segment cylinder for the tread and a
 * torus at each end for the shoulders. Three pieces, and it showed —
 * a cylinder meets its end cap at a hard ninety degrees, so the tread
 * had a machined edge with a separate doughnut floating beside it. No
 * tire has ever had that section. A tire is one continuous curve from
 * bead to bead: it rises off the rim, bulges out through the sidewall,
 * turns over a radiused shoulder and crowns very slightly across the
 * tread, and every one of those transitions is smooth.
 *
 * So: one profile, revolved. The numbers are a real tire's section.
 *
 *   The crown touches SECTION_R exactly and nothing else reaches it, so
 *   that after tireLathe scales the profile the outermost point of the
 *   tyre is TIRE_RADIUS to the millimetre. That is the contract — ride
 *   height, the wheel arches, the brake glow, the skid marks and the
 *   authored GLB wheel are all dimensioned against it, and a tyre that
 *   came out even a millimetre proud would lift every car in the game
 *   off its own shadow.
 *
 *   The half width is SECTION_HALF_W for the same reason, and the widest
 *   LATERAL point is the sidewall rather than the tread, which is what
 *   makes a tire look inflated instead of turned on a lathe.
 *
 * The UVs come out right for free. LatheGeometry runs v along the
 * profile, so laying the points out four / thirteen / four puts the
 * tread band at exactly v 0.2 to 0.8 — the same band the old three
 * pieces had to be remapped into by hand.
 */
const TIRE_SECTION: Array<[number, number]> = [
  // radius, axial — inner bead outward
  [0.218, -0.118], // bead, tucked onto the rim
  [0.258, -0.127],
  [0.298, -0.130], // the bulge: widest point of the whole tire
  [0.332, -0.122],
  [0.351, -0.101], // shoulder — tread band starts here (v = 0.2)
  [0.3572, -0.088],
  [0.3596, -0.074],
  [0.36, -0.058],
  [0.36, -0.038],
  [0.36, -0.019],
  [0.36, 0.0], // crown
  [0.36, 0.019],
  [0.36, 0.038],
  [0.36, 0.058],
  [0.3596, 0.074],
  [0.3572, 0.088],
  [0.351, 0.101], // shoulder — tread band ends here (v = 0.8)
  [0.332, 0.122],
  [0.298, 0.13],
  [0.258, 0.127],
  [0.218, 0.118],
];

function tireLathe(radialSegments: number): THREE.BufferGeometry {
  // Authored section, fitted wheel. Radially and axially by different
  // factors, because a tyre that gets 14% taller does not get 14% fatter
  // — see TIRE_HALF_W.
  const pts = TIRE_SECTION.map(
    ([r, y]) => new THREE.Vector2(r * WHEEL_R_K, y * WHEEL_W_K)
  );
  const g = new THREE.LatheGeometry(pts, radialSegments);
  // Lathe spins about Y; the axle is X.
  g.rotateZ(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

// 44 rather than 30. A 30-sided silhouette is 2 mm off a circle at this
// radius and the tire is the roundest thing on the car — it is the one
// place where faceting is read as faceting rather than as style.
const tireGeoHi = tireLathe(44);
// 22 for traffic — the cars behind you at a lane's distance, where the
// silhouette is a dozen pixels across and nobody has ever counted its
// sides.
tireGeo = tireLathe(22);
// Brake hardware behind the spokes — a wheel with nothing inside it
// reads as a toy the moment the camera drops low. Radially by
// WHEEL_R_K, axially by WHEEL_W_K: a bigger wheel gets a bigger disc,
// which is exactly what happens when a real car goes up a rim size and
// the reason people go up a rim size in the first place.
const discGeo = new THREE.CylinderGeometry(
  0.2 * WHEEL_R_K, 0.2 * WHEEL_R_K, 0.022 * WHEEL_W_K, 22
);
discGeo.rotateZ(Math.PI / 2);
const lugGeo = new THREE.CylinderGeometry(
  0.016 * WHEEL_R_K, 0.016 * WHEEL_R_K, 0.026 * WHEEL_W_K, 6
);
lugGeo.rotateZ(Math.PI / 2);
const discMat = new THREE.MeshStandardMaterial({ name: "disc",
  color: 0x9aa0a8,
  metalness: 0.9,
  roughness: 0.35,
  envMapIntensity: 1.2,
});
/**
 * The tire's surface.
 *
 * A tire was one flat colour at a single roughness, which at any distance
 * reads as a black rubber donut. Real rubber differs from that in three
 * ways, and all three are visible from the chase camera: the tread has a
 * pattern with actual depth, the sidewall is smoother and glossier than
 * the tread, and there is a shoulder where the two meet.
 *
 * One height field drives colour, roughness and normals together, so the
 * groove that shows in the picture is the same groove the streetlight
 * catches — three maps authored separately drift apart and read as dirt
 * rather than geometry.
 *
 * The image is ONE lateral block period wide and the whole tire width
 * tall, tiled around the circumference. `v` runs across the tire: outer
 * bands are sidewall, the middle is tread. The wheel's UVs are remapped
 * to match (see remapV), which is what lets the tread barrel and both
 * shoulder bulges read from the right part of one image — and so keeps
 * the tire a single mesh, which the authored-asset swap and the wheel
 * test both rely on.
 */
/** Lateral tread blocks around the tire. At a 2.26 m circumference this
 *  puts a block every ~12 cm, which is what a road tire actually runs. */
const TREAD_BLOCKS = 18;

let tireSurfShared: {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} | null = null;

function tireSurface() {
  if (tireSurfShared) return tireSurfShared;
  const W = 192;
  const H = 256;
  const h = new Float32Array(W * H);
  // Deterministic hash noise: a tire that is grainy differently on every
  // reload is a tire whose screenshots never match.
  const grain = (x: number, y: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const ridge = (t: number, c: number, w: number) => Math.max(0, 1 - Math.abs(t - c) / w);

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let e: number;
      if (v < 0.2 || v > 0.8) {
        // Sidewall: gently domed, carrying the fine concentric ribbing a
        // mould leaves, strongest out near the shoulder.
        const d = v < 0.5 ? v / 0.2 : (1 - v) / 0.2;
        e = 0.4 + 0.09 * Math.sin(v * 190) * (0.3 + 0.7 * d) + 0.08 * d;
      } else {
        // Tread: three circumferential grooves, and one lateral sipe per
        // tile raked across so the blocks are not a chequerboard.
        const t = (v - 0.2) / 0.6;
        e = 0.74;
        for (const c of [0.22, 0.5, 0.78]) e -= 0.55 * ridge(t, c, 0.055);
        const raked = (u + (t - 0.5) * 0.14 + 1) % 1;
        e -= 0.4 * Math.max(0, 1 - Math.abs(raked - 0.5) / 0.07);
        // Where the tread turns over the edge it breaks into shoulder
        // blocks — the part you actually see when the car is sideways.
        if (t < 0.12 || t > 0.88) {
          e -= 0.2 * Math.max(0, 1 - Math.abs(((u * 2) % 1) - 0.5) / 0.18);
        }
      }
      h[y * W + x] = Math.min(1, Math.max(0, e + (grain(x, y) - 0.5) * 0.05));
    }
  }

  const canvas = () => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c;
  };
  const colC = canvas();
  const rghC = canvas();
  const nrmC = canvas();
  const col = colC.getContext("2d")!.createImageData(W, H);
  const rgh = rghC.getContext("2d")!.createImageData(W, H);
  const nrm = nrmC.getContext("2d")!.createImageData(W, H);

  const at = (x: number, y: number) =>
    h[Math.min(H - 1, Math.max(0, y)) * W + ((x + W) % W)];

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const sidewall = v < 0.2 || v > 0.8;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const e = h[y * W + x];
      // Rubber is never pure black: it sits around 8-12% reflectance with
      // a faint blue-grey cast. Pure black reads as a hole in the frame.
      const base = sidewall ? 13 : 10;
      const lit = base + e * (sidewall ? 15 : 26);
      col.data[i] = lit * 0.98;
      col.data[i + 1] = lit;
      col.data[i + 2] = lit * 1.1;
      col.data[i + 3] = 255;
      // Sidewall rubber has a sheen; tread blocks are scuffed matte and
      // the groove floors, which never touch the road, rougher still.
      const r = sidewall ? 0.6 + (1 - e) * 0.14 : 0.86 + (1 - e) * 0.12;
      const rv = Math.round(Math.min(1, r) * 255);
      rgh.data[i] = rgh.data[i + 1] = rgh.data[i + 2] = rv;
      rgh.data[i + 3] = 255;
      // Normals by central difference on the same field.
      const dx = (at(x + 1, y) - at(x - 1, y)) * 3.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 3.2;
      const len = Math.hypot(dx, dy, 1);
      nrm.data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      nrm.data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      nrm.data[i + 2] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      nrm.data[i + 3] = 255;
    }
  }
  colC.getContext("2d")!.putImageData(col, 0, 0);
  rghC.getContext("2d")!.putImageData(rgh, 0, 0);
  nrmC.getContext("2d")!.putImageData(nrm, 0, 0);

  const map = new THREE.CanvasTexture(colC);
  const roughnessMap = new THREE.CanvasTexture(rghC);
  const normalMap = new THREE.CanvasTexture(nrmC);
  map.colorSpace = THREE.SRGBColorSpace;
  // Linear data, both of them. A roughness or normal map tagged sRGB is
  // silently decoded through the EOTF and comes out wrong — the same
  // trap the road surface fell into.
  roughnessMap.colorSpace = THREE.NoColorSpace;
  normalMap.colorSpace = THREE.NoColorSpace;
  for (const t of [map, roughnessMap, normalMap]) {
    // Around the circumference it tiles; across the width it must not,
    // or the sidewall wraps onto the opposite shoulder.
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(TREAD_BLOCKS, 1);
    t.anisotropy = 8; // read at a glancing angle, always
  }
  tireSurfShared = { map, normalMap, roughnessMap };
  return tireSurfShared;
}

/** Rewrite a geometry's V coordinates into the [lo, hi] band of the tire
 *  texture, so tread barrel and shoulders share one image. */
function remapV(geo: THREE.BufferGeometry, lo: number, hi: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, lo + uv.getY(i) * (hi - lo));
  uv.needsUpdate = true;
  return geo;
}

let tireMatShared: THREE.MeshStandardMaterial | null = null;
function getTireMat(): THREE.MeshStandardMaterial {
  if (tireMatShared) return tireMatShared;
  const s = tireSurface();
  tireMatShared = new THREE.MeshStandardMaterial({
    // Named, like every other material on the car. It was the one
    // unnamed material in the build, which meant every tool that groups
    // meshes by what they wear filed four tyres per car under
    // "unnamed" — and a tool measuring tyres could not find the tyre.
    name: "tire",
    map: s.map,
    normalMap: s.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: s.roughnessMap,
    color: 0xffffff,
    roughness: 1, // the map carries the real range
    metalness: 0,
    envMapIntensity: 2.4, // rubber picks up the night, faintly
  });
  return tireMatShared;
}

const rimGeo = new THREE.CylinderGeometry(
  0.205 * WHEEL_R_K, 0.205 * WHEEL_R_K, 0.27 * WHEEL_W_K, 14
);
rimGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(
  0.06 * WHEEL_R_K, 0.06 * WHEEL_R_K, 0.29 * WHEEL_W_K, 8
);
hubGeo.rotateZ(Math.PI / 2);
// x is along the axle here, so it takes the axial scale and the other
// two take the radial one.
const spokeGeo = roundedBox(
  0.27 * WHEEL_W_K, 0.3 * WHEEL_R_K, 0.06 * WHEEL_R_K, 0.018 * WHEEL_R_K
);
/**
 * The inside of the pipe.
 *
 * Darker than any tip finish and completely matte, because that is what
 * a bore is: unburnt fuel and carbon baked onto steel, in shadow, with
 * nothing to reflect. It is the only part of an exhaust that is the same
 * colour whatever the tip is made of — chrome, titanium and ceramic all
 * look identical two centimetres down the tube.
 */
const boreMat = new THREE.MeshStandardMaterial({
  name: "exhaust-bore",
  color: 0x0a0908,
  roughness: 1,
  metalness: 0,
  // Seen from OUTSIDE the cylinder's wall, because the camera is looking
  // down a tube at the far side of it. Without this the inner wall is
  // back-face culled and the pipe is a hole with nothing in it.
  side: THREE.BackSide,
});
/** The blind end of the bore, so a tip is a tube rather than a window
 *  through the bumper. Front-facing: this one is looked at directly. */
const boreCapMat = new THREE.MeshStandardMaterial({
  name: "exhaust-bore-cap",
  color: 0x080706,
  roughness: 1,
  metalness: 0,
});

/** Ceramic-coated race tip: matte black, soot-dulled. */
const ceramicTipMat = new THREE.MeshStandardMaterial({ name: "exhaust-tip-ceramic",
  color: 0x1a1a1c,
  roughness: 0.62,
  metalness: 0.35,
});
/** Titanium, burnt blue-violet at the tip the way heat leaves it. */
const titaniumTipMat = new THREE.MeshStandardMaterial({ name: "exhaust-tip-titanium",
  color: 0x6b7ea8,
  roughness: 0.3,
  metalness: 0.95,
  envMapIntensity: 1.4,
});
const rimMat = new THREE.MeshStandardMaterial({ name: "rim",
  color: 0xc8cdd4,
  roughness: 0.2,
  metalness: 0.95,
  envMapIntensity: 1.5,
});
/** A plastic wheel cover: grey, dull, and nothing like a machined face.
 *  Low metalness is the whole point — a hubcap that catches a highlight
 *  the way an alloy does is just a cheap-looking alloy. */
const hubcapMat = new THREE.MeshStandardMaterial({
  name: "hubcap",
  color: 0xa8adb4,
  roughness: 0.55,
  metalness: 0.15,
  envMapIntensity: 0.5,
});
const rimDarkMat = new THREE.MeshStandardMaterial({ name: "rim-dark",
  color: 0x23262b,
  roughness: 0.5,
  metalness: 0.6,
});

/**
 * The hubcap's dish: a shallow cone across most of the rim's face.
 *
 * Sized to the FITTED wheel like everything else in this section, so a
 * cover stays a cover when the wheel changes size rather than becoming
 * a saucer floating in front of one.
 */
const hubcapGeo = new THREE.CylinderGeometry(
  0.2 * WHEEL_R_K, 0.185 * WHEEL_R_K, 0.03 * WHEEL_W_K, 20
);
hubcapGeo.rotateZ(Math.PI / 2);

const lipGeo = new THREE.TorusGeometry(
  0.195 * WHEEL_R_K, 0.014 * WHEEL_R_K, 6, 20
);
lipGeo.rotateY(Math.PI / 2);
/**
 * Wheel arches.
 *
 * The body is one extruded shell with no opening cut in it, so the arch
 * has to be built ON its surface: a dark disc that reads as the shadowed
 * recess, and a body-coloured lip standing proud of it that reads as the
 * formed edge of the fender. The wheel's outer face sits at 0.97, past
 * both, which is what sells the opening.
 *
 * All of this used to be drawn at the WHEEL's centre rather than at the
 * body's surface: the lip spanned x 0.785-0.895 and the well sat at
 * 0.756, against a shell 0.92 wide. Every car in the game carried two
 * hidden meshes on each of its four corners, and the wheel read as a
 * hubcap glued to a flat painted wall.
 *
 * The front arch is the larger of the two and carries a flare, the way a
 * front fender is a wider panel than the rear quarter it runs back into.
 */
// How far outside the shell's own flank the opening and its lip sit.
// These were absolute numbers taken from the sedan's 0.92 half-width,
// which put both of them INSIDE the flank on the four wide silhouettes —
// the zx, rx7 and gtr shells run 0.96 to 0.98. Offsets from the shell's
// measured width work on every body.
// They also carry the tyre's extra half width, so that widening the
// tread did not simply push it out through the fender: the measured
// poke — how far the tyre's outer wall stands proud of the bodywork
// over it — stays where it was at 10 to 20 mm, which is flush fitment.
const TREAD_OUT = TIRE_HALF_W - SECTION_HALF_W;
const ARCH_OUT = 0.005 + TREAD_OUT;
const LIP_OUT = 0.009 + TREAD_OUT;
/**
 * How high the arch sits over the tyre.
 *
 * Measured before this was touched: the opening's top edge stood 165 mm
 * above the tyre at the front and 140 mm at the rear. A road car runs 40
 * to 90 mm, and a street car on this road runs less than that — 165 mm
 * is the gap of something with a lift kit, and it made every machine in
 * the showroom look like it was on stilts however low its roofline was.
 *
 * Two things were wrong at once and they added up. The arch was centred
 * 40 mm ABOVE the wheel centre, and its radius was 125 mm larger than
 * the tyre's. Real arches do sit a little above centre — the opening is
 * not concentric with the wheel — but nothing like the sum of those.
 *
 * The arch is now centred just above the wheel and radiused to leave
 * about 70 mm at the crown, which is what a car looks like sitting on
 * its own springs.
 *
 * All of it is now written as an OFFSET from TIRE_RADIUS rather than as
 * an absolute number, and additively rather than proportionally. That
 * choice is the whole reason a wheel could be made 14% bigger without
 * re-tuning any of this: an additive offset keeps the crown gap at
 * exactly the 70 mm this comment describes whatever the tyre's radius
 * is, where scaling the arch in proportion would have grown the gap by
 * 14% too and undone the fix.
 */
/** How far the arch centre sits above the axle. An opening is not
 *  concentric with its wheel; a real one rides a little high. */
const ARCH_RISE = 0.015;
const ARCH_Y = TIRE_RADIUS + ARCH_RISE;
/** Where the arch meshes sit, and how much bigger than the tyre each
 *  opening is. Front is the larger of the two. */
const ARCH_MESH_Y = TIRE_RADIUS + 0.04;
const ARCH_R_R = TIRE_RADIUS + 0.04;
const ARCH_R_F = TIRE_RADIUS + 0.055;
// 44 segments, not 22. At 22 the well's rim moved in ~114 mm chords —
// 16 degrees per facet on the one curve the eye traces around every
// wheel — while the body shells hold themselves to ~5.5 mm per facet.
const archWellGeo = new THREE.CircleGeometry(TIRE_RADIUS + 0.025, 44);
const archWellGeoF = new THREE.CircleGeometry(ARCH_R_R, 44);
// A rolled panel edge, not a hoop. The first pass used a 0.03-0.038 tube
// standing 18 mm proud and it read as a roll bar bolted over the wheel;
// a real arch lip is a few millimetres of turned-over steel that catches
// one thin highlight.
// 60/64 tubular segments over the half-turn (was 28/30 — 45 mm facets
// catching that "one thin highlight" as a string of straight glints),
// and 12 radial so the rolled edge is round in section. The radii, the
// tube sizes and every mesh position are untouched: the bounding
// extremes land on exact vertices under both old and new counts, so
// nothing measured moves.
const archLipGeo = new THREE.TorusGeometry(ARCH_R_R, 0.016, 12, 60, Math.PI);
archLipGeo.rotateY(Math.PI / 2);
const archLipGeoF = new THREE.TorusGeometry(ARCH_R_F, 0.021, 12, 64, Math.PI);
// The outer edge of each arch — the lip's radius plus its tube — and the
// height its centre sits at. Anything running along the flank has to
// stop here, so the numbers are named rather than repeated.
const ARCH_EDGE_F = ARCH_R_F + 0.021;
const ARCH_EDGE_R = ARCH_R_R + 0.016;
archLipGeoF.rotateY(Math.PI / 2);
const wellMat = new THREE.MeshBasicMaterial({ name: "arch-well", color: 0x060708 });

/**
 * The wide-body kit: over-fenders, and the track to fill them.
 *
 * A wide body is not a re-stamped door skin. Nobody widens a car by
 * making the doors wider — they rivet a flare over the arch and run more
 * wheel offset, and the door between the arches is the panel it always
 * was. That is exactly what this build wants to hear, because `flankX`
 * is measured off the shell (see the comment where it is taken) and
 * every detail on the flank is an offset from it. Widen the shell and
 * all of that has to be re-measured; bolt a flare over the arch and
 * none of it moves.
 *
 * `proud` is how far the flare's outermost paint stands past the door
 * skin, per side. The ceiling is not taste, it is measured:
 * tests/size.mjs allows an arch 0.1 m proud of the doors per side and
 * requires the mirrors to stay the widest thing on the car, and the
 * mirrors sit at flankX + 0.11. So 0.086 is the widest arch this game
 * can have without the mirrors disappearing inside the bodywork.
 *
 * `track` pushes each wheel outward to fill the new arch. It cannot
 * simply match `proud` — the same test requires the tyre to stay inside
 * the arch within 0.12 m, and the wheel already stands 0.068 proud of
 * the flank at its lugs. Half the flare is about right and leaves the
 * tyre tucked under the lip, which is what a fitted arch looks like.
 *
 * The tube radius is what does the standing-proud, so the flare is
 * positioned inboard of its own outer face by exactly that.
 */
export interface WideSpec {
  /** Outermost paint, past the door skin, per side (metres). */
  proud: number;
  /** How much further out each wheel sits (metres). */
  track: number;
  /** Rivets around each arch. Zero for a moulded street flare, which is
   *  bonded and painted rather than bolted on. */
  rivets: number;
}

export const WIDE: Record<KitLevel, WideSpec> = {
  // A street flare is a modest bonded lip — the arch looks fuller and
  // nothing about the car says workshop.
  //
  // Each level grew by the same amount on BOTH numbers — +8, +17 and
  // +26 mm — which is the only direction this table can safely move.
  // proud is where the flare stands and track is where the tyre stands,
  // so equal deltas keep the measured 40-90 mm poke exactly where the
  // fitment tool passed it, while the whole car plants wider: an attack
  // build now carries 112 mm of arch and 70 mm of track per side, which
  // reads as a widebody instead of a trim ring.
  street: { proud: 0.042, track: 0.02, rivets: 0 },
  // A sport arch is a bolt-on with the fasteners showing.
  sport: { proud: 0.077, track: 0.045, rivets: 7 },
  // And the attack arch is as wide as the rules of this game allow —
  // literally: tests/size.mjs holds every flare to 0.1 m per side of
  // the doors, and the first draft of this widening put the Storm S8 at
  // 0.107. 0.104 raw landed at 0.099 after the car's own scale — one
  // millimetre under, which stopped being enough the moment the doors
  // were fitted to a real width: the Storm's skin came out 62 mm wider
  // and carried its own flare out with it, to 0.102. A flare is authored
  // in the car's own units and a wider car has a proportionally wider
  // one, so the fix is here rather than in the ceiling. 0.100 raw lands
  // at 0.096 on the widest car that wears this kit; the track keeps the
  // same 42 mm offset so the measured poke does not move.
  attack: { proud: 0.1, track: 0.062, rivets: 9 },
};

/** How much of `proud` is the tube itself. The rest is standoff, so the
 *  flare reads as a separate piece sitting over the arch rather than as
 *  a fat lip growing out of it. */
const FLARE_TUBE_FRAC = 0.62;

/**
 * A flare traces the SAME arc as the arch lip it sits over — same radius,
 * same half-turn — just fatter and further out. Tracing a different curve
 * is what made the first attempt at this read as scaffolding: two arches
 * over one wheel, disagreeing about where the wheel was.
 *
 * Six of them (three kit levels x front/rear), built once and shared,
 * the way every other shell in this file is.
 */
const flareGeoCache = new Map<string, THREE.BufferGeometry>();
function flareGeo(kit: KitLevel, front: boolean): THREE.BufferGeometry {
  const key = `${kit}:${front ? "f" : "r"}`;
  const hit = flareGeoCache.get(key);
  if (hit) return hit;
  const tube = WIDE[kit].proud * FLARE_TUBE_FRAC;
  // The same counts as the lip each flare sits over, raised with it:
  // the measured rule here is that flare and lip must trace the same
  // arc — "two arcs that agree about where the wheel is read as one
  // fender" — and that now includes agreeing about the tessellation.
  // The flare tube is two to four times fatter than the lip's, so
  // smoothing only the lip would have left the WORST faceting on the
  // most visible torus of every kitted car.
  const geo = new THREE.TorusGeometry(
    front ? ARCH_R_F : ARCH_R_R,
    tube,
    12,
    front ? 64 : 60,
    Math.PI
  );
  geo.rotateY(Math.PI / 2);
  flareGeoCache.set(key, geo);
  return geo;
}

/** One rivet head. Shared across every arch on every car. */
const rivetGeo = new THREE.SphereGeometry(0.011, 6, 5);
// The hot-hatch nose stripe: painted red, not a lamp, but it carries a
// little glow so it still reads at night when nothing is lighting the
// bumper directly.
const hotStripeMat = new THREE.MeshStandardMaterial({ name: "hot-stripe",
  color: 0xc8102e,
  roughness: 0.35,
  emissive: 0x3a0409,
  emissiveIntensity: 0.6,
});

/**
 * Where the painted skin actually is.
 *
 * A style's anchors are the control points of its 2D profile. The
 * extrusion then bevels that profile, and the spline bows between the
 * points, so the surface ends up tens of millimetres away from the
 * anchor — outward at the nose, upward over the deck. Detail placed by
 * eye at "anchor, minus a bit" therefore kept landing inside the
 * bodywork: the Z32's entire headlight bar, both pop-up lamps and their
 * doors on the FD, the cooling slot on both cab-back noses, the third
 * brake light on the fastbacks, the front plate on the FD.
 *
 * So stop guessing and ask the geometry. Fire one ray at the shell from
 * outside the car; the first hit is the skin. Memoised on the geometry
 * and the ray, because the shells are module-level and shared — this
 * runs a handful of times for the life of the process, not once per car.
 */
const surfaceCache = new Map<string, number | null>();
function shellSurface(
  geo: THREE.BufferGeometry,
  key: string,
  from: [number, number, number],
  dir: [number, number, number]
): number | null {
  const cached = surfaceCache.get(key);
  if (cached !== undefined) return cached;
  const probe = new THREE.Mesh(geo);
  probe.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(from[0], from[1], from[2]),
    new THREE.Vector3(dir[0], dir[1], dir[2]).normalize()
  );
  const hit = ray.intersectObject(probe, false)[0];
  // A miss means the caller aimed off the body, which is its bug to fix.
  // Returning null lets it fall back to the old constant rather than
  // flinging the part to infinity.
  const at = hit
    ? dir[1] !== 0
      ? hit.point.y
      : dir[2] !== 0
        ? hit.point.z
        : hit.point.x
    : null;
  surfaceCache.set(key, at);
  return at;
}
/** The body's outer face at a height, on the centreline, front or rear. */
function noseFaceZ(geo: THREE.BufferGeometry, style: BodyStyle, y: number, front: boolean): number | null {
  const far = front ? 6 : -6;
  return shellSurface(geo, `${style}:z${front ? "+" : "-"}${y}`, [0, y, far], [0, 0, front ? -1 : 1]);
}
/** A panel's upper surface at a point along the car, on the centreline.
 *  `tag` names which panel, so the roof and the body do not share a
 *  cache entry when they are asked about the same z. */
function deckY(geo: THREE.BufferGeometry, style: BodyStyle, z: number, tag = "body"): number | null {
  return shellSurface(geo, `${style}:${tag}:y${z}`, [0, 6, z], [0, -1, 0]);
}
/** The same, off the centreline: the skin above a point on the car.
 *  A cabin is asked about at the DRIVER's x, not at x=0, because the
 *  crown pulls a roof in toward its edges and the difference over half a
 *  seat's width is tens of millimetres — the whole of a head's
 *  clearance. */
function skinAt(
  geo: THREE.BufferGeometry,
  style: BodyStyle,
  x: number,
  z: number,
  tag: string
): number | null {
  return shellSurface(geo, `${style}:${tag}:y${x}/${z}`, [x, 6, z], [0, -1, 0]);
}

// Tinted glass, not a mirror. The intent here was always to silhouette
// the interior, but metalness 0.9 made the surface behave like polished
// chrome: a metal has no diffuse transmission, so the reflection won
// every pixel and the cabin was a black box with a driver invisible
// inside it. Glass is a dielectric — metalness near zero, a real index
// of refraction, and enough transparency to see a shape through.
const glassMat = new THREE.MeshPhysicalMaterial({ name: "glass",
  color: 0x121722,
  roughness: 0.05,
  metalness: 0.12,
  ior: 1.5,
  envMapIntensity: 1.35,
  transparent: true,
  opacity: 0.62,
});

/**
 * Window tint, as a material.
 *
 * Two things have to move together or it does not read as tint.
 *
 * OPACITY is what you cannot see through. Factory glass shows the
 * interior, the seats, the driver's shoulders; limo black shows a
 * shape. Raising opacity alone gets most of the way there.
 *
 * COLOUR is the half people forget. Real tint film is a neutral-to-warm
 * grey laid over glass that is already blue-green, and it kills the
 * blue: a heavily tinted window is not a darker version of a light one,
 * it is a different colour. Darkening the existing 0x121722 without
 * pulling the blue out gives you a car with navy windows, which is what
 * a cheap tint job actually looks like and not what anyone is buying.
 *
 * Reflectivity comes up a little too, because a tinted window shows you
 * the street instead of the cabin — that is most of why they look the
 * way they do from outside.
 */
function tintedGlass(tintPct: number): THREE.MeshPhysicalMaterial {
  const t = Math.max(0, Math.min(100, tintPct)) / 100;
  const m = glassMat.clone();
  // 0.62 factory to 0.96 at full: never quite 1, because a window that
  // is completely opaque stops being glass and becomes a painted panel.
  m.opacity = 0.62 + t * 0.34;
  // Toward a neutral charcoal as the film goes on.
  m.color = new THREE.Color(0x121722).lerp(new THREE.Color(0x0b0b0c), t);
  m.envMapIntensity = 1.35 + t * 0.5;
  m.roughness = 0.05 + t * 0.02;
  return m;
}

const seamMat = new THREE.MeshStandardMaterial({ name: "seam", color: 0x0a0b0d, roughness: 0.85 });
// Panel gaps read almost black and swallow light — that contrast against
// the lit chamfer beside them is what sells a shut line.
const gapMat = new THREE.MeshStandardMaterial({ name: "panel-gap", color: 0x050506, roughness: 1 });
const interiorMat = new THREE.MeshStandardMaterial({ name: "interior", color: 0x14161a, roughness: 0.95 });
const indicatorMat = new THREE.MeshStandardMaterial({ name: "indicator",
  color: 0xffa020,
  emissive: 0xff8c1a,
  emissiveIntensity: 0.8,
});
const reverseMat = new THREE.MeshStandardMaterial({ name: "reverse-lamp",
  color: 0xd8d8d8,
  emissive: 0xbbbbbb,
  emissiveIntensity: 0.3,
});
const caliperMat = new THREE.MeshStandardMaterial({ name: "caliper", color: 0xb01818, roughness: 0.5 });
const towHookMat = new THREE.MeshStandardMaterial({
  name: "tow-hook",
  color: 0xc42020,
  roughness: 0.45,
});
// Big-brake teal — the time-attack kit's signature peeking through bronze
const tealCaliperMat = new THREE.MeshStandardMaterial({ name: "caliper-race",
  color: 0x18b09a,
  roughness: 0.4,
  emissive: 0x073b33,
  emissiveIntensity: 0.3,
});
// Forged bronze, matte like a shot-peened TE37 — not jewellery gold
const bronzeRimMat = new THREE.MeshStandardMaterial({ name: "rim-bronze",
  color: 0x9c6b2f,
  roughness: 0.45,
  metalness: 0.85,
  envMapIntensity: 1.2,
});
// Dry carbon for the aero: near-black, a hint of weave sheen
/**
 * A thin strip of surface that FOLLOWS a surface.
 *
 * The first version of the carbon panels was a row of pitched boxes,
 * which is the trick the racing stripes use — and it does not survive
 * being made wide. A box can only take one angle over its whole length,
 * so on anything curved consecutive boxes meet at their corners and the
 * panel becomes a staircase; the pitch is clamped as well, so on a steep
 * run they stay flat and stand proud of the paint. At the stripe's 46 cm
 * that reads as a stripe. At a bonnet's 1.3 m it read as nine steps
 * hovering over the boot, which is what the first render showed.
 *
 * A ribbon has no such problem, because its VERTICES are on the surface:
 * it is sampled rather than approximated, so it lies flush by
 * construction however the panel underneath curves.
 *
 * UVs are in metres, so the weave comes out the same size on a hatch's
 * bonnet and a saloon's roof rather than being stretched to fit each.
 */
function surfaceRibbon(
  zRear: number,
  zFront: number,
  halfW: number,
  lift: number,
  topAt: (z: number) => number,
  steps = 24
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const span = zFront - zRear;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = zRear + span * t;
    const y = topAt(z) + lift;
    pos.push(-halfW, y, z, halfW, y, z);
    const v = t * Math.abs(span);
    uv.push(0, v, halfW * 2, v);
    if (i < steps) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A carbon twill, drawn rather than described.
 *
 * The kit pieces in this game have been "carbon" since the kit existed,
 * and what that meant was a flat dark grey box — which is what carbon
 * looks like when nobody drew the cloth. Real 2x2 twill is two families
 * of tows crossing at right angles, and the thing that makes it read as
 * carbon at a glance is not the colour: it is that the two families
 * catch the light at ninety degrees to each other, so half the weave is
 * bright while the other half is dark, and which half swaps as the car
 * turns.
 *
 * So the weave is a NORMAL map and not a colour map. A painted-on
 * checkerboard is flat under every light in the scene; a normal map
 * makes the tows shift as the sun crosses them, which is the whole
 * effect. The colour stays the near-black the resin actually is.
 *
 * Built once, lazily, and shared: it is the same cloth on every car, and
 * a 128px tile repeated is indistinguishable from a large one at any
 * distance this game ever draws a car from.
 */
let weaveTex: THREE.Texture | null = null;
function carbonWeave(): THREE.Texture | null {
  if (weaveTex) return weaveTex;
  if (typeof document === "undefined") return null; // no DOM: traffic on a server
  const N = 128;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  if (!g) return null;
  // Flat normal is (0.5, 0.5, 1) in RGB — no tilt anywhere — and the
  // tows are drawn as tilts away from it.
  g.fillStyle = "#8080ff";
  g.fillRect(0, 0, N, N);
  const TOW = N / 8; // eight tows across the tile, which is 2x2 twill
  for (let ty = 0; ty < 8; ty++) {
    for (let tx = 0; tx < 8; tx++) {
      // 2x2 twill: the float steps one tow along on each successive row,
      // which is what gives carbon its diagonal.
      const warpOnTop = ((tx + ty) & 3) < 2;
      const x = tx * TOW, y = ty * TOW;
      // A tow is a rounded ridge, so its normal sweeps from one edge to
      // the other across its width. Drawn as a gradient along whichever
      // axis the tow runs ACROSS.
      const grad = warpOnTop
        ? g.createLinearGradient(x, 0, x + TOW, 0)
        : g.createLinearGradient(0, y, 0, y + TOW);
      if (warpOnTop) {
        grad.addColorStop(0, "#3a3aff");   // tilted left
        grad.addColorStop(0.5, "#8080ff"); // crown, flat
        grad.addColorStop(1, "#c6c6ff");   // tilted right
      } else {
        grad.addColorStop(0, "#80c6ff");
        grad.addColorStop(0.5, "#8080ff");
        grad.addColorStop(1, "#803aff");
      }
      g.fillStyle = grad;
      g.fillRect(x, y, TOW, TOW);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  weaveTex = t;
  return t;
}

const carbonMat = new THREE.MeshStandardMaterial({ name: "carbon",
  color: 0x101215,
  roughness: 0.35,
  metalness: 0.55,
  envMapIntensity: 1.1,
});

/**
 * The bodywork version of the same cloth.
 *
 * Separate from carbonMat because a panel is not a wing: a bonnet is
 * lacquered over the weave and a diffuser usually is not, so this one
 * carries a clearcoat and reads wetter. The weave is attached here
 * rather than on carbonMat so that a car with no carbon package does not
 * pay for a texture upload it never shows.
 */
let carbonPanelMatCache: THREE.MeshStandardMaterial | null = null;
function carbonPanelMat(): THREE.MeshStandardMaterial {
  if (carbonPanelMatCache) return carbonPanelMatCache;
  const m = new THREE.MeshStandardMaterial({
    name: "carbon-panel",
    color: 0x0c0e11,
    roughness: 0.22,
    metalness: 0.45,
    envMapIntensity: 1.35,
  });
  const w = carbonWeave();
  if (w) {
    m.normalMap = w;
    // Shallow. A weave that stands proud enough to see from the pavement
    // is a weave nobody wove — the tows are half a millimetre.
    m.normalScale = new THREE.Vector2(0.55, 0.55);
  }
  carbonPanelMatCache = m;
  return m;
}

// Smoked lamp housing: the dark bezel the lenses live in. The contrast
// between this and the lit lens is what makes a lamp read as an assembly
// instead of a painted-on rectangle.
const housingMat = new THREE.MeshStandardMaterial({ name: "lamp-housing",
  color: 0x17090b,
  roughness: 0.25,
  metalness: 0.5,
  envMapIntensity: 1.2,
});
// Passive rear reflectors: catch light, never emit
const reflectorMat = new THREE.MeshStandardMaterial({ name: "reflector",
  color: 0x7a1016,
  roughness: 0.25,
  metalness: 0.3,
  emissive: 0x30060a,
  emissiveIntensity: 0.4,
});
const amberReflectorMat = new THREE.MeshStandardMaterial({ name: "reflector-amber",
  color: 0xa66414,
  roughness: 0.25,
  emissive: 0x5a3208,
  emissiveIntensity: 0.4,
});

/**
 * The lens. Deliberately calmer than it was.
 *
 * At 2.6 every headlamp on every car clipped to flat white and then
 * bloomed, so the shape of the lamp — which is most of what tells one
 * car's face from another's — was gone before it reached the screen.
 * The tail lamps were rebuilt as three-layer assemblies a while back and
 * carry their lens at 2.0 with a hotter core inside it; this brings the
 * heads to the same standard rather than leaving one end of every car
 * built to a different one.
 */
const headlightMat = new THREE.MeshStandardMaterial({ name: "headlamp-lens",
  color: 0xffffff,
  emissive: 0xfff6cf,
  emissiveIntensity: 1.7,
});
/** The projector inside the lens: small, hot, and the only part that is
 *  allowed to blow out. A lamp with a focal point reads as a lamp; a
 *  uniform slab reads as a strip of tape. */
const headCoreMat = new THREE.MeshStandardMaterial({ name: "headlamp-core",
  color: 0xffffff,
  emissive: 0xffffff,
  emissiveIntensity: 4.2,
});
const grilleMat = new THREE.MeshStandardMaterial({ name: "grille", color: 0x0e0f12, roughness: 0.6 });
const chromeMat = new THREE.MeshStandardMaterial({ name: "chrome",
  color: 0xd8dde3,
  roughness: 0.12,
  metalness: 1,
  envMapIntensity: 1.6,
});


/*
 * METALLIC FLAKE AND ORANGE PEEL: TRIED, MEASURED, REMOVED.
 *
 * Both were built — a sparse platelet field for the flake, value noise
 * for the peel, each turned into a normal map by finite difference — and
 * both did precisely nothing, which took four measurements to establish
 * and is worth writing down so nobody builds them again.
 *
 * With the maps on and off, the mean luma gradient across the body
 * panels was 7.93 and 7.94. Forcing the normal scale from 0.28 to 4 —
 * fourteen times — moved it from 8.64 to 8.65. Coarsening the flake
 * repeat from 38 to 3, in case minification was averaging it away,
 * moved it to 8.59. And forcing the body colour to red moved it from
 * 8.63 to 5.37, which is how it is known that the override path worked
 * and the maps were the thing doing nothing.
 *
 * The reason is the same one that made the buildings blurry, seen from
 * the other side: a mirror can only show you detail that exists in what
 * it is reflecting. This car is lit almost entirely by an image-based
 * environment which is a smooth gradient dome plus eight small lamps.
 * Perturbing a surface normal by a fraction of a degree samples a
 * near-identical part of a near-uniform image, so nothing changes.
 * Flake sparkles in real life because the world is full of small hard
 * light sources; here there are eight, and they are 34 m away.
 *
 * No micro-surface trick can fix that — roughness variation integrates a
 * constant over a wider lobe and gets the same constant back. What would
 * fix it is a busier environment, which is a much larger change than a
 * texture, and not one to make by accident while adjusting paint.
 */


function plateTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f2f3f5";
  ctx.fillRect(0, 0, 128, 32);
  ctx.strokeStyle = "#888";
  ctx.strokeRect(1, 1, 126, 30);
  ctx.fillStyle = "#16191e";
  ctx.font = `700 19px ${latinDisplay()}`;
  ctx.textAlign = "center";
  ctx.fillText("KWT 8198", 64, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// ------------------------------------------------------------- stickers
/**
 * How far under the crease the flank wordmark hangs, and how tall it is.
 *
 * Named because two things need them: the wordmark itself, and the
 * full-length graphic that has to stay clear of it. Measured on the
 * fleet, the wordmark's bottom edge IS the floor of the rally pack —
 * 0.222 m on the rx7 up to 0.432 on the gtr — so a second copy of these
 * numbers somewhere else would be a clearance rule that silently stops
 * being true the first time the wordmark moves.
 */
const WORDMARK_DROP = 0.22;
const WORDMARK_H = 0.215;
/** The beltline stripe's lane: how far under the beltline it sits, and
 *  how deep it is. The full-length graphic uses the same lane, because a
 *  side graphic belongs where the eye is — see the note at its
 *  placement. */
const BELT_STRIPE_DROP = 0.16;
const BELT_STRIPE_H = 0.14;

// The rally pack. Canvas-drawn, cached, and deliberately brand-free —
// a roundel, a beltline stripe, an abstract falcon swoosh and the flag.

const roundelCache = new Map<number, THREE.CanvasTexture>();
function roundelTexture(num: number): THREE.CanvasTexture {
  const hit = roundelCache.get(num);
  if (hit) return hit;
  // 512, not 256. This decal is 440 mm across on a car the player spends
  // the whole game two metres behind, and at 256 the number's edges were
  // the softest thing on the machine — every panel gap around it was
  // sharper than the digit it framed.
  const S = 512;
  // textTexture, not a bare canvas: the Arabic-Indic twin under the
  // number is drawn with the Arabic face, and a texture rasterised
  // before that font arrives bakes the fallback in permanently. Every
  // decal in this pack had that bug; the flags module was built to avoid
  // it and the stickers never got the same treatment.
  const tex = textTexture(S, S, (ctx) => {
    ctx.clearRect(0, 0, S, S);
    const c2 = S / 2;
    // A rally roundel has to read against ANY paint. White on a white
    // car and black on a black one both vanish, so the disc gets a dark
    // ring AND a light keyline outside it: whichever way the paint goes,
    // one of the two edges separates.
    ctx.beginPath();
    ctx.arc(c2, c2, S * 0.474, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = S * 0.028;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c2, c2, S * 0.452, 0, Math.PI * 2);
    ctx.fillStyle = "#f6f6f2";
    ctx.fill();
    ctx.lineWidth = S * 0.042;
    ctx.strokeStyle = "#15161a";
    ctx.stroke();
    ctx.fillStyle = "#15161a";
    ctx.textAlign = "center";
    // Heavier and larger than it was: 800 weight at 0.5 of the disc
    // rather than 700 at 0.46. A door number is the one piece of type on
    // a car that is meant to be read from another car.
    ctx.font = `800 ${Math.round(S * 0.5)}px ${latinDisplay()}`;
    ctx.fillText(String(num), c2, S * 0.615);
    const arDigits = "٠١٢٣٤٥٦٧٨٩";
    const ar = String(num).split("").map((d) => arDigits[+d]).join("");
    ctx.font = `700 ${Math.round(S * 0.17)}px ${arabicUI()}`;
    ctx.fillText(ar, c2, S * 0.82);
  });
  tex.anisotropy = 16;
  roundelCache.set(num, tex);
  return tex;
}

let beltStripeTex: THREE.CanvasTexture | null = null;
function beltStripeTexture(): THREE.CanvasTexture {
  if (beltStripeTex) return beltStripeTex;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 64);
  // Twin racing stripe with a swept tail at both ends
  const band = (y: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(26, y);
    ctx.lineTo(486, y);
    ctx.lineTo(506, y + h / 2);
    ctx.lineTo(486, y + h);
    ctx.lineTo(26, y + h);
    ctx.lineTo(6, y + h / 2);
    ctx.closePath();
    ctx.fill();
  };
  band(10, 20, "#f2f4f7");
  band(38, 14, "#c1121f");
  beltStripeTex = new THREE.CanvasTexture(c);
  beltStripeTex.colorSpace = THREE.SRGBColorSpace;
  beltStripeTex.anisotropy = 8;
  return beltStripeTex;
}

/**
 * A decal strip that FOLLOWS the body instead of floating in front of it.
 *
 * Every other sticker in this pack is a flat PlaneGeometry hung a
 * centimetre off the flank, which is fine for something the size of a
 * door roundel: over 340 mm the body is near enough flat. A full-length
 * graphic is not. It runs the whole car, and a car is widest at the
 * doors and tapers into the nose and the tail — hold a plane at the
 * widest half-width and its ends hang in mid air outside the bodywork;
 * push it in far enough to stay buried at the ends and it disappears
 * inside the doors.
 *
 * So the shell is asked where its surface actually is. Two rays per
 * sample column, at the top and bottom edge of the strip, fired inward
 * from well outside the car; the ribbon is built through the hits with a
 * small standoff. Columns where the ray finds nothing are dropped, which
 * is what makes the run self-limiting: the graphic reaches exactly as far
 * as there is body to carry it, on whichever silhouette it is put on,
 * without a table of per-body lengths to keep in step.
 *
 * Returns null if the band is off the body entirely — the caller is
 * expected to check rather than add an empty mesh.
 */
function flankRibbon(
  shell: THREE.Mesh,
  side: 1 | -1,
  zA: number,
  zB: number,
  yMid: number,
  height: number,
  standoff: number,
  samples = 96
): THREE.BufferGeometry | null {
  const ray = new THREE.Raycaster();
  ray.far = 60;
  const dir = new THREE.Vector3(-side, 0, 0);
  const org = new THREE.Vector3();
  const yTop = yMid + height / 2;
  const yBot = yMid - height / 2;
  const surfaceX = (y: number, z: number): number | null => {
    org.set(side * 30, y, z);
    ray.set(org, dir);
    const hits = ray.intersectObject(shell, false);
    return hits.length ? hits[0].point.x : null;
  };
  const cols: { z: number; xt: number; xb: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const z = zA + ((zB - zA) * i) / samples;
    const xt = surfaceX(yTop, z);
    const xb = surfaceX(yBot, z);
    if (xt === null || xb === null) continue;
    cols.push({ z, xt, xb });
  }
  if (cols.length < 2) return null;

  const n = cols.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const zFirst = cols[0].z, zLast = cols[n - 1].z;
  const span = zLast - zFirst || 1;
  for (let i = 0; i < n; i++) {
    const c = cols[i];
    const off = side * standoff;
    pos[i * 6 + 0] = c.xt + off; pos[i * 6 + 1] = yTop; pos[i * 6 + 2] = c.z;
    pos[i * 6 + 3] = c.xb + off; pos[i * 6 + 4] = yBot; pos[i * 6 + 5] = c.z;
    // u runs 0 at the tail to 1 at the nose so the artwork's point lands
    // on the front wing whichever way the samples were walked.
    const u = (c.z - zFirst) / span;
    uv[i * 4 + 0] = u; uv[i * 4 + 1] = 1;
    uv[i * 4 + 2] = u; uv[i * 4 + 3] = 0;
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, dd = (i + 1) * 2 + 1;
    // Wound so the face looks OUTWARD on the side it is on: a decal
    // showing its back is invisible under a FrontSide material, and the
    // two flanks mirror, so the order has to flip with them.
    //
    // These two were the wrong way round and the render is what caught
    // it. With (a, b, c) on the right-hand side the cross product of
    // (b - a) and (c - a) is (-h*dz, 0, h*dx) — pointing INTO the car —
    // so the whole graphic faced inwards and all but vanished while
    // every number the geometry test printed stayed green. Position was
    // right; facing is not a position.
    if (side > 0) { idx.push(a, c, b, b, c, dd); }
    else { idx.push(a, b, c, b, dd, c); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

let fullStripeTex: THREE.CanvasTexture | null = null;
/**
 * The full-length side graphic: one sticker from the nose to the tail.
 *
 * Long and thin, so the canvas is too — 2048 by 96. This decal covers
 * about 4.6 metres of bodywork, and the beltline stripe's 512 would put
 * 111 texels on a metre of it, a quarter of what the door roundel gets.
 * At 2048 it is 445 to the metre and the diagonal cuts stay cuts instead
 * of turning into staircases.
 *
 * u=0 is the tail and u=1 the nose, so the wedge is deepest at the left
 * of the canvas and comes to its point at the right. The taper is not
 * linear: it holds full depth across the rear quarter and the door, then
 * falls away over the front wing, which is the difference between a
 * racing graphic and a triangle. Two colours and a hairline, no type —
 * this runs over five silhouettes and any wordmark would be legible on
 * one of them and squashed on the rest.
 */
function fullStripeTexture(): THREE.CanvasTexture {
  if (fullStripeTex) return fullStripeTex;
  const W = 2048, H = 96;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);
  // Holds full depth further forward than it first did, and tapers to a
  // sliver rather than to nothing. At hold 0.42 falling to zero, the
  // front half of the car was carried by the hairline alone, so on a
  // navy car the graphic read as a stripe over the rear quarter and the
  // "full length" of it was invisible. It ends at 0.14 of its depth: a
  // point that reaches the headlight, which is what a side graphic does.
  const depth = (u: number): number => {
    const t = Math.max(0, Math.min(1, u));
    const hold = 0.5;
    if (t <= hold) return 1;
    const k = (t - hold) / (1 - hold);
    return 0.14 + 0.86 * Math.max(0, 1 - k * k * (3 - 2 * k));
  };
  const wedge = (top: number, bot: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, top);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, bot - (bot - top) * depth(x / W));
    ctx.lineTo(W, bot);
    ctx.lineTo(0, bot);
    ctx.closePath();
    ctx.fill();
  };
  // The body of the graphic, a narrower accent inside it, then a hairline
  // along the bottom that carries the whole length even where the wedge
  // above it has run out — without it the front half of the car reads as
  // having no sticker at all.
  wedge(14, 74, "#f2f4f7");
  wedge(34, 74, "#c1121f");
  // The bottom edge has to read against ANY paint, the same problem the
  // door roundel solves with a dark ring inside a light keyline: a dark
  // hairline vanishes on a black car and a light one vanishes on a white
  // one. Both, stacked, so whichever way the paint goes one of the two
  // separates.
  ctx.fillStyle = "#f2f4f7";
  ctx.fillRect(0, 74, W, 4);
  ctx.fillStyle = "rgba(20,21,26,0.92)";
  ctx.fillRect(0, 78, W, 4);
  fullStripeTex = new THREE.CanvasTexture(c);
  fullStripeTex.colorSpace = THREE.SRGBColorSpace;
  fullStripeTex.anisotropy = 16;
  return fullStripeTex;
}

let hoodDecalTex: THREE.CanvasTexture | null = null;
function hoodDecalTexture(): THREE.CanvasTexture {
  if (hoodDecalTex) return hoodDecalTex;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 256);
  // Abstract falcon swoosh — two sweeping wings over a roundel core
  ctx.fillStyle = "#f2f4f7";
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(128, 96);
    ctx.quadraticCurveTo(128 + dir * 100, 60, 128 + dir * 118, 118);
    ctx.quadraticCurveTo(128 + dir * 70, 104, 128, 128);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#c1121f";
  ctx.beginPath();
  ctx.arc(128, 118, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f2f4f7";
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.font = `700 36px ${arabicUI()}`;
  ctx.fillText("ليالي الخليج", 128, 190);
  ctx.direction = "ltr";
  ctx.font = `600 20px ${latinDisplay()}`;
  ctx.fillText("GULF ROAD NIGHTS", 128, 220);
  hoodDecalTex = new THREE.CanvasTexture(c);
  hoodDecalTex.colorSpace = THREE.SRGBColorSpace;
  hoodDecalTex.anisotropy = 8;
  return hoodDecalTex;
}

let flagDecalTex: THREE.CanvasTexture | null = null;
/**
 * The flag of Kuwait, drawn to its own construction.
 *
 * It was 96 by 48 — four `fillRect`s and a quadrilateral — on a plane
 * 240 mm long. That is 400 texels to the metre, and the one edge in the
 * flag that is not horizontal is the hoist trapezoid's, which at that
 * size is a nine-pixel staircase softened into a smear by the mipmap
 * before it ever reaches the screen. It read as three coloured stripes
 * with a dark blob at one end.
 *
 * This is the 1961 construction: two by one, three equal horizontal
 * bands of green, white and red, and a black trapezoid at the hoist
 * whose base is a QUARTER of the length — the old one used 29%, which is
 * close enough to look right and wrong enough to be wrong — with its
 * slanted edges meeting the band boundaries at a third and two thirds of
 * the height.
 */
function flagDecalTexture(): THREE.CanvasTexture {
  if (flagDecalTex) return flagDecalTex;
  const W = 1024;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const third = H / 3;
  ctx.fillStyle = "#007a3d";
  ctx.fillRect(0, 0, W, third);
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(0, third, W, third);
  ctx.fillStyle = "#ce1126";
  ctx.fillRect(0, third * 2, W, H - third * 2);
  ctx.fillStyle = "#0a0a0a";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W / 4, third);
  ctx.lineTo(W / 4, third * 2);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  // A printed decal has an edge. Without one the white band runs
  // straight into white paint and the flag loses its top and bottom on
  // exactly the cars the sticker pack is most often bought for.
  ctx.strokeStyle = "#15161a";
  ctx.lineWidth = W * 0.008;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);
  flagDecalTex = new THREE.CanvasTexture(c);
  flagDecalTex.colorSpace = THREE.SRGBColorSpace;
  // Anisotropy is what keeps the hoist edge from smearing when the flank
  // is seen at a glancing angle, which on a car's side is nearly always.
  flagDecalTex.anisotropy = 16;
  return flagDecalTex;
}

/** Sticker plane: lit like paint, slightly emissive so it reads at night,
 *  polygon-offset so it never z-fights the panel it sits on. */
let demonMarkTex: THREE.CanvasTexture | null = null;
/**
 * The crew mark: a horned skull, drawn here rather than borrowed.
 *
 * The fleet is already full of jinn — an Efreet, a Kaiju, a rival called
 * Bu Torab running with the Dust Devils — so the sticker pack gets a
 * devil's head to match. Every line of it is a path in this function;
 * there is no real emblem behind it.
 */
function demonMarkTexture(): THREE.CanvasTexture {
  if (demonMarkTex) return demonMarkTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 256);
  const INK = "#14121a";
  const EMBER = "#ff5a1f";

  // Horns first, so the skull sits over their roots and they read as
  // growing out of it rather than being stuck on the sides.
  const horn = (s: number) => {
    ctx.beginPath();
    ctx.moveTo(128 + s * 46, 106);
    ctx.quadraticCurveTo(128 + s * 124, 88, 128 + s * 116, 18);
    ctx.quadraticCurveTo(128 + s * 88, 60, 128 + s * 60, 76);
    ctx.closePath();
  };
  // Skull: heavy brow, hard cheekbones, a long jaw
  const skull = () => {
    ctx.beginPath();
    ctx.moveTo(128, 238);
    ctx.lineTo(72, 160);
    ctx.lineTo(56, 102);
    ctx.quadraticCurveTo(128, 58, 200, 102);
    ctx.lineTo(184, 160);
    ctx.closePath();
  };
  // Stroked in ember before it is filled in ink. The mark goes on paint
  // that is often nearly black at night, and an all-ink silhouette on
  // dark paint is a hole rather than a badge.
  ctx.lineJoin = "round";
  ctx.strokeStyle = EMBER;
  ctx.lineWidth = 9;
  for (const s of [-1, 1]) { horn(s); ctx.stroke(); }
  skull();
  ctx.stroke();
  ctx.fillStyle = INK;
  for (const s of [-1, 1]) { horn(s); ctx.fill(); }
  skull();
  ctx.fill();

  // Eyes: angled slits, lit from inside
  ctx.fillStyle = EMBER;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(128 + s * 26, 114);
    ctx.lineTo(128 + s * 74, 130);
    ctx.lineTo(128 + s * 68, 152);
    ctx.lineTo(128 + s * 30, 134);
    ctx.closePath();
    ctx.fill();
  }
  // A row of teeth rather than a drawn smile — a curve at this size
  // turns to mush, and the sawtooth still reads at a car's length.
  ctx.beginPath();
  ctx.moveTo(98, 176);
  for (let i = 0; i < 6; i++) {
    ctx.lineTo(98 + (i + 0.5) * 10, 194);
    ctx.lineTo(98 + (i + 1) * 10, 176);
  }
  ctx.closePath();
  ctx.fill();

  demonMarkTex = new THREE.CanvasTexture(c);
  demonMarkTex.colorSpace = THREE.SRGBColorSpace;
  demonMarkTex.anisotropy = 8;
  return demonMarkTex;
}

const nameDecalCache = new Map<string, THREE.CanvasTexture>();
/** The car's own name, laid out as a flank wordmark: Latin over Arabic. */
function nameDecalTexture(name: string, ar?: string): THREE.CanvasTexture {
  const key = `${name}|${ar ?? ""}`;
  const hit = nameDecalCache.get(key);
  if (hit) return hit;
  // Doubled to 1024 x 256, and through textTexture so the Arabic half
  // repaints when its font lands instead of being frozen as whatever
  // the fallback drew.
  const W = 1024, H = 256;
  const tex = textTexture(W, H, (ctx) => {
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = "center";
    // Letter-spaced caps, because a wordmark on a flank is read side-on
    // at speed and tight tracking closes up to a smear.
    ctx.letterSpacing = "12px";
    // A dark backing stroke under every glyph. This is the whole fix
    // for legibility: the wordmark is near-white, and on a white,
    // silver or gold car it used to disappear into the paint entirely.
    // Stroking first and filling over it gives each letter its own edge
    // whatever it is standing on, which is what a real cut-vinyl decal
    // gets from its own thickness and shadow.
    ctx.font = `800 108px ${latinDisplay()}`;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(10,12,16,0.9)";
    ctx.lineWidth = 12;
    ctx.strokeText(name.toUpperCase(), W / 2, 116);
    ctx.fillStyle = "#f4f6fa";
    ctx.fillText(name.toUpperCase(), W / 2, 116);
    ctx.letterSpacing = "0px";
    // The rule under it, with its own dark edge for the same reason.
    ctx.fillStyle = "rgba(10,12,16,0.9)";
    ctx.fillRect(W / 2 - 218, 138, 436, 10);
    ctx.fillStyle = "#ff5a1f";
    ctx.fillRect(W / 2 - 214, 140, 428, 6);
    if (ar) {
      ctx.direction = "rtl";
      ctx.font = `700 76px ${arabicUI()}`;
      ctx.strokeStyle = "rgba(10,12,16,0.9)";
      ctx.lineWidth = 10;
      ctx.strokeText(ar, W / 2, 216);
      ctx.fillStyle = "#f4f6fa";
      ctx.fillText(ar, W / 2, 216);
    }
  });
  tex.anisotropy = 16;
  nameDecalCache.set(key, tex);
  return tex;
}

const crewDecalCache = new Map<string, THREE.CanvasTexture>();
function crewDecalTexture(logo: TeamLogo, tag: string, name: string): THREE.CanvasTexture {
  const key = `${logo.shape}|${logo.symbol}|${logo.bg}|${logo.fg}|${tag}|${name}`;
  const cached = crewDecalCache.get(key);
  if (cached) return cached;
  // 512 x 640: the crew mark carries the crew's NAME, and a name is
  // the thing on a car people try hardest to read.
  const W = 512;
  const H = 640;
  const tex = textTexture(W, H, (ctx) => {
  ctx.clearRect(0, 0, W, H);
  drawTeamLogo(ctx, logo, W, tag);
  // The crew's own name under the shield. An Arabic name is set with the
  // Arabic stack and laid out right-to-left; the tag inside the shield
  // already goes through the same sanitiser both scripts share.
  const ar = /[؀-ۿ]/.test(name);
  const label = name.trim().slice(0, 18).toUpperCase();
  if (label) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.direction = ar ? "rtl" : "ltr";
    // Shrink to fit rather than run off the panel — a long crew name is
    // a normal thing to pick and it should not be cropped to "AL MUB".
    let px = 92;
    ctx.font = `700 ${px}px ${ar ? arabicUI() : latinDisplay()}`;
    while (px > 36 && ctx.measureText(label).width > W - 24) {
      px -= 2;
      ctx.font = `700 ${px}px ${ar ? arabicUI() : latinDisplay()}`;
    }
    // A dark plate behind it, because the paint under the roof decal is
    // whatever colour the player chose and white-on-white is nothing.
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = logo.bg;
    ctx.strokeStyle = logo.fg;
    ctx.lineWidth = 4;
    const bw = Math.min(W - 8, tw + 30);
    ctx.beginPath();
    ctx.roundRect((W - bw) / 2, W + 6, bw, H - W - 14, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = logo.fg;
    ctx.fillText(label, W / 2, W + 6 + (H - W - 14) / 2 + 1);
  }
  });
  tex.anisotropy = 16;
  crewDecalCache.set(key, tex);
  return tex;
}

/**
 * How metallic a paint should be, from its own colour.
 *
 * Pale paints go solid. The physics is not a preference: at metalness
 * near 1 the diffuse term vanishes and all you see is the environment
 * tinted by the base colour, so a white car becomes a mirror wearing
 * whatever the sky is doing — which here is a warm sodium band, and the
 * car comes out gold.
 *
 * The threshold is on luminance rather than on saturation, because it is
 * lightness that kills the diffuse: a pale blue has the same problem as
 * a white, and a saturated red does not.
 */
function paintMetalness(hex: number): number {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Metallic in the mid-tones, falling away at BOTH ends.
  //
  // The paragraph above argues that a solid white "or a solid black" is
  // pigment under lacquer rather than flake, and then the code only ever
  // implemented the white half: everything at or below mid luminance got
  // a flat 0.95. Measured on a real car really painted, paint-black came
  // back with 56.3% of its bodywork at or under 8/255 and a tonal range
  // across the panels of 22.8 against white's 107.9. More than half of a
  // black car was a hole.
  //
  // The physics says why. In a metalness workflow F0 IS the base colour,
  // so a near-black basecoat reflects about five percent — and metalness
  // takes the diffuse away as well, leaving a surface that neither
  // reflects nor shades. Real metallic black is aluminium flake, which
  // is bright, suspended in a dark binder; calling the whole thing a
  // black metal is the part that was wrong.
  //
  // The dark knee is deliberately low. Dark does not mean unmetallic —
  // metallic reds and navies are real and common, and this fleet's red
  // sits at 0.22, its navy at 0.18 and its purple at 0.23, all of which
  // keep the full 0.95. Only the near-blacks, where F0 stops being
  // physical at all, come down to a dielectric basecoat and let the
  // clearcoat above do the work it is already there to do.
  if (lum >= 0.5) return Math.max(0.18, 0.95 - (lum - 0.5) * 1.9);
  const DARK_KNEE = 0.16;
  if (lum >= DARK_KNEE) return 0.95;
  return 0.18 + (0.95 - 0.18) * (lum / DARK_KNEE);
}

function seg0Pitch(p: number): number {
  return Math.max(-1.2, Math.min(1.2, p));
}

function decalMat(map: THREE.CanvasTexture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name: "decal",
    map,
    transparent: true,
    roughness: 0.5,
    metalness: 0.1,
    emissive: 0xffffff,
    emissiveMap: map,
    emissiveIntensity: 0.16,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
}

let sharedPlateTex: THREE.CanvasTexture | null = null;
function plateMat(): THREE.MeshStandardMaterial {
  if (!sharedPlateTex) sharedPlateTex = plateTexture();
  return new THREE.MeshStandardMaterial({ name: "plate", map: sharedPlateTex, roughness: 0.5 });
}

/**
 * What the wheel is.
 *
 * "steel" is not a colour, it is a different WHEEL: a pressed steel rim
 * with a plastic cover clipped over it, which is what a base-model car
 * leaves the showroom on and what half the cars on this road are still
 * wearing. It reads from ten metres and it is the single strongest cue
 * that a machine has not been got at yet — far stronger than the badge
 * or the power figure, because it is the one thing an owner changes
 * FIRST when they start spending.
 */
type WheelFinish = "silver" | "gold" | "bronze" | "steel";

/** Hero wheel parts, merged to one geometry per material so a Blender
 *  build can replace each in a single swap (models.ts) — and so four
 *  wheels cost five draw calls instead of fifteen. Keyed by spoke count
 *  and side, since the lip, rotor and lugs sit on the outboard face. */
const heroWheelCache = new Map<string, Record<string, THREE.BufferGeometry>>();

function heroWheelParts(nSpokes: number, side: number) {
  const key = `${nSpokes}|${side}`;
  let parts = heroWheelCache.get(key);
  if (parts) return parts;

  const at = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) => {
    const g = geo.clone();
    g.translate(x, y, z);
    return g;
  };
  // Tire: one lathed section, so tread and both sidewalls are a single
  // continuous surface. The lathe's own v already runs bead to bead
  // with the tread landing at 0.2-0.8, so the three hand-remapped
  // pieces this replaced are not needed and neither are their seams.
  const tire = tireGeoHi.clone();
  // Alloy face: machined lip, spokes, hub — everything wearing the
  // finish colour
  const alloyParts: THREE.BufferGeometry[] = [
    at(lipGeo, side * 0.135 * WHEEL_W_K),
    hubGeo.clone(),
  ];
  for (let i = 0; i < nSpokes; i++) {
    const g = spokeGeo.clone();
    g.translate(0, 0.1 * WHEEL_R_K, 0);
    g.rotateX((i / nSpokes) * Math.PI * 2);
    alloyParts.push(g);
  }
  const alloy = mergeGeometries(alloyParts)!;
  const lugParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    lugParts.push(
      at(
        lugGeo,
        side * 0.148 * WHEEL_W_K,
        Math.cos(a) * 0.058 * WHEEL_R_K,
        Math.sin(a) * 0.058 * WHEEL_R_K
      )
    );
  }
  parts = {
    tire,
    barrel: rimGeo,
    alloy,
    rotor: at(discGeo, -side * 0.055 * WHEEL_W_K),
    lugs: mergeGeometries(lugParts)!,
  };
  heroWheelCache.set(key, parts);
  return parts;
}

function buildWheel(
  finish: WheelFinish = "silver",
  side = 1,
  opts?: { detailed?: boolean; spokeMat?: THREE.MeshStandardMaterial }
): THREE.Group {
  const steel = finish === "steel";
  const spokeMat = steel
    ? hubcapMat
    : opts?.spokeMat ??
      (finish === "gold" ? getGoldRimMat() : finish === "bronze" ? bronzeRimMat : rimMat);
  const detailed = opts?.detailed ?? false;
  // Six straight spokes on the forged bronze wheel, five on the street
  // cast — and four on a hubcap, because a pressed cover has a few wide
  // flat vanes rather than a spoke pattern, and that difference in
  // COUNT is what the eye reads at speed even when the shape is coarse.
  const nSpokes = finish === "bronze" ? 6 : steel ? 4 : 5;
  const w = new THREE.Group();

  if (detailed) {
    // One mesh per material, each tagged for the authored swap. The
    // geometries are shared module-level merges — never dispose them.
    const parts = heroWheelParts(nSpokes, side);
    // Rotors get a per-wheel clone: they glow with brake heat, and the
    // shared material would light up the whole fleet at once.
    const rotorMat = discMat.clone();
    rotorMat.emissive = new THREE.Color(0xff3a00);
    rotorMat.emissiveIntensity = 0;
    const mats: Record<string, THREE.Material> = {
      tire: getTireMat(),
      barrel: rimDarkMat,
      alloy: spokeMat,
      rotor: rotorMat,
      lugs: rimDarkMat,
    };
    for (const name of ["tire", "barrel", "alloy", "rotor", "lugs"]) {
      const mesh = new THREE.Mesh(parts[name], mats[name]);
      mesh.userData.wheelPart = name;
      mesh.userData.wheelSide = side;
      w.add(mesh);
    }
    // The cover itself: a shallow dish clipped over the face of the
    // rim, which is what makes a steel wheel read as a steel wheel
    // rather than as a dull alloy. It sits PROUD of the spokes, hiding
    // most of them — a hubcap covers the wheel, that is its whole job.
    if (steel) {
      const cap = new THREE.Mesh(hubcapGeo, hubcapMat);
      cap.position.x = side * 0.135 * WHEEL_W_K;
      cap.userData.wheelPart = "hubcap";
      w.add(cap);
    }
    w.userData.spokes = nSpokes;
    w.userData.rotorMat = rotorMat;
    return w;
  }

  // Traffic wheel: the cheap build, unchanged
  w.add(new THREE.Mesh(tireGeo, getTireMat()));
  w.add(new THREE.Mesh(rimGeo, rimDarkMat));
  const lip = new THREE.Mesh(lipGeo, spokeMat);
  lip.position.x = side * 0.135 * WHEEL_W_K;
  w.add(lip);
  for (let i = 0; i < nSpokes; i++) {
    const holder = new THREE.Group();
    holder.rotation.x = (i / nSpokes) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeo, spokeMat);
    spoke.position.y = 0.1 * WHEEL_R_K;
    holder.add(spoke);
    w.add(holder);
  }
  w.add(new THREE.Mesh(hubGeo, spokeMat));
  return w;
}

export function createCar(colors: CarColors): THREE.Group {
  const group = new THREE.Group();
  const style: BodyStyle = colors.style ?? "sedan";
  // The same drop, applied to every anchor hung off the shells. Heights
  // only: nose, tail, wiperZ and the z halves of roof/mirror/bPillar are
  // stations along the car and must not move.
  const raw = STYLE_DIMS[style];
  const d: StyleDims = {
    ...raw,
    noseTopY: raw.noseTopY - BODY_DROP,
    grilleY: raw.grilleY - BODY_DROP,
    beltY: raw.beltY - BODY_DROP,
    hoodY: raw.hoodY - BODY_DROP,
    tailY: raw.tailY - BODY_DROP,
    deckY: raw.deckY - BODY_DROP,
    dashY: raw.dashY - BODY_DROP,
    creaseY: raw.creaseY - BODY_DROP,
    roof: [raw.roof[0], raw.roof[1] - BODY_DROP],
    mirror: [raw.mirror[0], raw.mirror[1] - BODY_DROP, raw.mirror[2]],
    bPillar: [raw.bPillar[0], raw.bPillar[1] - BODY_DROP, raw.bPillar[2]],
  };
  // How far this one is built. `raceKit` is the old yes/no form of the
  // same question and still wins if a caller only set that — the menu
  // hardcodes it for the prize car, and the showroom capture reads it
  // straight off the roster.
  //
  // Validated rather than trusted. Two suites were passing
  // `kit: car.kit === "attack"` — a boolean — which was silently ignored
  // while CarColors had no `kit` field, and became a hard crash the
  // moment it had one: WIDE[false] is undefined and every car in the
  // game stopped building. A caller getting this wrong should get the
  // weakest kit, not a broken scene.
  const asked = colors.kit;
  const kit: KitLevel =
    asked && asked in WIDE ? asked : colors.raceKit ? "attack" : "street";

  // Automotive paint is two layers: a metallic basecoat with flake, and a
  // hard clearcoat over it. The clearcoat is what throws the sharp
  // reflection of the world; the basecoat carries the colour and sparkle.
  // Two coats, and they are different materials doing different jobs.
  //
  // The basecoat is aluminium flake in a tinted binder: rough, so its
  // lobe is broad and dim, and it is what gives the car its colour. The
  // clearcoat is smooth dielectric lacquer, and it is what gives the car
  // its highlight — a small, white, near-mirror reflection of whatever
  // is actually there.
  //
  // At roughness 0.34 and metalness 0.9 a quarter of every panel sat
  // inside the highlight — measured, 23.7% of body pixels above half the
  // peak. That is a satin sheen, not gloss: gloss is a SMALL bright
  // thing on a DARKER field, and this was a large medium thing on a
  // medium field.
  //
  // The first attempt at fixing it went the wrong way, on the theory
  // that a real basecoat is rough and the clearcoat should carry the
  // highlight. Roughness 0.52 and metalness 0.78 took the highlight from
  // 23.7% of the panel to 43.4% and the contrast from 3.1 to 2.1 — more
  // diffuse, brighter, flatter, worse in every direction. Scanning five
  // settings against the same frame settled it: tighter and more
  // metallic is what gloss is here. 0.18/0.95 gives 18.6% and 3.7.
  //
  // clearcoatRoughness comes UP slightly all the same. 0.03 is optically
  // perfect, which nothing sprayed by a human has ever been, and a
  // flawless mirror is a large part of why a rendered highlight reads as
  // a neon strip rather than as a reflection of one.
  const bodyMat = new THREE.MeshPhysicalMaterial({
    name: "paint",
    color: colors.body,
    // Gloss, pulled back.
    //
    // These were the numbers of a show car under studio lights: a 0.18
    // basecoat under a clearcoat at 0.05 is very close to a mirror, and
    // envMapIntensity 2.4 then multiplies whatever that mirror finds by
    // nearly two and a half. On the showroom turntable it made every
    // machine look wet.
    //
    // Worth recording what this did NOT fix, because it was measured:
    // out on the road at night the paint's environment reflection adds
    // -0.004 mean luminance to the car and lifts 0.3% of it by more
    // than 0.2. Reflections are not what makes a car bright in the
    // race — the headlamps, their glare sprites and the tail lamps are,
    // and none of those are paint. So this is a showroom and menu
    // change by measurement, whatever it looks like it should be.
    // The finish decides the lacquer. gloss is the mirror this game has
    // always drawn; satin spreads the highlight so it follows a curve
    // instead of skipping across it; matte takes the clearcoat away
    // entirely and lets the shape do the work.
    // 0.18, and measured rather than picked — see tools/shots/paint.mjs,
    // which segments the body panels and reports the distribution rather
    // than one "is it shiny" number.
    //
    // At 0.29 the paint was matte by that instrument's own definition:
    // under the lamps, 68% of body pixels sat above half the highlight
    // and the median panel was within 1.5x of the brightest point. A
    // glossy surface puts its highlight in a SMALL area; this smeared it
    // across two thirds of the car.
    //
    // Swept against one live frame, 0.29 -> 0.10:
    //
    //   0.29/0.13   ratio 1.5   highlight  68%    dead 0%     grain 11.3
    //   0.22/0.09   ratio 2.2   highlight  44%    dead 0%     grain 12.1
    //   0.18/0.06   ratio 4.6   highlight  17%    dead 0.6%   grain 14.2
    //   0.14/0.04   ratio 6.6   highlight 7.7%    dead 1.4%   grain 11.4
    //   0.10/0.03   ratio 6.2   highlight 7.8%    dead 1.0%   grain  8.5
    //
    // 0.18 is the knee and three separate numbers agree on it. Past it
    // the ratio keeps climbing for the wrong reason: the median panel
    // collapses to 36 and dead pixels more than double, which is a
    // searing streak on a car gone black between highlights — the exact
    // failure paint.mjs was written to catch. The highlight itself also
    // gets DIMMER past the knee (spec 254 -> 235 -> 221), and grain, the
    // flake and orange-peel texture, peaks at 0.18 and falls away either
    // side.
    //
    // This does undo half of an earlier decision to pull the gloss back,
    // and that decision is worth remembering: it was taken when
    // envMapIntensity was 2.4, which "made every machine look wet" on
    // the showroom turntable. The gain is 1.5 now. A tight lobe and a
    // loud environment are different things, and only one of them was
    // the problem.
    roughness: 0.18 + FINISHES[colors.finish ?? "gloss"].roughnessAdd,
    // Metalness by how LIGHT the paint is.
    //
    // At 0.95 across the board, a metal's reflection is tinted by its
    // own colour and almost nothing diffuse survives — so a white car
    // shows you the environment map and nothing else, and this game's
    // environment map has a sodium horizon band in it. Every pale car
    // in the fleet was coming out GOLD. The Anniversary is supposed to
    // be arctic white with orange over the top and it rendered as a tan
    // coupe with orange over the top.
    //
    // Real paint agrees: a solid white or a solid black is not a
    // metallic finish, it is pigment under lacquer, and the gloss comes
    // from the clearcoat above rather than from flake below. Mid-tone
    // colours are where metallic paint actually lives, and they keep it.
    // The finish scales the metalness — see FinishSpec.metalScale for
    // why matte HAS to: a matte car that kept the paint's metalness had
    // no diffuse term and rendered as a dim mirror, not as pigment.
    metalness: paintMetalness(colors.body) * FINISHES[colors.finish ?? "gloss"].metalScale,
    clearcoat: FINISHES[colors.finish ?? "gloss"].clearcoat,
    clearcoatRoughness: FINISHES[colors.finish ?? "gloss"].clearcoatRoughness,
    envMapIntensity: 1.5 * FINISHES[colors.finish ?? "gloss"].envScale,
    // No sheen here, and that is a MEASURED decision rather than an
    // omission. The edges of a car in this game were the suspected
    // cause of "no volume", so a grazing-angle sheen lobe was fitted
    // and swept at 0.35 / 0.55 / 0.75 / 0.95 — and with the measurement
    // finally taken against a pinned exposure it made the rim ratio
    // slightly WORSE at every setting (2.13 without, 2.08 at 0.55,
    // 2.07 at 0.8). The upper silhouette already runs at twice the
    // luminance of the middle of the same panel; the clearcoat and the
    // envmap's horizon band were doing the job all along.
  });

  // Per-car metal clones for everything that should mirror the world.
  // The shared module materials must stay shared — the live reflection
  // probe carries the player's own surroundings, and binding it to a
  // shared material would paint the player's reflections onto every car
  // on the road. Traffic keeps the shared mats and skips the cost.
  const spokeBase =
    colors.raceKit ? bronzeRimMat : colors.goldRims ? getGoldRimMat() : rimMat;
  const spokeLocal = colors.simple ? undefined : spokeBase.clone();
  const chromeLocal = colors.simple ? chromeMat : chromeMat.clone();
  chromeLocal.name = "chrome";
  const reflectMats: THREE.MeshStandardMaterial[] = [];
  if (spokeLocal) {
    spokeLocal.userData.baseEnvIntensity = spokeLocal.envMapIntensity;
    reflectMats.push(spokeLocal);
  }
  if (chromeLocal !== chromeMat) {
    chromeLocal.userData.baseEnvIntensity = chromeLocal.envMapIntensity;
    reflectMats.push(chromeLocal);
  }

  const bCabBack = style === "zx" || style === "rx7";
  const [bGeo, cGeo, rGeo] =
    style === "pony"
      ? [ponyBodyGeo, ponyCanopyGeo, ponyRoofGeo]
      : style === "zx"
      ? [zxBodyGeo, zxCanopyGeo, zxRoofGeo]
      : style === "rx7"
        ? [rx7BodyGeo, rx7CanopyGeo, rx7RoofGeo]
        : style === "gtr"
          ? [gtrBodyGeo, gtrCanopyGeo, gtrRoofGeo]
          : style === "hatch"
            ? [hatchBodyGeo, hatchCanopyGeo, hatchRoofGeo]
            : [bodyGeo, canopyGeo, roofGeo];
  // The three shells are tagged so models.ts can swap in Blender-authored
  // geometry (same profiles, denser sampling) once it loads.
  const bodyShell = new THREE.Mesh(bGeo, bodyMat);
  bodyShell.userData.shell = "body";
  group.add(bodyShell);
  // The shell's own half-width. Everything that mounts on the flank —
  // arch openings, arch lips, side markers — is an offset from this
  // rather than from the sedan's 0.92, which is what the wide bodies
  // were being measured against while their skin sat 40-60 mm further
  // out. Cheap: extrudeProfile caches its bounding box after the first
  // car of a silhouette.
  bGeo.computeBoundingBox();
  const flankX = bGeo.boundingBox!.max.x;
  /**
   * The painted top skin at a point along the car, on the centreline.
   *
   * `hoodY` and `deckY` are the profile's top LINE. The extrusion's
   * bevel carries the actual surface 20 to 160 mm above it, depending on
   * the body — so everything that lies on the hood was lying inside it.
   * Measured on all four silhouettes: the sticker pack's hood decal was
   * 23 mm under the skin on the gtr and 170 mm under it on the rx7, and
   * had therefore never been seen on any car in the game.
   */
  const skinY = (z: number, fallback: number): number => deckY(bGeo, style, z) ?? fallback;
  // Per-car glass when the tint is not factory. The shared material has
  // to stay shared for everything else — thirty traffic cars pointing at
  // one material is the whole reason it is a module constant — but a
  // tinted window belongs to ONE car, and cloning the shared one would
  // tint every pane on the road.
  const tintPct = colors.tint ?? 0;
  const glassLocal = tintPct > 0 ? tintedGlass(tintPct) : glassMat;
  const canopyShell = new THREE.Mesh(cGeo, glassLocal);
  canopyShell.userData.shell = "canopy";
  group.add(canopyShell);
  const roofShell = new THREE.Mesh(rGeo, bodyMat);
  roofShell.userData.shell = "roof";
  group.add(roofShell);

  // The cabin fit: head behind the header, seat under the ceiling.
  // Both the driver and the interior behind him hang off these, so the
  // headrest cannot end up somewhere the head is not.
  const headerZ = cGeo.userData.headerZ as number | undefined;
  const headZ = headerZ !== undefined ? headerZ - CABIN_HEAD_BACK : bCabBack ? -0.26 : 0.1;
  const cabinRoofY = skinAt(cGeo, style, DRIVER_X, headZ, "canopy");
  const seatY =
    cabinRoofY !== null ? cabinRoofY - CABIN_HEADROOM - driverHeadTop() : d.dashY - 0.34;
  // The fit, published. A cabin is the one thing on this car measured
  // from the shell at build time rather than authored, so the numbers it
  // came out with are worth being able to read back.
  group.userData.cabin = { headZ, cabinRoofY, seatY, headTop: driverHeadTop() };

  /** Top of the bonnet stripe at a point along it, when the car wears one. */
  let hoodStripeTop: ((z: number) => number) | null = null;

  /**
   * The topmost painted surface at a point along the car — bonnet,
   * glass or roof, whichever is highest there.
   *
   * A stripe that runs over the top of a car crosses three separate
   * shells, and each of them is the top one for part of the length.
   * Asking only the body puts the stripe under the windscreen for the
   * whole of the cabin; asking only the roof puts it in the air over
   * the bonnet. Taking the max of all three is the only thing that
   * follows the car.
   */
  const topSkinY = (z: number): number => {
    const b = deckY(bGeo, style, z) ?? -Infinity;
    const c = deckY(cGeo, style, z, "canopy") ?? -Infinity;
    const r = deckY(rGeo, style, z, "roof") ?? -Infinity;
    const top = Math.max(b, c, r);
    return Number.isFinite(top) ? top : d.hoodY;
  };

  // --- Twin over-the-top stripes.
  if (colors.accent !== undefined && colors.stripes === "twin") {
    const stripeMat = new THREE.MeshStandardMaterial({
      name: "accent-stripe",
      color: colors.accent,
      roughness: 0.4,
    });
    // Laid in many short pieces for the same reason the single stripe
    // is: a panel is not a ramp, and a long board levelled against its
    // two ends sinks through everything curved in between. Over the top
    // of a car that is most of the run — the windscreen and the hatch
    // glass are the two steepest surfaces on the machine.
    const PIECES = 26;
    const zFront = d.nose - 0.1;
    const zRear = d.tail + 0.16;
    const step = (zFront - zRear) / PIECES;
    // Half the gap between the two stripes. Narrow, because these sit
    // either side of the centreline rather than out on the panels.
    const GAP = 0.135;
    const WIDE = 0.2;
    for (let i = 0; i < PIECES; i++) {
      const a = zRear + i * step;
      const b = a + step;
      const mid = (a + b) / 2;
      const yA = topSkinY(a);
      const yB = topSkinY(b);
      // Pitch, clamped: the windscreen is steep enough that an
      // unclamped asin would flip a piece onto its edge.
      const pitch = Math.atan2(yA - yB, step);
      for (const sx of [-1, 1]) {
        const seg = new THREE.Mesh(
          roundedBox(WIDE, 0.011, step * 1.06, 0.004),
          stripeMat
        );
        seg.position.set(
          sx * (GAP + WIDE / 2),
          (yA + yB) / 2 + 0.008,
          mid
        );
        seg.rotation.x = Math.max(-1.2, Math.min(1.2, pitch));
        group.add(seg);
      }
      if (mid > 0) {
        const y0 = (yA + yB) / 2 + 0.008;
        const sinA = Math.sin(seg0Pitch(pitch));
        const prev: ((z: number) => number) | null = hoodStripeTop;
        hoodStripeTop = (z: number): number =>
          Math.max(y0 + (mid - z) * sinA + 0.011, prev ? prev(z) : -Infinity);
      }
    }
  }

  if (colors.accent !== undefined && colors.stripes !== "twin") {
    // A bonnet-and-boot stripe, seated on the panels it lies on. It was
    // one 4.3 m bar held at a fixed height for the whole length of the
    // car, which is a straight line laid through a curved body: it broke
    // the surface over the nose, sank into the hood, ran under the
    // cabin, and never reached the boot. On screen it read as a green
    // rectangle stuck to the bumper.
    const accentMat = new THREE.MeshStandardMaterial({
      name: "accent-stripe",
      color: colors.accent,
      roughness: 0.35,
    });
    // Each run is laid in short pieces rather than as one long board.
    // A panel is not a ramp: levelled against its two ends only, a 0.9 m
    // stripe sinks into the crown between them, which broke the boot
    // stripe into two green patches with the middle missing.
    const PIECES = 4;
    // Where the stripe runs, derived from the body rather than typed in.
    //
    // Both runs were hardcoded saloon numbers, and the whole block was
    // gated on `style === "sedan"` — so nine of the fifteen cars in the
    // showroom accepted an accent colour and drew nothing with it. Found
    // by counting the fleet against itself: accent-stripe came out on
    // six cars and absent from nine, and the nine had one thing in
    // common, which was not being a saloon.
    //
    // The bonnet run is the same on every body: from just ahead of the
    // wiper line to just short of the nose. The BOOT run is not — a
    // fastback has no boot lid to put a stripe on, its glass runs to the
    // tail — so it is only laid where the profile actually has a deck,
    // and the fastbacks get the bonnet alone. That is what those cars
    // look like with a stripe on them, rather than a green rectangle
    // stuck across a rear window.
    const runs: Array<[number, number]> = [[d.wiperZ + 0.06, d.nose - 0.23]];
    if (style === "sedan" || style === "gtr") {
      runs.push([d.tail + 0.22, d.roof[0] - 0.9]);
    }
    for (const [zRear, zFront] of runs) {
      const step = (zFront - zRear) / PIECES;
      for (let i = 0; i < PIECES; i++) {
        const a = zRear + i * step;
        const b = a + step;
        const mid = (a + b) / 2;
        const yA = skinY(a, d.hoodY);
        const yB = skinY(b, d.hoodY);
        // 12 mm thick, not 30: this is paint, and a stripe standing 3 cm
        // off the bonnet is a spoiler.
        const seg = new THREE.Mesh(roundedBox(0.46, 0.012, step * 1.02, 0.005), accentMat);
        seg.position.set(0, (yA + yB) / 2 + 0.009, mid);
        seg.rotation.x = Math.asin(Math.min(0.6, (yA - yB) / step));
        group.add(seg);
        // The hood decal has to clear whichever piece it lands on, or
        // the stripe covers the falcon's middle. Measured at the decal's
        // own z: the pieces are pitched, so the height at the centre of
        // one is a centimetre off the height where the decal sits.
        if (zFront > 0) {
          const y0 = seg.position.y;
          const sinA = Math.sin(seg.rotation.x);
          const prev: ((z: number) => number) | null = hoodStripeTop;
          hoodStripeTop = (z: number): number =>
            Math.max(y0 + (mid - z) * sinA + 0.011, prev ? prev(z) : -Infinity);
        }
      }
    }
  }

  // --- Carbon bodywork.
  //
  // Panels laid over the shell rather than the shell re-materialised.
  // The body is one extruded skin from nose to tail — there is no bonnet
  // object to swap — so carbon is a set of thin plates that follow the
  // top surface, pitched piece by piece, the same technique the racing
  // stripes use for exactly the same reason.
  //
  // Only the panels a car actually has in carbon get one. A fastback has
  // no boot lid, so it gets no boot panel; putting one across its rear
  // glass would be a black rectangle stuck on a window, which is the
  // mistake the stripe code already learned not to make.
  const carbon: CarbonLevel = colors.carbon ?? "none";
  if (carbon !== "none" && !colors.simple) {
    const cMat = carbonPanelMat();
    /**
     * Lay a panel along z, following whatever the top surface does.
     *
     * `topAt` is passed in rather than assumed, because "the top
     * surface" is two different shells: under the bonnet and the boot it
     * is the body, and over the greenhouse it is the roof. Sampling the
     * body shell at a roof z returns the floor of the cabin, and a roof
     * panel seated on that would be inside the car.
     */
    const panel = (
      zRear: number, zFront: number, halfW: number, lift: number,
      topAt: (z: number) => number
    ): void => {
      if (zFront <= zRear) return;
      const m = new THREE.Mesh(surfaceRibbon(zRear, zFront, halfW, lift, topAt), cMat);
      m.userData.trim = "carbon";
      group.add(m);
    };
    const bodyTop = (z: number): number => skinY(z, d.hoodY);
    // The bonnet, on every car. Narrower than the body so the painted
    // wings still show either side of it — a carbon bonnet that reached
    // the arches would read as a black nose rather than as a panel.
    panel(d.wiperZ + 0.06, d.nose - 0.3, flankX * 0.66, 0.006, bodyTop);
    // The boot lid, where the profile has one. The run is the stripe's
    // own, which stops short of the backlight: a panel that carried on
    // up the rear glass is a black sheet over a window.
    if (style === "sedan" || style === "gtr") {
      panel(d.tail + 0.24, d.roof[0] - 0.94, flankX * 0.62, 0.006,
        (z) => skinY(z, d.deckY));
    }
    // Mirror caps: the cheapest carbon anybody buys and the first thing
    // they buy, so it is in the base package.
    for (const sxSign of [-1, 1]) {
      const cap = new THREE.Mesh(roundedBox(0.17, 0.055, 0.21, 0.03), cMat);
      cap.position.set(sxSign * (flankX + d.mirror[0]), d.mirror[1] + 0.03, d.mirror[2]);
      cap.userData.trim = "carbon";
      group.add(cap);
    }
    if (carbon === "full") {
      // The roof skin. Highest mass on the car and the one panel whose
      // weight a driver can feel in a change of direction, which is why
      // it is the step up rather than part of the base package.
      // The roof's z span comes from the roof shell's own bounds.
      //
      // NOT from d.roof. That is [z, y] — the sunroof and antenna ANCHOR
      // POINT, one z and one height — and reading it as a pair of z
      // values asks for the roof surface at z = 1.3, which is out over
      // the windscreen. deckY returns null there, the guard below
      // skipped the panel, and Full Dry Carbon quietly delivered exactly
      // the same four pieces as the cheaper package. It cost 3,200 KD
      // and added nothing, and it took measuring the built car to find
      // out, because nothing about it looked wrong.
      rGeo.computeBoundingBox();
      const roofBox = rGeo.boundingBox!;
      const seatedRoof = (z: number): number | null => deckY(rGeo, style, z, "roof");
      const a = roofBox.min.z + 0.18;
      const b = roofBox.max.z - 0.18;
      // Still guarded: a shell that cannot be measured gets no panel
      // rather than a panel on a guessed height, which is a slab
      // hovering over the glass.
      if (b > a && seatedRoof(a) !== null && seatedRoof(b) !== null) {
        panel(a, b, flankX * 0.55, 0.005, (z) => seatedRoof(z) ?? seatedRoof(a)!);
      }
    }
  }

  // --- The engine cover, and the vents that let you see it.
  //
  // A cam cover under a shut bonnet is money spent on a thing that is
  // not there, so the part does both: it cuts two openings in the
  // bonnet and puts something worth looking at underneath them. The
  // opening is a dark recess — the bay — with the cover sitting in it,
  // which is what gives the vent depth instead of making it a black
  // sticker.
  if (colors.engineCover !== undefined && !colors.simple) {
    const coverMat = new THREE.MeshStandardMaterial({
      name: "engine-cover",
      color: colors.engineCover,
      // Crackle and wrinkle finishes are the opposite of bodywork:
      // rough, barely metallic, and they hold no reflection at all.
      // Polished alloy is the exception and it is close enough to this
      // that a second material is not worth the draw call.
      roughness: 0.55,
      metalness: 0.35,
      envMapIntensity: 0.8,
    });
    const bayMat = new THREE.MeshStandardMaterial({
      name: "engine-bay",
      color: 0x05060a,
      roughness: 0.95,
      metalness: 0,
    });
    // Where the engine sits: back of the bonnet, ahead of the wipers,
    // which is where a bay is on a front-engined car.
    const bayZ = d.wiperZ + 0.55;
    const bayY = skinY(bayZ, d.hoodY);
    // Every piece is placed as a depth BELOW the bonnet skin, and the
    // depths are written down here rather than as offsets at each use,
    // because the first version had the cover's top three centimetres
    // ABOVE the skin — an engine growing out through a shut bonnet. That
    // is invisible in a night render of a dark car and obvious the
    // moment the bounding boxes are printed.
    const BAY_FLOOR = 0.11;  // the dark floor of the recess
    const COVER_TOP = 0.03;  // the cam cover's crown, safely under the skin
    const COVER_H = 0.06;
    for (const sx of [-0.33, 0.33]) {
      // The hole: a dark floor deep enough that the eye reads a recess
      // rather than a painted patch.
      const hole = new THREE.Mesh(roundedBox(0.3, 0.02, 0.44, 0.01), bayMat);
      hole.position.set(sx, bayY - BAY_FLOOR, bayZ);
      hole.userData.trim = "hood-vent";
      group.add(hole);
      // The cover, sitting in the recess with its crown a clear
      // centimetres below the bonnet line.
      const cover = new THREE.Mesh(roundedBox(0.25, COVER_H, 0.38, 0.015), coverMat);
      cover.position.set(sx, bayY - COVER_TOP - COVER_H / 2, bayZ);
      cover.userData.trim = "engine-cover";
      group.add(cover);
      // Ribs across it. A cam cover is ribbed, and the ribs are what
      // catch the one grazing light that reaches down a vent — without
      // them the cover is a flat coloured lozenge at any distance.
      for (const rz of [-0.12, 0, 0.12]) {
        const rib = new THREE.Mesh(roundedBox(0.22, 0.018, 0.04, 0.008), coverMat);
        rib.position.set(sx, bayY - COVER_TOP - 0.004, bayZ + rz);
        group.add(rib);
      }
      // The vent surround, in body colour: the lip of pressed steel the
      // opening is cut into. It is what stops the hole reading as a
      // decal painted on the bonnet.
      for (const ex of [-1, 1]) {
        const edge = new THREE.Mesh(roundedBox(0.02, 0.03, 0.46, 0.008), bodyMat);
        edge.position.set(sx + ex * 0.16, bayY + 0.002, bayZ);
        group.add(edge);
      }
    }
  }

  // Lights: lens strips front and rear. The head material is cloned per
  // car so a single rival can flash back without lighting up traffic.
  const headMat = headlightMat.clone();

  // --- The headlamp mods.
  const lamps = colors.headlamps ?? "stock";
  // Which side keeps its lamp when one has been taken out. The kerb
  // side, because that is the one a passer-by sees and the whole point
  // of the look is that people notice.
  const LAMP_GONE = 1;
  const lampGone = (sx: number): boolean => lamps === "single" && Math.sign(sx) === LAMP_GONE;
  if (lamps === "smoked") {
    // Smoked lenses. The glass goes dark and the emissive comes most of
    // the way down — but NOT to nothing, because a smoked lamp is still
    // a lamp: at night it glows a dull amber through the tint, and that
    // dirty glow is the entire look. Killing the emissive outright would
    // just give the car two black rectangles.
    headMat.color = new THREE.Color(0x1a1c20);
    headMat.emissive = new THREE.Color(0xffb257);
    headMat.emissiveIntensity = 0.42;
  }

  // Every lamp carries a soft bloom and a diffraction star. Sprites, so
  // the flare always faces the camera — an oncoming car's lights spike
  // properly whichever way it is pointing. Traffic skips them: thirty
  // background cars do not need sixty extra additive sprites.
  const headGlowMats: THREE.SpriteMaterial[] = [];
  /** Where this shell's lamps actually are, in body space.
   *
   *  Recorded so the engine can put its light sources at the lamps
   *  rather than at an average guess: every silhouette carries them at a
   *  different height and a different point in the nose, and a beam that
   *  starts somewhere other than the lamp it is supposed to be coming
   *  out of is the thing that makes headlights look painted on. */
  const lampPositions: THREE.Vector3[] = [];
  const addHeadGlare = (x: number, y: number, z: number, size = 1) => {
    // Recorded before the early return: traffic cars skip the sprites,
    // and they still have headlamps.
    lampPositions.push(new THREE.Vector3(x, y, z));
    if (colors.simple) return;
    // A tinted lens flares less, and the flare is most of what a
    // headlight IS at a distance — so the tint has to reach the sprites
    // or a smoked car looks stock from fifty metres.
    const flare = lamps === "smoked" ? 0.34 : 1;
    const halo = new THREE.SpriteMaterial({
      map: pointGlowTexture(),
      color: lamps === "smoked" ? 0xffc98a : 0xfff2cc,
      transparent: true,
      opacity: 0.5 * flare,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const h = new THREE.Sprite(halo);
    h.scale.setScalar(0.85 * size);
    h.position.set(x, y, z + 0.06);
    h.userData.noShadow = true;
    group.add(h);
    headGlowMats.push(halo);

    const starMat = new THREE.SpriteMaterial({
      map: headlightStarTexture(),
      color: lamps === "smoked" ? 0xffd9a0 : 0xfff6e0,
      transparent: true,
      opacity: 0.62 * flare,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const star = new THREE.Sprite(starMat);
    star.scale.setScalar(1.7 * size);
    star.position.set(x, y, z + 0.07);
    star.userData.noShadow = true;
    group.add(star);
    headGlowMats.push(starMat);
  };

  // Every headlamp is an assembly, the way the tail lamps already were:
  // a dark housing set into the bodywork, a lens inside it, and a hot
  // projector inside that. Each piece is SMALLER than the one around it
  // and therefore sits FURTHER OUT, or it is swallowed whole — the same
  // stacking rule the rear lamps are built to.
  //
  // Before this, every headlamp on every car was a single emissive box
  // at intensity 2.6. It clipped to flat white, bloomed, and arrived on
  // screen as a featureless glowing slab stuck to the nose: no bezel, no
  // lens, no focal point, and no way to tell one car's face from
  // another's. Four silhouettes, four different slabs, all identical
  // once lit.
  //
  // `bulb` is the piece that is allowed to blow out. Everything else has
  // to keep its shape.
  /**
   * What sits in the hole where a headlamp was.
   *
   * Not nothing. A deleted lamp on a street car is an open pan with a
   * mesh screen over it — that is how it stays legal-ish, how the intake
   * behind it breathes, and how anyone looking at the car can tell it
   * was DONE rather than broken. A smooth black rectangle reads as a
   * missing texture; a screen with a visible weave reads as a decision.
   */
  const addLampDelete = (x: number, y: number, z: number, w2: number, h2: number): void => {
    // The recessed backing, darker than the housing so the socket has
    // depth rather than being a flat patch.
    const back = new THREE.Mesh(roundedBox(w2, h2, 0.02, 0.012), gapMat);
    back.position.set(x, y, z - 0.02);
    group.add(back);
    if (colors.simple) return;
    // The screen: horizontal wires, because a coarse weave at this scale
    // is two sets of bars and only one of them survives being seen from
    // a car length away.
    const bars = Math.max(3, Math.round(h2 / 0.022));
    for (let i = 0; i < bars; i++) {
      const wire = new THREE.Mesh(
        new THREE.BoxGeometry(w2 * 0.94, 0.006, 0.008),
        seamMat
      );
      wire.position.set(x, y - h2 / 2 + (h2 * (i + 0.5)) / bars, z);
      group.add(wire);
    }
    // And a frame around it, so the screen has an edge instead of
    // fading into the pan.
    const frame = new THREE.Mesh(roundedBox(w2 + 0.018, h2 + 0.018, 0.014, 0.008), housingMat);
    frame.position.set(x, y, z - 0.006);
    group.add(frame);
  };

  const bulb = (x: number, y: number, z: number, r = 0.042, len = 0.05) => {
    const core = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.86, len, 14), headCoreMat);
    core.rotation.x = Math.PI / 2;
    core.position.set(x, y, z);
    core.name = "lamp-core";
    group.add(core);
  };

  if (style === "zx") {
    // Z32 signature: one flush light bar across the whole nose. Pinned
    // 80 mm behind the nose anchor it was 100 mm inside the bumper — the
    // three cars on this silhouette had no headlights on screen at all.
    const barY = d.noseTopY + 0.03;
    const barZ = (noseFaceZ(bGeo, style, barY, true) ?? d.nose) - 0.018;
    // The housing first: a dark channel the bar sits down inside.
    const channel = new THREE.Mesh(roundedBox(1.62, 0.14, 0.06, 0.03), housingMat);
    channel.position.set(0, barY, barZ - 0.014);
    channel.rotation.x = -0.09;
    channel.name = "lamp-housing";
    group.add(channel);
    // Then the bar itself, SEGMENTED. A continuous strip of emissive is
    // a fluorescent tube; a row of elements with the housing showing
    // between them is a light bar. This is the whole difference on this
    // silhouette.
    const SEGS = 6;
    const segW = 1.5 / SEGS - 0.028;
    for (let i = 0; i < SEGS; i++) {
      const cx = -0.75 + (1.5 / SEGS) * (i + 0.5);
      // A light BAR cannot lose one of two lamps, because it does not
      // have two. Half the bar goes dark instead, which is the same
      // statement in this silhouette's own language.
      if (lamps === "single" && Math.sign(cx) === LAMP_GONE) {
        addLampDelete(cx, barY, barZ + 0.004, segW, 0.078);
        continue;
      }
      const seg = new THREE.Mesh(roundedBox(segW, 0.078, 0.06, 0.022), headMat);
      seg.position.set(cx, barY + Math.sin(-0.09) * 0, barZ + 0.004);
      seg.rotation.x = -0.09;
      seg.name = "lamp-lens";
      group.add(seg);
    }
    // Two projectors in the bar, where the main beams actually come from.
    for (const sx of [-0.5, 0.5]) {
      if (lampGone(sx)) continue;
      bulb(sx, barY, barZ + 0.03, 0.03, 0.045);
      addHeadGlare(sx, barY, barZ, 0.95);
    }
  } else if (style === "rx7") {
    // Pop-up headlights, up for the night run: a body-colour door tilted
    // out of the hood with the lamp shining from under it. Both sat
    // under the hood skin, so the FD ran dark as well.
    const hood = deckY(bGeo, style, d.nose - 0.4) ?? d.noseTopY + 0.08;
    for (const sx of [-0.58, 0.58]) {
      const door = new THREE.Mesh(roundedBox(0.44, 0.05, 0.3, 0.02), bodyMat);
      door.position.set(sx, hood + 0.075, d.nose - 0.42);
      door.rotation.x = -0.62;
      group.add(door);
      // The bucket the lamp sits in, then a round lens, then the bulb.
      // A pop-up is a round sealed beam in a black pan, and the pan is
      // what makes it read as one.
      const pan = new THREE.Mesh(roundedBox(0.4, 0.15, 0.07, 0.03), housingMat);
      pan.position.set(sx, hood + 0.05, d.nose - 0.375);
      pan.name = "lamp-housing";
      group.add(pan);
      if (lampGone(sx)) {
        // A pop-up with the lamp out: the door stays DOWN, because
        // there is nothing to raise. The pan is what you see.
        door.rotation.x = 0;
        door.position.set(sx, hood + 0.028, d.nose - 0.44);
        addLampDelete(sx, hood + 0.05, d.nose - 0.35, 0.34, 0.12);
        continue;
      }
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.05, 18), headMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(sx, hood + 0.05, d.nose - 0.345);
      lens.name = "lamp-lens";
      group.add(lens);
      // Far enough forward to clear the raised door above it. The mesh
      // audit is what caught this: the bulb was proud of its lens and
      // still painted nothing, because the pop-up door tilted up over
      // the top of it.
      bulb(sx, hood + 0.05, d.nose - 0.295, 0.03, 0.04);
      addHeadGlare(sx, hood + 0.05, d.nose - 0.32, 0.9);
    }
  } else {
    for (const sx of [-0.62, 0.62]) {
      // Housing, deepest and widest. It stays even when the lamp inside
      // it has gone — an empty headlight is an empty SOCKET, and a car
      // with a smooth panel where a lamp used to be reads as a rendering
      // error rather than as a car somebody took a headlight out of.
      const pod = new THREE.Mesh(roundedBox(0.58, 0.175, 0.07, 0.03), housingMat);
      pod.position.set(sx, d.noseTopY, d.nose - 0.03);
      pod.name = "lamp-housing";
      group.add(pod);
      if (lampGone(sx)) {
        // What is left behind: the open pan, with a mesh screen across
        // it. This is what the mod actually looks like on the street —
        // the hole gets a grille so the intake behind it can breathe and
        // so nothing flies into it.
        addLampDelete(sx, d.noseTopY, d.nose - 0.012, 0.5, 0.115);
        continue;
      }
      // Lens, inset all round and stepped out.
      const head = new THREE.Mesh(roundedBox(0.5, 0.115, 0.065, 0.02), headMat);
      head.position.set(sx, d.noseTopY, d.nose - 0.008);
      head.name = "lamp-lens";
      group.add(head);
      // The projector, set toward the inboard end where a real one is.
      bulb(sx - Math.sign(sx) * 0.13, d.noseTopY, d.nose + 0.03);
      addHeadGlare(sx, d.noseTopY, d.nose + 0.02);
    }
    if (style === "gtr") {
      // Inner projector eyes beside the main lamps, each in its own dark
      // bezel so they read as a second pair rather than as two more
      // bright dots on the paint.
      for (const sx of [-0.3, 0.3]) {
        const bezel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.072, 0.072, 0.04, 16),
          housingMat
        );
        bezel.rotation.x = Math.PI / 2;
        bezel.position.set(sx, d.noseTopY, d.nose - 0.022);
        bezel.name = "lamp-housing";
        group.add(bezel);
        const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 12), headMat);
        eye.rotation.x = Math.PI / 2;
        eye.position.set(sx, d.noseTopY, d.nose - 0.005);
        eye.name = "lamp-lens";
        group.add(eye);
        bulb(sx, d.noseTopY, d.nose + 0.026, 0.026, 0.035);
      }
    }
  }
  const tailMat = new THREE.MeshStandardMaterial({
    name: "taillamp-lens",
    color: 0x550000,
    emissive: TAIL.lensColor,
    emissiveIntensity: TAIL.lensIdle,
  });
  // The hot element inside each lamp. It used to share tailMat with the
  // lens, which made it invisible twice over: the same flat emissive
  // colour, and geometry sitting wholly inside the lens. Now it is a
  // hotter, oranger red and it stands proud, so it reads as the filament
  // rather than as more of the same red plastic.
  const tailCoreMat = new THREE.MeshStandardMaterial({
    name: "taillamp-core",
    color: 0x330000,
    emissive: TAIL.coreColor,
    emissiveIntensity: TAIL.coreIdle,
  });
  // The rear lamps are built as assemblies — smoked housing, outer lens,
  // and a hotter inner core — with additive glow halos hung behind them
  // that the engine flares when the brakes bite.
  const tailGlowMats: THREE.MeshBasicMaterial[] = [];
  const addTailGlow = (x: number, y: number, z: number, w = 0.55, h = 0.4) => {
    const m = new THREE.MeshBasicMaterial({
      map: pointGlowTexture(),
      color: TAIL.glowColor,
      transparent: true,
      opacity: TAIL.glowIdle,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    glow.position.set(x, y, z - 0.12);
    glow.rotation.y = Math.PI; // faces the following traffic
    glow.userData.noShadow = true;
    group.add(glow);
    tailGlowMats.push(m);
  };

  // Every lamp assembly is a stack: a smoked outer housing, a lens
  // inside it, a hotter core inside that. Each element is SMALLER than
  // the one around it, so each must sit FURTHER OUT or it is swallowed
  // whole. All four silhouettes had the stack the other way round —
  // outer piece deepest, core shallowest — which put the core inside the
  // lens on every car in the fleet. The offsets below step outward by
  // 12–20 mm a layer; the mesh audit checks they still do.
  if (style === "gtr") {
    // The R34 calling card: four round afterburners, each a dark ring
    // with a hot core — the classic double-circle look.
    const garnish = new THREE.Mesh(roundedBox(1.72, 0.3, 0.05, 0.02), grilleMat);
    garnish.position.set(0, d.tailY, d.tail + 0.005);
    group.add(garnish);
    for (const sx of [-0.72, -0.44, 0.44, 0.72]) {
      const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.04, 16), housingMat);
      bezel.rotation.x = Math.PI / 2;
      bezel.position.set(sx, d.tailY, d.tail - 0.022);
      group.add(bezel);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.05, 16), tailMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(sx, d.tailY, d.tail - 0.03);
      group.add(ring);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 10), tailCoreMat);
      core.rotation.x = Math.PI / 2;
      core.position.set(sx, d.tailY, d.tail - 0.042);
      group.add(core);
    }
    addTailGlow(-0.58, d.tailY, d.tail, 0.75, 0.45);
    addTailGlow(0.58, d.tailY, d.tail, 0.75, 0.45);
  } else if (style === "rx7") {
    // The FD tail: a full-width smoked garnish with twin round lamps at
    // each corner, tucked tight in pairs
    const frame = new THREE.Mesh(roundedBox(1.8, 0.2, 0.05, 0.04), housingMat);
    frame.position.set(0, d.tailY, d.tail - 0.015);
    group.add(frame);
    for (const sx of [-0.76, -0.52, 0.52, 0.76]) {
      const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.04, 14), housingMat);
      bezel.rotation.x = Math.PI / 2;
      bezel.position.set(sx, d.tailY, d.tail - 0.032);
      group.add(bezel);
      // The red lens. It was not here: this was the only tail in the
      // fleet built as bezel-then-core with nothing between them, so
      // the FD's four lamps were a hot orange element sitting in a
      // smoked ring with no red around it, while every other silhouette
      // has three layers. Found by counting the fleet against itself —
      // taillamp-lens came out 0 on this body and 1 to 5 on the rest.
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.05, 14), tailMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(sx, d.tailY, d.tail - 0.044);
      group.add(lens);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.055, 14), tailCoreMat);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(sx, d.tailY, d.tail - 0.056);
      group.add(lamp);
    }
    addTailGlow(-0.64, d.tailY, d.tail, 0.7, 0.42);
    addTailGlow(0.64, d.tailY, d.tail, 0.7, 0.42);
  } else if (style === "zx") {
    // Full-width assembly under the fastback glass: smoked housing frame,
    // the band, and a hotter inner strip running its length
    const frame = new THREE.Mesh(roundedBox(1.86, 0.19, 0.05, 0.03), housingMat);
    frame.position.set(0, d.tailY, d.tail - 0.015);
    group.add(frame);
    const band = new THREE.Mesh(roundedBox(1.78, 0.13, 0.06, 0.025), tailMat);
    band.position.set(0, d.tailY, d.tail - 0.028);
    group.add(band);
    const core = new THREE.Mesh(roundedBox(1.6, 0.045, 0.065, 0.02), tailCoreMat);
    core.position.set(0, d.tailY, d.tail - 0.045);
    group.add(core);
    addTailGlow(-0.6, d.tailY, d.tail, 0.8, 0.4);
    addTailGlow(0.6, d.tailY, d.tail, 0.8, 0.4);
  } else if (style === "hatch") {
    // A hatch wears its lamps in the corners of the tailgate opening,
    // standing tall rather than lying wide: they wrap the D-pillar and
    // they are most of what you recognise the car by from behind.
    for (const sxSign of [-1, 1]) {
      const housing = new THREE.Mesh(roundedBox(0.34, 0.3, 0.05, 0.035), housingMat);
      housing.position.set(sxSign * 0.7, d.tailY, d.tail - 0.005);
      group.add(housing);
      const lens = new THREE.Mesh(roundedBox(0.28, 0.24, 0.06, 0.03), tailMat);
      lens.position.set(sxSign * 0.7, d.tailY, d.tail - 0.015);
      group.add(lens);
      // The lit element is an L: a bar across the top and one down the
      // outboard edge, which is the shape these have carried for decades.
      const bar = new THREE.Mesh(roundedBox(0.24, 0.05, 0.05, 0.016), tailCoreMat);
      bar.position.set(sxSign * 0.7, d.tailY + 0.08, d.tail - 0.032);
      group.add(bar);
      const post = new THREE.Mesh(roundedBox(0.05, 0.2, 0.05, 0.016), tailCoreMat);
      post.position.set(sxSign * 0.79, d.tailY - 0.02, d.tail - 0.032);
      group.add(post);
      addTailGlow(sxSign * 0.7, d.tailY, d.tail, 0.5, 0.5);
    }
  } else {
    // Two wrap-around housings with lens + core, split by the plate
    for (const sxSign of [-1, 1]) {
      const housing = new THREE.Mesh(roundedBox(0.78, 0.17, 0.05, 0.03), housingMat);
      housing.position.set(sxSign * 0.52, d.tailY, d.tail - 0.005);
      group.add(housing);
      const lens = new THREE.Mesh(roundedBox(0.7, 0.11, 0.06, 0.02), tailMat);
      lens.position.set(sxSign * 0.52, d.tailY, d.tail - 0.015);
      group.add(lens);
      const core = new THREE.Mesh(roundedBox(0.62, 0.04, 0.05, 0.015), tailCoreMat);
      core.position.set(sxSign * 0.52, d.tailY, d.tail - 0.032);
      group.add(core);
      addTailGlow(sxSign * 0.52, d.tailY, d.tail, 0.7, 0.4);
    }
  }

  // High-mount third brake light: sedan/gtr at the rear-glass base, and
  // for the gtr a second element in the wing itself; zx on the fastback.
  {
    const cherry = new THREE.Mesh(roundedBox(0.5, 0.035, 0.05, 0.015), tailMat);
    // On the fastbacks it sits on the bodywork itself, which arches
    // 100-160 mm above the profile line it was pinned to; on the sedan
    // and gtr it sits at the base of the rear glass, well above the
    // shell, so those two keep their measured heights.
    if (style === "zx") cherry.position.set(0, (deckY(bGeo, style, -1.98) ?? 0.86) + 0.02, -1.98);
    else if (style === "rx7") cherry.position.set(0, (deckY(bGeo, style, -1.86) ?? 0.8) + 0.02, -1.86);
    else if (style === "gtr") cherry.position.set(0, d.deckY + 0.05, -1.7);
    else cherry.position.set(0, 1.36, -1.28);
    cherry.rotation.x = bCabBack ? -0.5 : -0.2;
    group.add(cherry);
  }

  // Grille, chrome trim, plates, exhausts — all hung off the style dims
  if (!bCabBack) {
    // The Z32 nose is famously grille-less; the others get one
    const grille = new THREE.Mesh(roundedBox(1.05, 0.17, 0.07, 0.02), grilleMat);
    grille.position.set(0, d.grilleY, d.nose);
    group.add(grille);
    const trim = new THREE.Mesh(roundedBox(1.05, 0.025, 0.08, 0.008), chromeLocal);
    trim.position.set(0, d.grilleY + 0.09, d.nose);
    group.add(trim);
    if (style === "hatch") {
      // The stripe across the nose. Every fast version of a hatch has
      // worn one since the seventies, and it is the single cue that
      // separates the quick one from the shopping one at a distance.
      const stripe = new THREE.Mesh(roundedBox(1.44, 0.035, 0.05, 0.012), hotStripeMat);
      stripe.position.set(0, d.grilleY + 0.09, (noseFaceZ(bGeo, style, d.grilleY + 0.09, true) ?? d.nose) - 0.008);
      group.add(stripe);
    }
  } else {
    // Just a thin cooling slot low in the bumper
    const slot = new THREE.Mesh(roundedBox(1.3, 0.07, 0.06, 0.02), grilleMat);
    slot.position.set(0, d.grilleY, (noseFaceZ(bGeo, style, d.grilleY, true) ?? d.nose) - 0.015);
    group.add(slot);
  }
  // Plates hang on the bumper faces. The anchors are the profile's
  // corner points, and the bumper bows out past them by up to 40 mm, so
  // "anchor plus 20" left the front plate inside the FD's nose.
  for (const front of [true, false]) {
    const face = noseFaceZ(bGeo, style, 0.38, front);
    const z =
      face !== null ? face + (front ? 0.008 : -0.008) : front ? d.nose + 0.02 : d.tail - 0.03;
    const plate = new THREE.Mesh(roundedBox(0.52, 0.13, 0.02, 0.007), plateMat());
    plate.position.set(0, 0.38, z);
    group.add(plate);
  }
  // --- Exhaust.
  //
  // Stock keeps whatever arrangement the body style was drawn with — the
  // R34's big bores, the FD's single rotary can, the Z's pair on the left.
  // An aftermarket system replaces all of that with its own, because a
  // system you can hear and not see is half a purchase.
  //
  // The tips also decide where the backfire comes from. That used to be a
  // hardcoded pair at x +-0.34, z -2.08 — which is not where any of these
  // styles put a pipe, and 30 cm forward of the bumper besides, so the
  // flame lit up underneath the boot floor.
  {
    const ex = colors.exhaust ?? EXHAUSTS.stock;
    let xs: number[];
    let r: number;
    let len: number;
    let y: number;
    let mat: THREE.Material;
    let shape: "round" | "square" | "oval" = "round";
    let perSide = 1;
    if (ex.id !== "stock") {
      // Where the CLUSTERS sit, not where the tubes sit. A twin-tube
      // system is one exit split in two, so it hangs two pipes off each
      // of two positions rather than punching four separate holes
      // across the bumper — which is the difference between a car with
      // a split system and a car with four exhausts.
      const clusters = ex.tips / ex.perSide;
      xs =
        clusters === 4
          ? [-0.64, -0.42, 0.42, 0.64]
          : clusters === 1
            ? [-0.5]
            : [-0.5, 0.5];
      r = ex.bore;
      len = 0.24;
      y = 0.26;
      shape = ex.shape;
      perSide = ex.perSide;
      mat =
        ex.finish === "chrome"
          ? chromeLocal
          : ex.finish === "ceramic"
            ? ceramicTipMat
            : ex.finish === "titanium"
              ? titaniumTipMat
              : grilleMat;
    } else if (style === "gtr") {
      xs = [-0.55, 0.55]; r = 0.08; len = 0.22; y = 0.26; mat = chromeLocal;
    } else if (style === "rx7") {
      xs = [-0.5]; r = 0.09; len = 0.24; y = 0.26; mat = chromeLocal;
    } else if (style === "zx") {
      xs = [-0.55, -0.36]; r = 0.057; len = 0.2; y = 0.25; mat = chromeLocal;
    } else {
      xs = [-0.45, 0.45]; r = 0.052; len = 0.18; y = 0.27; mat = grilleMat;
    }
    const z = d.tail + 0.02;
    const origins: THREE.Vector3[] = [];
    /**
     * One tip. Round is a cylinder; square is the same tube with four
     * sides and a chamfer instead of a radius, which is what a squared
     * tip actually is — a rolled edge on a rectangular section, not a
     * box stuck on a pipe. Oval is a cylinder squashed on one axis.
     */
    // An exhaust tip is a TUBE, and every one of these was a solid peg.
    //
    // CylinderGeometry is capped by default, so the mouth was a flat
    // metal disc facing the camera. That is the one part of the car a
    // player looks at for the whole race — you spend it behind your own
    // bumper or behind a rival's — and it read as a stud screwed into
    // the valance rather than as something an engine breathes through.
    //
    // Three parts now: an open outer wall, an inner wall seen from
    // inside it, and a blind floor a little way down. The bore is only
    // built for cars that get detailing; nobody is ever close enough to
    // a traffic car to look down its exhaust, and there are 46 of them.
    const SEG = shape === "oval" ? 18 : 14;
    const bore = r * 0.78;
    const tip = (px: number, py: number): void => {
      let geo: THREE.BufferGeometry;
      if (shape === "square") {
        // A rounded box, so the mouth catches the same specular line a
        // real rolled edge does. Slightly wider than tall, like every
        // squared tip ever fitted to anything.
        geo = roundedBox(r * 2.1, r * 1.55, len, Math.min(r * 0.34, 0.022), 3);
      } else {
        geo = new THREE.CylinderGeometry(r, r * 1.1, len, SEG, 1, !colors.simple);
        geo.rotateX(Math.PI / 2);
        if (shape === "oval") geo.scale(1.5, 0.72, 1);
      }
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, z);
      if (!colors.simple) {
        // The inner wall. Slightly shorter than the outer so the rolled
        // lip of the mouth stays the outer material rather than turning
        // black right at the edge.
        const wall = new THREE.Mesh(
          new THREE.CylinderGeometry(bore, bore, len * 0.92, SEG, 1, true),
          boreMat
        );
        wall.geometry.rotateX(Math.PI / 2);
        if (shape === "oval") wall.geometry.scale(1.5, 0.72, 1);
        wall.position.set(px, py, z + len * 0.04);
        group.add(wall);
        // The blind end, set back down the tube. Depth is what sells it:
        // flush with the mouth it is a black sticker, and a tube you can
        // see through is a hole in the car.
        const floor = new THREE.Mesh(new THREE.CircleGeometry(bore, SEG), boreCapMat);
        if (shape === "oval") floor.geometry.scale(1.5, 0.72, 1);
        // Turned to face OUT of the pipe. A circle's normal is +Z and
        // the tail is at -Z, so an unturned floor shows the camera its
        // back face, gets culled, and the tube reads as a hole through
        // the car — which is worse than the solid peg it replaced.
        floor.rotation.y = Math.PI;
        floor.position.set(px, py, z + len * 0.42);
        group.add(floor);
      }
      // Tagged so the mod test can read the finish off the mesh that was
      // actually built, rather than fishing for a cylinder of the right
      // height — which missed the stock pipes entirely and reported their
      // finish as null.
      m.userData.exhaustPipe = true;
      m.userData.tipShape = shape;
      group.add(m);
      // Just outside the exit face, which is the tail-most end of the pipe.
      origins.push(new THREE.Vector3(px, py, z - len / 2 - 0.04));
    };
    for (const sx of xs) {
      if (perSide === 2) {
        // Stacked rather than side by side: a split system runs one tube
        // over the other out of a single hanger, and stacked is also the
        // only way two tubes fit behind a bumper cut for one.
        tip(sx, y + r * 1.15);
        tip(sx, y - r * 1.15);
      } else {
        tip(sx, y);
      }
    }
    group.userData.exhaustTips = origins;
  }

  // --- Roof furniture: a glass sunroof inset, slim side rails along the
  // panel edges, and an antenna. The bare painted rectangle up top was
  // the last place the car still looked like a toy from above.
  {
    const [rz, ry] = d.roof;
    const sunroofZ = rz + (bCabBack ? 0.28 : 0.18);
    // A crew car wears its colours on the roof, and the roof is not big
    // enough for both. Measured: the panel runs 0.88 m on a Z32 and
    // 1.10 m on an R34, the sunroof eats 0.62 of it, and the R34 puts a
    // shark fin in the 0.22 m behind that — which leaves 0.12 m for an
    // emblem, i.e. a postage stamp. Racing a crew's colours is a choice
    // the player makes deliberately, so it takes the whole panel and the
    // glass roof is what it costs.
    if (!colors.crew || colors.simple) {
      const sunroof = new THREE.Mesh(roundedBox(0.72, 0.02, 0.62, 0.015), glassLocal);
      // On the roof's measured surface, like the rails below it. Seated on
      // the roof ANCHOR — the profile's top line — the glass sat 26 mm
      // under the paint on the saloons and never appeared.
      sunroof.position.set(
        0,
        (deckY(rGeo, style, sunroofZ, "roof") ?? ry) - 0.008,
        sunroofZ
      );
      group.add(sunroof);
    }
    // Roof rails, and only on the saloon roof. They were pinned to the
    // roof anchor, which is the profile's top line — the extrusion's
    // bevel lifts the painted surface ~50 mm above it, so they sat
    // inside the paint on every car in the fleet. Seating them on the
    // measured surface fixes the saloon; on the three sports bodies it
    // makes the problem visible instead, because a fastback roof falls
    // away under a straight rail and it ends up hovering over the glass.
    // A Z32, an FD and an R34 do not have roof rails. So they don't now.
    if (style === "sedan") {
      rGeo.computeBoundingBox();
      const roofBox = rGeo.boundingBox!;
      // Sampled at the rail's own midpoint rather than at the roof's
      // highest point, which is not the same place on a curved panel.
      const seat = deckY(rGeo, style, rz, "roof") ?? roofBox.max.y;
      for (const sxSign of [-1, 1]) {
        const rail = new THREE.Mesh(roundedBox(0.035, 0.025, 1.0, 0.012), housingMat);
        rail.position.set(sxSign * (roofBox.max.x - 0.075), seat + 0.006, rz);
        group.add(rail);
      }
    }
    /** The forward face of anything already standing on the roof. */
    let roofClutterZ = -Infinity;
    if (style === "gtr") {
      // Shark fin at the trailing edge of the roof
      const fin = new THREE.Mesh(roundedBox(0.035, 0.1, 0.22, 0.012), bodyMat);
      fin.position.set(0, ry + 0.04, rz - 0.42);
      fin.rotation.x = -0.25;
      group.add(fin);
      // Measured, not derived. The fin leans back 0.25 rad and carries a
      // 12 mm bevel, so where its nose actually ends is not rz - 0.42
      // plus half of anything — and 6 mm was all the room the crew decal
      // had left beside it when that was assumed rather than asked.
      fin.updateMatrix();
      fin.geometry.computeBoundingBox();
      roofClutterZ = fin.geometry.boundingBox!.clone().applyMatrix4(fin.matrix).max.z;
    } else if (style === "zx") {
      // Period-correct power antenna on the rear quarter
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.42, 6), chromeLocal);
      mast.position.set(0.82, 1.0, -1.86);
      mast.rotation.x = 0.16;
      group.add(mast);
    }

    // --- The crew's colours.
    //
    // The top of teams.ts has promised "a decal baked onto the car's
    // roof" since the file was written, and it had never been built: a
    // crew lived in the hub server's memory, showed up on one lobby
    // card, and no part of the game the player actually drives had heard
    // of it. This is that decal.
    if (colors.crew && !colors.simple) {
      rGeo.computeBoundingBox();
      const roofBox = rGeo.boundingBox!;
      // Fitted to the clear run of panel it lies on rather than to a
      // fixed number: the roofs are 0.88 to 1.40 m long, and on the R34
      // the shark fin takes the back of one. 4:5, emblem over name.
      const rear = Math.max(roofBox.min.z + 0.07, roofClutterZ + 0.04);
      const front = roofBox.max.z - 0.07;
      const depth = Math.min(0.72, front - rear, (roofBox.max.x - 0.05) * 2 * 1.25);
      const width = depth * 0.8;
      const zc = (rear + front) / 2;
      const HALF = depth / 2;
      // A roof crowns across AND along. Levelled against its own two
      // ends, the same way the bonnet decal is, or it sinks into the
      // middle of the panel at one end and lifts off it at the other.
      const yBack = deckY(rGeo, style, zc - HALF, "roof") ?? ry;
      const yFront = deckY(rGeo, style, zc + HALF, "roof") ?? ry;
      const yMid = deckY(rGeo, style, zc, "roof") ?? ry;
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(width, depth),
        decalMat(crewDecalTexture(colors.crew.logo, colors.crew.tag, colors.crew.name))
      );
      plaque.rotation.z = Math.PI; // reads upright from the chase camera
      plaque.rotation.x = -Math.PI / 2 + Math.asin(Math.min(0.6, (yBack - yFront) / depth));
      plaque.position.set(
        0,
        Math.max((yBack + yFront) / 2, yMid) + 0.006,
        zc
      );
      group.add(plaque);
      group.userData.crewDecal = plaque;
    }
  }

  // Side mirrors.
  //
  // Anchored to the flank rather than to an absolute number. The x in
  // StyleDims is now how far PROUD of the bodyside the mirror sits, not
  // where it is — so narrowing a body brings its mirrors in with it
  // instead of leaving them hanging in space, and every silhouette gets
  // the same 90 mm of stalk whatever its width. Over-mirror width is
  // what a driver actually has to thread through a gap, and it was the
  // widest thing on every car in the fleet.
  for (const sxSign of [-1, 1]) {
    const mirror = new THREE.Mesh(roundedBox(0.16, 0.1, 0.2, 0.035), bodyMat);
    mirror.position.set(sxSign * (flankX + d.mirror[0]), d.mirror[1], d.mirror[2]);
    group.add(mirror);
  }

  // Wheels with arches; fronts steer, all spin (engine drives userData.wheels)
  const wheels: THREE.Group[] = [];
  const wzF = style === "zx" ? 1.52 : style === "gtr" || style === "rx7" ? 1.45 : 1.42;
  const wzR = style === "zx" ? -1.48 : style === "gtr" || style === "rx7" ? -1.45 : -1.42;

  /**
   * How long a feature running along the flank is allowed to be.
   *
   * The character line, the beltline and the rocker are panel features:
   * they run between the wheel arches and butt into them. They were
   * fixed at 2.7 and 3.1 m regardless of where the wheels are, so on the
   * short-wheelbase bodies they carried straight on across the arches —
   * 0.41 m into the Zeta's front arch and 0.62 m into its rear one,
   * which is what made the car look like it had two rails bolted down
   * its side.
   *
   * An arch is a circle, so where it starts depends on the height of the
   * feature meeting it: the rocker runs into it half a metre from the
   * wheel centre, the beltline only a quarter of one — and on the taller
   * saloon the beltline clears the arches entirely and is free to run
   * almost the whole flank. One rule gives all three of those.
   */
  const archReach = (edge: number, y: number): number => {
    const dy = Math.abs(y - ARCH_Y);
    return dy >= edge ? 0 : Math.sqrt(edge * edge - dy * dy);
  };
  const FLANK_GAP = 0.03; // panel gap where the feature meets the arch
  /** [length, centre z] for a flank feature at height y. */
  const flankRun = (y: number): [number, number] => {
    const back = wzR + archReach(ARCH_EDGE_R, y) + FLANK_GAP;
    const front = wzF - archReach(ARCH_EDGE_F, y) - FLANK_GAP;
    return [Math.max(0.2, front - back), (front + back) / 2];
  };

  /**
   * How far out the wheels sit.
   *
   * This was 0.84 on every body, which is the number the SALOON wants.
   * The arch opening is drawn on the body's own surface, so on the wider
   * shells it moved outboard with the paint while the wheels stayed put,
   * and the black arch interior came up flush with the tyre: 45 mm of
   * tyre stood proud of it on the saloon, 5 mm on the zx, and on the gtr
   * the opening was 15 mm IN FRONT of the tyre. That is why the Zeta's
   * wheels read as an alloy floating on a flat black hole — there was no
   * tyre left to see, and nothing to give the arch any depth.
   *
   * Held 80 mm inboard of the flank, every car keeps the saloon's
   * relationship: tyre 45 mm proud of the opening, alloy 68 mm proud.
   *
   * The kit then pushes it back out to fill the arch it just gained. A
   * wide arch over a standard track is the one way to make a car look
   * WORSE than it did before the kit: the flare hangs over nothing and
   * the tyre sits at the bottom of a tunnel.
   */
  const wide = WIDE[kit];
  const wheelX = flankX - 0.08 + wide.track;
  for (const [wx, wz] of [
    [-wheelX, wzF],
    [wheelX, wzF],
    [-wheelX, wzR],
    [wheelX, wzR],
  ]) {
    // Steel wheels and covers on a street car, unless the owner has
    // bought something. Gold rims are a purchase and they win — somebody
    // who has spent on wheels is telling you so, and burying that under
    // a hubcap because the kit is still stock would be the game
    // overruling a decision the player paid for.
    const wheelFinish: WheelFinish = colors.raceKit
      ? "bronze"
      : colors.goldRims
        ? "gold"
        : kit === "street"
          ? "steel"
          : "silver";
    const wheel = buildWheel(wheelFinish, Math.sign(wx), {
      detailed: !colors.simple,
      // A bought finish overrides the material; a hubcap does not take
      // one, because the point of it is that nothing was bought.
      spokeMat: wheelFinish === "steel" ? undefined : spokeLocal,
    });
    wheel.position.set(wx, TIRE_RADIUS, wz);
    group.add(wheel);
    wheels.push(wheel);

    // The opening, then the lip around it — both on the body's surface,
    // not at the wheel's centre where they were invisible.
    const front = wz > 0;
    const side = Math.sign(wx);
    const well = new THREE.Mesh(front ? archWellGeoF : archWellGeo, wellMat);
    well.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    well.position.set(side * (flankX + ARCH_OUT), ARCH_MESH_Y, wz);
    well.userData.archWell = true;
    group.add(well);

    // Body-coloured, so it reads as the panel's own edge rather than as
    // a black ring stuck around the wheel.
    const lip = new THREE.Mesh(front ? archLipGeoF : archLipGeo, bodyMat);
    lip.position.set(side * (flankX + LIP_OUT), ARCH_MESH_Y, wz);
    group.add(lip);
    lip.userData.archLip = true;

    // The over-fender.
    //
    // Still not a box. A rounded box laid over the arch does not follow
    // it — it sits across the top with two hard ends and reads as
    // scaffolding. So the flare is the lip's own shape again: the same
    // radius, the same half-turn, a fatter tube and further out. Two
    // arcs that agree about where the wheel is read as one fender with
    // an edge rolled over it, which is what a flare is.
    const tube = wide.proud * FLARE_TUBE_FRAC;
    const flare = new THREE.Mesh(flareGeo(kit, front), bodyMat);
    flare.position.set(side * (flankX + wide.proud - tube), ARCH_MESH_Y, wz);
    flare.userData.archFlare = true;
    group.add(flare);

    // Rivets, on the kits that bolt their arches on rather than bonding
    // them. They are the tell: a moulded flare is smooth and a riveted
    // one is a row of heads following the curve, and at ten metres the
    // row is the only part of it you can actually see.
    if (wide.rivets && !colors.simple) {
      const R = front ? ARCH_R_F : ARCH_R_R;
      for (let i = 0; i < wide.rivets; i++) {
        // Inset from both ends: a rivet on the very end of the arc sits
        // where the flare has already died back into the door.
        const a = ((i + 0.5) / wide.rivets) * Math.PI;
        const rivet = new THREE.Mesh(rivetGeo, seamMat);
        rivet.position.set(
          side * (flankX + wide.proud - tube * 0.15),
          ARCH_MESH_Y + R * Math.sin(a),
          wz - R * Math.cos(a)
        );
        group.add(rivet);
      }
    }
  }

  // --- Bumper assemblies: a black lower valance front and rear so the
  // bumpers read as fitted parts, amber corner reflectors up front and
  // red ones behind — the details every road car actually carries.
  {
    // Seated on the bumper, and as wide as the bumper.
    //
    // Both of these were 1.62 and 1.66 m wide at the profile's nose and
    // tail ANCHOR, plus twenty millimetres. Neither number was a
    // measurement of anything.
    //
    // The anchor is a control point of the 2D profile, and the extrusion
    // carries the painted skin out past it — the comment beside the
    // number plates says exactly this about the same two anchors, "the
    // bumper bows out past them by up to 40 mm". Measured at the height
    // the valance sits at, it is not 40: the skin at the rear runs 125
    // to 180 mm inside where the valance was hung, and at the front up
    // to 424 mm. They were planks floating off each end of the car.
    //
    // And a fixed width fits one silhouette. 1.66 m on bodies whose own
    // half-width runs from 0.9 to 1.04 m covered 83% of the tail on the
    // widest and left a valance visibly narrower than the bumper above
    // it on all of them.
    //
    // So: ask the shell where its skin is at that height, sit the trim's
    // outer face flush with it, and take the width off the flank the
    // same way every other detail on this car does.
    const VALANCE_Y = 0.3;
    const VALANCE_D = 0.1;
    const noseSkinZ = noseFaceZ(bGeo, style, VALANCE_Y, true) ?? d.nose;
    const tailSkinZ = noseFaceZ(bGeo, style, VALANCE_Y, false) ?? d.tail;
    const valanceW = flankX * 2 - 0.14; // inset 70 mm a side, like a real one
    const frontValance = new THREE.Mesh(roundedBox(valanceW, 0.09, VALANCE_D, 0.03), seamMat);
    frontValance.position.set(0, VALANCE_Y, noseSkinZ - VALANCE_D / 2);
    frontValance.userData.trim = "valance-front";
    group.add(frontValance);
    const rearValance = new THREE.Mesh(roundedBox(valanceW, 0.1, VALANCE_D, 0.03), seamMat);
    rearValance.position.set(0, VALANCE_Y, tailSkinZ + VALANCE_D / 2);
    rearValance.userData.trim = "valance-rear";
    group.add(rearValance);
    // Corner markers. These were mounted on the nose and tail faces at a
    // fixed inset from the anchor, which buried them 30–60 mm inside the
    // bumper on every silhouette: four meshes per car, on fourteen cars,
    // that never painted a pixel. They are side markers now — out on the
    // flank ahead of the front arch and behind the rear one, where the
    // body runs at full width, which is both where a real car carries
    // them and a place that can be derived from the shell's own bounds
    // instead of guessed per style.
    const markerGeo = roundedBox(0.016, 0.07, 0.16, 0.006);
    for (const sxSign of [-1, 1]) {
      const amber = new THREE.Mesh(markerGeo, amberReflectorMat);
      amber.position.set(sxSign * (flankX + 0.002), 0.5, d.nose - 0.34);
      group.add(amber);
      const red = new THREE.Mesh(markerGeo, reflectorMat);
      red.position.set(sxSign * (flankX + 0.002), 0.5, d.tail + 0.34);
      group.add(red);
    }
  }

  // Contact shadow blob — all cars, traffic included. Sits above the lane
  // paint (y 0.03) so it darkens markings like a real shadow. Exposed via
  // userData so the engine can re-parent it off the pitching player body.
  const contact = new THREE.Mesh(contactGeo, contactMat());
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.035;
  contact.userData.noShadow = true;
  group.add(contact);
  group.userData.contact = contact;

  // ---- Fine detailing (skipped for traffic to keep draw calls down)
  if (!colors.simple) {
    // Shut lines: hood, doors and trunk. Real panel gaps are dark slots
    // between two lit chamfers, so they get their own near-black material.
    // Every one of these rides on the flank, and every one of them was
    // pinned to 0.925 — five millimetres outside the SEDAN's skin, and
    // 35 to 55 mm inside the skin of the four wide silhouettes. Offsets
    // from the shell's own half-width keep the same relationship to the
    // panel on all of them. Their LENGTHS come from the arches — see
    // flankRun — so each one ends where the wheel opening starts.
    const [creaseLen, creaseZ] = flankRun(d.creaseY);
    const [beltLen, beltZ] = flankRun(d.beltY);
    const [rockerLen, rockerZ] = flankRun(0.25);
    for (const sxSign of [-1, 1]) {
      for (const sz of [0.62, -0.72]) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.5, 0.012), gapMat);
        seam.position.set(sxSign * (flankX + 0.005), 0.58, sz);
        group.add(seam);
      }
      // Character line — the crease that runs the flank of every modern
      // car and catches a long highlight as the world slides past
      const crease = new THREE.Mesh(roundedBox(0.035, 0.05, creaseLen, 0.016), bodyMat);
      crease.position.set(sxSign * (flankX + 0.01), d.creaseY, creaseZ);
      group.add(crease);
      const belt = new THREE.Mesh(roundedBox(0.015, 0.02, beltLen, 0.006), chromeLocal);
      belt.position.set(sxSign * (flankX + 0.005), d.beltY, beltZ);
      group.add(belt);
      for (const hz of [0.28, -1.02]) {
        const handle = new THREE.Mesh(roundedBox(0.03, 0.035, 0.14, 0.012), chromeLocal);
        handle.position.set(sxSign * (flankX + 0.005), d.creaseY + 0.08, hz);
        group.add(handle);
      }
      const skirt = new THREE.Mesh(roundedBox(0.06, 0.12, rockerLen, 0.02), seamMat);
      skirt.position.set(sxSign * (flankX - 0.023), 0.25, rockerZ);
      group.add(skirt);
    }

    // Hood and trunk shut lines across the top surfaces
    const hoodGap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.012, 0.016), gapMat);
    const hoodGapZ = bCabBack ? 0.65 : 1.06;
    hoodGap.position.set(0, skinY(hoodGapZ, d.hoodY) + 0.002, hoodGapZ);
    group.add(hoodGap);
    const trunkGap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.012, 0.016), gapMat);
    trunkGap.position.set(0, skinY(-1.42, d.deckY) + 0.002, -1.42);
    group.add(trunkGap);
    for (const sx of [-0.86, 0.86]) {
      const hoodSide = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 1.0), gapMat);
      const hsZ = bCabBack ? 1.2 : 1.55;
      hoodSide.position.set(sx, skinY(hsZ, d.hoodY) + 0.002, hsZ);
      group.add(hoodSide);
    }

    if (style === "gtr") {
      // Power bulge and the NACA-ish vents either side of it
      const bulge = new THREE.Mesh(roundedBox(0.72, 0.06, 1.0, 0.03), bodyMat);
      bulge.position.set(0, skinY(1.55, d.hoodY) + 0.02, 1.55);
      group.add(bulge);
      for (const sx of [-0.55, 0.55]) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.015, 0.4), gapMat);
        vent.position.set(sx, skinY(1.5, d.hoodY) + 0.004, 1.5);
        group.add(vent);
      }
      // The boxed fender flares that used to live here are gone: every
      // car in the game wears a real arch flare now, traced on the arch
      // itself, and these sat across the top of the same four wheels at
      // a hardcoded ±0.96 — inboard of this silhouette's own 0.9925
      // flank. Two flares over one wheel, one of them sunk in the paint.
      // The gtr keeps its calling card by being in the widest band.
    }
    if (style === "zx") {
      // Cooling slats let into the long hood
      for (const sx of [-0.5, 0.5]) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.014, 0.5), gapMat);
        slat.position.set(sx, skinY(1.45, d.hoodY) + 0.004, 1.45);
        group.add(slat);
      }
    }

    // Front splitter, rear diffuser fins, antenna, grille badge
    const splitter = new THREE.Mesh(roundedBox(1.72, 0.05, 0.3, 0.016), seamMat);
    splitter.position.set(0, 0.2, d.nose + 0.01);
    group.add(splitter);
    for (const fx of style === "gtr" ? [-0.6, -0.2, 0.2, 0.6] : [-0.45, 0, 0.45]) {
      const fin = new THREE.Mesh(roundedBox(0.04, 0.11, 0.28, 0.013), seamMat);
      fin.position.set(fx, 0.21, d.tail + 0.02);
      group.add(fin);
    }
    if (style === "sedan") {
      const fin = new THREE.Mesh(roundedBox(0.035, 0.11, 0.24, 0.012), bodyMat);
      fin.position.set(0, 1.5, -0.72);
      fin.rotation.x = -0.25;
      group.add(fin);
    }
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), chromeLocal);
    badge.rotation.x = Math.PI / 2;
    badge.position.set(0, d.noseTopY, d.nose + 0.01);
    group.add(badge);

    // Indicators + reverse lights
    for (const sx of [-0.86, 0.86]) {
      const ind = new THREE.Mesh(roundedBox(0.13, 0.08, 0.05, 0.015), indicatorMat);
      ind.position.set(sx, d.grilleY + 0.06, d.nose - 0.03);
      group.add(ind);
    }
    for (const sx of [-0.55, 0.55]) {
      const rev = new THREE.Mesh(roundedBox(0.16, 0.06, 0.04, 0.013), reverseMat);
      rev.position.set(sx, d.tailY - 0.14, d.tail + 0.01);
      group.add(rev);
    }

    // Interior silhouettes behind the glass: dashboard + headrests
    const dash = new THREE.Mesh(roundedBox(1.45, 0.13, 0.34, 0.03), interiorMat);
    dash.position.set(0, d.dashY, bCabBack ? 0.15 : 0.5);
    group.add(dash);
    // Behind the head, at the height of the head — off the same fit the
    // driver is seated by, not off the dash. Hung off the dash it stayed
    // put while he moved, which on the pony left a headrest 400 mm in
    // front of the man it was supposed to be behind.
    for (const sx of [-DRIVER_X, DRIVER_X]) {
      const headrest = new THREE.Mesh(roundedBox(0.26, 0.22, 0.12, 0.04), interiorMat);
      headrest.position.set(sx, seatY + driverHeadTop() - 0.14, headZ - 0.15);
      group.add(headrest);
    }

    // Brake calipers peeking through the spokes.
    //
    // Taken from wheelX rather than the sedan's old 0.84, because a
    // caliper lives inside a wheel and the wheels are not where they
    // were: the wide kits push the track out by up to 70 mm, and on the
    // zx the flank is 120 mm outboard of that constant to begin with. A
    // caliper that does not follow its own wheel is a caliper floating
    // in the middle of the car.
    for (const [wx, wz] of [
      [-wheelX, wzF],
      [wheelX, wzF],
      [-wheelX, wzR],
      [wheelX, wzR],
    ]) {
      const caliper = new THREE.Mesh(
        roundedBox(0.06, 0.17, 0.11, 0.02),
        colors.raceKit ? tealCaliperMat : caliperMat
      );
      caliper.position.set(wx * 0.93, 0.42, wz + 0.11);
      group.add(caliper);
    }

    // B-pillars split the side glass into door windows
    for (const sxSign of [-1, 1]) {
      const pillar = new THREE.Mesh(roundedBox(0.025, 0.44, 0.07, 0.008), bodyMat);
      pillar.position.set(sxSign * d.bPillar[0], d.bPillar[1], d.bPillar[2]);
      group.add(pillar);
    }

    // Windshield wipers parked at the glass base
    for (const [wxp, rz] of [
      [-0.35, 0.12],
      [0.28, 0.18],
    ]) {
      const wiper = new THREE.Mesh(roundedBox(0.5, 0.014, 0.025, 0.005), seamMat);
      wiper.position.set(wxp, skinY(d.wiperZ, d.hoodY) + 0.008, d.wiperZ);
      wiper.rotation.x = -0.66;
      wiper.rotation.z = rz;
      group.add(wiper);
    }

    // Lower intake + fog lights complete the front fascia
    const intake = new THREE.Mesh(
      roundedBox(style === "gtr" ? 1.5 : 1.3, style === "gtr" ? 0.2 : 0.13, 0.06, 0.02),
      grilleMat
    );
    intake.position.set(0, style === "gtr" ? 0.4 : 0.34, d.nose - 0.01);
    group.add(intake);
    for (const sx of [-0.66, 0.66]) {
      // In front of the intake, not level with it. Sharing the intake's
      // z put each 30 mm lamp wholly inside the 60 mm grille box.
      const fog = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), reverseMat);
      fog.rotation.x = Math.PI / 2;
      fog.position.set(sx, 0.36, d.nose + 0.035);
      group.add(fog);
    }

    // Mirror glass + a muffler box feeding the exhaust tips
    for (const sxSign of [-1, 1]) {
      // Same anchor as the housing it sits in. When d.mirror[0] changed
      // from an absolute x to an offset from the flank, this line kept
      // reading it as an absolute — so both mirror glasses moved to
      // within 30 mm of the centreline and sat inside the bodywork. The
      // mesh audit found them; nothing else would have.
      const mGlass = new THREE.Mesh(roundedBox(0.12, 0.07, 0.012, 0.005), chromeMat);
      mGlass.position.set(sxSign * (flankX + d.mirror[0]), d.mirror[1], d.mirror[2] - 0.1);
      group.add(mGlass);
    }
    const muffler = new THREE.Mesh(roundedBox(1.0, 0.1, 0.3, 0.03), grilleMat);
    muffler.position.set(0, 0.23, -1.92);
    group.add(muffler);
    // Where backfire and nitrous flames are born, in car-local space:
    // the tips themselves, recorded when they were built.

    // Fuel filler door on the right rear quarter.
    //
    // Both numbers here used to be absolute — x 0.945 and z -1.55 — and
    // both were wrong in the way this file keeps finding: 0.945 is the
    // saloon's flank, so on the four wide silhouettes the cap sank into
    // the paint, and -1.55 is only 150 mm behind the rear axle, which
    // puts a fuel filler INSIDE the rear tyre. It went unseen because
    // the tyre used to be small enough to leave 65 mm of daylight round
    // it; the moment the wheels were fitted to the cars, six machines
    // came back from check:fleet with a filler cap buried in the rubber.
    //
    // So it is placed the way every other flank detail on the car is:
    // on the shell's own surface, and behind where the arch actually
    // reaches AT THIS HEIGHT — which is what archReach answers.
    const FILLER_R = 0.055;
    const fillerY = d.creaseY + 0.09;
    const fillerZ =
      wzR - archReach(ARCH_EDGE_R, fillerY) - FLANK_GAP - FILLER_R;
    const filler = new THREE.Mesh(
      new THREE.CylinderGeometry(FILLER_R, FILLER_R, 0.012, 12),
      bodyMat
    );
    filler.rotation.z = Math.PI / 2;
    filler.position.set(flankX + 0.005, fillerY, fillerZ);
    group.add(filler);
    const fillerRing = new THREE.Mesh(
      new THREE.TorusGeometry(FILLER_R, 0.006, 6, 14),
      gapMat
    );
    fillerRing.rotation.y = Math.PI / 2;
    fillerRing.position.set(flankX + 0.008, fillerY, fillerZ);
    group.add(fillerRing);

    if (style === "gtr") {
      // Rear wiper parked across the hatch glass
      const rwiper = new THREE.Mesh(roundedBox(0.34, 0.013, 0.022, 0.005), seamMat);
      rwiper.position.set(0.12, 1.12, -1.42);
      rwiper.rotation.x = 0.9;
      rwiper.rotation.z = 0.25;
      group.add(rwiper);
    }
  }

  // Time-attack aero — the whole catalogue at once, factory-fitted.
  // Modelled on the classic yellow FD time-attack formula: swan-neck GT
  // wing, front splitter, canards, vented hood, skirts and a diffuser.
  // --- The sport kit: a real wing, a splitter and skirts.
  //
  // Everything between the street flare and the full attack build. It is
  // its own step rather than "attack minus some parts" because the two
  // are different intentions: this is a fast road car that has been got
  // at, and the attack kit is a car built to a regulation. A post wing
  // and a lip splitter say the first; canards and a swan neck say the
  // second, and putting canards on a Salmiya Turbo says neither.
  //
  // Skipped on traffic, which never gets closer than a lane away.
  if (kitAtLeast(kit, "sport") && !colors.raceKit && !colors.simple) {
    // A two-post wing on the deck: taller and wider than the factory
    // blade, nothing like the swan-neck plank the attack cars carry.
    const wingY = d.deckY + 0.3;
    for (const sx of [-0.6, 0.6]) {
      const post = new THREE.Mesh(roundedBox(0.045, 0.26, 0.14, 0.014), carbonMat);
      post.position.set(sx, d.deckY + 0.14, -1.92);
      group.add(post);
    }
    const plane = new THREE.Mesh(roundedBox(1.62, 0.042, 0.36, 0.014), bodyMat);
    plane.position.set(0, wingY, -1.95);
    plane.rotation.x = -0.14;
    group.add(plane);
    for (const sx of [-0.81, 0.81]) {
      const endplate = new THREE.Mesh(roundedBox(0.026, 0.2, 0.4, 0.01), carbonMat);
      endplate.position.set(sx, wingY, -1.95);
      group.add(endplate);
    }
    // Lip splitter — a blade off the bumper, not the full undertray.
    const lip = new THREE.Mesh(roundedBox(1.74, 0.03, 0.34, 0.011), carbonMat);
    lip.position.set(0, 0.17, d.nose - 0.02);
    group.add(lip);
    // Side skirts, seated on the same flank run the attack skirts use so
    // they stop at the arches instead of running through them.
    for (const sxSign of [-1, 1]) {
      const [kitLen, kitZ] = flankRun(0.17);
      const skirt = new THREE.Mesh(roundedBox(0.06, 0.08, kitLen, 0.018), carbonMat);
      skirt.position.set(sxSign * (flankX + 0.012), 0.17, kitZ);
      group.add(skirt);
    }
  }

  // --- The street kit: a boot lip and nothing that needs a spanner.
  //
  // The cheapest cars in the game are still built — they just are not
  // built LOUD. A ducktail lip and the arches are the whole of it, which
  // is what a first car on this road actually looks like.
  if (kit === "street" && !colors.spoiler && !colors.simple) {
    const lipZ = d.tail + 0.34;
    const seat = skinY(lipZ, d.deckY);
    const duck = new THREE.Mesh(roundedBox(1.44, 0.055, 0.26, 0.02), bodyMat);
    duck.position.set(0, seat + 0.03, lipZ);
    duck.rotation.x = -0.22;
    group.add(duck);
  }

  // ----------------------------------------------- the base-spec car
  //
  // A street car used to differ from a built one only by ABSENCE: no
  // flares, no skirts, no wing, and otherwise the same machine. That is
  // how you make the cheap cars look unfinished rather than cheap.
  //
  // These are the three things a base-model car on this road actually
  // HAS that a built one does not, and each reads from ten metres:
  // covers over steel wheels (above), a whip aerial on the roof, and
  // the sun band across the top of the windscreen that half the cars in
  // this country wear because the sun here is not a metaphor.
  if (kit === "street" && !colors.simple) {
    // The aerial. A thin mast is nearly invisible in a still and
    // unmistakable in motion, because it is the one part of the car
    // that moves against the sky.
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.011, 0.52, 5),
      seamMat
    );
    mast.position.set(flankX - 0.16, d.roof[1] + 0.24, d.roof[0] + 0.18);
    mast.rotation.z = 0.12; // raked back, the way a whip sits
    mast.rotation.x = -0.16;
    group.add(mast);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.035, 0.035, 8),
      seamMat
    );
    base.position.set(flankX - 0.16, d.roof[1] + 0.005, d.roof[0] + 0.18);
    group.add(base);

    // The sun band: a tinted strip across the top of the screen, dark
    // at the edges and clearing toward the middle where a driver
    // actually looks out. Emissive-free and nearly opaque, so at night
    // it reads as a black band rather than as glass.
    const band = new THREE.Mesh(
      roundedBox(1.28, 0.16, 0.02, 0.008),
      new THREE.MeshStandardMaterial({
        name: "sun-band",
        color: 0x0d1014,
        roughness: 0.35,
        metalness: 0.1,
        transparent: true,
        opacity: 0.82,
      })
    );
    band.position.set(0, d.beltY + 0.42, d.wiperZ + 0.16);
    band.rotation.x = -0.5; // lies along the screen's rake
    group.add(band);
  }

  if (colors.raceKit) {
    // Swan-neck GT wing, twice the garage part: tall carbon stays, a
    // body-colour main plane and big endplates
    const wingY = d.deckY + 0.58;
    for (const sx of [-0.55, 0.55]) {
      const stay = new THREE.Mesh(roundedBox(0.05, 0.55, 0.22, 0.016), carbonMat);
      stay.position.set(sx, d.deckY + 0.28, -1.88);
      stay.rotation.x = 0.16; // swept back into the plane
      group.add(stay);
    }
    const plane = new THREE.Mesh(roundedBox(1.95, 0.045, 0.5, 0.015), bodyMat);
    plane.position.set(0, wingY, -2.02);
    plane.rotation.x = -0.18;
    group.add(plane);
    // Gurney flap on the trailing edge + brake strip beneath it
    const gurney = new THREE.Mesh(roundedBox(1.9, 0.05, 0.02, 0.006), carbonMat);
    gurney.position.set(0, wingY + 0.06, -2.25);
    group.add(gurney);
    // Brake strip on the wing's trailing edge. Slung under the main
    // plane it was in the plane's own shadow from every angle above the
    // car — which is every angle the game is ever seen from. It tucks
    // under the gurney and projects past the trailing edge instead, so a
    // following car actually sees it light up.
    const strip = new THREE.Mesh(roundedBox(1.0, 0.028, 0.09, 0.008), tailMat);
    strip.position.set(0, wingY + 0.028, -2.285);
    group.add(strip);
    for (const sx of [-0.99, 0.99]) {
      const endplate = new THREE.Mesh(roundedBox(0.03, 0.3, 0.54, 0.012), carbonMat);
      endplate.position.set(sx, wingY, -2.02);
      group.add(endplate);
    }

    // Front splitter jutting past the bumper, low enough to scrape
    const splitter = new THREE.Mesh(roundedBox(1.95, 0.035, 0.7, 0.012), carbonMat);
    splitter.position.set(0, 0.14, d.nose - 0.18);
    group.add(splitter);

    // Canards: two per corner, biting the air off the bumper sides
    for (const sxSign of [-1, 1]) {
      for (const [cy, cz] of [
        [0.34, -0.14],
        [0.47, -0.22],
      ]) {
        const canard = new THREE.Mesh(roundedBox(0.3, 0.018, 0.18, 0.007), carbonMat);
        // On the bumper's own corner, not at the sedan's old 0.85 —
        // which is 190 mm inside the front of a zx and hangs off a
        // hatch. A canard bites the air coming off the corner; put it
        // anywhere else and it is a carbon shelf.
        canard.position.set(sxSign * (flankX - 0.06), cy, d.nose + cz);
        canard.rotation.z = sxSign * 0.3;
        canard.rotation.x = -0.25;
        group.add(canard);
      }
    }

    // Vented hood: twin extraction louvres and a pair of intake scoops
    for (const sx of [-0.36, 0.36]) {
      const louvre = new THREE.Mesh(roundedBox(0.34, 0.025, 0.5, 0.009), carbonMat);
      louvre.position.set(sx, skinY(1.15, d.hoodY) + 0.015, 1.15);
      louvre.rotation.x = -0.06; // follows the hood's fall
      group.add(louvre);
      const scoop = new THREE.Mesh(roundedBox(0.16, 0.07, 0.22, 0.02), carbonMat);
      scoop.position.set(sx * 1.4, skinY(0.62, d.hoodY) + 0.05, 0.62);
      group.add(scoop);
    }

    // Side skirts hugging the rockers
    for (const sxSign of [-1, 1]) {
      const [kitLen, kitZ] = flankRun(0.16);
      const skirt = new THREE.Mesh(roundedBox(0.08, 0.1, kitLen, 0.022), carbonMat);
      skirt.position.set(sxSign * (flankX + 0.01), 0.16, kitZ);
      group.add(skirt);
    }

    // Rear diffuser kicking up between the exhaust and the bumper
    const diffuser = new THREE.Mesh(roundedBox(1.7, 0.03, 0.5, 0.01), carbonMat);
    diffuser.position.set(0, 0.18, d.tail + 0.12);
    diffuser.rotation.x = 0.35;
    group.add(diffuser);
    for (const fx of [-0.4, 0, 0.4]) {
      const fin = new THREE.Mesh(roundedBox(0.02, 0.1, 0.4, 0.007), carbonMat);
      fin.position.set(fx, 0.2, d.tail + 0.1);
      fin.rotation.x = 0.35;
      group.add(fin);
    }

    // Red tow hook on the splitter — scrutineering says so. Its own
    // material rather than the caliper's: it was borrowing that one for
    // the colour, which made every kit car read as having five brake
    // calipers on four wheels to anything counting parts.
    const hook = new THREE.Mesh(roundedBox(0.1, 0.035, 0.12, 0.012), towHookMat);
    hook.position.set(0.45, 0.19, d.nose + 0.08);
    group.add(hook);
  }

  // The zx leaves the factory with a rear wing on the hatch — a low
  // two-post blade, not a bolt-on GT plank. Without it the tail is a
  // bare sheet from the glass to the bumper, which is the one thing that
  // made this silhouette read as unfinished from behind. It steps aside
  // for either aftermarket wing rather than stacking with them.
  // A hatch's spoiler is a lip off the roof's trailing edge, over the
  // glass — not a plank on a boot it does not have. Seated on the roof
  // panel's own measured surface so it sits ON the car whatever the
  // extrusion's bevel does.
  if (style === "hatch" && !colors.spoiler && !colors.raceKit) {
    const [rz] = d.roof;
    const lipZ = rz - 0.62;
    const seat = deckY(rGeo, style, Math.min(lipZ + 0.1, rz), "roof") ?? d.roof[1];
    const lip = new THREE.Mesh(roundedBox(1.42, 0.05, 0.34, 0.018), bodyMat);
    lip.position.set(0, seat - 0.02, lipZ);
    lip.rotation.x = 0.32; // follows the hatch glass down
    group.add(lip);
    for (const sx of [-0.66, 0.66]) {
      const fin = new THREE.Mesh(roundedBox(0.05, 0.09, 0.26, 0.016), bodyMat);
      fin.position.set(sx, seat - 0.05, lipZ - 0.02);
      fin.rotation.x = 0.32;
      group.add(fin);
    }
  }

  if (style === "zx" && !colors.spoiler && !colors.raceKit) {
    const wz = -1.98;
    const deck = deckY(bGeo, style, wz) ?? d.deckY + 0.12;
    for (const sx of [-0.66, 0.66]) {
      const post = new THREE.Mesh(roundedBox(0.07, 0.13, 0.2, 0.02), bodyMat);
      post.position.set(sx, deck + 0.05, wz);
      group.add(post);
    }
    const blade = new THREE.Mesh(roundedBox(1.66, 0.045, 0.36, 0.016), bodyMat);
    blade.position.set(0, deck + 0.125, wz - 0.02);
    blade.rotation.x = -0.07;
    group.add(blade);
    // A lip turned up at the trailing edge, which is what the real ones
    // have and what stops the blade reading as a shelf.
    const lip = new THREE.Mesh(roundedBox(1.62, 0.05, 0.02, 0.008), bodyMat);
    lip.position.set(0, deck + 0.15, wz - 0.19);
    group.add(lip);
  }

  // GT wing — always the player's choice: equip the part or run clean
  // (the attack kit brings its own swan-neck; don't stack two wings)
  if (colors.spoiler && !colors.raceKit) {
    const baseY = d.deckY + 0.18;
    for (const sx of [-0.62, 0.62]) {
      const strut = new THREE.Mesh(roundedBox(0.06, 0.26, 0.16, 0.016), seamMat);
      strut.position.set(sx, baseY, -1.95);
      group.add(strut);
    }
    const wing = new THREE.Mesh(roundedBox(1.8, 0.04, 0.42, 0.013), bodyMat);
    wing.position.set(0, baseY + 0.15, -1.98);
    wing.rotation.x = -0.12;
    group.add(wing);
    // Brake strip on the wing's trailing edge — behind it and just under
    // it, not inside it. At z -2.17 it sat within the blade's own depth
    // and never showed on any car that fitted this wing.
    const strip = new THREE.Mesh(roundedBox(0.9, 0.025, 0.09, 0.008), tailMat);
    strip.position.set(0, baseY + 0.155, -2.245);
    group.add(strip);
    for (const sx of [-0.88, 0.88]) {
      const endplate = new THREE.Mesh(roundedBox(0.03, 0.16, 0.4, 0.01), seamMat);
      endplate.position.set(sx, baseY + 0.15, -1.98);
      group.add(endplate);
    }
  }

  // ------------------------------------------------------------ stickers
  // The rally pack, hung a centimetre off the panels. Decal planes rather
  // than UV work because the shells are swapped for Blender geometry at
  // runtime — planes survive that swap untouched.
  // A livery comes with the kit from the sport step up. The Rally
  // Sticker Pack is still a garage part and still the only way a BASIC
  // car gets one — which is the point of it: on the bottom shelf a
  // livery is something you chose, and further up it is what the car
  // came wearing. Buying the pack for a car that already has one is
  // idempotent rather than doubled, because this is one flag.
  // The full-length graphic goes on FIRST and low, under the rally pack's
  // lane rather than in it. Everything that pack places lives between the
  // crease and the beltline; this sits below the crease on the lower
  // door, so the two can be worn together without a clearance rule
  // between them — which is the only way five silhouettes stay safe
  // without a table of exceptions per body.
  if (colors.fullStripe && !colors.simple) {
    // In the BELTLINE lane, not down by the sill.
    //
    // It was at the sill first, tucked into the clear band under the
    // wordmark so that nothing had to give way to it. The measurements
    // were all green and the render settled it: at that height the
    // graphic sits in the shade under the body with the wheels across
    // it, and a full-length sticker nobody can see is not a sticker. The
    // numbers said "it fits"; they cannot say "you can see it".
    //
    // So it takes the lane a side graphic actually occupies, and passes
    // UNDER the pack's roundel, flag and wordmark rather than dodging
    // them — 12 mm off the paint against their 22, which is how a real
    // livery is built: the stripe runs the length of the car and the
    // numbers sit on top of it. The pack's own beltline stripe is the
    // one thing that does give way, because two stripes in one lane is
    // just a shorter stripe drawn over a longer one.
    const yMid = d.beltY - BELT_STRIPE_DROP;
    const skin = decalMat(fullStripeTexture());
    for (const sign of [-1, 1] as const) {
      // Sampled past both bumpers on purpose: columns that find no body
      // are dropped, so the run ends itself exactly where the shell does.
      const geo = flankRibbon(bodyShell, sign, d.tail - 0.25, d.nose + 0.25, yMid, BELT_STRIPE_H, 0.012, 192);
      if (!geo) continue;
      const strip = new THREE.Mesh(geo, skin);
      strip.userData.decal = "full-stripe";
      group.add(strip);
    }
  }

  const wearsLivery = colors.stickers || (kitAtLeast(kit, "sport") && !colors.simple);
  if (wearsLivery && !colors.simple) {
    // Off the shell's measured flank, not a hand-kept table of the four
    // half-widths. The table happened to be right, but it was a second
    // place to remember when a body changes.
    const sideX = flankX + 0.014;
    const num =
      colors.stickerNumber ??
      ((((colors.body * 2654435761) >>> 0) % 90) + 10);

    const roundel = decalMat(roundelTexture(num));
    const stripe = decalMat(beltStripeTexture());
    const flag = decalMat(flagDecalTexture());
    const demon = decalMat(demonMarkTexture());
    const nameDecal = colors.name
      ? decalMat(nameDecalTexture(colors.name, colors.nameAr))
      : null;
    // Four decals and a stripe on one flank need lanes, or they land on
    // each other: the wordmark went straight under the roundel and the
    // horned mark disappeared into the stripe's tail. Front fender, door,
    // rear quarter — and the stripe stops before the quarter so the mark
    // has clean paint to sit on. The roundel is the deliberate exception,
    // interrupting the stripe the way a rally door number does.
    // The beltline stripe and the flag share the front of this run, and
    // the stripe gives way to it.
    //
    // The flag is 440 mm now rather than 240, and there is nowhere else
    // for it to go: measured on all five bodies, the band below the
    // stripe is already the wordmark's, and the clear flank at that
    // lower height stops 130 mm sooner than it does at the belt, because
    // a wheel arch is widest at the bottom. So the flag takes the front
    // of the beltline run and the stripe stops short of it — which is
    // what the stripe already does at the other end for the crew mark,
    // and reads as rally livery rather than as two decals fighting.
    const stripeY = d.beltY - BELT_STRIPE_DROP;
    const [beltRun, beltCtr] = flankRun(stripeY);
    const runFront = beltCtr + beltRun / 2;
    const runBack = beltCtr - beltRun / 2;
    // How tall a flag the fender will actually take.
    //
    // A flank is not a blank panel. The character crease is a 35 mm
    // moulding 50 mm tall standing proud of the paint, and the chrome
    // belt is another above it, and a flat decal cannot follow either of
    // them — put a 220 mm flag across the crease and the crease draws
    // over its bottom third, which is exactly how the first bigger
    // version came out. So the flag is sized to the CLEAR BAND between
    // the two mouldings, with a 15 mm margin off each, and comes out
    // 310 to 370 mm long depending on the body. That is a third to a
    // half again on the 240 mm it was, and it is as big as the panel
    // will honestly carry.
    const bandBot = d.creaseY + 0.025 + 0.015;
    const bandTop = d.beltY - 0.01 - 0.015;
    const FLAG_H = Math.min(0.2, bandTop - bandBot);
    const FLAG_L = FLAG_H * 2;
    const flagY = (bandBot + bandTop) / 2;
    const flagZ = runFront - 0.04 - FLAG_L / 2;
    const stripeFront = flagZ - FLAG_L / 2 - 0.06;
    const stripeLen = Math.max(0.3, stripeFront - runBack);
    const stripeZ = (stripeFront + runBack) / 2;
    for (const sign of [-1, 1]) {
      const x = sign * (sideX + 0.008);
      const flipY = sign * (Math.PI / 2);
      // Beltline stripe: the spine everything else is placed around. It
      // stops at the arches like the panel features do, rather than
      // running over a wheel opening.
      if (!colors.fullStripe) {
        const st = new THREE.Mesh(new THREE.PlaneGeometry(stripeLen, BELT_STRIPE_H), stripe);
        st.position.set(sign * sideX, stripeY, stripeZ);
        st.rotation.y = flipY;
        group.add(st);
      }
      // Kuwait flag on the front fender, behind the arch. 440 mm long
      // rather than 240: a flag on a rally car is a flag, and at the old
      // size it was a coloured smudge you had to be told about.
      //
      // Its height is measured DOWN FROM THE BELTLINE STRIPE rather than
      // taken off the crease, so it cannot collide with the stripe by
      // construction. At the new size, hung off the crease, it did on
      // every silhouette in the fleet — the sedan by a centimetre, the
      // FD by three.
      const f = new THREE.Mesh(new THREE.PlaneGeometry(FLAG_L, FLAG_H), flag);
      f.position.set(x, flagY, flagZ);
      f.rotation.y = flipY;
      group.add(f);
      // Door: racing number over the car's own name. Its z is held
      // behind whatever the stripe now ends at, so on the shortest flank
      // in the fleet — the FD's, where the run gives the flag 130 mm
      // less to work with — the number slides back rather than ending up
      // under the flag's trailing edge.
      const roundelZ = Math.min(0.35, stripeFront - 0.19);
      const r = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), roundel);
      r.position.set(x, d.creaseY + 0.12, roundelZ);
      r.rotation.y = flipY;
      group.add(r);
      if (colors.name) {
        const word = new THREE.Mesh(new THREE.PlaneGeometry(0.86, WORDMARK_H), nameDecal!);
        word.position.set(sign * (sideX + 0.004), d.creaseY - WORDMARK_DROP, roundelZ);
        word.rotation.y = flipY;
        group.add(word);
      }
      // The crew's horned mark on the rear quarter, clear of the stripe
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), demon);
      mark.position.set(x, d.beltY - 0.02, -1.45);
      mark.rotation.y = flipY;
      group.add(mark);
    }
    // Falcon swoosh flat on the hood, nosed toward the windshield
    const hood = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.85),
      decalMat(hoodDecalTexture())
    );
    // Laid ON the hood, which is a slope and not a table. A flat plane
    // set to the skin height at its centre has its back half inside the
    // bonnet and its front half floating: 0.85 m of decal spans 100 mm
    // of fall on the long-nosed bodies. Both ends are measured and the
    // plane is pitched to match.
    const hoodDecalZ = bCabBack ? 1.15 : 1.45;
    const HALF = 0.425;
    const yBack = skinY(hoodDecalZ - HALF, d.hoodY);
    const yFront = skinY(hoodDecalZ + HALF, d.hoodY);
    hood.rotation.z = Math.PI; // read the right way up from the driver's seat
    hood.rotation.x = -Math.PI / 2 + Math.asin(Math.min(0.6, (yBack - yFront) / (2 * HALF)));
    // A little more than a decal's clearance, because the bonnet bows
    // between the two points this is levelled against.
    hood.position.set(
      0,
      Math.max(
        (yBack + yFront) / 2 + 0.022,
        hoodStripeTop ? hoodStripeTop(hoodDecalZ) + 0.005 : -Infinity
      ),
      hoodDecalZ
    );
    group.add(hood);
  }

  // The body's own anchor points, so a camera bolted to this shell can
  // sit on ITS bonnet and behind ITS screen rather than at an average of
  // five silhouettes. Unscaled, like everything else on the car — the
  // rig is a child of the body and inherits the fit.
  group.userData.dims = d;
  group.userData.wheels = wheels;
  group.userData.tailMat = tailMat;
  group.userData.tailCoreMat = tailCoreMat;
  group.userData.headMat = headMat;
  // Flashed with the lamps by the engine's challenge ritual
  group.userData.headGlowMats = headGlowMats;
  group.userData.lampPositions = lampPositions;
  // The paint is per-car (glass/chrome/rims are shared modules), so the
  // engine can feed the player's paint a live reflection probe without
  // leaking it onto every car on the road.
  group.userData.bodyMat = bodyMat;
  // Metals that should mirror the player's actual surroundings — the
  // engine points these at the live cube probe alongside the paint.
  group.userData.reflectMats = reflectMats;
  // Brake-glow halos: the engine flares these with the tail lamps
  group.userData.tailGlowMats = tailGlowMats;

  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = !o.userData.noShadow;
    // And a car RECEIVES. It never used to — not one mesh on any car in
    // the game — so a car drove under a flyover in full moonlight, and
    // the car alongside you in a battle stayed lit through your own
    // shadow. Cars are the only thing on this road the player is looking
    // at; they were the one thing shadows could not touch.
    //
    // Same exclusion as casting: an unlit glow sprite or a lamp lens has
    // no business being darkened, and MeshBasicMaterial ignores this
    // anyway.
    o.receiveShadow = !o.userData.noShadow;
  });

  // Real-world sizing. The profiles are authored a little oversized, and
  // a flat 1.12 "presence" multiplier on top left every car 15-31% larger
  // than the machine it evokes — a 2.15 m wide RX-7 is wider than a
  // pickup, and the tyres came out 0.81 m across. Each style now carries
  // the factor that lands it on its real dimensions.
  //
  // The scale stays uniform on purpose: the wheels spin about their own
  // axis, so a non-uniform group scale would sweep them into ellipses.
  // That means length and width cannot both be exact, so the factor is
  // the geometric mean of the two corrections — every car ends up within
  // ~5% on all three axes, with tyres at a correct 0.64-0.70 m.
  //
  // Collision sizes are engine constants and are deliberately untouched.
  //
  // A car with a published length is FITTED to it rather than scaled by
  // a table: the shell is measured nose to tail exactly the way the size
  // test measures it — solid, shadow-casting bodywork, no glass and no
  // contact blob — and scaled until that measurement is the number on
  // the card. Two things follow from doing it this way. The length is
  // exact by construction rather than exact until somebody edits a
  // profile, and the WIDTH lands on the real machine's width for free,
  // because the extrusion depths were tuned to be right at a scale that
  // carried the 1.12 presence factor and this scale is that one divided
  // by 1.12.
  let scale = STYLE_SCALE[style];
  if (colors.lengthM && colors.lengthM > 1) {
    // World boxes, not local ones. Plenty of this car is nested — the
    // wheels are groups, the driver is a rig — and a child's own matrix
    // is relative to its parent, so measuring with it puts a wheel at
    // the origin and a bumper somewhere it is not.
    group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let minZ = Infinity;
    let maxZ = -Infinity;
    group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.noShadow) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && (m.transparent || (m.opacity ?? 1) < 1)) return;
      box.setFromObject(o);
      if (box.min.z < minZ) minZ = box.min.z;
      if (box.max.z > maxZ) maxZ = box.max.z;
    });
    const raw = maxZ - minZ;
    if (raw > 1) scale = colors.lengthM / raw;
  }
  /**
   * And the width, which the length fit cannot also get right.
   *
   * One more scale factor, on x alone, taking the door skin to the width
   * a car of this silhouette and this length actually is. The shell's
   * own half-width is already measured — flankX, which everything on the
   * flank is hung off — so this is the fit the length gets, applied to
   * the other axis.
   *
   * The wheels and the driver take it back off again. A tyre stretched
   * 12% along its axis is a tyre that is 12% too fat, and a person 12%
   * wider is a person; the body widening is the point, and they are
   * bolted to it rather than part of it. Their POSITIONS still move
   * outboard with the body, which is what widening a car does to its
   * track, and only their own geometry is held.
   */
  let widthFix = 1;
  if (colors.lengthM && colors.lengthM > 1) {
    const want = bodyWidthFor(style, colors.lengthM);
    const have = flankX * 2 * scale;
    if (have > 0.5) widthFix = THREE.MathUtils.clamp(want / have, 0.8, 1.25);
  }
  group.scale.set(scale * widthFix, scale, scale);
  if (widthFix !== 1) {
    for (const w of wheels) w.scale.x = 1 / widthFix;
  }
  group.userData.bodyWidth = flankX * 2 * scale * widthFix;
  /**
   * The wheel's radius IN THE WORLD, after that scale.
   *
   * Recorded rather than assumed, because the assumption was wrong on
   * every car in the game. The engine turned every wheel at v / 0.36 —
   * the local radius, correct before these cars were fitted to their
   * real lengths — and the scale that fit ranges from 0.826 to 1.064,
   * so the wheels were 5.5% to 21.8% out. A wheel turning 22% too
   * slowly is a wheel skidding forward down a dry road at every speed,
   * which is the one thing about a car nobody has to be told to look
   * for.
   *
   * attract.ts had this right from the day it was written — it measures
   * the built wheel because "the silhouettes carry different scale
   * factors, so the same tyre is a different size on each of them". The
   * menu rolled correctly and the game did not.
   */
  group.userData.wheelR = TIRE_RADIUS * scale;

  // Swap in the Blender-authored shells and wheels when they arrive.
  // Traffic keeps the cheap procedural build — thirty cars don't need
  // the density, and they never come close enough to the camera to show it.
  // Somebody is driving this — every car, not just the hero ones.
  // Right-hand drive, hands on the wheel by IK rather than parented to
  // it, so the arms answer the steering. Traffic gets the lean build
  // (torso, head, helmet, two arms) because a background driver is a
  // silhouette behind glass; what matters is that the seat is not
  // empty, which is what thirty driverless cars looked like.
  {
    const driver = kuwaitiDriver(0x1d2026, undefined, colors.simple === true);
    driver.group.position.set(DRIVER_X, seatY, headZ - RIG.driver.headZ);
    // Seated in a car that has been widened, not widened with it.
    if (widthFix !== 1) driver.group.scale.x = 1 / widthFix;
    group.add(driver.group);
    group.userData.driver = driver;
    // One solve at build, so the rest pose IS a driving pose.
    //
    // The shoulders are created with a position and no rotation
    // (characters.ts), so until a solver runs, both arms hang straight
    // down through the dash. The legs never had this problem — they get
    // authored rest angles — which is how the "reads as seated before a
    // solver runs" promise came to be true only below the waist. The
    // engine solves the six nearest traffic rigs and every hero car, so
    // the bug lived exclusively on traffic car seven and beyond: close
    // enough to see, never close enough to be solved.
    //
    // dt=1 turns every ease factor min(1, dt*rate) into 1 — the slowest
    // rig rate is 5 — so one call snaps the whole rig to a settled
    // straight-ahead pose: hands on the rim, eyes down the road.
    driver.group.updateWorldMatrix(true, false);
    const restLook = new THREE.Vector3(0, RIG.driver.lookHeight, RIG.driver.lookAheadM);
    driver.group.localToWorld(restLook);
    solveDriverRig(driver, 0, 0, 0, restLook, 1);
  }

  if (!colors.simple) {
    upgradeCarShells(group, style);
    upgradeWheels(group);
    // The driver too — helmet, visor, gloves, rim and pedal faces. The
    // rig is a child of this group, so one call covers every car that
    // carries one: yours, the rival's, and the cruisers online.
    upgradeDriver(group);
  }

  if (colors.underglow !== undefined) {
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 5.6),
      new THREE.MeshBasicMaterial({
        map: poolGlowTexture(),
        color: colors.underglow,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.06;
    glow.castShadow = false;
    group.add(glow);
  }

  return group;
}
