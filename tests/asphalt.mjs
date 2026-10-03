// The asphalt texture moved its paint-like strokes without moving the city.
//
//   npm run test:asphalt      (no browser, no dev server)
//
// asphaltSurface (world.ts) draws its patches, cracks, seams and oil
// drips from the world's shared random stream (rand.ts), and it runs
// partway through buildWorld. The stream is consumed in build order, so
// one draw more or fewer in here moves every building, billboard and lamp
// placed after it — with no visible error, and tests/world.mjs only sees
// it in a browser. This change rewrote those strokes: the cracks and
// seams became Path2Ds stroked twice (colour and a sealant mask), two of
// the three seams shrank to one lane, the oil drips moved from the lane
// lines to the lane centres. None of that may take a number the old code
// did not take, or skip one it did.
//
// So the old code's consumption is written out below, independently, as
// a replay — every rand() it made, in its order, and what it did with
// each — and the new function is run against a stub canvas that records
// every stroke, fill and gradient. From the same stream position both
// must: draw the same count; leave the stream on the same next value;
// and use each number for the same thing (every crack vertex identical,
// every seam's width and row, every drip's jitter, row and radius).
// Checked from several positions, because the crack branching depends on
// the values drawn and so does the count.
//
// It also holds the new placement to ASPHALT (markings.ts): wear bands at
// the lane centres ± 0.78 m, drips at the lane centres, seams 1 and 2
// across one lane, every crack and seam stroked into the sealant mask at
// its own width.

import { asphaltSurface } from "../src/game/world.ts";
import { ASPHALT } from "../src/game/markings.ts";
import { LANES } from "../src/game/track.ts";
import { makeRng, rand, resetWorldRng, worldDraws, WORLD_SEED } from "../src/game/rand.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c; };
const S = 1024;

// --- a canvas that records instead of drawing ---------------------------
let log = [];
let canvases = 0;
class Path2DStub {
  constructor() { this.pts = []; }
  moveTo(x, y) { this.pts.push([x, y]); }
  lineTo(x, y) { this.pts.push([x, y]); }
}
const context = (name) => ({
  lineWidth: 1, strokeStyle: "", fillStyle: "", cur: null,
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {},
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: (x0, y0, r0, x1, y1, r1) => {
    log.push({ op: "radial", canvas: name, x: x1, y: y1, r: r1 });
    return { addColorStop() {} };
  },
  fillRect(x, y, w, h) { log.push({ op: "fillRect", canvas: name, x, y, w, h }); },
  beginPath() { this.cur = new Path2DStub(); },
  moveTo(x, y) { this.cur.moveTo(x, y); },
  lineTo(x, y) { this.cur.lineTo(x, y); },
  closePath() {},
  fill() { log.push({ op: "fill", canvas: name, pts: this.cur.pts }); },
  stroke(path) { log.push({ op: "stroke", canvas: name, pts: (path ?? this.cur).pts, width: this.lineWidth }); },
});
const saved = { document: globalThis.document, Path2D: globalThis.Path2D };
globalThis.Path2D = Path2DStub;
globalThis.document = {
  createElement: () => {
    const name = `canvas${++canvases}`;
    return { width: 0, height: 0, getContext: () => context(name) };
  },
};

// --- the OLD code's draws, written out (world.ts before this change) -----
// Patches: 4 x (w, h, x, y, then 13 + 13 + 13 ragged edge offsets).
// Cracks: 10 x (x, y, len, angle), each 8 turns, then a branch test only
// below depth 2 and, when it branches, a side choice before recursing.
// Seams: 3 x (width, row). Drips: 20 x (jitter, row, radius).
function oldDraws(r) {
  const out = { patches: [], cracks: [], seams: [], drips: [] };
  for (let i = 0; i < 4; i++) {
    const w = 90 + r() * 240;
    const hgt = 80 + r() * 200;
    const x = r() * (S - w);
    const y = r() * (S - hgt);
    const pts = [[x, y]];
    for (let k = 0; k <= 12; k++) pts.push([x + (w * k) / 12, y + (r() - 0.5) * 9]);
    for (let k = 0; k <= 12; k++) pts.push([x + w + (r() - 0.5) * 9, y + (hgt * k) / 12]);
    for (let k = 12; k >= 0; k--) pts.push([x + (w * k) / 12, y + hgt + (r() - 0.5) * 9]);
    out.patches.push(pts);
  }
  const crack = (x, y, len, angle, depth) => {
    const pts = [[x, y]];
    let cx = x, cy = y, a = angle;
    for (let i = 0; i < 8; i++) {
      a += (r() - 0.5) * 0.6;
      cx += Math.cos(a) * (len / 8);
      cy += Math.sin(a) * (len / 8);
      pts.push([cx, cy]);
    }
    out.cracks.push({ pts, width: Math.max(0.7, 2.6 - depth * 0.8) });
    if (depth < 2 && r() < 0.8) crack(cx, cy, len * 0.55, a + (r() < 0.5 ? 0.9 : -0.9), depth + 1);
  };
  for (let i = 0; i < 10; i++) {
    const x = r() * S, y = r() * S, len = 110 + r() * 240, angle = r() * 6.28;
    crack(x, y, len, angle, 0);
  }
  for (let i = 0; i < 3; i++) {
    const width = 4 + r() * 4;
    const y0 = r() * S;
    out.seams.push({ width, y0 });
  }
  for (let i = 0; i < 20; i++) {
    const jitter = (r() - 0.5) * 60;
    const y = r() * S;
    const rad = 6 + r() * 22;
    out.drips.push({ jitter, y, r: rad });
  }
  return out;
}

const same = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

// Positions in the stream to start from: the seed itself, and partway in,
// which is where buildWorld actually calls it.
const STARTS = [
  { seed: WORLD_SEED, burn: 0 },
  { seed: WORLD_SEED, burn: 4321 },
  { seed: 0x1234567, burn: 77 },
];
let firstLog = null;
for (const { seed, burn } of STARTS) {
  const tag = `seed ${seed.toString(16)} +${burn}`;
  // New code, on the world's stream.
  resetWorldRng(seed);
  for (let i = 0; i < burn; i++) rand();
  log = [];
  canvases = 0;
  const before = worldDraws();
  const t0 = Date.now();
  asphaltSurface();
  const ms = Date.now() - t0;
  const took = worldDraws() - before;
  const nextNew = rand();

  // The replay, on its own copy of the same stream.
  const ref = makeRng(seed);
  for (let i = 0; i < burn; i++) ref();
  let refCount = 0;
  const counted = () => { refCount++; return ref(); };
  const old = oldDraws(counted);
  const nextOld = ref();

  check(took === refCount, `${tag}: asphaltSurface took ${took} numbers, the old code took ${refCount} — the city after it moves`);
  check(nextNew === nextOld, `${tag}: the stream is left at a different place than the old code left it`);

  // Same numbers, same jobs.
  const colour = "canvas1", mask = "canvas2";
  const fills = log.filter((e) => e.op === "fill" && e.canvas === colour);
  check(fills.length === 4 && fills.every((f, i) => same(f.pts, old.patches[i])), `${tag}: the patches are not the old patches`);
  const strokes = log.filter((e) => e.op === "stroke" && e.canvas === colour);
  const masked = log.filter((e) => e.op === "stroke" && e.canvas === mask);
  const nc = old.cracks.length;
  check(strokes.length === nc + 3, `${tag}: ${strokes.length} strokes, expected ${nc} cracks + 3 seams`);
  for (let i = 0; i < nc; i++) {
    if (!check(same(strokes[i].pts, old.cracks[i].pts) && strokes[i].width === old.cracks[i].width,
      `${tag}: crack ${i} is not the old crack`)) break;
  }
  for (let i = 0; i < 3; i++) {
    const st = strokes[nc + i], sm = old.seams[i];
    if (!st) break;
    const x0 = i === 0 ? 0 : 0.25 * (Math.floor(sm.y0) % 4) * S;
    const x1 = i === 0 ? S : x0 + 0.25 * S;
    const xs = st.pts.map((p) => p[0]);
    check(st.width === sm.width, `${tag}: seam ${i} width ${st.width} is not the old ${sm.width}`);
    check(st.pts[0][1] === sm.y0 + Math.sin(x0 * 0.02) * 6, `${tag}: seam ${i} is not on the old seam's row`);
    check(Math.min(...xs) === x0 && Math.max(...xs) === x1,
      `${tag}: seam ${i} spans ${Math.min(...xs)}-${Math.max(...xs)}, expected ${x0}-${x1} (${i === 0 ? "full width" : "one lane"})`);
  }
  // Every crack and seam is in the sealant mask, at the width it was drawn.
  check(masked.length === strokes.length && masked.every((m, i) => m.pts === strokes[i].pts && m.width === strokes[i].width),
    `${tag}: the sealant mask is missing strokes, or has them at another width`);
  const drips = log.filter((e) => e.op === "radial" && e.canvas === colour);
  check(drips.length === 20, `${tag}: ${drips.length} drips`);
  drips.forEach((d, i) => {
    const o = old.drips[i];
    const lane = ASPHALT.oilU[i % ASPHALT.oilU.length] * S;
    check(d.x - lane === o.jitter && d.y === o.y && d.r === o.r, `${tag}: drip ${i} did not take the old drip's numbers`);
  });
  if (!firstLog) firstLog = { log: log.slice(), took, ms, nc };
  console.log(`${tag}: ${took} draws, next value identical, ${nc} cracks + 3 seams + 20 drips + 4 patches match the old code (${ms} ms)`);
}

// --- where the texture now puts things -----------------------------------
{
  const L = firstLog.log;
  const laneU = LANES.map((l) => l / ASPHALT.tileM + 0.5);
  check(ASPHALT.oilU.every((u, i) => Math.abs(u - laneU[i]) < 1e-12), "ASPHALT.oilU must be the lane centres");
  // Wear bands: the eight 48 px gradients drawn before anything random.
  const bands = L.filter((e) => e.op === "fillRect" && e.canvas === "canvas1" && e.w === 48).map((e) => (e.x + 24) / S);
  const wp = ASPHALT.wheelPathM / ASPHALT.tileM;
  check(bands.length === 8, `${bands.length} wear bands, expected 8`);
  const offs = bands.map((u, i) => (u - laneU[Math.floor(i / 2)]) * ASPHALT.tileM);
  check(offs.every((o, i) => Math.abs(Math.abs(o) - ASPHALT.wheelPathM) < 1e-9 && Math.sign(o) === (i % 2 ? 1 : -1)),
    `wear bands at ${offs.map((o) => o.toFixed(2)).join(", ")} m from the lane centres, expected ±${ASPHALT.wheelPathM}`);
  const drips = L.filter((e) => e.op === "radial" && e.canvas === "canvas1");
  const worst = Math.max(...drips.map((d, i) => Math.abs(d.x / S - ASPHALT.oilU[i % 4])));
  check(worst <= 30 / S + 1e-12, `a drip is ${(worst * ASPHALT.tileM).toFixed(2)} m from its lane centre`);
  // Nothing drips on a lane line (lat -3.5 / 0 / 3.5 is u 0.25 / 0.5 / 0.75).
  const onLine = drips.filter((d) => [0.25, 0.5, 0.75].some((u) => Math.abs(d.x / S - u) < 0.05)).length;
  check(onLine === 0, `${onLine} drips still on a lane line`);
  console.log(
    `wear bands at the lane centres ±${ASPHALT.wheelPathM} m (u ±${wp.toFixed(4)}), ` +
    `drips within ${(worst * ASPHALT.tileM).toFixed(2)} m of the lane centres, none on a line; ` +
    `sealant roughness held at ≥ ${ASPHALT.sealantRoughness}`
  );
}

globalThis.document = saved.document;
globalThis.Path2D = saved.Path2D;
console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
