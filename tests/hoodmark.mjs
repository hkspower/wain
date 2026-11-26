// The rally pack's bonnet bar and falcon, on the gtr's power bulge.
//
//   npm run test:hoodmark        (no browser, no dev server)
//
// The gtr wears a level slab down the bonnet, 0.72 m wide and standing
// about 80 mm proud of the skin. The pack's two bonnet pieces were
// levelled against the BARE shell, so on the Kaiju R they ended up inside
// it: three of the bar's four pieces were buried, and the 0.85 m falcon
// sat 31 to 55 mm under the slab with only a sliver of its text clear at
// the rear edge. From above the bonnet was a plain rectangle of paint
// with two green stubs. The Black Demon's livery had met the same bug and
// fixed it for itself with a raycast; the pack never got the fix.
//
// So this builds the car the way the game does and asks the things a
// person looking down at the bonnet would:
//
//   inside   the falcon's whole footprint is on the slab's flat top, not
//            hanging over the paint beside it
//   above    every corner of it is a few millimetres over the slab and
//            never under it
//   bar      no piece of the bar is under the slab's top where it runs
//            over it
//   seen     a ray down the centreline meets the bar or the falcon first,
//            not the slab's paint, along the slab's length
//   alone    the other bodies' bars and falcons did not move
import * as THREE from "three";
import "./lib/dom-stub.mjs";
import { createCar } from "../src/game/cars.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok  " : "FAIL"; };
const mm = (v) => `${(v * 1000).toFixed(0)} mm`;

const car = createCar({
  style: "gtr", kit: "attack", raceKit: true,
  body: 0x3f66c4, accent: 0x007a3d, name: "Kaiju R",
});
// In the car's own frame. createCar's group carries a fit scale, and every
// number below is a design number in unscaled metres.
car.scale.set(1, 1, 1);
car.updateMatrixWorld(true);

let bulge = null, falcon = null;
const bars = [];
car.traverse((o) => {
  if (!o.isMesh) return;
  o.geometry.computeBoundingBox();
  const b = o.geometry.boundingBox;
  const size = b.getSize(new THREE.Vector3());
  // The bulge is the only slab on the car that is 1.0 m long and 0.78 wide
  // (the 0.72 outline plus a bevel radius each side).
  if (Math.abs(size.x - 0.778) < 0.004 && Math.abs(size.z - 1.0) < 0.002 && size.y > 0.1 && size.y < 0.13) bulge = o;
  if (o.userData.decal === "hood-falcon") falcon = o;
  if (o.material?.name === "accent-stripe") bars.push(o);
});
if (!bulge || !falcon) {
  console.error("no bulge or no hood falcon on the Kaiju R build");
  process.exit(2);
}
const world = (o) => new THREE.Box3().setFromObject(o);
const slab = world(bulge);
const top = slab.max.y;
// Flat top. roundedBox bevels its outline outward by the corner radius,
// so the solid is 0.778 wide and its extremes are not the flat: the flat
// is the nominal 0.72 less a radius each side, and the nominal 1.0 m
// less a radius at each end.
const R = 0.03;
const flat = { x: 0.36 - R, z0: slab.min.z + R, z1: slab.max.z - R };

console.log(`bulge     top ${top.toFixed(3)} m, flat to |x| ${flat.x.toFixed(2)}, z ${flat.z0.toFixed(2)}..${flat.z1.toFixed(2)}`);

// --- inside ------------------------------------------------------------
const w = falcon.geometry.parameters.width;
const fb = world(falcon);
console.log(
  `inside    ${check(
    fb.max.x <= flat.x && fb.min.x >= -flat.x && fb.min.z >= flat.z0 && fb.max.z <= flat.z1,
    `falcon plane x ${fb.min.x.toFixed(3)}..${fb.max.x.toFixed(3)}, z ${fb.min.z.toFixed(3)}..${fb.max.z.toFixed(3)} ` +
      `is not inside the flat top`
  )}  ${w.toFixed(2)} m falcon, x ${fb.min.x.toFixed(2)}..${fb.max.x.toFixed(2)}, z ${fb.min.z.toFixed(2)}..${fb.max.z.toFixed(2)}`
);

// --- above -------------------------------------------------------------
const pos = falcon.geometry.attributes.position;
const lifts = [];
for (let i = 0; i < pos.count; i++) {
  const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(falcon.matrixWorld);
  lifts.push(v.y - top);
}
const lo = Math.min(...lifts), hi = Math.max(...lifts);
console.log(
  `above     ${check(
    lo >= 0.010 && hi <= 0.040,
    `falcon corners stand ${mm(lo)} to ${mm(hi)} over the slab, want 10 to 40 mm`
  )}  corners ${mm(lo)} to ${mm(hi)} over the slab's top`
);

// --- bar ---------------------------------------------------------------
// Every piece that lies over the slab, judged by where its top is.
const over = bars.filter((b) => {
  const bb = world(b);
  return bb.min.z >= slab.min.z - 0.01 && bb.max.z <= slab.max.z + 0.01 && bb.max.z > 1.2;
});
const buried = over.filter((b) => world(b).max.y < top);
console.log(
  `bar       ${check(
    over.length >= 1 && buried.length === 0,
    over.length ? `${buried.length} bar piece(s) over the slab have their top under it` : "no bar piece lies over the slab"
  )}  ${over.length} piece(s) over the slab, tops ${over.map((b) => mm(world(b).max.y - top)).join(", ")} above it`
);

// --- seen --------------------------------------------------------------
const ray = new THREE.Raycaster();
const all = [];
car.traverse((o) => { if (o.isMesh) all.push(o); });
let seen = 0, n = 0;
const what = {};
for (let z = 1.1; z <= 2.0001; z += 0.02) {
  ray.set(new THREE.Vector3(0, 3, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObjects(all, false)[0];
  n++;
  const tag = hit?.object === falcon ? "falcon" : hit?.object.material?.name === "accent-stripe" ? "bar" : hit?.object === bulge ? "slab" : "other";
  what[tag] = (what[tag] ?? 0) + 1;
  if (tag === "falcon" || tag === "bar") seen++;
}
console.log(
  `seen      ${check(
    seen / n >= 0.9,
    `a ray down the centreline meets the bar or the falcon first at ${seen} of ${n} stations, not 90%`
  )}  ${seen} of ${n} stations show the bar or the falcon (${Object.entries(what).map(([k, v]) => `${k} ${v}`).join(", ")})`
);

// --- alone -------------------------------------------------------------
// What the other bodies wear, read off the build once the bars became
// ribbons (tests/stripes.mjs owns that change): the falcon's height, z
// and pitch, and each bar as [rear z, front z, top y]. 1 mm and 2 mrad.
//
// The bar was four 12 mm plates a run, each pinned here by its own y, z
// and pitch, and a plate has none of those any more: one ribbon runs the
// whole bonnet and one the boot, with no position of its own. What it
// must still keep is the run it covers and how high it stands at the
// top, and that is what is pinned. The falcon moved with it where it
// was riding up a 20 mm plate: it is 22 mm over the skin now, as it
// always was where the bar was out of its way. The zx is the control —
// its falcon sat at the skin height before and sits there now.
const WAS = {
  sedan: { hood: [0.8302, 1.45, -1.4396], bars: [[0.99, 2.14, 0.8705], [-2.16, -1.1, 0.8842]] },
  zx: { hood: [0.7194, 1.15, -1.4496], bars: [[0.56, 2.27, 0.7715]] },
  rx7: { hood: [0.6907, 1.15, -1.3843], bars: [[0.51, 2.21, 0.7718]] },
  // The hatch's falcon moved behind its wipers (tests/hoodfit.mjs owns
  // that).
  hatch: { hood: [0.8682, 1.605, -1.3704], bars: [[1.18, 1.95, 0.9231]] },
};
for (const [style, was] of Object.entries(WAS)) {
  const c = createCar({ style, kit: "attack", raceKit: true, body: 0x3f66c4, accent: 0x007a3d, name: "Kaiju R" });
  c.scale.set(1, 1, 1);
  c.updateMatrixWorld(true);
  const got = [];
  let hood = null;
  c.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material?.name === "accent-stripe") {
      const b = new THREE.Box3().setFromObject(o);
      got.push([b.min.z, b.max.z, b.max.y]);
    }
    if (o.userData.decal === "hood-falcon") hood = [o.position.y, o.position.z, o.rotation.x];
  });
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001 && Math.abs(a[2] - b[2]) < 0.002;
  const barOk = got.length === was.bars.length && was.bars.every((b, i) => got[i].every((v, k) => Math.abs(v - b[k]) < 0.001));
  const hoodOk = was.hood === null || (hood && same(hood, was.hood));
  console.log(
    `alone     ${check(barOk && hoodOk, `${style}: its bar or falcon moved`)}  ${style.padEnd(6)} ${was.bars.length} bar ribbon${was.bars.length > 1 ? "s" : ""}` +
      `${was.hood ? " and the falcon" : ""} where they were`
  );
}

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe pack lies on the bulge.");
