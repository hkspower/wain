// Where the bumper trim actually sits, against the bumper it trims.
//
//   npm run dev
//   node tools/shots/bumpers.mjs
//
// The black valance under each bumper is placed at the profile's nose
// and tail ANCHOR, plus twenty millimetres. The anchor is a control
// point of the 2D profile, and the extrusion's bevel and spline carry
// the painted skin out past it — by up to forty millimetres, as the
// comment beside the number plates in cars.ts already says of the same
// two anchors. Twenty is not forty, so the trim can end up inside the
// paint it is supposed to be bolted under.
//
// This asks the geometry instead of the anchor: a ray fired at the tail
// from behind, at the valance's own height, is the skin. Reported per
// silhouette, both ends, in millimetres of proud (positive) or sunk
// (negative).
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const C=[process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium","/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find((p)=>existsSync(p));
if (!exe) { console.error("No Chromium found."); process.exit(2); }
const b = await chromium.launch({executablePath:exe,args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"],headless:true});
const page = await b.newPage({viewport:{width:1000,height:640}});
page.setDefaultTimeout(180000);
page.on("pageerror",(e)=>console.log("PAGEERROR:",e.message));
await page.goto("http://localhost:3000/race",{waitUntil:"networkidle"});
await page.evaluate(()=>{localStorage.clear();localStorage.setItem("gulf-road-nights-onboarded","2");localStorage.setItem("gulf-road-nights-coach","3");});
await page.reload({waitUntil:"networkidle"});
await page.click("text=START ENGINE");
await page.waitForFunction(()=>!!window.__grnDebug,null,{timeout:180000});

const cars = await page.evaluate(()=>fetch("/api/grn/v1/cars").then(r=>r.json()));
const bySil = new Map();
for (const c of cars.cars) if (!bySil.has(c.bodyStyle)) bySil.set(c.bodyStyle, c);

const measure = (carId) => page.evaluate(async (carId)=>{
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car: carId, cars: [carId], owned: [], kd: 99999,
    equipped: { paint: "paint-white", glow: "glow-none" },
  }));
  e.applyGarage();
  await new Promise(r=>setTimeout(r,250));
  const car = e.carBody;
  car.updateMatrixWorld(true);
  // The car's OWN frame throughout. Measured in world space these rays
  // are fired down the world's z axis at a car that is parked on a track
  // with a heading, so they miss it entirely — every skin reading came
  // back null — and a world Box3 around a rotated body reports it three
  // metres wide. tests/ik.mjs paid for this lesson on the roof and wrote
  // it down; this is the same mistake at the other end of the car.
  const inv = car.matrixWorld.clone().invert();
  // The valances: the two seam-black rounded boxes low at each end.
  const found = { front: null, rear: null };
  const shells = [];
  car.traverse((o)=>{
    if (!o.isMesh) return;
    if (o.userData.shell === "body") shells.push(o);
    // By its tag, not by "the last black box at that end". Picked out of
    // the seam-black meshes by size and sign, this found the front
    // SPLITTER — a blade that is supposed to jut past the bumper — and
    // reported the car's aero as a 424 mm fault.
    const trim = o.userData.trim;
    if (trim !== "valance-front" && trim !== "valance-rear") return;
    const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
    found[trim === "valance-front" ? "front" : "rear"] =
      { z: p.z, y: p.y, width: bb.max.x - bb.min.x, depth: bb.max.z - bb.min.z };
  });
  // The painted skin at that height, asked of the shell rather than the
  // anchor: one ray from outside the car, straight down its axis.
  const skinAt = (y, front) => {
    for (const s of shells) {
      // A probe mesh on the geometry alone, so the ray and the surface
      // are both in the shell's own coordinates.
      const probe = new THREE.Mesh(s.geometry);
      probe.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(
        new THREE.Vector3(0, y, front ? 12 : -12),
        new THREE.Vector3(0, 0, front ? -1 : 1)
      );
      const hit = ray.intersectObject(probe, false)[0];
      if (hit) return hit.point.z;
    }
    return null;
  };
  const bodyBox = new THREE.Box3();
  for (const s of shells) {
    if (!s.geometry.boundingBox) s.geometry.computeBoundingBox();
    bodyBox.union(s.geometry.boundingBox);
  }
  const out = {};
  for (const face of ["front", "rear"]) {
    const v = found[face];
    if (!v) { out[face] = null; continue; }
    const skin = skinAt(v.y, face === "front");
    const half = v.depth / 2;
    const outer = face === "front" ? v.z + half : v.z - half;
    out[face] = {
      valanceZ: +v.z.toFixed(3),
      valanceWidth: +v.width.toFixed(3),
      skinZ: skin === null ? null : +skin.toFixed(3),
      proudMm: skin === null ? null : Math.round((face === "front" ? outer - skin : skin - outer) * 1000),
    };
  }
  out.bodyHalfWidth = +((bodyBox.max.x - bodyBox.min.x) / 2).toFixed(3);
  return out;
}, carId);

console.log("\nvalance vs the painted skin it is bolted under, per silhouette");
console.log("  proud > 0 = standing out of the bumper; < 0 = buried inside it\n");
const fail = [];
for (const [style, c] of bySil) {
  const m = await measure(c.id);
  for (const face of ["front", "rear"]) {
    const v = m[face];
    if (!v) { console.log(`  ${style.padEnd(7)} ${face.padEnd(5)} no valance found`); fail.push(`${style}: no ${face} valance`); continue; }
    const cover = ((v.valanceWidth / 2 / m.bodyHalfWidth) * 100).toFixed(0);
    console.log(
      `  ${style.padEnd(7)} ${face.padEnd(5)} valance z ${String(v.valanceZ).padStart(7)}  skin z ${String(v.skinZ).padStart(7)}  ` +
      `${String(v.proudMm).padStart(5)} mm proud   ${String(v.valanceWidth).padStart(5)} m wide (${cover}% of the body)`
    );
    if (v.proudMm !== null && v.proudMm < 0) fail.push(`${style} ${face}: the valance is ${-v.proudMm} mm inside the bumper skin`);
    if (+cover < 80) fail.push(`${style} ${face}: the valance covers ${cover}% of the body's width`);
  }
}
console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nevery valance sits on the bumper it trims");
await b.close();
