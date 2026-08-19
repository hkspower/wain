import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EXHAUSTS, type ExhaustSpec } from "./mods";
import { upgradeCarShells, upgradeWheels, upgradeDriver } from "./models";
import { arabicUI, latinDisplay } from "./text";
import { kuwaitiDriver } from "./characters";

// Procedural sedans with a real silhouette: the body and glasshouse are
// bevel-extruded side profiles (smoothed normals), riding on spoked
// wheels the engine spins with road speed. Built facing +Z; footprint
// stays ~1.9 x 4.4 m so gameplay collision sizes are unchanged.
//
// group.userData: { wheels: Group[4] (fl, fr, rl, rr), tailMat }

/** Silhouette family. "zx" is the long-nose fastback wedge of a Z32
 *  300ZX; "gtr" is the boxy, high-decked muscle of an R34 Skyline. */
export type BodyStyle = "sedan" | "zx" | "gtr" | "rx7";

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
}

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

let glowTexShared: THREE.CanvasTexture | null = null;
function underglowTexture(): THREE.CanvasTexture {
  if (glowTexShared) return glowTexShared;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.55, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTexShared = new THREE.CanvasTexture(c);
  return glowTexShared;
}

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
  1.84,
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
  1.6,
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
  1.42,
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
  1.92,
  0.15
);
const zxCanopyGeo = extrudeProfile(
  [
    [0.48, 0.84],
    [-0.12, 1.24], // peak just over the driver
    [-0.95, 1.19],
    [-2.0, 0.78], // fastback all the way down
  ],
  1.64,
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
  1.46,
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
  1.96,
  0.13
);
const gtrCanopyGeo = extrudeProfile(
  [
    [1.0, 0.97],
    [0.34, 1.42],
    [-0.66, 1.44],
    [-1.32, 0.99],
  ],
  1.68,
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
  1.48,
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
  1.92,
  0.17 // the fattest bevel in the fleet — everything rolls
);
const rx7CanopyGeo = extrudeProfile(
  [
    [0.8, 0.83],
    [0.1, 1.28], // bubble peak over the driver
    [-0.72, 1.24],
    [-1.68, 0.78], // long rounded hatch glass
  ],
  1.6,
  0.12
);
const rx7RoofGeo = extrudeProfile(
  [
    [0.06, 1.28],
    [-0.02, 1.33],
    [-0.6, 1.3],
    [-0.68, 1.25],
  ],
  1.4,
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
const PRESENCE = 1.12;
const STYLE_SCALE: Record<BodyStyle, number> = {
  sedan: 0.978 * PRESENCE,
  zx: 0.894 * PRESENCE,
  // Base 0.912 (was 0.926): the R34 measured +11% on height, the worst
  // residual in the fleet. Trading a little length brings the roof down
  // while width lands within 1% of proportion — the closest a uniform
  // scale can get this profile to 4.60 x 1.79 x 1.36.
  gtr: 0.912 * PRESENCE,
  rx7: 0.899 * PRESENCE,
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
  mirror: [number, number, number];
  dashY: number;
  wiperZ: number;
  bPillar: [number, number, number];
  creaseY: number;
}
const STYLE_DIMS: Record<BodyStyle, StyleDims> = {
  sedan: {
    nose: 2.37, tail: -2.38, roof: [-0.2, 1.49], noseTopY: 0.7, grilleY: 0.52, beltY: 0.94,
    hoodY: 0.98, tailY: 0.78, deckY: 0.96, mirror: [1.0, 1.04, 0.82],
    dashY: 1.0, wiperZ: 0.93, bPillar: [0.77, 1.14, -0.2], creaseY: 0.72,
  },
  zx: {
    nose: 2.5, tail: -2.44, roof: [-0.53, 1.3], noseTopY: 0.56, grilleY: 0.42, beltY: 0.85,
    hoodY: 0.82, tailY: 0.66, deckY: 0.79, mirror: [1.02, 0.92, 0.4],
    dashY: 0.9, wiperZ: 0.5, bPillar: [0.8, 1.02, -0.75], creaseY: 0.6,
  },
  rx7: {
    nose: 2.44, tail: -2.32, roof: [-0.31, 1.34], noseTopY: 0.5, grilleY: 0.38,
    beltY: 0.8, hoodY: 0.72, tailY: 0.6, deckY: 0.76, mirror: [1.0, 0.9, 0.35],
    dashY: 0.86, wiperZ: 0.45, bPillar: [0.78, 0.98, -0.6], creaseY: 0.55,
  },
  gtr: {
    nose: 2.46, tail: -2.4, roof: [-0.18, 1.51], noseTopY: 0.76, grilleY: 0.5, beltY: 0.99,
    hoodY: 1.0, tailY: 0.84, deckY: 0.98, mirror: [1.03, 1.08, 0.85],
    dashY: 1.02, wiperZ: 0.95, bPillar: [0.79, 1.16, -0.16], creaseY: 0.76,
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
archLipGeoF.rotateY(Math.PI / 2);
const wellMat = new THREE.MeshBasicMaterial({ color: 0x060708 });

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

const headlightMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xfff6cf,
  emissiveIntensity: 2.6,
});
const grilleMat = new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.6 });
const chromeMat = new THREE.MeshStandardMaterial({
  color: 0xd8dde3,
  roughness: 0.12,
  metalness: 1,
  envMapIntensity: 1.6,
});

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
function flagDecalTexture(): THREE.CanvasTexture {
  if (flagDecalTex) return flagDecalTex;
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 48;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#007a3d";
  ctx.fillRect(0, 0, 96, 16);
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(0, 16, 96, 16);
  ctx.fillStyle = "#ce1126";
  ctx.fillRect(0, 32, 96, 16);
  ctx.fillStyle = "#0a0a0a";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(28, 16);
  ctx.lineTo(28, 32);
  ctx.lineTo(0, 48);
  ctx.closePath();
  ctx.fill();
  flagDecalTex = new THREE.CanvasTexture(c);
  flagDecalTex.colorSpace = THREE.SRGBColorSpace;
  flagDecalTex.anisotropy = 8;
  return flagDecalTex;
}

/** Sticker plane: lit like paint, slightly emissive so it reads at night,
 *  polygon-offset so it never z-fights the panel it sits on. */
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
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: colors.body,
    roughness: 0.34, // basecoat: flake scatter, not a mirror
    metalness: 0.9,
    clearcoat: 1,
    clearcoatRoughness: 0.03, // lacquer: near-mirror
    envMapIntensity: 2.1,
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
  const canopyShell = new THREE.Mesh(cGeo, glassMat);
  canopyShell.userData.shell = "canopy";
  group.add(canopyShell);
  const roofShell = new THREE.Mesh(rGeo, bodyMat);
  roofShell.userData.shell = "roof";
  group.add(roofShell);

  if (colors.accent !== undefined && style === "sedan") {
    const stripe = new THREE.Mesh(
      roundedBox(0.46, 0.03, 4.3, 0.012),
      new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.35 })
    );
    stripe.position.y = 1.0;
    group.add(stripe);
  }

  // Lights: lens strips front and rear. The head material is cloned per
  // car so a single rival can flash back without lighting up traffic.
  const headMat = headlightMat.clone();

  // Every lamp carries a soft bloom and a diffraction star. Sprites, so
  // the flare always faces the camera — an oncoming car's lights spike
  // properly whichever way it is pointing. Traffic skips them: thirty
  // background cars do not need sixty extra additive sprites.
  const headGlowMats: THREE.SpriteMaterial[] = [];
  const addHeadGlare = (x: number, y: number, z: number, size = 1) => {
    if (colors.simple) return;
    const halo = new THREE.SpriteMaterial({
      map: underglowTexture(),
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

  if (style === "zx") {
    // Z32 signature: one flush light bar across the whole nose. Pinned
    // 80 mm behind the nose anchor it was 100 mm inside the bumper — the
    // three cars on this silhouette had no headlights on screen at all.
    const barY = d.noseTopY + 0.03;
    const barZ = (noseFaceZ(bGeo, style, barY, true) ?? d.nose) - 0.018;
    const bar = new THREE.Mesh(roundedBox(1.56, 0.1, 0.07, 0.03), headMat);
    bar.position.set(0, barY, barZ);
    bar.rotation.x = -0.09; // gently raked, flush with the hood line
    group.add(bar);
    for (const sx of [-0.5, 0.5]) addHeadGlare(sx, barY, barZ, 0.95);
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
      const lamp = new THREE.Mesh(roundedBox(0.36, 0.12, 0.08, 0.03), headMat);
      lamp.position.set(sx, hood + 0.05, d.nose - 0.36);
      group.add(lamp);
      addHeadGlare(sx, hood + 0.05, d.nose - 0.32, 0.9);
    }
  } else {
    for (const sx of [-0.62, 0.62]) {
      const head = new THREE.Mesh(roundedBox(0.52, 0.13, 0.07, 0.02), headMat);
      head.position.set(sx, d.noseTopY, d.nose - 0.01);
      group.add(head);
      addHeadGlare(sx, d.noseTopY, d.nose + 0.02);
    }
    if (style === "gtr") {
      // Inner projector eyes beside the main lamps
      for (const sx of [-0.3, 0.3]) {
        const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 12), headMat);
        eye.rotation.x = Math.PI / 2;
        eye.position.set(sx, d.noseTopY, d.nose - 0.005);
        group.add(eye);
      }
    }
  }
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x550000,
    emissive: 0xff2222,
    emissiveIntensity: 2.0,
  });
  // The hot element inside each lamp. It used to share tailMat with the
  // lens, which made it invisible twice over: the same flat emissive
  // colour, and geometry sitting wholly inside the lens. Now it is a
  // hotter, oranger red and it stands proud, so it reads as the filament
  // rather than as more of the same red plastic.
  const tailCoreMat = new THREE.MeshStandardMaterial({
    color: 0x330000,
    emissive: 0xff7048,
    emissiveIntensity: 3.2,
  });
  // The rear lamps are built as assemblies — smoked housing, outer lens,
  // and a hotter inner core — with additive glow halos hung behind them
  // that the engine flares when the brakes bite.
  const tailGlowMats: THREE.MeshBasicMaterial[] = [];
  const addTailGlow = (x: number, y: number, z: number, w = 0.55, h = 0.4) => {
    const m = new THREE.MeshBasicMaterial({
      map: underglowTexture(),
      color: 0xff2222,
      transparent: true,
      opacity: 0.3,
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
    const sunroof = new THREE.Mesh(roundedBox(0.72, 0.02, 0.62, 0.015), glassMat);
    sunroof.position.set(0, ry + 0.005, rz + (bCabBack ? 0.28 : 0.18));
    group.add(sunroof);
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
    if (style === "gtr") {
      // Shark fin at the trailing edge of the roof
      const fin = new THREE.Mesh(roundedBox(0.035, 0.1, 0.22, 0.012), bodyMat);
      fin.position.set(0, ry + 0.04, rz - 0.42);
      fin.rotation.x = -0.25;
      group.add(fin);
    } else if (style === "zx") {
      // Period-correct power antenna on the rear quarter
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.42, 6), chromeLocal);
      mast.position.set(0.82, 1.0, -1.86);
      mast.rotation.x = 0.16;
      group.add(mast);
    }
  }

  // Side mirrors
  for (const sxSign of [-1, 1]) {
    const mirror = new THREE.Mesh(roundedBox(0.16, 0.1, 0.2, 0.035), bodyMat);
    mirror.position.set(sxSign * d.mirror[0], d.mirror[1], d.mirror[2]);
    group.add(mirror);
  }

  // Wheels with arches; fronts steer, all spin (engine drives userData.wheels)
  const wheels: THREE.Group[] = [];
  const wzF = style === "zx" ? 1.52 : style === "gtr" || style === "rx7" ? 1.45 : 1.42;
  const wzR = style === "zx" ? -1.48 : style === "gtr" || style === "rx7" ? -1.45 : -1.42;
  for (const [wx, wz] of [
    [-0.84, wzF],
    [0.84, wzF],
    [-0.84, wzR],
    [0.84, wzR],
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
    // panel on all of them.
    for (const sxSign of [-1, 1]) {
      for (const sz of [0.62, -0.72]) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.5, 0.012), gapMat);
        seam.position.set(sxSign * (flankX + 0.005), 0.58, sz);
        group.add(seam);
      }
      // Character line — the crease that runs the flank of every modern
      // car and catches a long highlight as the world slides past
      const crease = new THREE.Mesh(roundedBox(0.035, 0.05, 3.1, 0.016), bodyMat);
      crease.position.set(sxSign * (flankX + 0.01), d.creaseY, -0.1);
      group.add(crease);
      const belt = new THREE.Mesh(roundedBox(0.015, 0.02, 2.7, 0.006), chromeLocal);
      belt.position.set(sxSign * (flankX + 0.005), d.beltY, -0.15);
      group.add(belt);
      for (const hz of [0.28, -1.02]) {
        const handle = new THREE.Mesh(roundedBox(0.03, 0.035, 0.14, 0.012), chromeLocal);
        handle.position.set(sxSign * (flankX + 0.005), d.creaseY + 0.08, hz);
        group.add(handle);
      }
      const skirt = new THREE.Mesh(roundedBox(0.06, 0.12, 2.7, 0.02), seamMat);
      skirt.position.set(sxSign * (flankX - 0.023), 0.25, -0.1);
      group.add(skirt);
    }

    // Hood and trunk shut lines across the top surfaces
    const hoodGap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.012, 0.016), gapMat);
    hoodGap.position.set(0, d.hoodY + 0.01, bCabBack ? 0.65 : 1.06);
    group.add(hoodGap);
    const trunkGap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.012, 0.016), gapMat);
    trunkGap.position.set(0, d.deckY + 0.005, -1.42);
    group.add(trunkGap);
    for (const sx of [-0.86, 0.86]) {
      const hoodSide = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 1.0), gapMat);
      hoodSide.position.set(sx, d.hoodY, bCabBack ? 1.2 : 1.55);
      group.add(hoodSide);
    }

    if (style === "gtr") {
      // Power bulge and the NACA-ish vents either side of it
      const bulge = new THREE.Mesh(roundedBox(0.72, 0.06, 1.0, 0.03), bodyMat);
      bulge.position.set(0, d.hoodY, 1.55);
      group.add(bulge);
      for (const sx of [-0.55, 0.55]) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.015, 0.4), gapMat);
        vent.position.set(sx, d.hoodY + 0.005, 1.5);
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
        slat.position.set(sx, d.hoodY + 0.005, 1.45);
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
      wiper.position.set(wxp, d.hoodY, d.wiperZ);
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
      const mGlass = new THREE.Mesh(roundedBox(0.12, 0.07, 0.012, 0.005), chromeMat);
      mGlass.position.set(sxSign * d.mirror[0], d.mirror[1], d.mirror[2] - 0.1);
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
      louvre.position.set(sx, d.hoodY + 0.015, 1.15);
      louvre.rotation.x = -0.06; // follows the hood's fall
      group.add(louvre);
      const scoop = new THREE.Mesh(roundedBox(0.16, 0.07, 0.22, 0.02), carbonMat);
      scoop.position.set(sx * 1.4, d.hoodY + 0.05, 0.62);
      group.add(scoop);
    }

    // Side skirts hugging the rockers
    for (const sxSign of [-1, 1]) {
      const skirt = new THREE.Mesh(roundedBox(0.08, 0.1, 2.7, 0.022), carbonMat);
      skirt.position.set(sxSign * (flankX + 0.01), 0.16, 0);
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
    // Brake strip let into the wing's trailing edge
    const strip = new THREE.Mesh(roundedBox(0.9, 0.025, 0.03, 0.008), tailMat);
    strip.position.set(0, baseY + 0.13, -2.17);
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
    const HALF_W: Record<BodyStyle, number> = { sedan: 0.92, zx: 0.96, gtr: 0.98, rx7: 0.96 };
    const sideX = HALF_W[style] + 0.014;
    const num =
      colors.stickerNumber ??
      ((((colors.body * 2654435761) >>> 0) % 90) + 10);

    const roundel = decalMat(roundelTexture(num));
    const stripe = decalMat(beltStripeTexture());
    const flag = decalMat(flagDecalTexture());
    for (const sign of [-1, 1]) {
      // Door roundel with the racing number
      const r = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), roundel);
      r.position.set(sign * (sideX + 0.008), d.creaseY + 0.02, 0.45);
      r.rotation.y = sign * (Math.PI / 2);
      group.add(r);
      // Beltline stripe running the flank
      const st = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.14), stripe);
      st.position.set(sign * sideX, d.beltY - 0.16, -0.15);
      st.rotation.y = sign * (Math.PI / 2);
      group.add(st);
      // Kuwait flag on the rear quarter
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.12), flag);
      f.position.set(sign * (sideX + 0.008), d.beltY - 0.1, -1.55);
      f.rotation.y = sign * (Math.PI / 2);
      group.add(f);
    }
    // Falcon swoosh flat on the hood, nosed toward the windshield
    const hood = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.85),
      decalMat(hoodDecalTexture())
    );
    hood.rotation.x = -Math.PI / 2;
    hood.rotation.z = Math.PI; // read the right way up from the driver's seat
    hood.position.set(0, d.hoodY + 0.014, bCabBack ? 1.15 : 1.45);
    group.add(hood);
  }

  group.userData.wheels = wheels;
  group.userData.tailMat = tailMat;
  group.userData.tailCoreMat = tailCoreMat;
  group.userData.headMat = headMat;
  // Flashed with the lamps by the engine's challenge ritual
  group.userData.headGlowMats = headGlowMats;
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
  group.scale.setScalar(STYLE_SCALE[style]);

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
        map: underglowTexture(),
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
