// Every car has its own face, and it is set into the nose.
//
//   npm run test:headfit         (no browser, no dev server)
//
// Two claims, and both were false before this test existed.
//
// ITS OWN FACE. Six of the nine silhouettes wore the SAME headlamp — a
// 540 x 155 mm lens with its outer edge at 890 mm, on the saloon, the
// hatch, the pickup, the SUV, the supercar and the GT-R alike. A 5.35 m
// half-tonne truck and a 4.28 m hot hatch met the world with the same
// eyes. cars.ts had already written the complaint, in the block that
// rebuilt the lamps as three-layer assemblies: "no way to tell one
// car's face from another's. Four silhouettes, four different slabs,
// all identical once lit." The assemblies fixed the slab; they did not
// give anybody a face. LAMPS_BY_STYLE does.
//
// SET INTO THE NOSE. The lamp was pinned to `d.nose` — the silhouette's
// centreline anchor — and to a hand-picked x of 0.62, on every body.
// A nose falls away toward its corners and the lamp did not, so
// measured on the built fleet the lens stood 53 to 121 mm AHEAD of the
// bodywork at its own station, and on the pony its outer edge sat
// 162 mm outboard of the car's own flank. A sideways ray fired at the
// lamp found no car at all on seven of the nine, which is the shortest
// way to say it: the headlights were in front of the vehicle.
//
// The tail lamps were refitted to their panel a while ago, with
// tailFaceZ and flankXAt and a TAIL_PAD. This is the same idiom at the
// other end — noseFaceAt, flankXAt, HEAD_PAD — and the same test shape
// as tests/tailfit.mjs asks of the rear.
//
// Measured in the car's OWN frame: the lamps are added straight to the
// group and the geometry the rays hit is that group's, and the group
// carries a width fix, so mixing world and local reads that scale as
// hundreds of millimetres of false drift.
import * as THREE from "three";
import "./lib/dom-stub.mjs";
import { createCar, LAMPS_BY_STYLE } from "../src/game/cars.ts";

const STYLES = ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"];

/** The two silhouettes whose lamps are drawn by their own bespoke
 *  branch rather than from the package record: the Z32's full-width bar
 *  and the FD's pop-ups. Both are the reason their real machines are
 *  recognisable head-on, both already fit themselves with noseFaceZ,
 *  and neither is measured for pad here — a bar IS the width of the
 *  nose, and a pop-up sits under the hood skin rather than in the
 *  panel. They are still required to be distinct from everything else. */
const BESPOKE = new Set(["zx", "rx7"]);

const fail = [];
const ray = new THREE.Raycaster();
const dbl = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

console.log("Front lamps: the lens, and how it sits in the nose. Millimetres.\n");
console.log("style   | lens w x h  | pad to flank | proud of the panel | lenses");

const faces = new Map();

for (const style of STYLES) {
  const car = createCar({ style, body: 0xffffff, accent: 0x222222, kit: "street" });
  car.updateMatrixWorld(true);
  let body = null;
  car.traverse((o) => { if (o.isMesh && o.userData.shell === "body") body = o; });
  if (!body) { fail.push(`${style}: no body shell`); continue; }
  const pBody = new THREE.Mesh(body.geometry, dbl);
  pBody.updateMatrixWorld(true);
  /** The flank's half-width at a height and a station. */
  const flankAt = (y, z) => {
    ray.set(new THREE.Vector3(6, y, z), new THREE.Vector3(-1, 0, 0));
    const h = ray.intersectObject(pBody, false)[0];
    return h ? h.point.x : null;
  };
  /** Where the painted nose is, at a lamp's own station. */
  const noseAt = (y, x) => {
    ray.set(new THREE.Vector3(x, y, 8), new THREE.Vector3(0, 0, -1));
    const h = ray.intersectObject(pBody, false)[0];
    return h ? h.point.z : null;
  };

  const lenses = [];
  for (const o of car.children) {
    if (!o.isMesh || o.name !== "lamp-lens" || o.position.z <= 0) continue;
    o.geometry.computeBoundingBox();
    const g = o.geometry.boundingBox;
    // A round lens is a cylinder laid on its side, so its geometry box
    // reads the barrel length as height. Take the diameter both ways.
    const round = o.rotation.x !== 0;
    lenses.push({
      x: o.position.x, y: o.position.y, z: o.position.z,
      w: round ? (g.max.x - g.min.x) : (g.max.x - g.min.x),
      h: round ? (g.max.x - g.min.x) : (g.max.y - g.min.y),
      outer: Math.abs(o.position.x) + g.max.x,
      front: o.position.z + (round ? g.max.y : g.max.z),
    });
  }
  if (!lenses.length) { fail.push(`${style}: no headlamp lens at all`); continue; }

  const right = lenses.filter((e) => e.x > 0.05).sort((a, b) => b.outer - a.outer)[0];
  // The OUTERMOST on each side. Sorting the other way compares the
  // GT-R's inboard projector eye against the far side's main lamp, and
  // the pony's inner round against its outer — which is a difference
  // between two different lamps, not an asymmetry.
  const left = lenses.filter((e) => e.x < -0.05).sort((a, b) => b.outer - a.outer)[0];
  const spec = LAMPS_BY_STYLE[style];
  faces.set(style, `${spec.shape}:${spec.w.toFixed(3)}x${spec.h.toFixed(3)}${spec.eyes ? "+eyes" : ""}`);

  let padTxt = "   n/a", proudTxt = "   n/a";
  if (right && !BESPOKE.has(style)) {
    const fx = flankAt(right.y, right.z);
    const nz = noseAt(right.y, right.x);
    if (fx === null) {
      fail.push(`${style}: a sideways ray at the headlamp finds no bodywork — the lamp is not on the car`);
    } else {
      const pad = fx - right.outer;
      padTxt = (pad * 1000).toFixed(0).padStart(6);
      if (pad < 0.015)
        fail.push(`${style}: the headlamp's outer edge is ${(pad * 1000).toFixed(0)} mm from the flank — it hangs off the corner`);
      if (pad > 0.16)
        fail.push(`${style}: the headlamp sits ${(pad * 1000).toFixed(0)} mm inboard of the flank — that is a gap, not a lamp`);
    }
    if (nz === null) {
      fail.push(`${style}: no painted nose behind the headlamp`);
    } else {
      const proud = right.front - nz;
      proudTxt = (proud * 1000).toFixed(0).padStart(6);
      if (proud > 0.05)
        fail.push(`${style}: the lens stands ${(proud * 1000).toFixed(0)} mm proud of the panel — it is in front of the car`);
      if (proud < -0.06)
        fail.push(`${style}: the lens is ${(-proud * 1000).toFixed(0)} mm inside the panel — it is buried`);
    }
    // Both sides, to the millimetre, the way tailfit asks of the rear.
    if (left && Math.abs(Math.abs(left.outer) - right.outer) > 0.002)
      fail.push(`${style}: the lamps are ${(Math.abs(Math.abs(left.outer) - right.outer) * 1000).toFixed(0)} mm apart left to right`);
  }
  console.log(
    `${style.padEnd(7)} | ${(right.w * 1000).toFixed(0).padStart(4)} x ${(right.h * 1000).toFixed(0).padStart(3)} |${padTxt}       |${proudTxt}              | ${lenses.length}`
  );
}

// ...and no two cars wearing the same one. This is the whole point.
const seen = new Map();
for (const [style, sig] of faces) {
  if (seen.has(sig)) fail.push(`${style} and ${seen.get(sig)} have the same headlamp package (${sig}) — they have the same face`);
  else seen.set(sig, style);
}
console.log(`\npackages   ${faces.size} silhouettes, ${seen.size} distinct faces`);
const shapes = new Set([...faces.values()].map((v) => v.split(":")[0]));
console.log(`shapes     ${[...shapes].sort().join(", ")}`);
if (shapes.size < 4) fail.push(`only ${shapes.size} lamp shapes across the fleet — a face is more than a width`);

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const m of fail) console.log(`  - ${m}`);
  process.exit(1);
}
console.log("\nevery car has its own face, and it is set into the nose");
