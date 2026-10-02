// Parts that sit ON a shell actually touch it: the windscreen sun band and
// the high-mount third brake light, on every body style.
//
//   npm run test:perch
//
// Both used to be pinned by numbers — the band at a fixed height over the
// wiper line, the lamp 1.36 m up and 1.28 m back on six silhouettes — and
// the shells moved under them. Studio renders of the whole fleet showed a
// black bar floating ahead of every base car's windscreen (140-340 mm off
// the glass) and a red lamp hanging in the air behind the roof (85-400 mm
// up; on the suv, 360 mm inside it). cars.ts now reads both off the shells.
//
// The band: from its centre and from both ends, a ray back along its own
// face normal must meet the canopy within a few centimetres, so it is on
// the screen, not in front of it and not sunk through it, and does not
// overhang the glass at either end. The lamp: the skin straight below its
// centre must be within its own half-height or so.
import * as THREE from "three";
import "./lib/dom-stub.mjs";
import { createCar } from "../src/game/cars.ts";

const STYLES = ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"];
const BAND_GAP = [0.004, 0.03];   // m from the band's centre plane to the glass
const LAMP_GAP = [-0.01, 0.03];   // m from the lamp's underside to the skin
const fail = [];
const ray = new THREE.Raycaster();
const dbl = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

for (const style of STYLES) {
  const car = createCar({ style, body: 0xffffff, accent: 0x222222, kit: "street" });
  car.updateMatrixWorld(true);
  const shells = {};
  let band = null;
  const lamps = [];
  car.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.shell) {
      // In the car's own transform: createCar scales the whole group to
      // the car's length, shells and parts alike.
      const m = new THREE.Mesh(o.geometry, dbl);
      m.matrixAutoUpdate = false;
      m.matrix.copy(o.matrixWorld);
      m.matrixWorld.copy(o.matrixWorld);
      shells[o.userData.shell] = m;
    }
    if (o.material?.name === "sun-band") band = o;
    if (o.material === car.userData.tailMat) lamps.push(o);
  });
  const all = Object.values(shells);
  const line = [`${style.padEnd(7)}`];

  // --- the sun band
  if (!band) {
    fail.push(`${style}: no sun band on a street-kit car`);
  } else {
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(band.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const g = band.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const hw = (g.boundingBox.max.x - g.boundingBox.min.x) / 2;
    const gaps = [];
    for (const fx of [0, -0.95, 0.95]) {
      const p = new THREE.Vector3(fx * hw, 0, 0).applyMatrix4(band.matrixWorld);
      ray.set(p.clone().addScaledVector(n, 0.5), n.clone().negate());
      const h = ray.intersectObject(shells.canopy, false)[0];
      gaps.push(h ? h.distance - 0.5 : null);
    }
    const [c, l, r] = gaps;
    line.push(`band ${(hw * 2).toFixed(2)} m wide, off the glass ${gaps.map((v) => (v === null ? "miss" : (v * 1000).toFixed(0))).join("/")} mm`);
    if (c === null || c < BAND_GAP[0] || c > BAND_GAP[1])
      fail.push(`${style}: sun band centre ${c === null ? "is not over the screen" : `${(c * 1000).toFixed(0)} mm off the glass`}`);
    for (const [side, v] of [["left", l], ["right", r]])
      if (v === null || v < BAND_GAP[0] - 0.01 || v > BAND_GAP[1] + 0.03)
        fail.push(`${style}: sun band ${side} end ${v === null ? "overhangs the screen" : `${(v * 1000).toFixed(0)} mm off the glass`}`);
  }

  // --- the third brake light: the wide, short lens above the tail lamps
  const lamp = lamps
    .map((o) => [o, new THREE.Box3().setFromObject(o)])
    .filter(([, b]) => {
      const s = b.getSize(new THREE.Vector3());
      return s.x > 0.4 && s.x < 0.6 && s.y < 0.1;
    })
    .sort((a, b) => b[1].max.y - a[1].max.y)[0];
  if (!lamp) {
    fail.push(`${style}: no third brake light`);
  } else {
    const [, b] = lamp;
    const c = b.getCenter(new THREE.Vector3());
    ray.set(new THREE.Vector3(0, 8, c.z), new THREE.Vector3(0, -1, 0));
    // Skin below the lamp, ignoring the lamp itself: the highest shell hit
    // that is not above the lamp's top.
    const hits = ray.intersectObjects(all, false).filter((h) => h.point.y < b.max.y + 0.001);
    const skin = hits.length ? hits[0].point.y : null;
    const gap = skin === null ? null : b.min.y - skin;
    line.push(`3rd brake light ${gap === null ? "over nothing" : `${(gap * 1000).toFixed(0)} mm off the skin`}`);
    // The fastbacks and the gtr hang theirs off the bodywork and the wing;
    // all must still be ON something.
    if (gap === null || gap < LAMP_GAP[0] - 0.02 || gap > LAMP_GAP[1])
      fail.push(`${style}: third brake light ${gap === null ? "is over nothing" : `${(gap * 1000).toFixed(0)} mm off the skin`}`);
    // ...and outside it: a lamp buried in the roof is not a lamp.
    const above = ray.intersectObjects(all, false).filter((h) => h.point.y > b.max.y + 0.005);
    if (above.length && above[0].point.y - b.max.y > 0.01)
      fail.push(`${style}: third brake light is ${((above[0].point.y - b.max.y) * 1000).toFixed(0)} mm inside the shell`);
  }
  console.log(line.join("  "));
}

if (fail.length) {
  console.log(`\n${fail.length} problem(s):`);
  for (const f of fail) console.log("  - " + f);
  process.exit(1);
}
console.log(`\nthe sun band and the third brake light sit on the car, on all ${STYLES.length} styles`);
