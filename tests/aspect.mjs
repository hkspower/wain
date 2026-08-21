// The shape of the window, and what it does to the shot.
//
//   node tests/aspect.mjs
//
// No browser. This is arithmetic — one degree of freedom per aspect
// ratio — and arithmetic should be checked where it is cheap to check,
// not through a WebGL context on a software rasteriser.
//
// The properties that matter are not "the numbers are these numbers".
// They are the ones a player would notice being broken:
//
//   anchored     16:9 is exactly what views.ts asked for. The game is
//                framed, shot and tuned at 16:9; if this moves, every
//                capture in press/ is a lie.
//   monotone     dragging a window wider never takes horizontal field
//                away, and dragging it taller never takes vertical
//                field away. Note what is NOT asserted: the vertical is
//                allowed to fall as the window widens, because past a
//                point it has to — one degree of freedom, and the
//                horizontal has to come from somewhere. What that costs
//                is bounded by "slow spend" below instead, which is the
//                check the old rule actually failed.
//   continuous   no jump while the window is being dragged.
//   bounded      nothing reaches a field of view that stretches the
//                frame edge into a smear.
//   pays back    a narrow screen gets the road back one way or the
//                other — lens where the camera is bolted down, distance
//                where it is not.

import {
  REFERENCE_ASPECT,
  WIDE_KNEE,
  MAX_VFOV,
  MAX_HFOV,
  verticalFov,
  horizontalFov,
  chaseDolly,
  aspectReport,
} from "../src/game/aspect.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

/** The chase camera's designed field. Everything is quoted against it. */
const BASE = 62;

const SHAPES = [
  ["phone portrait", 390 / 844],
  ["4:3", 4 / 3],
  ["3:2", 3 / 2],
  ["16:10", 16 / 10],
  ["16:9", 16 / 9],
  ["phone landscape", 844 / 390],
  ["21:9", 21 / 9],
  ["32:9", 32 / 9],
  ["48:9 (triples)", 48 / 9],
];

console.log("shape                aspect    vFov     hFov   dolly");
for (const [name, a] of SHAPES) {
  const r = aspectReport(BASE, a);
  console.log(
    `  ${name.padEnd(18)} ${String(r.aspect).padStart(6)}  ` +
      `${String(r.vFov).padStart(6)}  ${String(r.hFov).padStart(6)}  ${String(r.dolly).padStart(5)}`
  );
}

// --- 1. 16:9 is untouched, exactly ------------------------------------
const at169 = verticalFov(BASE, REFERENCE_ASPECT);
console.log(
  `\nanchored   ${check(Math.abs(at169 - BASE) < 1e-9,
    `16:9 came out at ${at169.toFixed(4)} instead of ${BASE}`)}  ` +
    `16:9 -> ${at169.toFixed(4)} deg vertical`
);

// --- 2. Monotone, both ways -------------------------------------------
//
// Swept finely rather than sampled at the named shapes: a failure here
// lives between the named shapes, not at them — the boundaries are
// where a branch changes and nobody looks.
let hBack = 0;   // widening ever cost horizontal field
let vBack = 0;   // narrowing ever cost vertical field
let worstH = null;
let prevH = -Infinity;
for (let a = 0.4; a <= 6; a += 0.002) {
  const h = horizontalFov(verticalFov(BASE, a), a);
  if (h < prevH - 1e-6) {
    hBack++;
    if (!worstH) worstH = { a: +a.toFixed(3), h: +h.toFixed(2), prev: +prevH.toFixed(2) };
  }
  prevH = h;
}
let prevV = Infinity;
for (let a = 0.4; a <= 6; a += 0.002) {
  const v = verticalFov(BASE, a);
  if (v > prevV + 1e-6) vBack++;
  prevV = v;
}
console.log(
  `monotone   ${check(hBack === 0, `the horizontal field goes BACKWARDS as the window widens` +
    (worstH ? ` — at ${worstH.a}:1 it drops from ${worstH.prev} to ${worstH.h}` : ""))}  ` +
    `horizontal never falls as the window widens`
);
console.log(
  `           ${check(vBack === 0, "the vertical field goes backwards as the window narrows")}  ` +
    `vertical never falls as the window narrows`
);

// --- 3. Continuous -----------------------------------------------------
// A jump here is a visible pop while a window is being dragged. The knee
// and the reference are both branch boundaries; step across each.
let worstJump = 0;
let jumpAt = 0;
for (let a = 0.4; a <= 6; a += 0.001) {
  const d = Math.abs(verticalFov(BASE, a + 0.001) - verticalFov(BASE, a));
  if (d > worstJump) { worstJump = d; jumpAt = a; }
}
console.log(
  `continuous ${check(worstJump < 0.05,
    `the vertical FOV jumps ${worstJump.toFixed(3)} deg at aspect ${jumpAt.toFixed(3)}`)}  ` +
    `largest step ${worstJump.toFixed(4)} deg per 0.001 of aspect`
);

// --- 4. Bounded --------------------------------------------------------
let maxV = 0;
let maxH = 0;
for (let a = 0.3; a <= 8; a += 0.005) {
  const v = verticalFov(BASE, a);
  maxV = Math.max(maxV, v);
  maxH = Math.max(maxH, horizontalFov(v, a));
}
console.log(
  `bounded    ${check(maxV <= MAX_VFOV + 1e-6 && maxH <= MAX_HFOV + 1e-6,
    `fields reach ${maxV.toFixed(1)} x ${maxH.toFixed(1)} deg`)}  ` +
    `worst case ${maxV.toFixed(1)} vertical, ${maxH.toFixed(1)} horizontal`
);

// --- 5. The ultrawide payoff is real, and keeps paying ------------------
//
// This is the property the old rule broke. 21:9 must beat 16:9 on the
// horizontal, and 32:9 must beat 21:9 — on the horizontal, because that
// is the axis the screen was bought for.
const h169 = horizontalFov(verticalFov(BASE, 16 / 9), 16 / 9);
const h219 = horizontalFov(verticalFov(BASE, 21 / 9), 21 / 9);
const h329 = horizontalFov(verticalFov(BASE, 32 / 9), 32 / 9);
const v219 = verticalFov(BASE, 21 / 9);
const v329 = verticalFov(BASE, 32 / 9);
console.log(
  `payoff     ${check(h219 > h169 + 8 && h329 > h219 + 4,
    `16:9 ${h169.toFixed(1)} -> 21:9 ${h219.toFixed(1)} -> 32:9 ${h329.toFixed(1)}`)}  ` +
    `${h169.toFixed(1)} -> ${h219.toFixed(1)} -> ${h329.toFixed(1)} deg horizontal`
);
// And 21:9 pays nothing for it: the knee is where Hor+ still holds.
console.log(
  `free to 21 ${check(Math.abs(v219 - BASE) < 1e-6,
    `21:9 already gave up ${(BASE - v219).toFixed(2)} deg of vertical`)}  ` +
    `21:9 keeps the full ${BASE} deg vertical`
);
// Past it, the vertical is spent slowly. The old rule spent 18 degrees
// by 32:9; anything near that is the same mistake in a new curve.
console.log(
  `slow spend ${check(BASE - v329 < 14,
    `32:9 gives up ${(BASE - v329).toFixed(1)} deg of vertical`)}  ` +
    `32:9 gives up ${(BASE - v329).toFixed(1)} deg of vertical for ` +
    `${(h329 - h219).toFixed(1)} deg of horizontal`
);

// --- 6. Narrow screens are paid back, one way or the other -------------
//
// Two currencies, and the test is that the total is close to whole. The
// lens gives back some of the horizontal directly; the dolly gives back
// world width by standing further off. A screen that got neither would
// be looking down a drainpipe.
for (const [name, a] of [["4:3", 4 / 3], ["3:2", 3 / 2], ["phone portrait", 390 / 844]]) {
  const v = verticalFov(BASE, a);
  const h = horizontalFov(v, a);
  // What it would have been with no compensation at all.
  const raw = horizontalFov(BASE, a);
  const dolly = chaseDolly(BASE, a);
  const recovered = (h - raw) / (h169 - raw); // fraction of the gap the lens closed
  console.log(
    `${name.padEnd(10)} ${check(h > raw + 1e-6 && (recovered > 0.35 || dolly > 1.2),
      `${name} got ${h.toFixed(1)} deg horizontal against a bare ${raw.toFixed(1)} and no dolly`)}  ` +
      `bare ${raw.toFixed(1)} -> ${h.toFixed(1)} deg (${(recovered * 100).toFixed(0)}% of the gap), ` +
      `camera back x${dolly.toFixed(2)}`
  );
}
// And a wide screen never dollies: there is no shortfall to make up.
console.log(
  `no dolly   ${check(
    [16 / 9, 2, 21 / 9, 32 / 9].every((a) => chaseDolly(BASE, a) === 1),
    "a wide screen moved the camera"
  )}  the camera only moves on screens narrower than 16:9`
);

// --- 7. Every view's own field survives the treatment -------------------
// views.ts spans 58 (cockpit) to 78 (bumper). The curve has to behave
// for all of them, not just for the chase camera it was reasoned about.
let bad = 0;
for (const base of [58, 62, 66, 72, 78]) {
  for (const [, a] of SHAPES) {
    const v = verticalFov(base, a);
    const h = horizontalFov(v, a);
    if (!(v > 5 && v <= MAX_VFOV + 1e-6 && h > 5 && h <= MAX_HFOV + 1e-6)) bad++;
  }
}
console.log(
  `every view ${check(bad === 0, `${bad} view/aspect pairs land outside the bounds`)}  ` +
    `58-78 deg base fields, all ${SHAPES.length} shapes`
);

if (fail.length) {
  console.log(`\n${fail.length} FAILED`);
  for (const f of fail) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nthe window shape is handled");
