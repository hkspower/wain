// The roadside planting, measured without a browser.
//
//   npm run test:shrubs          (no browser, no dev server)
//
// The verge passed every guard it had while it rendered as torn green
// glass. tests/planting.mjs measured where each plant's CENTRE stood and
// how tall it was — correctly, and nothing else — so a shape whose
// corners had come apart (IcosahedronGeometry is not indexed, and every
// copy of a corner took its own rand()), whose 300 of 300 triangles were
// flat-shaded, that was one flat colour, and that stood on cross-street
// pavement 109-126 times, was green on every run. This is the instrument
// for the half nobody was measuring:
//
//   §1 every shape: welded, smooth, no underside, a lit crown over a dark
//      foot, a canopy as bright as the old one and no brighter, the bend
//      weight rooted, and the same mesh every build;
//   §2 the leaf tile: averages to exactly 1, has leaves and gaps, tiles;
//      and its shader patch finds its anchors in three's own shader;
//   §3 the layout over the REAL Track: every footprint corner behind the
//      rail, nothing in a street mouth, on a forecourt, in the tunnel, in
//      the sea or on top of the verge's furniture, the hedges continuous,
//      every plant taller than the rail, the lean in metres, the budget;
//   §4 the shared stream: the beds draw nothing from it, and the burn
//      that stands in for the old block's draws is exact — against a
//      verbatim copy of the old block in source order, which is itself
//      held to the recorded city: run from the draw that city entered
//      the block at, it rebuilds the old planting to its recorded hashes.
//
// What it does not cover: the chunked culling (S2 of the design — not
// built), and how it looks. The browser half is tests/planting.mjs,
// tests/world.mjs and the ik stills.
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  SHRUB,
  SHRUB_KINDS,
  LEAF_TILE,
  shrubGeometry,
  canopyMeanY,
  lumaY,
  openEdgeVertices,
  triCount,
  leafDetailData,
  patchLeafVertex,
  patchLeafFragment,
  layoutVerge,
  burnLegacyVergeDraws,
} from "../src/game/shrubs.ts";
import { Track, LAP, COAST_END_M, COAST_U, CITY_GROUND_Y, ROAD_HALF_WIDTH } from "../src/game/track.ts";
import { STREETS, onForecourt, vergeFurniture } from "../src/game/world.ts";
import { makeRng, rand, resetWorldRng, worldDraws, WORLD_SEED } from "../src/game/rand.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const f3 = (x) => x.toFixed(3);

// ------------------------------------------------------------------ §1
console.log("=== §1 SHAPES ===");
const toSrgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const geos = {};
for (const [i, kind] of SHRUB_KINDS.entries()) {
  const drawsBefore = worldDraws();
  const g = shrubGeometry(kind, i + 1);
  check(worldDraws() === drawsBefore, `${kind}: building the shape drew from the world's shared stream`);
  geos[kind] = g;
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const col = g.getAttribute("color");
  const wgt = g.getAttribute("grnWeight");
  const idx = g.index;
  const tris = triCount(g);
  const bb = g.boundingBox;
  const top = bb.max.y;

  // Welded: no two vertices at one position. THIS is the torn-shard
  // bug — six copies of a corner, each displaced on its own.
  const seen = new Map();
  let dupes = 0;
  for (let v = 0; v < pos.count; v++) {
    const k = `${Math.round(pos.getX(v) * 1e5)},${Math.round(pos.getY(v) * 1e5)},${Math.round(pos.getZ(v) * 1e5)}`;
    if (seen.has(k)) dupes++;
    else seen.set(k, v);
  }
  // Open edges, flat-shaded and downward faces.
  //
  // THE RIM IS ON THE SOIL, EXACTLY. The round kinds have their rim
  // pinned to y = 0 (moundShape) and the hedge's foot ring is built at
  // y = 0, so every open-edge vertex is 0 to the bit, and the check is
  // exact. The first version allowed 0.36 of the height, which is wider
  // than the gap the pin exists to close: with the pin line deleted the
  // rims measured ball 0.182-0.289, mound 0.144-0.194 and upright
  // 0.176-0.244 of the height, daylight under every plant, and that
  // check stayed green.
  const open = openEdgeVertices(g);
  let openTop = 0, openOff = 0;
  for (const v of open) {
    openTop = Math.max(openTop, pos.getY(v));
    if (pos.getY(v) !== 0) openOff++;
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n0 = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
  let flat = 0, down = 0;
  for (let f = 0; f < idx.count; f += 3) {
    const i0 = idx.getX(f), i1 = idx.getX(f + 1), i2 = idx.getX(f + 2);
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    const fn = b.sub(a).cross(c.sub(a)).normalize();
    if (fn.y < -0.5) down++;
    n0.fromBufferAttribute(nor, i0); n1.fromBufferAttribute(nor, i1); n2.fromBufferAttribute(nor, i2);
    if (n0.distanceTo(n1) < 1e-4 && n0.distanceTo(n2) < 1e-4) flat++;
  }
  // Bend weight: rooted at the soil, whole at the top.
  let rootMax = 0, tipW = 0, tipY = -Infinity;
  for (let v = 0; v < pos.count; v++) {
    const y = pos.getY(v);
    if (y <= 0.02) rootMax = Math.max(rootMax, wgt.getX(v));
    if (y > tipY) { tipY = y; tipW = wgt.getX(v); }
  }
  // The baked light. The underside is cut away, so the plant's core is
  // the foot of its shell: the top band against the bottom band, leaf
  // vertices only (a flower is meant to be brighter than a leaf).
  const flower = g.userData.flower;
  let topY = 0, topN = 0, footY = 0, footN = 0, mr = 0, mg = 0, mb = 0, mn = 0, nFlower = 0, nUpper = 0;
  for (let v = 0; v < pos.count; v++) {
    const yc = pos.getY(v) / top;
    if (yc > SHRUB.flowers.above) { nUpper++; if (flower[v]) nFlower++; }
    if (flower[v]) continue;
    const Y = lumaY(col.getX(v), col.getY(v), col.getZ(v));
    if (yc > 0.85) { topY += Y; topN++; }
    if (yc < 0.2) { footY += Y; footN++; }
    mr += col.getX(v); mg += col.getY(v); mb += col.getZ(v); mn++;
  }
  const crown = topY / topN / (footY / footN);
  // Edge-neighbour contrast: one flat colour per plant was 0.
  const rel = [];
  for (let f = 0; f < idx.count; f += 3) {
    for (let e = 0; e < 3; e++) {
      const u = idx.getX(f + e), w = idx.getX(f + ((e + 1) % 3));
      const Yu = lumaY(col.getX(u), col.getY(u), col.getZ(u)), Yw = lumaY(col.getX(w), col.getY(w), col.getZ(w));
      rel.push((Yu - Yw) / ((Yu + Yw) / 2));
    }
  }
  const relMean = rel.reduce((s, x) => s + x, 0) / rel.length;
  const relStd = Math.sqrt(rel.reduce((s, x) => s + (x - relMean) ** 2, 0) / rel.length);
  // The leaf canopy's mean colour, as the eye would name it.
  const [R, G, B] = [mr / mn, mg / mn, mb / mn].map(toSrgb);
  const mx = Math.max(R, G, B), mi = Math.min(R, G, B);
  const sat = (mx - mi) / mx;
  const hue = mx === G ? 60 * (2 + (B - R) / (mx - mi)) : mx === R ? 60 * (((G - B) / (mx - mi)) % 6) : 60 * (4 + (R - G) / (mx - mi));
  const meanY = canopyMeanY(g);
  // The same mesh every build.
  const again = shrubGeometry(kind, i + 1);
  const pa = pos.array, pb = again.getAttribute("position").array;
  const ca = col.array, cb = again.getAttribute("color").array;
  let same = pa.length === pb.length && ca.length === cb.length;
  for (let k = 0; same && k < pa.length; k++) same = pa[k] === pb[k];
  for (let k = 0; same && k < ca.length; k++) same = ca[k] === cb[k];

  const spec = SHRUB.kinds[kind];
  const flowering = !!spec.flower;
  console.log(
    `  ${kind.padEnd(7)} ${tris} tris, ${pos.count} verts; open rim ${open.size} verts at y<=${f3(openTop)}; ` +
      `flat ${flat}, down ${down}; canopy Y ${meanY.toFixed(4)}; crown/foot ${crown.toFixed(2)}; ` +
      `contrast ${relStd.toFixed(3)}; sRGB s ${sat.toFixed(2)} h ${hue.toFixed(0)}°; flowers ${nFlower}/${nUpper}`
  );
  check(!!idx, `${kind}: not indexed — the copies of each corner can move apart`);
  check(dupes === 0, `${kind}: ${dupes} vertices share a position with another — unwelded corners tear`);
  check(tris <= SHRUB.maxTrisPerPlant, `${kind}: ${tris} triangles > ${SHRUB.maxTrisPerPlant}`);
  check(openOff === 0, `${kind}: ${openOff} of ${open.size} open-edge vertices off the soil, up to y ${f3(openTop)} — daylight under the skirt`);
  check(flat / tris <= 0.05, `${kind}: ${flat} of ${tris} triangles flat-shaded (legacy 300/300)`);
  check(down / tris <= 0.02, `${kind}: ${down} of ${tris} triangles face the soil`);
  check(bb.min.y >= -0.01, `${kind}: geometry reaches y ${f3(bb.min.y)}, below its own foot`);
  check(Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z) <= 0.5 + 1e-6, `${kind}: footprint leaves the unit frame (±0.5)`);
  check(Math.abs(top - 1) < 1e-6, `${kind}: top at ${f3(top)}, not 1 — an instance's y scale would not be its height`);
  check(rootMax <= 0.01, `${kind}: bend weight ${f3(rootMax)} at the root — the foot would slide`);
  check(tipW >= 0.99, `${kind}: bend weight ${f3(tipW)} at the top`);
  check(col && col.itemSize === 3, `${kind}: no colour attribute`);
  check(meanY >= SHRUB.canopyY[0] && meanY <= SHRUB.canopyY[1], `${kind}: canopy Y ${meanY.toFixed(4)} outside ${SHRUB.canopyY.join("..")} (old planting 0.037..0.051)`);
  check(crown >= 1.8, `${kind}: crown only ${crown.toFixed(2)}× the foot — no core, no lit top`);
  check(relStd >= 0.08, `${kind}: neighbour contrast ${relStd.toFixed(3)} — a flat-coloured plant`);
  check(sat <= 0.45 && hue >= 85 && hue <= 115, `${kind}: leaf colour s ${sat.toFixed(2)} h ${hue.toFixed(0)}° is not a dusty Gulf green`);
  check(same, `${kind}: a second build is not bit-identical`);
  if (flowering) check(nFlower / nUpper >= 0.1 && nFlower / nUpper <= 0.6, `${kind}: ${nFlower} of ${nUpper} upper vertices in flower`);
  else check(nFlower === 0, `${kind}: flowers on a plant that does not flower`);
}
{
  const H = SHRUB.kinds.hedge;
  const joint = H.round[0] * H.len;
  console.log(`  hedge joints: end rounding ${f3(joint)} m against half the ${f3(H.len - H.pitch)} m overlap  ` +
    check(joint <= (H.len - H.pitch) / 2, "the rounded hedge ends would notch the joint between segments"));
}

// ------------------------------------------------------------------ §2
console.log("\n=== §2 LEAF TILE ===");
{
  const d0 = worldDraws();
  const data = leafDetailData();
  const N = LEAF_TILE.px;
  const v = (i, c) => (data[i * 4 + c] / 255) * 2;
  const means = [0, 1, 2].map((c) => { let s = 0; for (let i = 0; i < N * N; i++) s += v(i, c); return s / (N * N); });
  const Y = new Float32Array(N * N);
  let my = 0;
  for (let i = 0; i < N * N; i++) { Y[i] = lumaY(v(i, 0), v(i, 1), v(i, 2)); my += Y[i]; }
  my /= N * N;
  let gap = 0, sd = 0;
  for (let i = 0; i < N * N; i++) { if (Y[i] < 0.75 * my) gap++; sd += (Y[i] - my) ** 2; }
  gap /= N * N; sd = Math.sqrt(sd / (N * N));
  // Tileable: the wrap from the last row to the first is no harsher than
  // any two neighbouring rows inside.
  let seamR = 0, seamC = 0, inner = 0, nIn = 0;
  for (let x = 0; x < N; x++) {
    seamR += Math.abs(Y[x] - Y[(N - 1) * N + x]);
    seamC += Math.abs(Y[x * N] - Y[x * N + N - 1]);
    for (let y = 1; y < N - 1; y++) { inner += Math.abs(Y[y * N + x] - Y[(y + 1) * N + x]); nIn++; }
  }
  seamR /= N; seamC /= N; inner /= nIn;
  const again = leafDetailData();
  let same = again.length === data.length;
  for (let i = 0; same && i < data.length; i++) same = again[i] === data[i];
  console.log(`  mean ${means.map((m) => m.toFixed(3)).join(" / ")}; gaps ${(gap * 100).toFixed(1)}%; luma std ${sd.toFixed(3)}; ` +
    `seams ${seamR.toFixed(3)} / ${seamC.toFixed(3)} against ${inner.toFixed(3)} inside`);
  check(means.every((m) => Math.abs(m - 1) <= 0.02), `leaf tile mean ${means.map((m) => m.toFixed(3)).join("/")}, not 1 — distant canopies would change exposure`);
  check(gap >= 0.12 && gap <= 0.3, `leaf tile gap fraction ${(gap * 100).toFixed(1)}% outside 12-30%`);
  check(sd >= 0.18, `leaf tile luma std ${sd.toFixed(3)} < 0.18 — no leaves to see`);
  check(seamR <= 1.5 * inner && seamC <= 1.5 * inner, "the leaf tile has a seam where it repeats");
  check(same, "the leaf tile is not the same twice");
  check(worldDraws() === d0, "the leaf tile drew from the world's shared stream");

  // The shader patch: anchors present exactly once in three's own
  // MeshStandardMaterial shaders, and the fragment half NOT behind
  // USE_INSTANCING — three defines that for the vertex stage only, so a
  // guarded fragment block compiles and never runs.
  let vs = "", fs = "", threw = null;
  try {
    vs = patchLeafVertex(THREE.ShaderLib.standard.vertexShader);
    fs = patchLeafFragment(THREE.ShaderLib.standard.fragmentShader);
  } catch (e) { threw = e.message; }
  const leafAt = fs.indexOf("grnLeafMap, grnLp");
  const guard = fs.lastIndexOf("#ifdef USE_INSTANCING", leafAt);
  const guardEnd = guard >= 0 ? fs.indexOf("#endif", guard) : -1;
  console.log(`  shader patch ${check(!threw, `leaf patch: ${threw}`)}  ` +
    check(vs.includes("vGrnLeafP = position;") && leafAt > 0 && !(guard >= 0 && guardEnd > leafAt),
      "the leaf tile's fragment code is missing or sits behind a vertex-only define"));
  let threwOnMissing = false;
  try { patchLeafFragment("void main() {}"); } catch { threwOnMissing = true; }
  check(threwOnMissing, "the leaf patch accepted a shader without its anchors — a renamed chunk would ship silently");
}

// ------------------------------------------------------------------ §3
console.log("\n=== §3 LAYOUT (the real Track) ===");
const track = new Track();
const L = track.length;
const blockLen = L / Math.round(L / STREETS.crossEvery);
const crossCount = Math.round(L / blockLen);
const opts = (avoid) => ({
  track,
  L,
  tunnel: LAP.tunnel,
  coastEnd: COAST_END_M,
  coastU: COAST_U.to,
  blockLen,
  streetHalf: STREETS.half,
  onForecourt: (s, h, lo, hi) => onForecourt(track, s, h, lo, hi),
  avoid,
  rng: makeRng((WORLD_SEED ^ 0x53485242) >>> 0),
});
// The real furniture (no palms — their seeds come from the palm block's
// shared draws, which need a whole world build) plus a synthetic palm.
const synthetic = { s: 4000, lat: 9.6, r: 0.3 };
const furniture = [...vergeFurniture(track, []), synthetic];
const d0 = worldDraws();
const t0 = performance.now();
const beds = layoutVerge(opts(furniture));
const ms = performance.now() - t0;
console.log(`  ${beds.length} plants in ${ms.toFixed(0)} ms; ${furniture.length} furniture points stepped round`);
check(worldDraws() === d0, `layoutVerge drew ${worldDraws() - d0} numbers from the world's shared stream`);
{
  const again = layoutVerge(opts(furniture));
  check(again.length === beds.length && again.every((b, i) => b.s === beds[i].s && b.lat === beds[i].lat && b.yaw === beds[i].yaw),
    "the layout is not the same twice");
}

const P = new THREE.Vector3(), T = new THREE.Vector3(), S = new THREE.Vector3();
/** World xz back to (s, lat), from a nearby guess. */
const project = (x, z, s) => {
  for (let k = 0; k < 4; k++) {
    track.pointAt(s, P); track.tangentAt(s, T);
    s += (x - P.x) * T.x + (z - P.z) * T.z;
  }
  track.pointAt(s, P); track.sideAt(s, S);
  return { s, lat: (x - P.x) * S.x + (z - P.z) * S.z };
};

const by = {};
let worstCorner = Infinity, worstBack = -Infinity, minTop = Infinity, tris = 0;
const bad = { corner: [], back: 0, tunnel: 0, sea: 0, street: [], forecourt: 0, furniture: [], gain: 0, top: 0 };
const RAIL_LIP = 0.776; // the W-beam's crest; tests/planting.mjs reads it off the rail in the scene
for (const b of beds) {
  by[b.kind] = (by[b.kind] ?? 0) + 1;
  const g = geos[b.kind];
  tris += triCount(g);
  const bb = g.boundingBox;
  const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
  for (const lx of [bb.min.x, bb.max.x]) {
    for (const lz of [bb.min.z, bb.max.z]) {
      const ox = lx * b.sx, oz = lz * b.sz;
      const c = project(b.x + ox * cy + oz * sy, b.z - ox * sy + oz * cy, b.s);
      const clear = b.side * c.lat - track.halfWidthAt(c.s);
      worstCorner = Math.min(worstCorner, clear);
      if (clear < 1.2 && bad.corner.length < 3) bad.corner.push(`${b.kind} s=${b.s.toFixed(1)} corner ${clear.toFixed(2)} m out`);
    }
  }
  const back = Math.abs(b.lat) + b.depth / 2 - track.halfWidthAt(b.s);
  worstBack = Math.max(worstBack, back);
  if (back > SHRUB.bed.backMax + 1e-9) bad.back++;
  const lo = b.s - b.len / 2, hi = b.s + b.len / 2;
  if (hi > LAP.tunnel.from - 20 && lo < LAP.tunnel.to + 20) bad.tunnel++;
  if (b.side < 0 && (lo < COAST_END_M + 40 || hi > L - 40)) bad.sea++;
  for (let i = 0; i < crossCount; i++) {
    const cs = i * blockLen;
    if (b.side < 0 && cs / L <= COAST_U.to) continue;
    if (Math.abs(track.deltaAhead(cs, b.s)) < STREETS.half + 1.0 + b.len / 2 && bad.street.length < 3) bad.street.push(`${b.kind} s=${b.s.toFixed(1)} by street ${i}`);
  }
  if (b.side > 0 && onForecourt(track, b.s, b.len / 2, Math.abs(b.lat) - b.depth / 2, Math.abs(b.lat) + b.depth / 2)) bad.forecourt++;
  for (const f of furniture) {
    if (Math.abs(track.deltaAhead(f.s, b.s)) < b.len / 2 + f.r + 0.3 && Math.abs(b.lat - f.lat) < b.depth / 2 + f.r + 0.3) {
      if (bad.furniture.length < 3) bad.furniture.push(`${b.kind} s=${b.s.toFixed(1)} lat=${b.lat.toFixed(2)} on (${f.s.toFixed(1)}, ${f.lat.toFixed(2)})`);
    }
  }
  const G = SHRUB.kinds[b.kind].bendGain * b.sy;
  if (Math.abs(b.gx * b.sx - G) > 1e-6 || Math.abs(b.gz * b.sz - G) > 1e-6 || Math.abs(b.gain - G) > 1e-9) bad.gain++;
  const absTop = CITY_GROUND_Y - SHRUB.sink + b.sy;
  minTop = Math.min(minTop, absTop);
  if (absTop < RAIL_LIP + 0.05) bad.top++;
}
console.log(`  ${Object.entries(by).map(([k, n]) => `${n} ${k}`).join(", ")}; ${tris} triangles resident`);
console.log(`  footprint corners >= ${worstCorner.toFixed(2)} m outside the tarmac  ` +
  check(bad.corner.length === 0, `footprint inside hw + 1.2 (behind the rail is + 0.683): ${bad.corner.join("; ")}`));
console.log(`  back faces <= hw + ${worstBack.toFixed(2)}  ` + check(bad.back === 0, `${bad.back} bed(s) reach past hw + ${SHRUB.bed.backMax} into the city bands`));
console.log(`  tunnel ${check(bad.tunnel === 0, `${bad.tunnel} plant(s) in the tunnel or its walled approach`)}  ` +
  `sea ${check(bad.sea === 0, `${bad.sea} plant(s) on the seaward verge of the coast or past a seam`)}  ` +
  `street mouths ${check(bad.street.length === 0, `plants in a cross-street mouth: ${bad.street.join("; ")}`)}  ` +
  `forecourts ${check(bad.forecourt === 0, `${bad.forecourt} plant(s) on a forecourt apron`)}  ` +
  `furniture ${check(bad.furniture.length === 0, `plants on the verge's furniture: ${bad.furniture.join("; ")}`)}`);
console.log(`  absolute top >= ${minTop.toFixed(3)} m against the ${RAIL_LIP} m rail lip  ` +
  check(bad.top === 0, `${bad.top} plant(s) no taller than the rail from the road`));
console.log(`  lean in metres ${check(bad.gain === 0, `${bad.gain} plant(s) whose per-axis gain does not give bendGain × height in metres`)}`);

// Counts, beds, hedges.
{
  const leftPast = beds.filter((b) => b.side < 0 && b.s > COAST_END_M).length;
  const rightPast = beds.filter((b) => b.side > 0 && b.s > COAST_END_M).length;
  const span = new Map();
  for (const b of beds) {
    const e = span.get(b.bed) ?? { lo: Infinity, hi: -Infinity };
    e.lo = Math.min(e.lo, b.s - b.len / 2); e.hi = Math.max(e.hi, b.s + b.len / 2);
    span.set(b.bed, e);
  }
  const lens = [...span.values()].map((e) => e.hi - e.lo).sort((x, y) => x - y);
  const median = lens[lens.length >> 1];
  // Hedges: consecutive segments of a bed overlap, and follow the line.
  let minOverlap = Infinity, worstYaw = 0, worstStraightYaw = 0;
  const p = new THREE.Vector3(), q = new THREE.Vector3(), tmp = new THREE.Vector3();
  const hedges = beds.filter((b) => b.kind === "hedge");
  for (let i = 0; i < hedges.length; i++) {
    const h = hedges[i];
    const off = SHRUB.bed.front + h.depth / 2;
    track.pose(h.s - 0.5, h.side * (track.halfWidthAt(h.s - 0.5) + off), p, tmp);
    track.pose(h.s + 0.5, h.side * (track.halfWidthAt(h.s + 0.5) + off), q, tmp);
    const curve = Math.atan2(-(q.z - p.z), q.x - p.x);
    const dy = (a, b2) => Math.abs(((a - b2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    worstYaw = Math.max(worstYaw, dy(h.yaw, curve));
    if ([h.s - 2, h.s, h.s + 2].every((s) => track.halfWidthAt(s) === ROAD_HALF_WIDTH)) {
      track.tangentAt(h.s, T);
      worstStraightYaw = Math.max(worstStraightYaw, dy(h.yaw, Math.atan2(-T.z, T.x)));
    }
    const n = hedges[i + 1];
    if (n && n.bed === h.bed) minOverlap = Math.min(minOverlap, h.len - Math.hypot(n.x - h.x, n.z - h.z));
  }
  const deg = (r) => (r * 180) / Math.PI;
  console.log(`  verges past the coast: ${leftPast} left, ${rightPast} right  ` +
    check(leftPast > 200 && rightPast > 200, "a verge past the coast is all but bare"));
  console.log(`  total ${beds.length}  ` + check(beds.length >= 1600 && beds.length <= 2800, `${beds.length} plants, outside 1,600-2,800`));
  console.log(`  ${lens.length} beds, median ${median.toFixed(1)} m  ` + check(median >= 15, `median bed ${median.toFixed(1)} m — dots, not beds`));
  console.log(`  hedge overlap >= ${minOverlap.toFixed(3)} m  ` + check(minOverlap >= 0.25, `hedge segments overlap only ${minOverlap.toFixed(3)} m — the joints open`));
  console.log(`  hedge yaw: ${deg(worstYaw).toFixed(2)}° off the offset line, ${deg(worstStraightYaw).toFixed(2)}° off the road where it is 7 m  ` +
    check(deg(worstYaw) <= 1 && deg(worstStraightYaw) <= 1, "hedge segments do not follow the bed line"));
  check(Math.abs(SHRUB.kinds.hedge.bendGain - hedges[0].gain / hedges[0].sy) < 1e-9, "a hedge's lean is not its bendGain × height");
  console.log(`  resident triangles ${tris}  ` + check(tris <= 520000, `${tris} resident triangles > 520k`));
}

// ------------------------------------------------------------------ §4
console.log("\n=== §4 THE SHARED STREAM ===");
/**
 * The legacy verge block, VERBATIM in every line that draws, decides
 * whether to draw, or places an instance: world.ts at f1a525c4, IN
 * SOURCE ORDER. The placement loop 6710-6743 runs first. mound() is
 * defined at 6644 but only CALLED at 6752, inside the per-shape
 * InstancedMesh loop, once the spots are counted, so its 1,440 draws
 * come second. Then per plant the yaw 6782, h / w / z-scale 6798-6800
 * and the tint 6806, and last the phases 6821.
 *
 * The order is the whole point. The loop's skip tests read the values,
 * so 1,440 draws moved in front of it change which slots it keeps and
 * how many draws it takes. The first copy of this ran the shapes first,
 * the same swap the burn made, so the two agreed with each other and
 * with nothing else: 17,441 draws in the recorded city against the real
 * 17,408. That is why this copy is held to the recorded city below and
 * not only to the burn.
 *
 * Code that neither draws nor moves an instance is left out, with one
 * stand-in: topOf[k], the merged stem-and-crown's bounding-box top, is
 * read straight off the crown. The stem tops out at STEM_H and every
 * crown vertex sits at STEM_H or above, so the crown's highest Float32
 * y IS the merged box's max, and skipping the merge skips three's
 * "already non-indexed" warning on every call. The hash check below
 * would fail if it were not.
 *
 * Frozen: this is the reference the burn must reproduce, not code anyone
 * should update. With `place` it also fills the three InstancedMeshes the
 * way the old block did, so their matrices can be fingerprinted the way
 * tests/world.mjs fingerprints them.
 */
function legacyVergeBlock(rand, place = false) {
  const STEM_H = 0.28;
  const SHAPES = 3, SPACING = 7, LAT_MIN = 2.3, LAT_SPAN = 1.1;
  const TUNNEL_S = LAP.tunnel;
  const spots = [];
  for (let step = 0; step < L; step += SPACING) {
    for (const side of [1, -1]) {
      if (rand() < 0.28) continue;
      const at = step + rand() * SPACING * 0.6;
      if (at > TUNNEL_S.from - 20 && at < TUNNEL_S.to + 20) continue;
      const SEAM = 40;
      if (side < 0 && (at < COAST_END_M + SEAM || at > L - SEAM)) continue;
      spots.push({ s: at, lat: side * (track.halfWidthAt(at) + LAT_MIN + rand() * LAT_SPAN) });
    }
  }
  const per = Math.ceil(spots.length / SHAPES);
  const meshes = [];
  const topOf = [];
  for (let shape = 0; shape < SHAPES; shape++) {
    // mound(shape), 6644-6683, called here at 6752.
    const seed = shape;
    const crown = new THREE.IcosahedronGeometry(0.5, 1);
    const pos = crown.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = 0.72 + rand() * 0.5;
      pos.setXYZ(i, pos.getX(i) * k * (1 + seed * 0.06), Math.max(0, pos.getY(i)) * (0.55 + rand() * 0.3) + STEM_H, pos.getZ(i) * k);
    }
    let top = STEM_H;
    for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
    topOf.push(top);
    if (place) {
      const im = new THREE.InstancedMesh(crown, undefined, per);
      im.count = 0;
      meshes.push(im);
    }
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), p2 = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  for (const [i, spot] of spots.entries()) {
    if (place) track.pose(spot.s, spot.lat, p2, tmp2);
    p.set(p2.x, 0, p2.z);
    const yaw = rand() * Math.PI * 2; // 6782
    q.setFromAxisAngle(up, yaw);
    const h = 0.85 + rand() * 0.85; // 6798
    const w = 0.8 + rand() * 1.5; // 6799
    scl.set(w, h / topOf[i % SHAPES], w * (0.8 + rand() * 0.4)); // 6800
    if (place) {
      const im = meshes[i % SHAPES];
      m.compose(p, q, scl);
      im.setMatrixAt(im.count, m);
      im.count++;
    }
    rand(); rand(); rand(); // tint (6806)
  }
  for (let i = 0; i < spots.length; i++) rand(); // phase (6821)
  return { plants: spots.length, meshes };
}
/**
 * The recorded city's verge, frozen: tests/baselines/world.json as
 * f1a525c4 wrote it, the last build with the old shapes. The new beds
 * keep the name "planting", so the next BASELINE=write overwrites these
 * three lines there; they are history, so they live here.
 *
 * ENTRY is the draw the old block started at in that build. Found, not
 * assumed: of the 258,930 entry draws the recorded stream allows, 5,657
 * give the source-order loop the recorded 1,313 plants, and exactly one
 * of those, 43,825, rebuilds "planting" to its recorded hash, with
 * "planting#1" and "planting#2" matching too. DRAWS is what the block
 * took from there.
 *
 * It rests on that commit's lap as well as its stream: the hashes are of
 * positions from track.pose and halfWidthAt, and the loop runs to
 * track.length past LAP.tunnel and COAST_END_M. A change to the lap's
 * geometry turns this line red for a reason that is not the burn's. The
 * burn itself follows the lap, so the check below it stays meaningful;
 * re-anchor this one by rerunning the search (every entry draw whose
 * loop gives 1,313 plants, hashed) against f1a525c4's lap.
 */
const RECORDED = {
  entry: 43825,
  draws: 17408,
  groups: [["planting", 438, "7a2b30b6312c"], ["planting#1", 438, "804b4620f992"], ["planting#2", 437, "a5fb5d612606"]],
};
const digest = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
/** tests/world.mjs's fingerprint: the whole matrix buffer, rounded hard. */
const fingerprint = (im) => {
  const a = im.instanceMatrix.array;
  const q = new Array(a.length);
  for (let i = 0; i < a.length; i++) q[i] = Math.round(a[i] * 1000) / 1000;
  return digest(q.join(","));
};
const counting = (seed, skip) => {
  const r = makeRng(seed);
  for (let i = 0; i < skip; i++) r();
  let n = 0;
  const f = () => { n++; return r(); };
  return { f, r, n: () => n };
};
{
  const a = counting(WORLD_SEED, RECORDED.entry);
  const { plants, meshes } = legacyVergeBlock(a.f, true);
  const got = meshes.map((im) => [im.count, fingerprint(im)]);
  const ok = got.every(([n, h], k) => n === RECORDED.groups[k][1] && h === RECORDED.groups[k][2]) && a.n() === RECORDED.draws;
  console.log(`  the reference, from draw ${RECORDED.entry}: ${plants} plants, ` +
    got.map(([n, h], k) => `${RECORDED.groups[k][0]} ${n} ${h}`).join(", ") + `; ${a.n()} draws  ` +
    check(ok, "the legacy reference does not rebuild the recorded city's planting: it is not the block the city was built with, so the burn is being held to the wrong thing"));
}
{
  const offsets = [0, 1, 12345, RECORDED.entry, 777777, 2 ** 20];
  const counts = [];
  let allSame = true;
  for (const off of offsets) {
    const a = counting(WORLD_SEED, off);
    legacyVergeBlock(a.f);
    const b = counting(WORLD_SEED, off);
    const said = burnLegacyVergeDraws(b.f, L, LAP.tunnel, COAST_END_M);
    const ok = a.n() === b.n() && said === b.n() && a.r() === b.r() && a.r() === b.r();
    if (!ok) allSame = false;
    counts.push(`${off}: ${a.n()}${ok ? "" : ` (burn ${b.n()}, said ${said})`}`);
  }
  console.log(`  legacy draws by entry offset — ${counts.join(", ")}`);
  console.log(`  burn == legacy, count and state  ${check(allSame, "the burn does not leave the shared stream where the legacy block left it — every billboard side and tunnel texture after it moves")}`);

  // And through the real module-level stream, the way world.ts calls it,
  // from where the recorded city entered the block.
  resetWorldRng();
  for (let i = 0; i < RECORDED.entry; i++) rand();
  const said = burnLegacyVergeDraws(rand, L, LAP.tunnel, COAST_END_M);
  const after = worldDraws();
  const ref = counting(WORLD_SEED, RECORDED.entry);
  legacyVergeBlock(ref.f);
  const atEnd = after === RECORDED.entry + RECORDED.draws;
  const onReplay = said === ref.n() && rand() === ref.r();
  console.log(`  through rand() from draw ${RECORDED.entry}: ${said} draws, stream at ${after}  ` +
    check(atEnd && onReplay, atEnd
      ? `burning through rand() disagrees with the replay (${said} against ${ref.n()} draws)`
      : `burning through rand() leaves the stream at ${after}, not the recorded ${RECORDED.entry + RECORDED.draws}`));
  resetWorldRng();
}
// The call site: once, after the palm block and before the underpass's
// textures, and the planting block takes nothing else from the stream.
{
  const src = readFileSync(new URL("../src/game/world.ts", import.meta.url), "utf8");
  const blockAt = src.indexOf("// Roadside planting — the shrub beds along both verges.");
  const blockEnd = src.indexOf("// The underpass: concrete walls + ceiling");
  const calls = src.split("burnLegacyVergeDraws(rand, L, TUNNEL_S, COAST_END_M)").length - 1;
  const callAt = src.indexOf("burnLegacyVergeDraws(rand, L, TUNNEL_S, COAST_END_M)");
  const palmsAt = src.lastIndexOf("palmSeeds.push(", blockAt);
  // Code only: the block's comments talk about rand() at some length.
  const block = src.slice(blockAt, blockEnd).replace(/\/\/[^\n]*/g, "");
  const otherDraws = (block.replace("burnLegacyVergeDraws(rand, L, TUNNEL_S, COAST_END_M)", "").match(/\brand\(\)/g) ?? []).length;
  console.log(`  call site ${check(calls === 1 && callAt > blockAt && callAt < blockEnd && palmsAt >= 0 && palmsAt < callAt,
    "burnLegacyVergeDraws is not called exactly once, inside the planting block, after the palms")}  ` +
    `no other shared draws in the block ${check(otherDraws === 0, `${otherDraws} rand() call(s) left in the planting block`)}`);
}

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nwelded, lit, laid out in beds, clear of everything on the verge, and the city behind it unmoved.");
