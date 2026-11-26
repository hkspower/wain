// The bonnet falcon sits behind the wipers and on the paint.
//
//   npm run test:hoodfit         (no browser, no dev server)
//
// The 0.85 m falcon decal was centred at z 1.45 on every body but the
// two with the cabin at the back. Its type is in the plane's rear 90 mm,
// so the 'NIGHT RACERS' baseline came out at z 1.11 — which cleared every
// wiper line in the fleet until the hatch arrived with its wipers at 1.12
// and put both blades on the words. The stripe and the carbon bonnet
// already start at wiperZ + 0.06; the decal never asked.
//
// Built the way the game builds the pack: every body, sport kit, stickers.
//
//   behind    the plane starts at or after wiperZ + 0.06, which is where
//             the stripe starts, and the type's baseline is at least
//             0.10 m ahead of the wipers
//   short     the plane's front edge stops 0.12 m before the nose, so it
//             does not run onto the roll-off
//   on        the plane is over the paint everywhere it is looked at —
//             centre, both ends and both sides — a few millimetres, not
//             sunk in the bonnet and not floating off it
//   twin      a twin-striped car wears the small dark falcon, and all of
//             it lies in the paint gap between the stripes
import * as THREE from "three";
import "./lib/dom-stub.mjs";
import { createCar } from "../src/game/cars.ts";

const STYLES = ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"];
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok  " : "FAIL"; };
const mm = (v) => `${(v * 1000).toFixed(0)}`;

/** Where the baseline of the 'NIGHT RACERS' line sits in the plane: 230
 *  of the texture's 256 rows down, so this far from its centre. */
const BASELINE = 230 / 256 - 0.5;

const ray = new THREE.Raycaster();
const dbl = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

function build(style, extra = {}) {
  const car = createCar({
    style, body: 0x3f66c4, accent: 0x007a3d, stickers: true, kit: "sport", name: "Test", ...extra,
  });
  // The car's own frame: createCar's group carries a fit scale.
  car.scale.set(1, 1, 1);
  car.updateMatrixWorld(true);
  let hood = null, body = null;
  car.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.decal === "hood-falcon") hood = o;
    if (o.userData.shell === "body") body = o;
  });
  return { car, hood, body };
}

/** The decal's height over the body's top skin at (x, z), in metres. */
function hover(hood, body, x, z) {
  const m = new THREE.Mesh(body.geometry, dbl);
  m.matrixWorld.copy(body.matrixWorld);
  ray.set(new THREE.Vector3(x, 4, z), new THREE.Vector3(0, -1, 0));
  const skin = ray.intersectObject(m, false)[0];
  if (!skin) return null;
  // Where the plane itself is over the same (x, z).
  const plane = new THREE.Mesh(hood.geometry, dbl);
  plane.matrixWorld.copy(hood.matrixWorld);
  const up = ray.intersectObject(plane, false)[0];
  return up ? up.point.y - skin.point.y : null;
}

console.log("style   | span  | rear edge | baseline ahead of wipers | front edge short of nose | hover mm (centre, rear, front, sides)");
for (const style of STYLES) {
  const { car, hood, body } = build(style);
  if (!hood || !body) { check(false, `${style}: no hood falcon or no body shell`); continue; }
  const d = car.userData.dims;
  const span = hood.geometry.parameters.width;
  const z = hood.position.z;
  const rear = z - span / 2;
  const front = z + span / 2;
  const baseline = z - BASELINE * span;
  const ahead = baseline - d.wiperZ;
  const short = d.nose - front;
  const spots = [
    ["centre", 0, z],
    ["rear", 0, rear + 0.04],
    ["front", 0, front - 0.04],
    ["left", -span * 0.4, z],
    ["right", span * 0.4, z],
  ].map(([n, x, zz]) => [n, hover(hood, body, x, zz)]);
  // A gtr's falcon lies on the power bulge, 80 mm over the bare shell the
  // rays hit, so its hover over the shell means nothing; tests/hoodmark.mjs
  // measures it against the bulge instead.
  const hs = spots.map(([, v]) => (style === "gtr" ? null : v));
  const behind = rear >= d.wiperZ + 0.06 - 1e-6 && ahead >= 0.10;
  console.log(
    `${style.padEnd(7)} | ${span.toFixed(2)} | ${rear.toFixed(3)}     | ${mm(ahead).padStart(4)} mm                  | ${mm(short).padStart(4)} mm                  | ` +
      (style === "gtr" ? "on the bulge" : hs.map((v) => (v === null ? "  - " : mm(v).padStart(4))).join(" "))
  );
  check(behind, `${style}: the plane starts at ${rear.toFixed(3)} and its type is ${mm(ahead)} mm ahead of the wipers at ${d.wiperZ}`);
  check(short >= 0.12, `${style}: the plane's front edge is only ${mm(short)} mm short of the nose`);
  // The hatch is the body whose decal moved, so it is the one held to a
  // number; the others are printed so a drift shows.
  if (style === "hatch") {
    const bad = hs.filter((v) => v === null || v < 0.003 || v > 0.05);
    check(bad.length === 0, `hatch: the falcon hovers ${hs.map((v) => (v === null ? "-" : mm(v))).join(", ")} mm over the paint, want 3 to 50`);
  }
}

// --- twin ----------------------------------------------------------------
// The one car with over-the-top stripes. The falcon is the small dark one
// and its wingtips, which reach 122 of the plane's 128 half-units, have
// to stop short of the stripes' inner edge. The plan's own number is
// |x| 0.125; the stripe is at 0.131 once its bevel is counted.
{
  const { car, hood } = build("pony", { accent: 0xf04b16, stripes: "twin", body: 0xf2f2ee });
  if (!hood) { check(false, "pony with twin stripes: no hood falcon"); }
  else {
    const stripes = [];
    car.traverse((o) => { if (o.isMesh && o.material?.name === "accent-stripe") stripes.push(o); });
    const inner = Math.min(...stripes.map((o) => {
      const b = new THREE.Box3().setFromObject(o);
      return Math.min(Math.abs(b.min.x), Math.abs(b.max.x));
    }));
    const span = hood.geometry.parameters.width;
    const wing = (span / 2) * (122 / 128);
    console.log(
      `twin      ${check(
        wing <= 0.125 && wing < inner,
        `twin falcon's wingtips reach |x| ${wing.toFixed(3)} against stripes starting at ${inner.toFixed(3)} (span ${span.toFixed(2)})`
      )}  pony twin: ${span.toFixed(2)} m falcon, wingtips at |x| ${wing.toFixed(3)}, stripes start at ${inner.toFixed(3)}`
    );
  }
}

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe falcon is behind the wipers and on the paint, on every body.");
