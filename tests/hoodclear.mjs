// Nothing stands on the bonnet falcon.
//
//   npm run test:hoodclear       (no browser, no dev server)
//
// The attack kit's two carbon louvres were 0.34 x 0.5 slabs at x +/-0.36,
// so their inner edge was at 0.19 — inside the 0.85 m falcon (wings to
// 0.405) and inside the 0.46 m accent bar. The falcon is laid 22 mm over
// the bare skin and a louvre stands 37 mm, so the louvre won the depth
// test across the outer wings: they ended in flat vertical cuts, the bar
// was notched, and on the zx the cooling slats beside them made a
// stair-stepped V of four black pads.
//
// Asked the way a camera above the bonnet would ask: a grid of rays down
// onto the falcon's plane, and what each one hits FIRST. A decal that is
// "there" in the scene graph and not on top is invisible, and that is the
// failure this has.
//
// Every body, in every kit, wearing the pack. The twin-striped pony too,
// since its falcon is a different plane in a different place.
//
// Twice: as createCar builds it, and with the authored loft put on it the
// way the game does (tests/lib/loft.mjs). The bonnet bar is laid again on
// the loft's skin, a few millimetres from where it stood on the extrusion,
// and the falcon was laid over the bar as it stood on the extrusion.
import * as THREE from "three";
import "./lib/dom-stub.mjs";
import { createCar } from "../src/game/cars.ts";
import { wearLoft } from "./lib/loft.mjs";

const STYLES = ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"];
const KITS = ["street", "sport", "attack"];
/** The share of the inked part of the plane that must show the decal
 *  rather than something standing on it. Not 100: a rounded corner of the
 *  plane can sit just under a bevel it was never meant to clear. */
const WANT = 0.98;
const GRID = 24;
/** The plane is square and the ink is not: the bird's head starts 51 rows
 *  down a 256-row texture and the last line of type ends at row 232, so a
 *  fifth of the plane is empty margin. The rx7's plane starts under its
 *  windscreen and put 24 of 576 rays on glass over a margin with nothing
 *  in it, which is no defect. Only the inked rows are asked about. */
const INK_TOP = 51 / 256;
const INK_BOTTOM = 232 / 256;

const fail = [];
const ray = new THREE.Raycaster();

function seen(car, hood) {
  const meshes = [];
  car.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const half = hood.geometry.parameters.width / 2;
  let self = 0, n = 0;
  const by = {};
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const u = -half + ((i + 0.5) / GRID) * 2 * half;
      // Down the texture from the top row of ink to the bottom one, as
      // local y: the plane's +y is the texture's top.
      const row = INK_TOP + ((j + 0.5) / GRID) * (INK_BOTTOM - INK_TOP);
      const v = half - row * 2 * half;
      const p = new THREE.Vector3(u, v, 0).applyMatrix4(hood.matrixWorld);
      ray.set(new THREE.Vector3(p.x, 4, p.z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObjects(meshes, false)[0];
      n++;
      if (hit?.object === hood) self++;
      else {
        const what = hit ? (hit.object.material?.name || hit.object.userData.shell || "part") : "nothing";
        by[what] = (by[what] ?? 0) + 1;
      }
    }
  }
  return { share: self / n, by };
}

async function run(label, opts, wear) {
  const car = createCar({ body: 0x3f66c4, accent: 0x007a3d, stickers: true, name: "Test", ...opts });
  let tag = "";
  if (wear === "loft") {
    const worn = await wearLoft(car, opts.style);
    // What the game draws when the loft is refused is the extrusion, which
    // the other pass has measured.
    if (worn.body !== "loft") { console.log(`  ${label.padEnd(16)} skip  the loft is not worn (${worn.body})`); return; }
    tag = "  (loft)";
    loftMeasured++;
  }
  car.scale.set(1, 1, 1);
  car.updateMatrixWorld(true);
  let hood = null;
  car.traverse((o) => { if (o.userData.decal === "hood-falcon") hood = o; });
  if (!hood) { fail.push(`${label}${tag}: no hood falcon`); return; }
  const { share, by } = seen(car, hood);
  const ok = share >= WANT;
  if (!ok) {
    fail.push(`${label}${tag}: only ${(share * 100).toFixed(0)}% of the inked falcon shows (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  }
  console.log(`  ${label.padEnd(16)} ${ok ? "ok  " : "FAIL"}  ${(share * 100).toFixed(0).padStart(3)}% of the ink is on top${tag}`);
}

let loftMeasured = 0;
console.log(`${GRID}x${GRID} rays down onto the inked part of the falcon, the first thing each one meets.\n`);
for (const wear of ["extruded", "loft"]) {
  console.log(wear === "loft" ? "\nworn as the game wears it: the authored loft swapped in, refitted" : "as createCar builds it: the extrusion");
  for (const kit of KITS) {
    console.log(`${kit}`);
    for (const style of STYLES) {
      await run(`${style}`, { style, kit, raceKit: kit === "attack" }, wear);
    }
  }
  console.log("twin stripes");
  await run("pony (twin)", { style: "pony", kit: "sport", stripes: "twin", accent: 0xf04b16, body: 0xf2f2ee }, wear);
}
if (!loftMeasured) fail.push("no car wore the authored loft, so the pass that matters measured nothing");

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe falcon is on top, on every body in every kit, on the extrusion and on the loft.");
