// The Black Demon's marks, measured on the body the game wears.
//
//   npm run test:demonmarks      (no browser, no dev server)
//
// tests/demon.mjs measures the marks in a browser, on a car built a
// moment ago. That car wears the EXTRUDED body: the authored loft
// (public/models/car-gtr.glb) arrives later, over the network, and
// models.ts swaps it in underneath the decals. The two disagree about the
// flank by up to 118 mm — the extrusion tucks in under the shoulder and
// the loft is nearly vertical — so a band laid on the one is buried in
// the other. That is how the Demon's flank mark came to be 26% showing in
// the game and 99% showing in the test: the test measured the car the
// game had already stopped drawing.
//
// So the swap is done here exactly as models.ts does it (crown the loft,
// refuse it if shellFit would, put it on the car, call refitShell), and
// every number below is read off the car that results. Everything is
// asked the way a camera would ask it: a ray from the artwork to the
// outside, or from a camera to the artwork, against double-sided copies
// of every solid on the car. A ray fired from INSIDE a closed shell
// passes through its front-face-only paint, so a buried sticker would
// read as free on the car's own materials.
//
// Artwork-weighted: only the inked pixels of the skull count, as the
// outline of the artwork is built below from the same paths
// demonMarkTexture draws. The dom stub paints nothing.
import * as THREE from "three";
import { readFileSync, existsSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import "./lib/dom-stub.mjs";
import { createCar, crownFor, crownShell } from "../src/game/cars.ts";
import { shellFit } from "../src/game/models.ts";
import { CARS } from "../src/game/mods.ts";

const record = CARS.find((c) => c.id === "black-demon");
const opts = {
  body: record.color, style: record.style, kit: record.kit, raceKit: record.kit === "attack",
  finish: record.finish, lengthM: record.lengthM, tint: record.glass?.tint, tintFilm: record.glass?.film,
  rims: record.rims, livery: record.livery, trike: record.trike,
};

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); return ok ? "ok  " : "FAIL"; };
const mm = (v) => `${(v * 1000).toFixed(0)} mm`;
const pct = (v) => `${(v * 100).toFixed(0)}%`;

// ---------------------------------------------------------------- artwork
/** The mark's inked area, as the polygons demonMarkTexture draws, in its
 *  256-space. Flattened curves are close enough for a share to 1%. */
const quad = (p0, c, p1, n = 12) => {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    out.push([(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
              (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]]);
  }
  return out;
};
const horn = (s) => [[128 + s * 46, 106],
  ...quad([128 + s * 46, 106], [128 + s * 124, 88], [128 + s * 116, 18]),
  ...quad([128 + s * 116, 18], [128 + s * 88, 60], [128 + s * 60, 76])];
const skull = [[128, 238], [72, 160], [56, 102], ...quad([56, 102], [128, 58], [200, 102]), [184, 160]];
const inPoly = (poly, x, y) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const POLYS = [horn(-1), horn(1), skull];
const inked = (u, v) => POLYS.some((p) => inPoly(p, u * 256, (1 - v) * 256));

// ------------------------------------------------------------------ cars
const loader = new GLTFLoader();
const shells = await new Promise((res) => {
  const file = "public/models/car-gtr.glb";
  if (!existsSync(file)) return res(null);
  const buf = readFileSync(file);
  loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", (g) => {
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
if (!shells?.body) { console.error("public/models/car-gtr.glb is missing or unreadable"); process.exit(2); }
for (const slot of ["body", "canopy", "roof"]) if (shells[slot]) crownShell(shells[slot], crownFor("gtr", slot));

/** The Demon as createCar leaves it, wearing the extrusion. */
const extruded = () => createCar(opts);

/** ...and as the game has it a moment later: models.ts's settle(), slot
 *  for slot. Returns the car and what shellFit said about the body. */
function authored() {
  const g = createCar(opts);
  const by = {};
  g.traverse((o) => { if (o.isMesh && o.userData.shell) by[o.userData.shell] = o; });
  const fit = shellFit(shells.body, by.body.geometry);
  if (!fit.ok) return { g, fit };
  by.body.geometry = shells.body;
  g.userData.refitShell?.(shells.body);
  if (by.canopy && shells.canopy) by.canopy.geometry = shells.canopy;
  if (by.roof && shells.roof) by.roof.geometry = shells.roof;
  g.userData.refitCabin?.(shells.canopy);
  return { g, fit };
}

/** Local units from here on: the length fit's scale is taken off after the
 *  swap (which ran at the scale the game runs it at), so a millimetre
 *  here is a millimetre of the model. */
const settle = (g) => { g.scale.set(1, 1, 1); g.updateMatrixWorld(true); return g; };

const doubleSided = (g) => {
  const out = [];
  g.traverse((m) => {
    // Not the decals, and not the tail lamps' glow cards: those are additive
    // light with no depth write, hung 0.12 m behind each lamp, and stand in
    // front of nothing a camera can see.
    if (!m.isMesh || !m.visible || m.userData.decal || m.userData.noShadow) return;
    const c = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    c.matrixWorld.copy(m.matrixWorld);
    out.push(c);
  });
  return out;
};

/**
 * The share of a mark's INKED area that can be seen: from outside along
 * its own normal, or from a camera.
 */
function share(solids, o, cam = null) {
  const pa = o.geometry.getAttribute("position");
  const ua = o.geometry.getAttribute("uv");
  const idx = o.geometry.getIndex();
  const tris = idx ? idx.count / 3 : pa.count / 3;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const uA = new THREE.Vector2(), uB = new THREE.Vector2(), uC = new THREE.Vector2();
  const n = new THREE.Vector3(), p = new THREE.Vector3(), uv = new THREE.Vector2(), q = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  let seen = 0, total = 0;
  for (let t = 0; t < tris; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    A.fromBufferAttribute(pa, i0).applyMatrix4(o.matrixWorld);
    B.fromBufferAttribute(pa, i1).applyMatrix4(o.matrixWorld);
    C.fromBufferAttribute(pa, i2).applyMatrix4(o.matrixWorld);
    uA.fromBufferAttribute(ua, i0); uB.fromBufferAttribute(ua, i1); uC.fromBufferAttribute(ua, i2);
    n.copy(B).sub(A).cross(C.clone().sub(A));
    const area = n.length() / 2;
    n.normalize();
    const N = Math.max(1, Math.round(area * 8000));
    for (let k = 0; k < N; k++) {
      // A fixed spread inside the triangle: no rng, so tomorrow's number
      // is today's number.
      let r1 = (k * 0.61803398875 + 0.13) % 1, r2 = (k * 0.7548776662 + 0.29) % 1;
      if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
      p.copy(A).addScaledVector(B.clone().sub(A), r1).addScaledVector(C.clone().sub(A), r2);
      uv.copy(uA).multiplyScalar(1 - r1 - r2).addScaledVector(uB, r1).addScaledVector(uC, r2);
      if (!inked(uv.x, uv.y)) continue;
      total++;
      if (cam) {
        const dir = p.clone().sub(cam);
        const dist = dir.length();
        dir.normalize();
        if (dir.dot(n) > 0) continue; // its back is to the camera
        ray.set(cam, dir);
        ray.far = dist - 0.004;
      } else {
        q.copy(p).addScaledVector(n, 0.002);
        ray.set(q, n);
        ray.far = 3;
      }
      if (!ray.intersectObjects(solids, false).length) seen++;
    }
  }
  return total ? seen / total : 0;
}

const marksOf = (g, tag) => {
  const out = [];
  g.traverse((o) => { if (o.isMesh && o.userData.decal === tag) out.push(o); });
  return out;
};
const boxOf = (o) => new THREE.Box3().setFromObject(o);

// ================================================================== run
console.log("The Black Demon's marks, on the body the game wears.\n");

// --- 0. The car the game really has.
const { g: au, fit } = authored();
console.log(`shell     ${fit.ok ? "the authored loft is accepted" : "REJECTED: " + fit.reason}  ` +
  check(fit.ok, `shellFit refuses car-gtr.glb (${fit.reason}), so the game would never wear what this measures`));
if (!fit.ok) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
settle(au);
const solids = doubleSided(au);
const tags = [];
au.traverse((o) => { if (o.isMesh && String(o.userData.decal ?? "").startsWith("demon-")) tags.push(o.userData.decal); });
// Four, and four after refitShell has run: the flanks are built again
// there, and the old pair has to go or this reads six.
console.log(`marks     ${tags.sort().join(", ")}  ` +
  check(tags.join() === "demon-flank,demon-flank,demon-hood,demon-tail",
    `the car wears ${tags.join(", ")}, not one mark on each side`));

// --- 1. The flanks.
console.log("\nflanks (wear the authored loft, 5 rows, rebuilt by refitShell)");
const flank = marksOf(au, "demon-flank");
const body = [];
au.traverse((o) => { if (o.isMesh && o.userData.shell === "body") body.push(o); });
const skin = new THREE.Mesh(body[0].geometry, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
skin.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
const skinX = (side, y, z) => {
  ray.set(new THREE.Vector3(side * 30, y, z), new THREE.Vector3(-side, 0, 0));
  const h = ray.intersectObject(skin, false)[0];
  return h ? h.point.x : null;
};
const belts = [], flares = [];
au.traverse((o) => {
  if (o.isMesh && o.userData.flank === "belt") belts.push(o);
  if (o.isMesh && o.userData.archFlare) flares.push(o);
});
const boxes = flank.map(boxOf);
for (const [i, m] of flank.entries()) {
  const b = boxes[i];
  const side = Math.sign((b.min.x + b.max.x) / 2);
  const label = side > 0 ? "+x" : "-x";
  const vis = share(solids, m);
  console.log(`  ${label}  ${pct(vis)} of the artwork shows  ` +
    check(vis >= 0.9, `${label} flank mark: only ${pct(vis)} of the artwork can be seen on the authored body (it is buried in the paint)`));

  const h = b.max.y - b.min.y;
  console.log(`  ${label}  ${mm(h)} tall  ` +
    check(h >= 0.199 && h <= 0.281, `${label} flank mark is ${mm(h)} tall, not a skull of 0.20-0.28 m`));

  // Under the chrome belt, not across the horns.
  const belt = belts.find((o) => Math.sign(boxOf(o).getCenter(new THREE.Vector3()).x) === side);
  const beltLow = boxOf(belt).min.y;
  console.log(`  ${label}  top edge ${mm(beltLow - b.max.y)} under the belt chrome  ` +
    check(beltLow - b.max.y >= 0.0099, `${label} flank mark's top edge is only ${mm(beltLow - b.max.y)} under the belt chrome (wants 10)`));

  // Clear of the rear flare, as it is drawn.
  const pa = (f) => f.geometry.getAttribute("position");
  const v = new THREE.Vector3();
  let flareZ = -Infinity;
  for (const f of flares) {
    const fb = boxOf(f);
    if (fb.max.z > 0 || Math.sign((fb.min.x + fb.max.x) / 2) !== side) continue;
    for (let k = 0; k < pa(f).count; k++) {
      v.fromBufferAttribute(pa(f), k).applyMatrix4(f.matrixWorld);
      if (v.y >= b.min.y && v.y <= b.max.y && Math.abs(v.x) > 0.5) flareZ = Math.max(flareZ, v.z);
    }
  }
  console.log(`  ${label}  ${mm(b.min.z - flareZ)} clear of the rear flare  ` +
    check(b.min.z - flareZ >= 0.0299, `${label} flank mark ends ${mm(b.min.z - flareZ)} from the rear flare (wants 30)`));

  // And it stands off the displayed skin, at every vertex of every row.
  const pos = m.geometry.getAttribute("position");
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld);
    const sx = skinX(side, v.y, v.z);
    if (sx === null) { lo = -Infinity; continue; }
    const off = side * (v.x - sx);
    lo = Math.min(lo, off); hi = Math.max(hi, off);
  }
  console.log(`  ${label}  ${mm(lo)} to ${mm(hi)} off the skin, ${new Set([...Array(pos.count).keys()].map((k) => pos.getY(k).toFixed(4))).size} rows  ` +
    check(lo >= 0.004 && hi <= 0.04, `${label} flank mark stands ${mm(lo)} to ${mm(hi)} off the skin it is drawn on (wants 4-40 mm)`));
}
// Mirror images, to 5 mm.
if (boxes.length === 2) {
  const [a, b] = boxes;
  const d = Math.max(Math.abs(a.min.y - b.min.y), Math.abs(a.max.y - b.max.y), Math.abs(a.min.z - b.min.z),
    Math.abs(a.max.z - b.max.z), Math.abs(Math.abs(a.min.x + a.max.x) - Math.abs(b.min.x + b.max.x)) / 2);
  console.log(`  the two flanks differ by ${mm(d)}  ` +
    check(d < 0.005 && a.min.x * b.min.x < 0, `the two flank marks are ${mm(d)} apart, not mirror images`));
}

// --- 2. The tail.
//
// It was on the boot lid, and the wing's plane (0.46 m up) and uprights hid
// it from every camera below the roof line and from both rear
// three-quarters: 0% from the scan's r34 cameras, 100% only from straight
// above. It is on the black panel the lamps are set in now.
console.log("\ntail");
const [tail] = marksOf(au, "demon-tail");
const [hood] = marksOf(au, "demon-hood");
const up = (m) => new THREE.Vector3(0, 1, 0).applyQuaternion(m.getWorldQuaternion(new THREE.Quaternion()));
const faces = (m) => new THREE.Vector3(0, 0, 1).applyQuaternion(m.getWorldQuaternion(new THREE.Quaternion()));
console.log(`  it faces ${faces(tail).z < 0 ? "aft" : "FORWARD"} (${faces(tail).z.toFixed(2)}), its top points ${up(tail).y > 0 ? "up" : "DOWN"} (${up(tail).y.toFixed(2)})  ` +
  check(faces(tail).z < -0.9 && up(tail).y > 0.9, "the tail mark does not face the car behind with its horns up"));

// Asked as the viewer asks it: a camera behind and above, and the artwork's
// top point against its centre on the screen.
const upright = (m, at, look) => {
  const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  cam.position.set(...at);
  cam.lookAt(...look);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const b = boxOf(m);
  const c = b.getCenter(new THREE.Vector3());
  const top = c.clone().addScaledVector(up(m), 0.05);
  return top.project(cam).y - c.clone().project(cam).y;
};
const behind = upright(tail, [0, 2.8, -6.3], [0, 0.9, -1.5]);
console.log(`  from the chase camera its top is ${behind > 0 ? "above" : "BELOW"} its centre on the screen  ` +
  check(behind > 0, "from behind and above, the tail mark's top projects below its centre: it is upside down to a follower"));
const driver = upright(hood, [0, 1.25, 0.1], [0, 0.8, 1.6]);
console.log(`  from the driver's seat the hood mark's top is ${driver > 0 ? "above" : "BELOW"} its centre  ` +
  check(driver > 0, "from the driver's seat the hood mark is upside down"));

const free = share(solids, tail);
console.log(`  nothing stands over it: ${pct(free)} of the artwork is clear along its normal  ` +
  check(free >= 0.95, `${pct(1 - free)} of the tail mark is under something`));
// The cameras a follower, the game and the scan put behind the car. The
// chase cameras are the game's own (chaseArm); the others are the scan's
// rear, tail-n and r34 shots.
for (const [name, cam, min] of [
  ["chase camera (6.3 m back, 2.8 up)", [0, 2.8, -6.3], 0.6],
  ["far chase camera (7.7 m, 3.3 up)", [0, 3.3, -7.7], 0.6],
  ["scan's rear camera (11.5 m, bumper height)", [0, 0.9, -11.5], 0.4],
  ["scan's tail-n camera", [-2.9, 0.9, -5.3], 0.4],
  ["scan's r34-p camera", [6.2, 2.2, -6.2], 0.4],
  ["scan's r34-n camera", [-6.2, 2.2, -6.2], 0.4],
]) {
  const s = share(solids, tail, new THREE.Vector3(...cam));
  console.log(`  ${pct(s).padStart(4)} seen from the ${name}  ` + check(s >= min, `only ${pct(s)} of the tail mark is visible from the ${name} (wants ${pct(min)})`));
}

// On the panel, clear of every lamp, and nothing of it on the lid.
const tb = boxOf(tail);
let across = 0;
au.traverse((o) => {
  if (!o.isMesh || !/^(lamp-housing|taillamp-)/.test(o.material?.name ?? "")) return;
  const b = boxOf(o);
  if (b.max.z > -1.5) return; // the tail's, not the headlamps'
  if (b.max.x > tb.min.x && b.min.x < tb.max.x && b.max.y > tb.min.y && b.min.y < tb.max.y) across++;
});
console.log(`  ${across} lamp parts across it, ${mm(tb.max.x - tb.min.x)} wide  ` + check(across === 0, "a tail lamp stands across the tail mark"));
let panelZ = null;
au.traverse((o) => { if (o.isMesh && o.userData.tailPanel) panelZ = boxOf(o).min.z; });
console.log(`  ${panelZ === null ? "no panel" : mm(panelZ - tb.min.z)} off the black panel  ` +
  check(panelZ !== null && panelZ - tb.min.z > 0.003 && panelZ - tb.min.z < 0.02, "the tail mark is not stuck to the tail panel"));
let lidMarks = 0;
au.traverse((o) => { if (o.isMesh && o.userData.decal === "demon-deck") lidMarks++; });
console.log(`  ${lidMarks} marks left on the lid  ` + check(lidMarks === 0, "the Demon still has a mark on its boot lid, under the wing"));

// --- 3. The bonnet, as it was.
const hv = share(solids, hood);
console.log(`\nhood      ${pct(hv)} of the artwork is clear  ` + check(hv >= 0.9, `${pct(1 - hv)} of the hood mark is covered`));

// --- 4. The fallback: no loft, the extrusion. Smaller and less visible
// there, and still present, on the skin and clear of the belt.
{
  const g = settle(extruded());
  const f = marksOf(g, "demon-flank");
  console.log(`extruded  ${f.length} flank marks on the fallback body  ` + check(f.length === 2, "the extruded body carries no flank marks"));
}

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe Demon's marks are on the car the game draws");
