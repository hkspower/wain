import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { upgradeCarShells } from "./models";

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
  /** Gold rims (garage mod). */
  goldRims?: boolean;
  /** Full time-attack aero: swan-neck wing, splitter, canards, vented
   *  hood, skirts, diffuser, bronze six-spokes and teal calipers. */
  raceKit?: boolean;
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
function roundedBox(w: number, h: number, d: number, r = 0.035, seg = 2): THREE.BufferGeometry {
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
 * Per-silhouette scale onto real-world dimensions, from the car each
 * shape evokes: a generic saloon (4.70 x 1.80 m), a Z32 300ZX
 * (4.31 x 1.80), an R34 Skyline (4.60 x 1.79) and an FD RX-7
 * (4.30 x 1.76). Applied to the whole group in createCar.
 */
const STYLE_SCALE: Record<BodyStyle, number> = {
  sedan: 0.978,
  zx: 0.894,
  gtr: 0.926,
  rx7: 0.899,
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
const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.92 });

const rimGeo = new THREE.CylinderGeometry(0.205, 0.205, 0.27, 14);
rimGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.29, 8);
hubGeo.rotateZ(Math.PI / 2);
const spokeGeo = new THREE.BoxGeometry(0.27, 0.3, 0.06);
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
const archGeo = new THREE.TorusGeometry(0.46, 0.055, 8, 16, Math.PI);
const archMat = new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.9 });
// Dark disc behind each wheel fakes the cut-out wheel well
const wellGeo = new THREE.CircleGeometry(0.44, 16);
const wellMat = new THREE.MeshBasicMaterial({ color: 0x060708 });

const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x0c1018,
  roughness: 0.06,
  metalness: 0.9,
  envMapIntensity: 1.6,
  transparent: true,
  opacity: 0.8, // just enough to silhouette the interior
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
  ctx.font = "bold 19px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("KWT 8198", 64, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
let sharedPlateTex: THREE.CanvasTexture | null = null;
function plateMat(): THREE.MeshStandardMaterial {
  if (!sharedPlateTex) sharedPlateTex = plateTexture();
  return new THREE.MeshStandardMaterial({ map: sharedPlateTex, roughness: 0.5 });
}

type WheelFinish = "silver" | "gold" | "bronze";

function buildWheel(finish: WheelFinish = "silver", side = 1): THREE.Group {
  const spokeMat =
    finish === "gold" ? getGoldRimMat() : finish === "bronze" ? bronzeRimMat : rimMat;
  const w = new THREE.Group();
  w.add(new THREE.Mesh(tireGeo, tireMat));
  w.add(new THREE.Mesh(rimGeo, rimDarkMat));
  // Machined lip on the outer face — the ring highlight that makes a
  // wheel read as an alloy instead of a drum
  const lip = new THREE.Mesh(lipGeo, spokeMat);
  lip.position.x = side * 0.135;
  w.add(lip);
  // Six straight spokes on the forged bronze wheel, five on the street cast
  const nSpokes = finish === "bronze" ? 6 : 5;
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
  if (style === "zx") {
    // Z32 signature: one flush light bar across the whole nose
    const bar = new THREE.Mesh(roundedBox(1.56, 0.1, 0.07, 0.03), headMat);
    bar.position.set(0, d.noseTopY + 0.03, d.nose - 0.08);
    bar.rotation.x = -0.09; // gently raked, flush with the hood line
    group.add(bar);
  } else if (style === "rx7") {
    // Pop-up headlights, up for the night run: a body-colour door tilted
    // out of the hood with the lamp shining from under it
    for (const sx of [-0.58, 0.58]) {
      const door = new THREE.Mesh(roundedBox(0.44, 0.05, 0.3, 0.02), bodyMat);
      door.position.set(sx, d.noseTopY + 0.15, d.nose - 0.42);
      door.rotation.x = -0.62;
      group.add(door);
      const lamp = new THREE.Mesh(roundedBox(0.36, 0.12, 0.08, 0.03), headMat);
      lamp.position.set(sx, d.noseTopY + 0.07, d.nose - 0.36);
      group.add(lamp);
    }
  } else {
    for (const sx of [-0.62, 0.62]) {
      const head = new THREE.Mesh(roundedBox(0.52, 0.13, 0.07, 0.02), headMat);
      head.position.set(sx, d.noseTopY, d.nose - 0.01);
      group.add(head);
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

  if (style === "gtr") {
    // The R34 calling card: four round afterburners, each a dark ring
    // with a hot core — the classic double-circle look.
    const garnish = new THREE.Mesh(roundedBox(1.72, 0.3, 0.05, 0.02), grilleMat);
    garnish.position.set(0, d.tailY, d.tail - 0.005);
    group.add(garnish);
    for (const sx of [-0.72, -0.44, 0.44, 0.72]) {
      const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.04, 16), housingMat);
      bezel.rotation.x = Math.PI / 2;
      bezel.position.set(sx, d.tailY, d.tail - 0.03);
      group.add(bezel);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.05, 16), tailMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(sx, d.tailY, d.tail - 0.02);
      group.add(ring);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 10), tailMat);
      core.rotation.x = Math.PI / 2;
      core.position.set(sx, d.tailY, d.tail - 0.015);
      group.add(core);
    }
    addTailGlow(-0.58, d.tailY, d.tail, 0.75, 0.45);
    addTailGlow(0.58, d.tailY, d.tail, 0.75, 0.45);
  } else if (style === "rx7") {
    // The FD tail: a full-width smoked garnish with twin round lamps at
    // each corner, tucked tight in pairs
    const frame = new THREE.Mesh(roundedBox(1.8, 0.2, 0.05, 0.04), housingMat);
    frame.position.set(0, d.tailY, d.tail - 0.03);
    group.add(frame);
    for (const sx of [-0.76, -0.52, 0.52, 0.76]) {
      const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.04, 14), housingMat);
      bezel.rotation.x = Math.PI / 2;
      bezel.position.set(sx, d.tailY, d.tail - 0.025);
      group.add(bezel);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.055, 14), tailMat);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(sx, d.tailY, d.tail - 0.015);
      group.add(lamp);
    }
    addTailGlow(-0.64, d.tailY, d.tail, 0.7, 0.42);
    addTailGlow(0.64, d.tailY, d.tail, 0.7, 0.42);
  } else if (style === "zx") {
    // Full-width assembly under the fastback glass: smoked housing frame,
    // the band, and a hotter inner strip running its length
    const frame = new THREE.Mesh(roundedBox(1.86, 0.19, 0.05, 0.03), housingMat);
    frame.position.set(0, d.tailY, d.tail - 0.03);
    group.add(frame);
    const band = new THREE.Mesh(roundedBox(1.78, 0.13, 0.06, 0.025), tailMat);
    band.position.set(0, d.tailY, d.tail - 0.02);
    group.add(band);
    const core = new THREE.Mesh(roundedBox(1.6, 0.045, 0.065, 0.02), tailMat);
    core.position.set(0, d.tailY, d.tail - 0.015);
    group.add(core);
    addTailGlow(-0.6, d.tailY, d.tail, 0.8, 0.4);
    addTailGlow(0.6, d.tailY, d.tail, 0.8, 0.4);
  } else {
    // Two wrap-around housings with lens + core, split by the plate
    for (const sxSign of [-1, 1]) {
      const housing = new THREE.Mesh(roundedBox(0.78, 0.17, 0.05, 0.03), housingMat);
      housing.position.set(sxSign * 0.52, d.tailY, d.tail - 0.02);
      group.add(housing);
      const lens = new THREE.Mesh(roundedBox(0.7, 0.11, 0.06, 0.02), tailMat);
      lens.position.set(sxSign * 0.52, d.tailY, d.tail - 0.01);
      group.add(lens);
      const core = new THREE.Mesh(roundedBox(0.62, 0.04, 0.065, 0.015), tailMat);
      core.position.set(sxSign * 0.52, d.tailY, d.tail - 0.005);
      group.add(core);
      addTailGlow(sxSign * 0.52, d.tailY, d.tail, 0.7, 0.4);
    }
  }

  // High-mount third brake light: sedan/gtr at the rear-glass base, and
  // for the gtr a second element in the wing itself; zx on the fastback.
  {
    const cherry = new THREE.Mesh(roundedBox(0.5, 0.035, 0.05, 0.015), tailMat);
    if (style === "zx") cherry.position.set(0, 0.86, -1.98);
    else if (style === "rx7") cherry.position.set(0, 0.8, -1.86);
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
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.025, 0.08), chromeMat);
    trim.position.set(0, d.grilleY + 0.09, d.nose);
    group.add(trim);
  } else {
    // Just a thin cooling slot low in the bumper
    const slot = new THREE.Mesh(roundedBox(1.3, 0.07, 0.06, 0.02), grilleMat);
    slot.position.set(0, d.grilleY, d.nose - 0.02);
    group.add(slot);
  }
  for (const z of [d.nose + 0.02, d.tail - 0.03]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.13, 0.02), plateMat());
    plate.position.set(0, 0.38, z);
    group.add(plate);
  }
  if (style === "gtr") {
    // Big single bore each side — the R34 exhausts announce themselves
    for (const sx of [-0.55, 0.55]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.22, 12), chromeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(sx, 0.26, d.tail + 0.02);
      group.add(pipe);
    }
  } else if (style === "rx7") {
    // One big rotary can on the left — the FD announcement
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.24, 14), chromeMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(-0.5, 0.26, d.tail + 0.02);
    group.add(pipe);
  } else if (style === "zx") {
    // Twin round tips together on the left, Z-style
    for (const sx of [-0.55, -0.36]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.2, 10), chromeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(sx, 0.25, d.tail + 0.02);
      group.add(pipe);
    }
  } else {
    for (const sx of [-0.45, 0.45]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.18, 10), grilleMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(sx, 0.27, d.tail + 0.01);
      group.add(pipe);
    }
  }

  // --- Roof furniture: a glass sunroof inset, slim side rails along the
  // panel edges, and an antenna. The bare painted rectangle up top was
  // the last place the car still looked like a toy from above.
  {
    const [rz, ry] = d.roof;
    const sunroof = new THREE.Mesh(roundedBox(0.72, 0.02, 0.62, 0.015), glassMat);
    sunroof.position.set(0, ry + 0.005, rz + (bCabBack ? 0.28 : 0.18));
    group.add(sunroof);
    const railLen = bCabBack ? 0.72 : 1.0;
    for (const sxSign of [-1, 1]) {
      const rail = new THREE.Mesh(roundedBox(0.035, 0.025, railLen, 0.012), housingMat);
      rail.position.set(sxSign * (bCabBack ? 0.62 : 0.64), ry, rz);
      group.add(rail);
    }
    if (style === "gtr") {
      // Shark fin at the trailing edge of the roof
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 0.22), bodyMat);
      fin.position.set(0, ry + 0.04, rz - 0.42);
      fin.rotation.x = -0.25;
      group.add(fin);
    } else if (style === "zx") {
      // Period-correct power antenna on the rear quarter
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.42, 6), chromeMat);
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
      Math.sign(wx)
    );
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
    wheels.push(wheel);

    const arch = new THREE.Mesh(archGeo, archMat);
    arch.rotation.y = Math.PI / 2;
    arch.position.set(wx, 0.4, wz);
    group.add(arch);

    // Wheel well: dark disc facing outward so the wheel reads as inset
    const well = new THREE.Mesh(wellGeo, wellMat);
    well.rotation.y = wx > 0 ? Math.PI / 2 : -Math.PI / 2;
    well.position.set(wx * 0.9, 0.38, wz);
    group.add(well);
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
    for (const sxSign of [-1, 1]) {
      const amber = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.04), amberReflectorMat);
      amber.position.set(sxSign * 0.82, 0.42, d.nose - 0.06);
      group.add(amber);
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.04), reflectorMat);
      red.position.set(sxSign * 0.8, 0.42, d.tail + 0.05);
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
    for (const sx of [-0.925, 0.925]) {
      for (const sz of [0.62, -0.72]) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.5, 0.012), gapMat);
        seam.position.set(sx, 0.58, sz);
        group.add(seam);
      }
      // Character line — the crease that runs the flank of every modern
      // car and catches a long highlight as the world slides past
      const crease = new THREE.Mesh(roundedBox(0.035, 0.05, 3.1, 0.016), bodyMat);
      crease.position.set(sx * 1.005, d.creaseY, -0.1);
      group.add(crease);
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.02, 2.7), chromeMat);
      belt.position.set(sx, d.beltY, -0.15);
      group.add(belt);
      for (const hz of [0.28, -1.02]) {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.14), chromeMat);
        handle.position.set(sx, d.creaseY + 0.08, hz);
        group.add(handle);
      }
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 2.7), seamMat);
      skirt.position.set(sx * 0.97, 0.25, -0.1);
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
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.05, 0.3), seamMat);
    splitter.position.set(0, 0.2, d.nose + 0.01);
    group.add(splitter);
    for (const fx of style === "gtr" ? [-0.6, -0.2, 0.2, 0.6] : [-0.45, 0, 0.45]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.28), seamMat);
      fin.position.set(fx, 0.21, d.tail + 0.02);
      group.add(fin);
    }
    if (style === "sedan") {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.11, 0.24), bodyMat);
      fin.position.set(0, 1.5, -0.72);
      fin.rotation.x = -0.25;
      group.add(fin);
    }
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), chromeMat);
    badge.rotation.x = Math.PI / 2;
    badge.position.set(0, d.noseTopY, d.nose + 0.01);
    group.add(badge);

    // Indicators + reverse lights
    for (const sx of [-0.86, 0.86]) {
      const ind = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.05), indicatorMat);
      ind.position.set(sx, d.grilleY + 0.06, d.nose - 0.03);
      group.add(ind);
    }
    for (const sx of [-0.55, 0.55]) {
      const rev = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.04), reverseMat);
      rev.position.set(sx, d.tailY - 0.14, d.tail + 0.01);
      group.add(rev);
    }

    // Interior silhouettes behind the glass: dashboard + headrests
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.13, 0.34), interiorMat);
    dash.position.set(0, d.dashY, bCabBack ? 0.15 : 0.5);
    group.add(dash);
    for (const sx of [-0.38, 0.38]) {
      const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.12), interiorMat);
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
        new THREE.BoxGeometry(0.06, 0.17, 0.11),
        colors.raceKit ? tealCaliperMat : caliperMat
      );
      caliper.position.set(wx * 0.93, 0.42, wz + 0.11);
      group.add(caliper);
    }

    // B-pillars split the side glass into door windows
    for (const sxSign of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.44, 0.07), bodyMat);
      pillar.position.set(sxSign * d.bPillar[0], d.bPillar[1], d.bPillar[2]);
      group.add(pillar);
    }

    // Windshield wipers parked at the glass base
    for (const [wxp, rz] of [
      [-0.35, 0.12],
      [0.28, 0.18],
    ]) {
      const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.014, 0.025), seamMat);
      wiper.position.set(wxp, d.hoodY, d.wiperZ);
      wiper.rotation.x = -0.66;
      wiper.rotation.z = rz;
      group.add(wiper);
    }

    // Lower intake + fog lights complete the front fascia
    const intake = new THREE.Mesh(
      new THREE.BoxGeometry(style === "gtr" ? 1.5 : 1.3, style === "gtr" ? 0.2 : 0.13, 0.06),
      grilleMat
    );
    intake.position.set(0, style === "gtr" ? 0.4 : 0.34, d.nose + 0.01);
    group.add(intake);
    for (const sx of [-0.66, 0.66]) {
      const fog = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), reverseMat);
      fog.rotation.x = Math.PI / 2;
      fog.position.set(sx, 0.36, d.nose + 0.01);
      group.add(fog);
    }

    // Mirror glass + a muffler box feeding the exhaust tips
    for (const sxSign of [-1, 1]) {
      const mGlass = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.012), chromeMat);
      mGlass.position.set(sxSign * d.mirror[0], d.mirror[1], d.mirror[2] - 0.1);
      group.add(mGlass);
    }
    const muffler = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.3), grilleMat);
    muffler.position.set(0, 0.23, -1.92);
    group.add(muffler);

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
      const rwiper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.013, 0.022), seamMat);
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
      const stay = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.22), carbonMat);
      stay.position.set(sx, d.deckY + 0.28, -1.88);
      stay.rotation.x = 0.16; // swept back into the plane
      group.add(stay);
    }
    const plane = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.045, 0.5), bodyMat);
    plane.position.set(0, wingY, -2.02);
    plane.rotation.x = -0.18;
    group.add(plane);
    // Gurney flap on the trailing edge + brake strip beneath it
    const gurney = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.02), carbonMat);
    gurney.position.set(0, wingY + 0.06, -2.25);
    group.add(gurney);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.028, 0.03), tailMat);
    strip.position.set(0, wingY - 0.03, -2.24);
    group.add(strip);
    for (const sx of [-0.99, 0.99]) {
      const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.54), carbonMat);
      endplate.position.set(sx, wingY, -2.02);
      group.add(endplate);
    }

    // Front splitter jutting past the bumper, low enough to scrape
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.035, 0.7), carbonMat);
    splitter.position.set(0, 0.14, d.nose - 0.18);
    group.add(splitter);

    // Canards: two per corner, biting the air off the bumper sides
    for (const sxSign of [-1, 1]) {
      for (const [cy, cz] of [
        [0.34, -0.14],
        [0.47, -0.22],
      ]) {
        const canard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.018, 0.18), carbonMat);
        canard.position.set(sxSign * 0.85, cy, d.nose + cz);
        canard.rotation.z = sxSign * 0.3;
        canard.rotation.x = -0.25;
        group.add(canard);
      }
    }

    // Vented hood: twin extraction louvres and a pair of intake scoops
    for (const sx of [-0.36, 0.36]) {
      const louvre = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.5), carbonMat);
      louvre.position.set(sx, d.hoodY + 0.015, 1.15);
      louvre.rotation.x = -0.06; // follows the hood's fall
      group.add(louvre);
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.22), carbonMat);
      scoop.position.set(sx * 1.4, d.hoodY + 0.05, 0.62);
      group.add(scoop);
    }

    // Side skirts hugging the rockers
    for (const sxSign of [-1, 1]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 2.7), carbonMat);
      skirt.position.set(sxSign * 0.93, 0.16, 0);
      group.add(skirt);
    }

    // Rear diffuser kicking up between the exhaust and the bumper
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.03, 0.5), carbonMat);
    diffuser.position.set(0, 0.18, d.tail + 0.12);
    diffuser.rotation.x = 0.35;
    group.add(diffuser);
    for (const fx of [-0.4, 0, 0.4]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.4), carbonMat);
      fin.position.set(fx, 0.2, d.tail + 0.1);
      fin.rotation.x = 0.35;
      group.add(fin);
    }

    // Red tow hook on the splitter — scrutineering says so
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.12), caliperMat);
    hook.position.set(0.45, 0.19, d.nose + 0.08);
    group.add(hook);
  }

  // GT wing — always the player's choice: equip the part or run clean
  // (the attack kit brings its own swan-neck; don't stack two wings)
  if (colors.spoiler && !colors.raceKit) {
    const baseY = d.deckY + 0.18;
    for (const sx of [-0.62, 0.62]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.16), seamMat);
      strut.position.set(sx, baseY, -1.95);
      group.add(strut);
    }
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 0.42), bodyMat);
    wing.position.set(0, baseY + 0.15, -1.98);
    wing.rotation.x = -0.12;
    group.add(wing);
    // Brake strip let into the wing's trailing edge
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.025, 0.03), tailMat);
    strip.position.set(0, baseY + 0.13, -2.17);
    group.add(strip);
    for (const sx of [-0.88, 0.88]) {
      const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.4), seamMat);
      endplate.position.set(sx, baseY + 0.15, -1.98);
      group.add(endplate);
    }
  }

  group.userData.wheels = wheels;
  group.userData.tailMat = tailMat;
  group.userData.headMat = headMat;
  // The paint is per-car (glass/chrome/rims are shared modules), so the
  // engine can feed the player's paint a live reflection probe without
  // leaking it onto every car on the road.
  group.userData.bodyMat = bodyMat;
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

  // Swap in the Blender-authored shells when they arrive. Traffic keeps
  // the cheap procedural extrusions — thirty cars don't need the density.
  if (!colors.simple) upgradeCarShells(group, style);

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
