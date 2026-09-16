import * as THREE from "three";
import { RIG } from "./rig";
import { stepSpring, type SpringState } from "./spring";

// The verge, as a thing with mass.
//
// The roadside planting bent in a vertex shader from the first day it
// existed, but the number it bent by was solved fresh every frame: a
// wind term and a push away from wherever the player's car happened to
// be. No memory, no velocity. A car went past and the plants stood
// straight up the instant it was gone — and only the player's car
// moved them; the rival and forty-six civilians drove through a hedge
// that did not know they were there.
//
// Each plant is now a two-axis spring (the lean, in the ground plane,
// and its velocity), driven toward a target that is the sum of the
// wind and every car's wake. The wake is DIRECTIONAL: beside and just
// ahead of a car the air is pushed outward from its path, and behind
// it the air is pulled back in and dragged along — the trailing wash.
// So a plant leans away as the nose arrives, is tugged the other way
// as the tail passes, and rings down on its own spring. That last part
// is the whole difference: a hedge after a lorry has gone through it.
//
// This file is pure arithmetic over typed arrays so that it can be run
// without a browser (tests/plants.mjs). world.ts owns the meshes and
// hands the result to the shader; nothing here knows what a mesh is.

/** A car, as the verge sees it: where, which way, how fast, how long. */
export interface Wake {
  /** Arc length along the lap, for the window search. */
  s: number;
  x: number;
  z: number;
  /** Unit heading in the ground plane. */
  dirX: number;
  dirZ: number;
  /** m/s. */
  speed: number;
  /** Overall length, metres. */
  len: number;
}

/** One plant at build time. */
export interface PlantSeed {
  s: number;
  x: number;
  z: number;
  /** The instance's own yaw, so a world-space lean can be turned into
   *  the plant's frame — the shader bends BEFORE the instance matrix. */
  yaw: number;
  phase: number;
  /** 0 a shrub on the verge, 1 a palm crown six metres up. */
  kind: 0 | 1;
}

export interface PlantField {
  n: number;
  s: Float32Array;
  x: Float32Array;
  z: Float32Array;
  cy: Float32Array;
  sy: Float32Array;
  phase: Float32Array;
  kind: Uint8Array;
  /** Target lean this frame, world plane — scratch. */
  tx: Float32Array;
  tz: Float32Array;
  /** The springs: lean and velocity, world plane. */
  lx: Float32Array;
  lz: Float32Array;
  vx: Float32Array;
  vz: Float32Array;
  /** Indices sorted by s, and s in that order, for the window search. */
  order: Uint32Array;
  sorted: Float32Array;
  /** How many plants the last solve evaluated a wake on — for the cost
   *  test, which is the reason the window search exists. */
  wakeEvals: number;
}

export function newPlantField(seeds: PlantSeed[]): PlantField {
  const n = seeds.length;
  const f: PlantField = {
    n,
    s: new Float32Array(n),
    x: new Float32Array(n),
    z: new Float32Array(n),
    cy: new Float32Array(n),
    sy: new Float32Array(n),
    phase: new Float32Array(n),
    kind: new Uint8Array(n),
    tx: new Float32Array(n),
    tz: new Float32Array(n),
    lx: new Float32Array(n),
    lz: new Float32Array(n),
    vx: new Float32Array(n),
    vz: new Float32Array(n),
    order: new Uint32Array(n),
    sorted: new Float32Array(n),
    wakeEvals: 0,
  };
  for (let i = 0; i < n; i++) {
    const p = seeds[i];
    f.s[i] = p.s;
    f.x[i] = p.x;
    f.z[i] = p.z;
    f.cy[i] = Math.cos(p.yaw);
    f.sy[i] = Math.sin(p.yaw);
    f.phase[i] = p.phase;
    f.kind[i] = p.kind;
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => seeds[a].s - seeds[b].s);
  for (let k = 0; k < n; k++) {
    f.order[k] = idx[k];
    f.sorted[k] = seeds[idx[k]].s;
  }
  return f;
}

/** First index in `sorted` with a value >= s. */
function lowerBound(sorted: Float32Array, s: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const _a: SpringState = { x: 0, v: 0 };
const _b: SpringState = { x: 0, v: 0 };

/**
 * One frame of the verge. `out` receives each plant's bend in its OWN
 * frame — (dirX, dirZ, strength), the shape the shader reads — so the
 * caller can write it straight into an instance attribute.
 */
export function solvePlantField(
  f: PlantField,
  t: number,
  dt: number,
  wakes: readonly Wake[],
  lapLen: number,
  out: (i: number, dx: number, dz: number, str: number) => void
): void {
  const P = RIG.plant;
  // --- wind, on every plant ------------------------------------------
  // A slow gust that everything feels, turning slowly; each plant's own
  // sway on top, offset by its phase so the hedge does not move in
  // step; and a FRONT — a wave travelling down the road — so a gust is
  // seen arriving, plant after plant, rather than switching on.
  const gust = P.gustBase + P.gustAmp * Math.sin(t * P.gustRate);
  const wdir = t * P.windTurnRate;
  const wx = Math.cos(wdir) * P.windK;
  const wz = Math.sin(wdir) * P.windK;
  const sway = 2 * Math.PI * P.swayHz;
  for (let i = 0; i < f.n; i++) {
    const ph = f.phase[i];
    // The front scales the whole gust, so it is felt on the lean's size
    // rather than as a push of its own.
    const g = gust * (1 + P.frontAmp * Math.sin(t * P.frontRate - f.s[i] * P.frontK));
    f.tx[i] = (wx + Math.sin(t * sway + ph) * P.swayK) * g;
    f.tz[i] = (wz + Math.cos(t * sway * 0.78 + ph * 1.3) * P.swayK) * g;
  }
  // --- wakes, on the plants near each car ----------------------------
  f.wakeEvals = 0;
  for (const w of wakes) {
    const spd = Math.min(1, w.speed / P.wakeRefSpeed);
    if (spd <= 0.01) continue;
    const half = w.len * 0.5;
    const reach = Math.max(P.wakeR + half + P.noseM, P.wakeR + half + P.tailLenM * 3);
    // The window along the lap, in two pieces when it crosses the seam.
    const lo = w.s - reach;
    const hi = w.s + reach;
    const ranges: Array<[number, number]> =
      lo < 0 ? [[lo + lapLen, lapLen], [0, hi]] : hi > lapLen ? [[lo, lapLen], [0, hi - lapLen]] : [[lo, hi]];
    // Left of the heading.
    const px = -w.dirZ;
    const pz = w.dirX;
    for (const [a, b] of ranges) {
      const k0 = lowerBound(f.sorted, a);
      for (let k = k0; k < f.n && f.sorted[k] <= b; k++) {
        const i = f.order[k];
        f.wakeEvals++;
        const rx = f.x[i] - w.x;
        const rz = f.z[i] - w.z;
        const along = rx * w.dirX + rz * w.dirZ;
        const across = rx * px + rz * pz;
        const dist = Math.abs(across);
        if (dist >= P.wakeR || dist < 1e-3) continue;
        const lateral = 1 - dist / P.wakeR;
        const side = across > 0 ? 1 : -1;
        const scale = (f.kind[i] === 1 ? P.palmWakeK : 1) * spd * lateral;
        if (along > -half) {
          // Beside, and a little ahead of the nose: pushed outward.
          const g = along <= half ? 1 : Math.max(0, 1 - (along - half) / P.noseM);
          const push = P.wakeK * scale * g * side;
          f.tx[i] += px * push;
          f.tz[i] += pz * push;
        } else {
          // Behind: pulled back in toward the path and dragged along it.
          const e = Math.exp(-(-along - half) / P.tailLenM);
          const pull = -P.suctionK * scale * e * side;
          const drag = P.dragK * scale * e;
          f.tx[i] += px * pull + w.dirX * drag;
          f.tz[i] += pz * pull + w.dirZ * drag;
        }
      }
    }
  }
  // --- the springs -----------------------------------------------------
  for (let i = 0; i < f.n; i++) {
    const palm = f.kind[i] === 1;
    const k = palm ? P.palmK : P.shrubK;
    const c = palm ? P.palmC : P.shrubC;
    _a.x = f.lx[i];
    _a.v = f.vx[i];
    _b.x = f.lz[i];
    _b.v = f.vz[i];
    stepSpring(_a, f.tx[i], k, c, dt);
    stepSpring(_b, f.tz[i], k, c, dt);
    let x = _a.x;
    let z = _b.x;
    let str = Math.hypot(x, z);
    if (str > P.maxLean) {
      // The stem has a limit and the spring does not: hold the lean at
      // it and let the velocity carry on, so it comes back off the stop
      // the way it went on.
      const r = P.maxLean / str;
      x *= r;
      z *= r;
      str = P.maxLean;
    }
    f.lx[i] = x;
    f.lz[i] = z;
    f.vx[i] = _a.v;
    f.vz[i] = _b.v;
    // Into the plant's own frame. The instance is spun by `yaw` about Y
    // (x' = x cos + z sin, z' = -x sin + z cos), and the shader bends
    // before that spin is applied, so the world lean is turned back by
    // the same angle here. Without this a hedge bent by a car leaned in
    // a thousand random directions — one per plant's spin.
    const cy = f.cy[i];
    const sy = f.sy[i];
    const inv = str > 1e-6 ? 1 / str : 0;
    const dx = (x * cy - z * sy) * inv;
    const dz = (x * sy + z * cy) * inv;
    out(i, dx, dz, str);
  }
}

/**
 * Bake the per-vertex bend weight onto a geometry: 0 where it is rooted,
 * 1 at the tips, cubed so the root is stiff and the tip whippy. A shrub
 * roots at the ground and its weight is height; a palm crown is a ring
 * of fronds on a fixed trunk, so its weight is distance out from the
 * axis — the tips flutter and the heart barely moves. Computed from the
 * geometry's own bounds, so the authored crown that replaces the
 * procedural one is baked the same way.
 */
export function bakeBendWeight(geo: THREE.BufferGeometry, mode: "height" | "radial"): void {
  const p = geo.getAttribute("position");
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const w = new Float32Array(p.count);
  if (mode === "height") {
    const top = bb.max.y || 1;
    for (let i = 0; i < p.count; i++) {
      const k = Math.max(0, Math.min(1, p.getY(i) / top));
      w[i] = k * k * k;
    }
  } else {
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    let rMax = 1e-6;
    for (let i = 0; i < p.count; i++) {
      rMax = Math.max(rMax, Math.hypot(p.getX(i) - cx, p.getZ(i) - cz));
    }
    for (let i = 0; i < p.count; i++) {
      const k = Math.hypot(p.getX(i) - cx, p.getZ(i) - cz) / rMax;
      w[i] = k * k * k;
    }
  }
  geo.setAttribute("grnWeight", new THREE.BufferAttribute(w, 1));
}
