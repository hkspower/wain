import * as THREE from "three";
import type { Track } from "./track";

// The flat ribbon every ground surface on the road is built from: the
// asphalt, the edge lines, the solid approach lines, the corniche
// walkway, the beach, the plaza kerb.
//
// Its own module, and a pure one (three and the Track type, nothing
// else), so that the marking builder in markings.ts can lay paint with
// the same function the world lays the road with and a node test can
// call both without a browser. It lived in world.ts, which markings.ts
// must not import: world.ts imports markings.ts, and a circle between
// them would hand one of the two an undefined binding at load time.

/** Lateral offset: a constant, or a function of s for widths that follow
 *  the drivable road (the Sharq plaza swell). */
export type LatOffset = number | ((s: number) => number);
export const latAt = (o: LatOffset, s: number) => (typeof o === "number" ? o : o(s));

/** Flat ribbon following the track between lateral offsets a..b at height y,
 *  optionally only over the lap fraction u0..u1.
 *
 *  `uMetres`, when given, maps the texture's u to metres of lateral
 *  offset — u = lat / uMetres + 0.5 — instead of stretching 0..1 across
 *  whatever width the ribbon happens to have at that s. The road needs
 *  it: with u pinned to the two edges, the asphalt's wheel paths and wear
 *  bands sat where the lanes are only while the road was 14 m wide, and
 *  at the plaza's 38 m they slid out across the lane lines. At hw = 7 and
 *  uMetres = 14 the mapping is the old one exactly (u 0..1 over lat ±7). */
export function buildRibbon(
  track: Track,
  a: LatOffset,
  b: LatOffset,
  y: number,
  step = 8,
  u0 = 0,
  u1 = 1,
  uMetres?: number
): THREE.BufferGeometry {
  const span = (u1 - u0) * track.length;
  const n = Math.ceil(span / step);
  const positions = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();

  for (let i = 0; i <= n; i++) {
    const s = u0 * track.length + (i / n) * span;
    track.pointAt(s, p);
    track.sideAt(s, side);
    const av = latAt(a, s);
    const bv = latAt(b, s);
    const o = i * 6;
    positions[o] = p.x + side.x * av;
    positions[o + 1] = y;
    positions[o + 2] = p.z + side.z * av;
    positions[o + 3] = p.x + side.x * bv;
    positions[o + 4] = y;
    positions[o + 5] = p.z + side.z * bv;
    const ou = i * 4;
    uvs[ou] = uMetres ? av / uMetres + 0.5 : 0;
    uvs[ou + 1] = s / 14; // one texture tile per ~14 m of road
    uvs[ou + 2] = uMetres ? bv / uMetres + 0.5 : 1;
    uvs[ou + 3] = s / 14;
    if (i < n) {
      const v = i * 2;
      // Wound to face UP, decided per quad from which offset is on the
      // left. `side` is tangent x UP, so (lateral, along) is a
      // left-handed pair and the natural index order faces the GROUND —
      // and a ground quad facing down is back-face culled, which is the
      // trap the cross streets fell into and documented in world.ts.
      //
      // Both edge lines fell into it too, and stayed there. The call site
      // tried to correct the winding with an `edge < 0 ? 0.35 : 0.15`
      // ternary, but negating both offsets for the far side already
      // reverses their order, so the swap cancelled itself: b - a came
      // out -0.20 on BOTH edges. Measured on the live curve, every vertex
      // normal on both ribbons read -1.000 — the game's two lane edge
      // lines had never been drawn at all. Neither had the corniche
      // walkway, the beach, or the seaward half of the plaza kerb.
      //
      // Deciding it here rather than at each call site is the point: a
      // caller cannot get this wrong if it is not the caller's to get
      // wrong, and the ribbon knows which way round its own offsets are.
      if (bv > av) indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      else indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
