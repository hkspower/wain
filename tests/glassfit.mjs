// The glass sits ON the car, front and rear.
//
//   npm run test:glassfit        (no browser, no dev server)
//
// Nothing in this repo measured the windscreen or the rear window. What
// existed was tests/roofline.mjs — a regex over cars.ts checking the
// painted roof is as wide as the glass under it — and
// tools/shots/glasshouse.mjs, which measures the real thing and has no
// assertions, no exit code and no npm script. roofline.mjs:24-27 calls
// that one "the expensive one that proves the cheap one is measuring the
// right thing". It was never wired up, so for the life of the project
// the only automatic guard on the glasshouse was a check on one width.
//
// WHAT THE GLASS IS. There is no windscreen mesh and no rear-window
// mesh. Each car has ONE glass object: the `canopy` shell, a SOLID
// closed extrusion of a side profile (every canopy is built with
// bottomPoints = 0, so closePath draws a straight chord from the last
// profile point back to the first, and that chord is the underside of a
// slab of glass). The first segment of the profile IS the windscreen,
// the last segment IS the backlight, and a painted `roof` extrusion
// sits on top of both.
//
// So the question a front and a rear window have to answer is where the
// glass COMES DOWN — and the measurement is BITE: how far the upper
// shell's underside is buried beneath the skin of the shell below it.
//
//   positive   the two interpenetrate; the junction is closed
//   zero       they graze
//   negative   daylight, the full width of the car
//
// Bite and not "gap", because these shells are not authored to touch —
// they are authored to overlap, and by tens of millimetres. Asking
// whether a junction is closed is asking how deep the overlap is.
//
// TWO THINGS THIS HAD TO LEARN THE HARD WAY, both worth keeping:
//
//   sides    the shells' own materials are FrontSide — glassMat and the
//            paint both — and a Raycaster honours that, so a ray fired
//            down at a closed slab returns ONE hit: the top skin. The
//            underside faces away and is culled. The first run of this
//            read the sedan's glass as floating 412 mm over its own
//            bonnet, which is not a gap, it is the height of the
//            glasshouse: top minus top. Every probe here is a
//            double-sided copy.
//   insets   a shell's bevel rolls over at its own perimeter and its
//            section tapers to nothing at the tip, so a ray fired near
//            the edge grazes a curve and reads air that is not a gap.
//            Sampled at 1.5x the bevel this flagged the suv's roof and
//            the super's screen; at 3x the suv came back +16 mm and was
//            never a defect at all. Stay clear of the roll.
//
// BOTH BUILDS. The procedural extrusion is what thirty traffic cars
// wear — they are built with colors.simple and skip upgradeCarShells
// entirely — and the authored loft is what the hero cars wear. They are
// different geometry and both are measured here, from disk, with no
// browser in the loop.
import * as THREE from "three";
import { readFileSync, existsSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import "./lib/dom-stub.mjs";
import { createCar, crownFor, crownShell } from "../src/game/cars.ts";

const STYLES = ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"];

/** Bevels, read from the source rather than copied, so the insets below
 *  track the shells if anyone re-bevels them. */
const src = readFileSync("src/game/cars.ts", "utf8");
const edge = (name) => {
  const m = src.match(new RegExp(`const ${name} = ([\\d.]+);`));
  if (!m) { console.error(`${name} is gone from cars.ts`); process.exit(2); }
  return parseFloat(m[1]);
};
const CANOPY_EDGE = edge("CANOPY_EDGE"), ROOF_EDGE = edge("ROOF_EDGE");

/** Clear of the bevel roll. Three times the shell's own bevel — see the
 *  note above about what 1.5x reported. */
const INSET = 3;
/** How far into the shell's length the foot is looked for. A foot is a
 *  region, not a point. */
const BAND = 0.12;
/** Columns across the half-width, as a fraction of it. Stops before the
 *  side bevel for the same reason the z inset does. */
const COLS = [0, 0.4, 0.72];

/** Daylight. Anything at or below this is a junction that does not
 *  close, and no arithmetic rescues it: the bevel, the spline and the
 *  crown are all already in the surface the ray hit. */
const FAIL_BITE = 0;
/** Thin. Half a canopy bevel of overlap is a junction one edit from
 *  being a hole, and worth saying out loud without failing a build. */
const WARN_BITE = 0.012;

const fail = [];
const warn = [];

const loader = new GLTFLoader();
const loadGlb = (file) =>
  new Promise((res) => {
    if (!existsSync(file)) return res(null);
    const buf = readFileSync(file);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    loader.parse(ab, "", (g) => {
      const out = {};
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld);
        out[o.name.toLowerCase()] = geo;
      });
      res(out);
    }, () => res(null));
  });

const ray = new THREE.Raycaster();
const dbl = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const meshOf = (geo) => {
  const m = new THREE.Mesh(geo, dbl);
  m.updateMatrixWorld(true);
  return m;
};
/** Every surface a straight-down ray at (x, z) crosses, highest first. */
const down = (m, x, z) => {
  ray.set(new THREE.Vector3(x, 8, z), new THREE.Vector3(0, -1, 0));
  return ray.intersectObject(m, false).map((h) => h.point.y);
};

/**
 * The worst bite over one end of an upper shell: lower shell's top skin
 * minus upper shell's underside, across the columns and along the band.
 */
function bite(upper, lower, box, inset, front) {
  const span = box.max.z - box.min.z;
  const hw = box.max.x;
  const z0 = front ? box.max.z - inset : box.min.z + inset;
  const z1 = front ? box.max.z - span * BAND : box.min.z + span * BAND;
  let worst = null;
  for (const c of COLS) {
    const x = hw * c;
    for (let i = 0; i <= 20; i++) {
      const z = z0 + (z1 - z0) * (i / 20);
      const up = down(upper, x, z);
      const lo = down(lower, x, z);
      if (!up.length || !lo.length) continue;
      const b = lo[0] - up[up.length - 1];
      if (worst === null || b < worst) worst = b;
    }
  }
  return worst;
}

function measure(body, canopy, roof) {
  const pB = meshOf(body), pC = meshOf(canopy), pR = roof ? meshOf(roof) : null;
  const cb = new THREE.Box3().setFromBufferAttribute(canopy.attributes.position);
  const rb = roof ? new THREE.Box3().setFromBufferAttribute(roof.attributes.position) : null;
  const cIn = CANOPY_EDGE * INSET, rIn = ROOF_EDGE * INSET;
  return {
    screen: bite(pC, pB, cb, cIn, true),
    back: bite(pC, pB, cb, cIn, false),
    lipF: pR ? bite(pR, pC, rb, rIn, true) : null,
    lipR: pR ? bite(pR, pC, rb, rIn, false) : null,
  };
}

const mm = (v) => (v === null ? "   -- " : (v * 1000).toFixed(0).padStart(5));
const judge = (style, build, what, v) => {
  if (v === null) return;
  if (v <= FAIL_BITE)
    fail.push(`${style} (${build}): the ${what} does not close — ${(v * 1000).toFixed(0)} mm of daylight under the glass`);
  else if (v < WARN_BITE)
    warn.push(`${style} (${build}): the ${what} closes by only ${(v * 1000).toFixed(0)} mm`);
};

console.log("BITE — the shell below's skin, minus the shell above's underside.");
console.log("Positive is a closed junction; negative is daylight. Millimetres.\n");
console.log("style   build       | screen  back  | roof front  roof rear");

for (const style of STYLES) {
  const car = createCar({ style, body: 0xffffff, accent: 0x222222, kit: "street" });
  car.updateMatrixWorld(true);
  const geo = {};
  car.traverse((o) => { if (o.isMesh && o.userData.shell) geo[o.userData.shell] = o.geometry; });
  if (!geo.body || !geo.canopy) { fail.push(`${style}: no body or canopy shell`); continue; }

  const p = measure(geo.body, geo.canopy, geo.roof);
  console.log(`${style.padEnd(7)} procedural  | ${mm(p.screen)} ${mm(p.back)}  | ${mm(p.lipF)}      ${mm(p.lipR)}`);
  judge(style, "procedural", "windscreen foot", p.screen);
  judge(style, "procedural", "rear window foot", p.back);
  judge(style, "procedural", "roof's front lip", p.lipF);
  judge(style, "procedural", "roof's rear lip", p.lipR);

  // ...and the shells the hero cars actually wear. Crowned the way
  // models.ts crowns them, or this measures a flat loft against a
  // surfaced extrusion and every number is the crown.
  const shells = await loadGlb(`public/models/car-${style}.glb`);
  if (!shells?.canopy || !shells?.body) {
    console.log(`${"".padEnd(7)} authored    | no shipped shell to measure`);
    continue;
  }
  for (const slot of ["body", "canopy", "roof"]) if (shells[slot]) crownShell(shells[slot], crownFor(style, slot));
  const a = measure(shells.body, shells.canopy, shells.roof);
  console.log(`${"".padEnd(7)} authored    | ${mm(a.screen)} ${mm(a.back)}  | ${mm(a.lipF)}      ${mm(a.lipR)}`);
  // The authored shells are judged too, but a stale one is not a defect
  // in the car — it is a file that models.ts will REJECT at load, and
  // the corrected procedural shell stands in its place. So a failure
  // here is only real if the game would actually ship it.
  const rejected = [];
  for (const [what, v] of [["windscreen foot", a.screen], ["rear window foot", a.back],
                           ["roof's front lip", a.lipF], ["roof's rear lip", a.lipR]]) {
    if (v !== null && v <= FAIL_BITE) rejected.push(`${what} ${(v * 1000).toFixed(0)} mm`);
  }
  if (rejected.length) {
    console.log(`${"".padEnd(7)}             ^ stale loft (${rejected.join(", ")}) — models.ts rejects it on skin drift,`);
    console.log(`${"".padEnd(7)}               so the corrected procedural shell is what ships. Re-loft when Blender is available.`);
  }
}

for (const m of warn) console.log(`\nthin: ${m}`);
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const m of fail) console.log(`  - ${m}`);
  process.exit(1);
}
console.log("\nthe glass lands on the car, front and rear");
