// The verge has mass.
//
//   npm run test:plants          (no browser, no dev server)
//
// The plants were re-solved from nothing every frame: a car pushed them
// over and they stood straight up the instant it was gone, and only the
// player's car existed to them. This drives the spring field headlessly
// on a synthetic straight verge and asks for what only a spring with a
// directional wake can do: lean away as a car arrives, whip back as its
// tail passes, ring down and settle; feel every car; and cost less than
// one evaluation per plant per car.
import * as THREE from "three";
import { newPlantField, solvePlantField, bakeBendWeight } from "../src/game/plants.ts";
import { RIG } from "../src/game/rig.ts";
import { springHz } from "../src/game/spring.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const P = RIG.plant;
const DT = 1 / 60;
const LAP = 2000;

// A straight road along +z: s is z, plants on both verges at x = ±3, one
// every 7 m, plus a far one at x = 30, plus a palm crown at x = -3.
const lcg = (() => { let x = 7; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); })();
const seeds = [];
for (let s = 0; s < LAP; s += 7) {
  for (const x of [3, -3]) seeds.push({ s, x, z: s, yaw: 0, phase: lcg() * 2 * Math.PI, kind: 0 });
}
seeds.push({ s: 700, x: 30, z: 700, yaw: 0, phase: 1, kind: 0 });
const FAR = seeds.length - 1;
seeds.push({ s: 707, x: -3, z: 707, yaw: 0, phase: 2, kind: 1 });
const PALM = seeds.length - 1;
// Two plants at the seam. The lap is a loop, so a plant at s = LAP-3 is
// three metres BEHIND the start line in the world (z = -3), and one at
// s = 2 is two metres past the end of it. A car at s = 3 must find the
// first through the wrap, and a car at s = LAP-2 the second.
seeds.push({ s: LAP - 3, x: 3, z: -3, yaw: 0, phase: 0, kind: 0 });
const SEAM_END = seeds.length - 1;
seeds.push({ s: 2, x: 3, z: LAP + 2, yaw: 0, phase: 0, kind: 0 });
const SEAM_START = seeds.length - 1;
const build = () => newPlantField(seeds);
const car = (s, speed, dir = 1) => ({ s, x: 0, z: s, dirX: 0, dirZ: dir, speed, len: 4.6 });
const lean = new Float32Array(seeds.length * 2);
const write = (i, dx, dz, str) => { lean[i * 2] = dx * str; lean[i * 2 + 1] = dz * str; };
const solve = (f, t, dt, wakes) => solvePlantField(f, t, dt, wakes, LAP, write);
const idx = (s, x) => seeds.findIndex((p) => p.s === s && p.x === x && p.kind === 0);

// --- 1. Wind alone: bounded, moving, and coherent along the road -------
{
  const f = build();
  let maxLean = 0, moved = 0;
  const a = idx(700, 3), b = idx(707, 3), far = idx(1400, 3);
  const A = [], B = [], F = [];
  for (let i = 0; i < 600; i++) {
    solve(f, i * DT, DT, []);
    for (let k = 0; k < f.n; k++) maxLean = Math.max(maxLean, Math.hypot(lean[k * 2], lean[k * 2 + 1]));
    const mag = (k) => Math.hypot(lean[k * 2], lean[k * 2 + 1]);
    A.push(mag(a)); B.push(mag(b)); F.push(mag(far));
    if (i > 0) moved = Math.max(moved, Math.abs(A[i] - A[i - 1]));
  }
  console.log(`wind      max lean ${maxLean.toFixed(3)} (limit ${P.maxLean})`);
  console.log(`  ${check(maxLean > 0.02 && maxLean <= P.maxLean, `wind leans the verge ${maxLean.toFixed(3)} — dead, or past the stop`)}  the wind moves the verge, within its limit`);
  console.log(`  ${check(moved > 0, "nothing moves frame to frame")}  and keeps moving`);
  void B; void F;

  // The front: a swell travelling down the road. At one instant the
  // wind's target along the verge is a sinusoid in s with wavenumber
  // frontK; its phase advances at frontRate. Read the phase off the
  // field's own targets by projecting the target magnitudes of the
  // right-hand verge onto sin(k·s) and cos(k·s), two seconds apart, on
  // a field with every sway phase at zero so nothing else varies with s.
  const flat = newPlantField(seeds.map((p) => ({ ...p, phase: 0 })));
  const rightVerge = seeds.map((p, i) => (p.x === 3 && p.kind === 0 && p.z === p.s ? i : -1)).filter((i) => i >= 0);
  const phaseAt = (t) => {
    solve(flat, t, DT, []);
    let sn = 0, cs = 0;
    for (const i of rightVerge) {
      const m = Math.hypot(flat.tx[i], flat.tz[i]);
      sn += m * Math.sin(P.frontK * seeds[i].s);
      cs += m * Math.cos(P.frontK * seeds[i].s);
    }
    return Math.atan2(sn, cs);
  };
  const p1 = phaseAt(10), p2 = phaseAt(12);
  let dphi = p2 - p1;
  while (dphi > Math.PI) dphi -= 2 * Math.PI;
  while (dphi < -Math.PI) dphi += 2 * Math.PI;
  const predicted = 2 * P.frontRate;
  console.log(`front     the swell's phase along the road moved ${dphi.toFixed(2)} rad in two seconds (frontRate says ${predicted.toFixed(2)}); it travels at ${(P.frontRate / P.frontK).toFixed(1)} m/s with a ${(2 * Math.PI / P.frontK).toFixed(0)} m wavelength`);
  console.log(`  ${check(Math.abs(Math.abs(dphi) - predicted) < 0.1, `phase moved ${dphi.toFixed(2)} rad, not ${predicted.toFixed(2)} — the gust is not travelling`)}  a gust front runs along the road`);
}

// --- 2. A car passing: away, then back over, then settle ---------------
// Measured against a twin field feeling the wind alone, so the wake is
// read on its own and the wind — which is the same in both — cancels.
{
  const f = build(), twin = build();
  const wind = new Float32Array(lean.length);
  const right = idx(700, 3), left = idx(700, -3);
  const SPEED = 28; // m/s, ~100 km/h
  const START = 700 - SPEED * 3;
  const passAt = 3; // when the car's centre is level with the plant
  let peakR = 0, peakAt = -1, crossAt = -1, settledAt = -1, farMax = 0, palmMax = 0, palmAt = -1;
  let s = START;
  const trace = [];
  for (let i = 0; i < 60 * 10; i++) {
    const t = i * DT;
    s += SPEED * DT;
    solvePlantField(twin, t, DT, [], LAP, (k, dx, dz, str) => { wind[k * 2] = dx * str; wind[k * 2 + 1] = dz * str; });
    solve(f, t, DT, [car(s, SPEED)]);
    const wx = (k) => lean[k * 2] - wind[k * 2];
    const x = wx(right);
    trace.push({ t, x, l: wx(left) });
    if (x > peakR) { peakR = x; peakAt = t; }
    if (peakAt >= 0 && crossAt < 0 && x < 0 && t > peakAt) crossAt = t;
    farMax = Math.max(farMax, Math.hypot(wx(FAR), lean[FAR * 2 + 1] - wind[FAR * 2 + 1]));
    const pl = Math.abs(wx(PALM));
    if (pl > palmMax) { palmMax = pl; palmAt = t; }
  }
  for (const p of trace) if (p.t > passAt && Math.abs(p.x) > 0.03) settledAt = p.t;
  const leftAtPeak = trace.find((p) => p.t >= peakAt).l;
  console.log(`pass      car at ${SPEED} m/s level with the plant at ${passAt.toFixed(2)} s; right verge leans +${peakR.toFixed(3)} at ${peakAt.toFixed(2)} s, crosses back at ${crossAt.toFixed(2)} s, settled by ${settledAt.toFixed(2)} s; left verge ${leftAtPeak.toFixed(3)} at the peak; far plant ${farMax.toFixed(4)}; palm ${palmMax.toFixed(3)} at ${palmAt.toFixed(2)} s`);
  console.log(`  ${check(peakR > 0.15, `the wake leans the plant only ${peakR.toFixed(3)}`)}  the wake lays the verge over`);
  console.log(`  ${check(peakR > 0 && leftAtPeak < 0, `right verge ${peakR.toFixed(3)}, left ${leftAtPeak.toFixed(3)} — not both away from the car`)}  both verges lean AWAY from the path`);
  console.log(`  ${check(Math.abs(peakAt - passAt) < 0.35, `peak at ${peakAt.toFixed(2)} s, car level at ${passAt.toFixed(2)} s`)}  the peak is as the car passes`);
  console.log(`  ${check(crossAt > 0 && crossAt - peakAt < 1.2, `the plant never whips back (${crossAt})`)}  and it whips back over as the tail goes by`);
  console.log(`  ${check(settledAt > 0 && settledAt - passAt < 2.5, `still ringing ${(settledAt - passAt).toFixed(2)} s after the pass`)}  settled inside 2.5 s`);
  console.log(`  ${check(farMax < 0.01, `a plant 30 m from the road leaned ${farMax.toFixed(3)} to the wake`)}  the far plant feels only the wind`);
  console.log(`  ${check(palmMax > 0.03 && palmMax < peakR && palmAt > peakAt, `palm ${palmMax.toFixed(3)} at ${palmAt.toFixed(2)} s vs shrub ${peakR.toFixed(3)} at ${peakAt.toFixed(2)} s`)}  the palm crown moves less, and later`);
  console.log(`  ${check(springHz(P.palmK) < springHz(P.shrubK) * 0.6, "the palm is not slower than the shrub")}  a palm is the slower spring`);
}

// --- 3. Every car counts, and a car the other way pushes the other way -
{
  const f = build();
  const right = idx(700, 3);
  let up = 0, down = 0;
  let s = 0;
  s = 600;
  for (let i = 0; i < 60 * 8; i++) { s += 28 * DT; solve(f, i * DT, DT, [car(s, 28)]); up = Math.max(up, lean[right * 2]); }
  const g = build();
  s = 800;
  for (let i = 0; i < 60 * 8; i++) { s -= 28 * DT; solve(g, i * DT, DT, [{ s, x: 0, z: s, dirX: 0, dirZ: -1, speed: 28, len: 4.6 }]); down = Math.max(down, lean[right * 2]); }
  console.log(`direction right verge leans +${up.toFixed(3)} for a car going up the road, +${down.toFixed(3)} for one coming down it`);
  console.log(`  ${check(down > 0.15 && Math.abs(down - up) < 0.1, `a car the other way leans it ${down.toFixed(3)} vs ${up.toFixed(3)}`)}  the push is away from the path whichever way the car goes`);
  // Two cars: the second one, well behind, is still felt.
  const h = build();
  const back = idx(350, 3);
  let backPeak = 0;
  s = 250;
  for (let i = 0; i < 60 * 8; i++) { s += 28 * DT; solve(h, i * DT, DT, [car(s + 350, 28), car(s, 28)]); backPeak = Math.max(backPeak, lean[back * 2]); }
  console.log(`  ${check(backPeak > 0.15, `the second car's wake leaned the verge only ${backPeak.toFixed(3)}`)}  the second car is felt too`);
}

// --- 4. The search is a window, not a sweep -----------------------------
{
  const f = build();
  const cars = Array.from({ length: 48 }, (_, i) => car((i * 41) % LAP, 25));
  solve(f, 1, DT, cars);
  const perCar = f.wakeEvals / cars.length;
  const window = 2 * (P.wakeR + 2.3 + Math.max(P.noseM, P.tailLenM * 3)) / 7 * 2 + 4;
  console.log(`cost      ${cars.length} cars, ${f.n} plants: ${f.wakeEvals} wake evaluations, ${perCar.toFixed(1)} per car (a sweep would be ${f.n})`);
  console.log(`  ${check(perCar < window, `${perCar.toFixed(1)} evaluations per car — the window is not working`)}  each car only sees the plants near it`);
  // Across the seam: a car at s = 5 must reach the plants at the end of
  // the lap, and one at the end must reach the start.
  const g = build(), twin = build();
  const wind = new Float32Array(lean.length);
  let e = 0, st = 0;
  for (let i = 0; i < 120; i++) {
    solvePlantField(twin, i * DT, DT, [], LAP, (k, dx, dz, str) => { wind[k * 2] = dx * str; });
    solve(g, i * DT, DT, [car(3, 28), { s: LAP - 2, x: 0, z: LAP - 2, dirX: 0, dirZ: 1, speed: 28, len: 4.6 }]);
    // The plant behind the line is BEHIND the car at s = 3, so it is
    // pulled in rather than pushed out; either way it must be felt.
    e = Math.max(e, Math.abs(lean[SEAM_END * 2] - wind[SEAM_END * 2]));
    st = Math.max(st, Math.abs(lean[SEAM_START * 2] - wind[SEAM_START * 2]));
  }
  console.log(`  ${check(e > 0.03 && st > 0.03, `seam: the plant behind the line moved ${e.toFixed(3)} to the wake, the one past the end ${st.toFixed(3)}`)}  the window wraps at the seam`);
}

// --- 5. A big step is integrated, and the frame is in the plant's own frame
{
  const f = build();
  for (let i = 0; i < 10; i++) solve(f, i * 0.25, 0.25, [car(700, 30)]);
  let finite = true;
  for (let k = 0; k < f.n; k++) if (!Number.isFinite(lean[k * 2]) || !Number.isFinite(lean[k * 2 + 1])) finite = false;
  console.log(`  ${check(finite, "a quarter-second step blew the field up")}  a quarter-second step is stable`);

  // A plant spun a quarter turn, bent by the world +x: the shader bends
  // in the plant's frame before the instance spin, so the local bend,
  // rotated by the spin, must come out world +x again.
  const spun = newPlantField([{ s: 10, x: 3, z: 10, yaw: Math.PI / 2, phase: 0, kind: 0 }]);
  const flat = newPlantField([{ s: 10, x: 3, z: 10, yaw: 0, phase: 0, kind: 0 }]);
  let got = null, want = null;
  for (let i = 0; i < 60; i++) {
    solvePlantField(spun, i * DT, DT, [car(10, 40)], LAP, (_, dx, dz, str) => { got = [dx * str, dz * str]; });
    solvePlantField(flat, i * DT, DT, [car(10, 40)], LAP, (_, dx, dz, str) => { want = [dx * str, dz * str]; });
  }
  const world = new THREE.Vector3(got[0], 0, got[1]).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const err = Math.hypot(world.x - want[0], world.z - want[1]);
  console.log(`frame     spun plant bends locally (${got[0].toFixed(3)}, ${got[1].toFixed(3)}); through its quarter-turn that is world (${world.x.toFixed(3)}, ${world.z.toFixed(3)}); an unspun twin bends (${want[0].toFixed(3)}, ${want[1].toFixed(3)})`);
  console.log(`  ${check(err < 1e-4 && Math.hypot(...want) > 0.1, `spun and unspun plants disagree by ${err.toFixed(4)} in the world`)}  the bend survives the instance's spin`);
}

// --- 6. The weight bake ---------------------------------------------------
{
  const stem = new THREE.CylinderGeometry(0.05, 0.05, 1, 5).translate(0, 0.5, 0);
  bakeBendWeight(stem, "height");
  const w = stem.getAttribute("grnWeight");
  let top = 0, bottom = 1;
  for (let i = 0; i < w.count; i++) { if (stem.getAttribute("position").getY(i) > 0.99) top = Math.max(top, w.getX(i)); if (stem.getAttribute("position").getY(i) < 0.01) bottom = Math.min(bottom, w.getX(i)); }
  const ring = new THREE.TorusGeometry(2, 0.1, 4, 12).rotateX(Math.PI / 2).translate(0, 6.1, 0);
  bakeBendWeight(ring, "radial");
  const rw = ring.getAttribute("grnWeight");
  let rmin = 1, rmax = 0;
  for (let i = 0; i < rw.count; i++) { rmin = Math.min(rmin, rw.getX(i)); rmax = Math.max(rmax, rw.getX(i)); }
  console.log(`bake      stem weight ${bottom.toFixed(2)} at the root, ${top.toFixed(2)} at the tip; a ring six metres up weights ${rmin.toFixed(2)}..${rmax.toFixed(2)} by radius`);
  console.log(`  ${check(bottom < 0.01 && top > 0.99, "height weight is not 0 at the root and 1 at the tip")}  a stem is rooted at the ground`);
  console.log(`  ${check(rmax > 0.99 && rmin > 0.5, "radial weight ignores the geometry's own centre")}  a crown is weighted from its own axis, wherever it sits`);
}

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe verge has mass");
process.exit(fail.length ? 1 : 0);
