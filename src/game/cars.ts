import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EXHAUSTS, type ExhaustSpec } from "./mods";
import { upgradeCarShells, upgradeWheels, upgradeDriver } from "./models";
import { arabicUI, latinDisplay } from "./text";
import { kuwaitiDriver } from "./characters";
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
export type BodyStyle = "sedan" | "zx" | "gtr" | "rx7" | "hatch";

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
  /** Full time-attack aero: swan-neck wing, splitter, canards, vented
   *  hood, skirts, diffuser, bronze six-spokes and teal calipers. */
  raceKit?: boolean;
  /** Rally sticker pack: door roundels, beltline stripes, hood decal,
   *  Kuwait flags on the rear quarters. */
  stickers?: boolean;
  /** Racing number for the roundels; derived from the paint if absent. */
  stickerNumber?: number;
  /** The car's own name, for the flank wordmark in the sticker pack. */
  name?: string;
  nameAr?: string;
  /** Overall length in metres. When given, the shell is SCALED until it
   *  measures this — see the fit at the end of createCar. */
  lengthM?: number;
  /** The crew this car runs for: emblem and name on the roof.
   *  Absent means a privateer, which is what every car was until now. */
  crew?: { name: string; tag: string; logo: TeamLogo };
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
      envMapIntensity: 1.8,
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
  bottomPoints = 2
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const top = points.slice(0, points.length - bottomPoints);
  shape.moveTo(top[0][0], top[0][1]);
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
    bevelSegments: 5,
    // The spline spans the whole body top, so it needs real sampling
    // density or the curve degenerates back into a polyline.
    curveSegments: 28,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo = mergeVertices(geo, 1e-3);
  geo.computeVertexNormals();
  // Profile length axis (x) onto the car's forward axis (+Z)
  geo.rotateY(-Math.PI / 2);
  return geo;
}

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
  0.14
);

// Raked glasshouse: windshield, roofline, rear window
const canopyGeo = extrudeProfile(
  [
    [1.02, 0.93],
    [0.42, 1.4],
    [-0.78, 1.42],
    [-1.5, 0.94],
  ],
  1.600,
  0.1,
  0
);

// Painted roof panel over the glass
const roofGeo = extrudeProfile(
  [
    [0.38, 1.41],
    [0.28, 1.47],
    [-0.68, 1.48],
    [-0.76, 1.42],
  ],
  1.420,
  0.06,
  0
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
  0.15
);
const zxCanopyGeo = extrudeProfile(
  [
    [0.48, 0.84],
    [-0.12, 1.24], // peak just over the driver
    [-0.95, 1.19],
    [-2.0, 0.78], // fastback all the way down
  ],
  1.776,
  0.1,
  0
);
const zxRoofGeo = extrudeProfile(
  [
    [-0.16, 1.24],
    [-0.24, 1.29],
    [-0.82, 1.25],
    [-0.9, 1.2],
  ],
  1.582,
  0.05,
  0
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
  0.13
);
const gtrCanopyGeo = extrudeProfile(
  [
    [1.0, 0.97],
    [0.34, 1.42],
    [-0.66, 1.44],
    [-1.32, 0.99],
  ],
  1.701,
  0.1,
  0
);
const gtrRoofGeo = extrudeProfile(
  [
    [0.3, 1.43],
    [0.2, 1.49],
    [-0.56, 1.5],
    [-0.64, 1.44],
  ],
  1.500,
  0.06,
  0
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
  0.17 // the fattest bevel in the fleet — everything rolls
);
const rx7CanopyGeo = extrudeProfile(
  [
    [0.8, 0.83],
    [0.1, 1.28], // bubble peak over the driver
    [-0.72, 1.24],
    [-1.68, 0.78], // long rounded hatch glass
  ],
  1.635,
  0.12
);
const rx7RoofGeo = extrudeProfile(
  [
    [0.06, 1.28],
    [-0.02, 1.33],
    [-0.6, 1.3],
    [-0.68, 1.25],
  ],
  1.429,
  0.05
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
  0.13
);
// The cabin sits FORWARD. Authored first with the screen base back at
// z 0.74 it came out with a long bonnet and the glasshouse pushed over
// the rear axle, which is coupe proportion — the shape read as a short
// muscle car rather than a hatch. A hot hatch puts its windscreen where
// a saloon puts the back of its bonnet, and spends everything it saves
// on roof.
const hatchCanopyGeo = extrudeProfile(
  [
    [1.02, 0.99],
    [0.40, 1.44], // short, steep screen
    [-0.95, 1.46], // long flat roof
    [-1.86, 1.04], // hatch glass, raked but still upright
  ],
  1.556,
  0.1
);
const hatchRoofGeo = extrudeProfile(
  [
    [0.34, 1.44],
    [0.24, 1.5],
    [-0.82, 1.49],
    [-0.92, 1.43],
  ],
  1.418,
  0.05
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
  // A hot hatch is the small car in this fleet and has to park like one:
  // 4.28 x 1.79 x 1.47 m, which is 40 cm shorter than the saloon and
  // 10 cm taller. The profile is authored close to those numbers, so the
  // factor here is near one.
  hatch: 0.935 * PRESENCE,
};

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
};

const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 22);
tireGeo.rotateZ(Math.PI / 2);
// The traffic tire is a bare barrel with no shoulder bulges, so it reads
// the tread band of the texture across its whole width. Without this it
// samples the sidewall bands at its edges and the tread looks smeared.
// Deferred, because remapV walks the attribute and this module is
// evaluated before anything asks for a wheel.
let treadUvDone = false;
function ensureTreadUvs(): void {
  if (treadUvDone) return;
  treadUvDone = true;
  remapV(tireGeo, 0.2, 0.8);
}
// Hero tire: more segments than traffic will ever need, plus sidewall
// bulges. The silhouette of a wheel is mostly its tire.
const tireGeoHi = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 30);
tireGeoHi.rotateZ(Math.PI / 2);
const sidewallGeo = new THREE.TorusGeometry(0.3, 0.042, 7, 26);
sidewallGeo.rotateY(Math.PI / 2);
// Brake hardware behind the spokes — a wheel with nothing inside it
// reads as a toy the moment the camera drops low
const discGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.022, 22);
discGeo.rotateZ(Math.PI / 2);
const lugGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.026, 6);
lugGeo.rotateZ(Math.PI / 2);
const discMat = new THREE.MeshStandardMaterial({
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
    map: s.map,
    normalMap: s.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: s.roughnessMap,
    color: 0xffffff,
    roughness: 1, // the map carries the real range
    metalness: 0,
    envMapIntensity: 0.55, // rubber picks up the night, faintly
  });
  return tireMatShared;
}

const rimGeo = new THREE.CylinderGeometry(0.205, 0.205, 0.27, 14);
rimGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.29, 8);
hubGeo.rotateZ(Math.PI / 2);
const spokeGeo = roundedBox(0.27, 0.3, 0.06, 0.018);
/** Ceramic-coated race tip: matte black, soot-dulled. */
const ceramicTipMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a1c,
  roughness: 0.62,
  metalness: 0.35,
});
/** Titanium, burnt blue-violet at the tip the way heat leaves it. */
const titaniumTipMat = new THREE.MeshStandardMaterial({
  color: 0x6b7ea8,
  roughness: 0.3,
  metalness: 0.95,
  envMapIntensity: 1.4,
});
const rimMat = new THREE.MeshStandardMaterial({
  color: 0xc8cdd4,
  roughness: 0.2,
  metalness: 0.95,
  envMapIntensity: 1.5,
});
const rimDarkMat = new THREE.MeshStandardMaterial({
  color: 0x23262b,
  roughness: 0.5,
  metalness: 0.6,
});

const lipGeo = new THREE.TorusGeometry(0.195, 0.014, 6, 20);
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
const ARCH_OUT = 0.005;
const LIP_OUT = 0.009;
const archWellGeo = new THREE.CircleGeometry(0.46, 22);
const archWellGeoF = new THREE.CircleGeometry(0.485, 22);
// A rolled panel edge, not a hoop. The first pass used a 0.03-0.038 tube
// standing 18 mm proud and it read as a roll bar bolted over the wheel;
// a real arch lip is a few millimetres of turned-over steel that catches
// one thin highlight.
const archLipGeo = new THREE.TorusGeometry(0.475, 0.016, 8, 28, Math.PI);
archLipGeo.rotateY(Math.PI / 2);
const archLipGeoF = new THREE.TorusGeometry(0.5, 0.021, 8, 30, Math.PI);
// The outer edge of each arch — the lip's radius plus its tube — and the
// height its centre sits at. Anything running along the flank has to
// stop here, so the numbers are named rather than repeated.
const ARCH_EDGE_F = 0.5 + 0.021;
const ARCH_EDGE_R = 0.475 + 0.016;
const ARCH_Y = 0.4;
archLipGeoF.rotateY(Math.PI / 2);
const wellMat = new THREE.MeshBasicMaterial({ color: 0x060708 });
// The hot-hatch nose stripe: painted red, not a lamp, but it carries a
// little glow so it still reads at night when nothing is lighting the
// bumper directly.
const hotStripeMat = new THREE.MeshStandardMaterial({
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

// Tinted glass, not a mirror. The intent here was always to silhouette
// the interior, but metalness 0.9 made the surface behave like polished
// chrome: a metal has no diffuse transmission, so the reflection won
// every pixel and the cabin was a black box with a driver invisible
// inside it. Glass is a dielectric — metalness near zero, a real index
// of refraction, and enough transparency to see a shape through.
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x121722,
  roughness: 0.05,
  metalness: 0.12,
  ior: 1.5,
  envMapIntensity: 1.35,
  transparent: true,
  opacity: 0.62,
});

const seamMat = new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.85 });
// Panel gaps read almost black and swallow light — that contrast against
// the lit chamfer beside them is what sells a shut line.
const gapMat = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1 });
const interiorMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
const indicatorMat = new THREE.MeshStandardMaterial({
  color: 0xffa020,
  emissive: 0xff8c1a,
  emissiveIntensity: 0.8,
});
const reverseMat = new THREE.MeshStandardMaterial({
  color: 0xd8d8d8,
  emissive: 0xbbbbbb,
  emissiveIntensity: 0.3,
});
const caliperMat = new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.5 });
// Big-brake teal — the time-attack kit's signature peeking through bronze
const tealCaliperMat = new THREE.MeshStandardMaterial({
  color: 0x18b09a,
  roughness: 0.4,
  emissive: 0x073b33,
  emissiveIntensity: 0.3,
});
// Forged bronze, matte like a shot-peened TE37 — not jewellery gold
const bronzeRimMat = new THREE.MeshStandardMaterial({
  color: 0x9c6b2f,
  roughness: 0.45,
  metalness: 0.85,
  envMapIntensity: 1.2,
});
// Dry carbon for the aero: near-black, a hint of weave sheen
const carbonMat = new THREE.MeshStandardMaterial({
  color: 0x101215,
  roughness: 0.35,
  metalness: 0.55,
  envMapIntensity: 1.1,
});

// Smoked lamp housing: the dark bezel the lenses live in. The contrast
// between this and the lit lens is what makes a lamp read as an assembly
// instead of a painted-on rectangle.
const housingMat = new THREE.MeshStandardMaterial({
  color: 0x17090b,
  roughness: 0.25,
  metalness: 0.5,
  envMapIntensity: 1.2,
});
// Passive rear reflectors: catch light, never emit
const reflectorMat = new THREE.MeshStandardMaterial({
  color: 0x7a1016,
  roughness: 0.25,
  metalness: 0.3,
  emissive: 0x30060a,
  emissiveIntensity: 0.4,
});
const amberReflectorMat = new THREE.MeshStandardMaterial({
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
const headlightMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xfff6cf,
  emissiveIntensity: 1.7,
});
/** The projector inside the lens: small, hot, and the only part that is
 *  allowed to blow out. A lamp with a focal point reads as a lamp; a
 *  uniform slab reads as a strip of tape. */
const headCoreMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffffff,
  emissiveIntensity: 4.2,
});
const grilleMat = new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.6 });
const chromeMat = new THREE.MeshStandardMaterial({
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
// The rally pack. Canvas-drawn, cached, and deliberately brand-free —
// a roundel, a beltline stripe, an abstract falcon swoosh and the flag.

const roundelCache = new Map<number, THREE.CanvasTexture>();
function roundelTexture(num: number): THREE.CanvasTexture {
  const hit = roundelCache.get(num);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 256);
  // Classic rally roundel: white disc, dark ring, bold number
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.fillStyle = "#f4f4f0";
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#15161a";
  ctx.stroke();
  ctx.fillStyle = "#15161a";
  ctx.textAlign = "center";
  ctx.font = `700 118px ${latinDisplay()}`;
  ctx.fillText(String(num), 128, 152);
  // Arabic-Indic twin, small, under the number — this is Gulf Road
  const arDigits = "٠١٢٣٤٥٦٧٨٩";
  const ar = String(num).split("").map((d) => arDigits[+d]).join("");
  ctx.font = `600 40px ${arabicUI()}`;
  ctx.fillText(ar, 128, 204);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
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
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 128);
  ctx.textAlign = "center";
  // Letter-spaced caps, because a wordmark on a flank is read side-on at
  // speed and tight tracking closes up to a smear.
  ctx.letterSpacing = "6px";
  ctx.fillStyle = "#f2f4f7";
  ctx.font = `700 54px ${latinDisplay()}`;
  ctx.fillText(name.toUpperCase(), 256, 58);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#ff5a1f";
  ctx.fillRect(150, 70, 212, 3);
  if (ar) {
    ctx.direction = "rtl";
    ctx.font = `600 38px ${arabicUI()}`;
    ctx.fillText(ar, 256, 110);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  nameDecalCache.set(key, tex);
  return tex;
}

/** The crew's roof livery: emblem over the crew's name.
 *
 *  Drawn by teams.ts so the emblem on the car is the same emblem as the
 *  one on the lobby card — one description of a logo, one routine that
 *  draws it, at whatever size is asked for. The name band underneath is
 *  laid out here because only the roof needs it. */
const crewDecalCache = new Map<string, THREE.CanvasTexture>();
function crewDecalTexture(logo: TeamLogo, tag: string, name: string): THREE.CanvasTexture {
  const key = `${logo.shape}|${logo.symbol}|${logo.bg}|${logo.fg}|${tag}|${name}`;
  const cached = crewDecalCache.get(key);
  if (cached) return cached;
  const W = 256;
  const H = 320;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
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
    let px = 46;
    ctx.font = `700 ${px}px ${ar ? arabicUI() : latinDisplay()}`;
    while (px > 18 && ctx.measureText(label).width > W - 24) {
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
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  crewDecalCache.set(key, tex);
  return tex;
}

function decalMat(map: THREE.CanvasTexture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
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
  return new THREE.MeshStandardMaterial({ map: sharedPlateTex, roughness: 0.5 });
}

type WheelFinish = "silver" | "gold" | "bronze";

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
  // Tire: tread barrel plus the two shoulder bulges
  // Each piece is remapped into its own band of the tire texture, so one
  // image covers tread and both shoulders and the tire stays one mesh.
  const tire = mergeGeometries([
    remapV(tireGeoHi.clone(), 0.2, 0.8),
    remapV(at(sidewallGeo, -0.095), 0.03, 0.2),
    remapV(at(sidewallGeo, 0.095), 0.8, 0.97),
  ])!;
  // Alloy face: machined lip, spokes, hub — everything wearing the
  // finish colour
  const alloyParts: THREE.BufferGeometry[] = [at(lipGeo, side * 0.135), hubGeo.clone()];
  for (let i = 0; i < nSpokes; i++) {
    const g = spokeGeo.clone();
    g.translate(0, 0.1, 0);
    g.rotateX((i / nSpokes) * Math.PI * 2);
    alloyParts.push(g);
  }
  const alloy = mergeGeometries(alloyParts)!;
  const lugParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    lugParts.push(at(lugGeo, side * 0.148, Math.cos(a) * 0.058, Math.sin(a) * 0.058));
  }
  parts = {
    tire,
    barrel: rimGeo,
    alloy,
    rotor: at(discGeo, -side * 0.055),
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
  const spokeMat =
    opts?.spokeMat ??
    (finish === "gold" ? getGoldRimMat() : finish === "bronze" ? bronzeRimMat : rimMat);
  const detailed = opts?.detailed ?? false;
  // Six straight spokes on the forged bronze wheel, five on the street cast
  const nSpokes = finish === "bronze" ? 6 : 5;
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
    w.userData.spokes = nSpokes;
    w.userData.rotorMat = rotorMat;
    return w;
  }

  // Traffic wheel: the cheap build, unchanged
  ensureTreadUvs();
  w.add(new THREE.Mesh(tireGeo, getTireMat()));
  w.add(new THREE.Mesh(rimGeo, rimDarkMat));
  const lip = new THREE.Mesh(lipGeo, spokeMat);
  lip.position.x = side * 0.135;
  w.add(lip);
  for (let i = 0; i < nSpokes; i++) {
    const holder = new THREE.Group();
    holder.rotation.x = (i / nSpokes) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeo, spokeMat);
    spoke.position.y = 0.1;
    holder.add(spoke);
    w.add(holder);
  }
  w.add(new THREE.Mesh(hubGeo, spokeMat));
  return w;
}

export function createCar(colors: CarColors): THREE.Group {
  const group = new THREE.Group();
  const style: BodyStyle = colors.style ?? "sedan";
  const d = STYLE_DIMS[style];

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
    color: colors.body,
    roughness: 0.18, // basecoat: tight, so the flake catches points
    metalness: 0.95,
    clearcoat: 1,
    clearcoatRoughness: 0.05, // lacquer: near-mirror, not a laser mirror
    envMapIntensity: 2.4,
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
    style === "zx"
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
  const canopyShell = new THREE.Mesh(cGeo, glassMat);
  canopyShell.userData.shell = "canopy";
  group.add(canopyShell);
  const roofShell = new THREE.Mesh(rGeo, bodyMat);
  roofShell.userData.shell = "roof";
  group.add(roofShell);

  /** Top of the bonnet stripe at a point along it, when the car wears one. */
  let hoodStripeTop: ((z: number) => number) | null = null;
  if (colors.accent !== undefined && style === "sedan") {
    // A bonnet-and-boot stripe, seated on the panels it lies on. It was
    // one 4.3 m bar held at a fixed height for the whole length of the
    // car, which is a straight line laid through a curved body: it broke
    // the surface over the nose, sank into the hood, ran under the
    // cabin, and never reached the boot. On screen it read as a green
    // rectangle stuck to the bumper.
    const accentMat = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.35 });
    // Each run is laid in short pieces rather than as one long board.
    // A panel is not a ramp: levelled against its two ends only, a 0.9 m
    // stripe sinks into the crown between them, which broke the boot
    // stripe into two green patches with the middle missing.
    const PIECES = 4;
    for (const [zRear, zFront] of [
      [0.95, 2.14],
      [-2.16, -1.22],
    ]) {
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

  // Lights: lens strips front and rear. The head material is cloned per
  // car so a single rival can flash back without lighting up traffic.
  const headMat = headlightMat.clone();

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
    const halo = new THREE.SpriteMaterial({
      map: pointGlowTexture(),
      color: 0xfff2cc,
      transparent: true,
      opacity: 0.5,
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
      color: 0xfff6e0,
      transparent: true,
      opacity: 0.62,
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
      const seg = new THREE.Mesh(roundedBox(segW, 0.078, 0.06, 0.022), headMat);
      seg.position.set(cx, barY + Math.sin(-0.09) * 0, barZ + 0.004);
      seg.rotation.x = -0.09;
      seg.name = "lamp-lens";
      group.add(seg);
    }
    // Two projectors in the bar, where the main beams actually come from.
    for (const sx of [-0.5, 0.5]) {
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
      // Housing, deepest and widest.
      const pod = new THREE.Mesh(roundedBox(0.58, 0.175, 0.07, 0.03), housingMat);
      pod.position.set(sx, d.noseTopY, d.nose - 0.03);
      pod.name = "lamp-housing";
      group.add(pod);
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
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.055, 14), tailCoreMat);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(sx, d.tailY, d.tail - 0.045);
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
    if (ex.id !== "stock") {
      xs =
        ex.tips === 4
          ? [-0.64, -0.42, 0.42, 0.64]
          : ex.tips === 1
            ? [-0.5]
            : [-0.5, 0.5];
      r = ex.bore;
      len = 0.24;
      y = 0.26;
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
    for (const sx of xs) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, len, 14), mat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(sx, y, z);
      // Tagged so the mod test can read the finish off the mesh that was
      // actually built, rather than fishing for a cylinder of the right
      // height — which missed the stock pipes entirely and reported their
      // finish as null.
      pipe.userData.exhaustPipe = true;
      group.add(pipe);
      // Just outside the exit face, which is the tail-most end of the pipe.
      origins.push(new THREE.Vector3(sx, y, z - len / 2 - 0.04));
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
      const sunroof = new THREE.Mesh(roundedBox(0.72, 0.02, 0.62, 0.015), glassMat);
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
   */
  const wheelX = flankX - 0.08;
  for (const [wx, wz] of [
    [-wheelX, wzF],
    [wheelX, wzF],
    [-wheelX, wzR],
    [wheelX, wzR],
  ]) {
    const wheel = buildWheel(
      colors.raceKit ? "bronze" : colors.goldRims ? "gold" : "silver",
      Math.sign(wx),
      { detailed: !colors.simple, spokeMat: spokeLocal }
    );
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
    wheels.push(wheel);

    // The opening, then the lip around it — both on the body's surface,
    // not at the wheel's centre where they were invisible.
    const front = wz > 0;
    const side = Math.sign(wx);
    const well = new THREE.Mesh(front ? archWellGeoF : archWellGeo, wellMat);
    well.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    well.position.set(side * (flankX + ARCH_OUT), 0.4, wz);
    well.userData.archWell = true;
    group.add(well);

    // Body-coloured, so it reads as the panel's own edge rather than as
    // a black ring stuck around the wheel.
    const lip = new THREE.Mesh(front ? archLipGeoF : archLipGeo, bodyMat);
    lip.position.set(side * (flankX + LIP_OUT), 0.4, wz);
    group.add(lip);
    lip.userData.archLip = true;

    // No separate flare box. A rounded box laid over the arch does not
    // follow it — it sits across the top with two hard ends and reads as
    // scaffolding. The front fender's extra width is in the lip's own
    // radius instead, which is the shape a flare actually has.
  }

  // --- Bumper assemblies: a black lower valance front and rear so the
  // bumpers read as fitted parts, amber corner reflectors up front and
  // red ones behind — the details every road car actually carries.
  {
    const frontValance = new THREE.Mesh(roundedBox(1.62, 0.09, 0.1, 0.03), seamMat);
    frontValance.position.set(0, 0.3, d.nose - 0.02);
    group.add(frontValance);
    const rearValance = new THREE.Mesh(roundedBox(1.66, 0.1, 0.1, 0.03), seamMat);
    rearValance.position.set(0, 0.3, d.tail + 0.02);
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
      // Boxed fender flares over all four arches
      for (const [fx, fz] of [
        [-0.96, wzF],
        [0.96, wzF],
        [-0.96, wzR],
        [0.96, wzR],
      ]) {
        const flare = new THREE.Mesh(roundedBox(0.09, 0.1, 1.02, 0.035), bodyMat);
        flare.position.set(fx, 0.68, fz);
        group.add(flare);
      }
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
    for (const sx of [-0.38, 0.38]) {
      const headrest = new THREE.Mesh(roundedBox(0.26, 0.22, 0.12, 0.04), interiorMat);
      headrest.position.set(sx, d.dashY + 0.14, bCabBack ? -0.45 : -0.05);
      group.add(headrest);
    }

    // Brake calipers peeking through the spokes
    for (const [wx, wz] of [
      [-0.84, wzF],
      [0.84, wzF],
      [-0.84, wzR],
      [0.84, wzR],
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

    // Fuel filler door on the right rear quarter
    const filler = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.012, 12), bodyMat);
    filler.rotation.z = Math.PI / 2;
    filler.position.set(0.945, d.creaseY + 0.09, -1.55);
    group.add(filler);
    const fillerRing = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.006, 6, 14), gapMat);
    fillerRing.rotation.y = Math.PI / 2;
    fillerRing.position.set(0.948, d.creaseY + 0.09, -1.55);
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
        canard.position.set(sxSign * 0.85, cy, d.nose + cz);
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

    // Red tow hook on the splitter — scrutineering says so
    const hook = new THREE.Mesh(roundedBox(0.1, 0.035, 0.12, 0.012), caliperMat);
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
  if (colors.stickers && !colors.simple) {
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
    const stripeY = d.beltY - 0.16;
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
      const st = new THREE.Mesh(new THREE.PlaneGeometry(stripeLen, 0.14), stripe);
      st.position.set(sign * sideX, stripeY, stripeZ);
      st.rotation.y = flipY;
      group.add(st);
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
        const word = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.215), nameDecal!);
        word.position.set(sign * (sideX + 0.004), d.creaseY - 0.22, roundelZ);
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
    if (o instanceof THREE.Mesh) o.castShadow = !o.userData.noShadow;
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
  group.scale.setScalar(scale);

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
    driver.group.position.set(0.38, d.dashY - 0.34, bCabBack ? -0.28 : 0.08);
    group.add(driver.group);
    group.userData.driver = driver;
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
