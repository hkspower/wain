// Both number plates read left to right, on every body style.
//
//   npm run test:plates
//
// A plate is a roundedBox with its two flat caps mapped to the whole
// texture by faceUV (src/game/cars.ts). The extrude generator writes
// u = x on BOTH caps, and the face looking backwards is seen from behind,
// where world -X is the viewer's right: mapped the same way it reads
// mirrored. It did, on every rear plate in the game — the plate the chase
// camera shows all race — until a 3ds Max preview render of the Black
// Demon's tail showed "191403" back to front.
//
// So: build every style in node (tests/lib/dom-stub.mjs, as glassfit does),
// find the plates, take each plate's OUTWARD cap (the one facing away from
// the car), and require u to increase toward the right of someone looking
// at it, and v to increase upward.
import * as THREE from "three";
import "./lib/dom-stub.mjs";
import { createCar } from "../src/game/cars.ts";

const STYLES = ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"];
const fail = [];
let plates = 0;

for (const style of STYLES) {
  const car = createCar({ style, body: 0xffffff, accent: 0x222222, kit: "street" });
  car.updateMatrixWorld(true);
  const found = [];
  car.traverse((o) => {
    if (o.isMesh && !Array.isArray(o.material) && o.material?.name === "plate") found.push(o);
  });
  if (found.length !== 2) {
    fail.push(`${style}: ${found.length} plates, expected a front and a rear`);
    continue;
  }
  for (const p of found) {
    plates++;
    const where = new THREE.Vector3();
    p.getWorldPosition(where);
    const out = Math.sign(where.z);              // +1 front plate, -1 rear plate
    const g = p.geometry;
    const pos = g.attributes.position, uv = g.attributes.uv, nor = g.attributes.normal;
    // The outward cap's vertices, and how u and v move across them.
    let n = 0, sxu = 0, sxx = 0, syv = 0, syy = 0, mx = 0, my = 0, mu = 0, mv = 0;
    const pick = [];
    for (let i = 0; i < pos.count; i++) if (nor.getZ(i) * out > 0.99) pick.push(i);
    for (const i of pick) { mx += pos.getX(i); my += pos.getY(i); mu += uv.getX(i); mv += uv.getY(i); n++; }
    if (n < 4) { fail.push(`${style} ${out > 0 ? "front" : "rear"} plate: no outward cap found`); continue; }
    mx /= n; my /= n; mu /= n; mv /= n;
    for (const i of pick) {
      const dx = pos.getX(i) - mx, dy = pos.getY(i) - my;
      sxu += dx * (uv.getX(i) - mu); sxx += dx * dx;
      syv += dy * (uv.getY(i) - mv); syy += dy * dy;
    }
    const dudx = sxu / sxx, dvdy = syv / syy;
    // Facing the cap, the viewer's right is +X for the front plate and -X
    // for the rear one: u must grow that way.
    const dudRight = dudx * out;
    const label = `${style} ${out > 0 ? "front" : "rear "} plate`;
    console.log(`${label.padEnd(18)} du/d(right) ${dudRight.toFixed(2).padStart(6)}  dv/d(up) ${dvdy.toFixed(2).padStart(6)}`);
    if (!(dudRight > 0)) fail.push(`${label}: reads mirrored (u runs toward the viewer's left)`);
    if (!(dvdy > 0)) fail.push(`${label}: reads upside down`);
    // And the whole texture, not a corner of it (the bug faceUV was written for).
    let umin = 1e9, umax = -1e9;
    for (const i of pick) { umin = Math.min(umin, uv.getX(i)); umax = Math.max(umax, uv.getX(i)); }
    if (umin < -0.02 || umax > 1.02 || umax - umin < 0.9) fail.push(`${label}: u spans ${umin.toFixed(2)}..${umax.toFixed(2)}, not the texture`);
  }
}

if (fail.length) {
  console.log(`\n${fail.length} problem(s):`);
  for (const f of fail) console.log("  - " + f);
  process.exit(1);
}
console.log(`\n${plates} plates on ${STYLES.length} styles read left to right`);
