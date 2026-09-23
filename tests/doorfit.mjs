// The door furniture sits on the door.
//
//   npm run test:doorfit         (no browser, no dev server)
//
// A car in this game has no door. The body is one extruded shell with no
// opening cut in it — cars.ts says so itself, in three places — so a
// door is implied entirely by what is hung on the flank: two vertical
// panel gaps, a handle, a character crease, a chrome belt strip, a sill,
// and a B-pillar dividing the side glass. Get those wrong and the car
// has no door at all.
//
// They were wrong in two ways, and nothing in the repo measured either.
//
// WHERE THEY SIT. Every one was pinned to `flankX` — the body's WIDEST
// half-width, read off its bounding box — and then placed at a height
// and a station where the body is not that wide. A shell tumbles home
// above the shoulder, tucks under it, and tapers in plan over both
// overhangs, so the widest point is one line around the middle of the
// car and nothing else is on it. Measured on the built fleet before
// this: shutlines 55 to 258 mm outside the paint, handles 61 to 231 mm.
// On the saloon the flank at the shutline's own height is at 0.781 and
// the shutline was at 0.933 — a door gap floating 152 mm off the door.
// The B-pillar was worse in a different way: the last anchor on the
// flank still carrying an absolute x, so it sat 63 mm INSIDE the zx's
// glass and 54 mm off the suv's.
//
// HOW MANY THERE ARE. Two gaps and TWO HANDLES went on every side of
// every car — on the coupes, on the three-door hatch, and on the
// half-tonne single cab, whose second door line landed out in the load
// bed. Seven of the nine silhouettes wore a rear door they do not have.
// cars.ts names the real count itself: "four doors' worth of flank" for
// the saloon, "Half-tonne single cab", "the shape a fast three-door has
// had for fifty years", "R34-style coupe", "the American pony coupe".
//
// Measured in the car's OWN frame. The details are added straight to the
// group and the geometry the rays hit is that group's, so both live in
// the same space — and the group carries a width fix, so mixing world
// and local reads that scale as hundreds of millimetres of drift. The
// first run of this test did exactly that.
import * as THREE from "three";
import "./lib/dom-stub.mjs";
import { createCar } from "../src/game/cars.ts";

/** Which silhouettes have a rear side door, from cars.ts's own prose. */
const FOUR_DOOR = new Set(["sedan", "suv"]);
const STYLES = ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"];

/** How far a detail may stand off the skin it belongs to.
 *
 *  A panel gap is a dark slot IN a surface, so it wants to be flush; a
 *  handle and a pillar stand proud by their own thickness, which is what
 *  a handle and a pillar do. The point of the test is not the exact
 *  standoff, it is that the detail is ON the car: everything here was
 *  two orders of magnitude out. */
const LIMITS = {
  shutline: [0, 6],
  handle: [8, 45],
  pillar: [4, 40],
  crease: [4, 45],
  belt: [2, 30],
  skirt: [-30, 30],
};

const fail = [];
const ray = new THREE.Raycaster();
const dbl = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

console.log("How far each flank detail stands off the skin it belongs to, in mm.");
console.log("Negative is sunk into the paint; a shutline wants to be flush.\n");
console.log("style   | shutline | handle | pillar | crease | belt | skirt | doors");

for (const style of STYLES) {
  const car = createCar({ style, body: 0xffffff, accent: 0x222222, kit: "street" });
  car.updateMatrixWorld(true);
  let body = null, canopy = null;
  car.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.shell === "body") body = o;
    if (o.userData.shell === "canopy") canopy = o;
  });
  if (!body || !canopy) { fail.push(`${style}: no body or canopy shell`); continue; }
  const probe = (g) => { const m = new THREE.Mesh(g, dbl); m.updateMatrixWorld(true); return m; };
  const pBody = probe(body.geometry), pGlass = probe(canopy.geometry);
  /** The skin's half-width at a height and a station, from outside in. */
  const skin = (m, y, z) => {
    ray.set(new THREE.Vector3(6, y, z), new THREE.Vector3(-1, 0, 0));
    const h = ray.intersectObject(m, false)[0];
    return h ? h.point.x : null;
  };

  const found = {};
  for (const o of car.children) {
    const tag = o.userData?.flank;
    if (!tag || !o.isMesh) continue;
    if (o.position.x < 0.2) continue; // one side answers for both
    o.geometry.computeBoundingBox();
    const gb = o.geometry.boundingBox;
    (found[tag] ??= []).push({
      // The detail's outermost paint, and where it sits along the car.
      x: o.position.x + gb.max.x,
      y: o.position.y,
      z: o.position.z,
    });
  }

  const cell = (tag) => {
    const list = found[tag];
    if (!list?.length) return "  -- ";
    // The B-pillar divides the GLASS; everything else rides the body.
    const against = tag === "pillar" ? pGlass : pBody;
    let worst = null;
    for (const e of list) {
      const s = skin(against, e.y, e.z);
      if (s === null) {
        fail.push(`${style}: the ${tag} at z=${e.z.toFixed(2)} has no ${tag === "pillar" ? "glass" : "bodywork"} behind it at all`);
        continue;
      }
      const off = e.x - s;
      if (worst === null || Math.abs(off) > Math.abs(worst)) worst = off;
    }
    if (worst === null) return " miss";
    const [lo, hi] = LIMITS[tag] ?? [-50, 50];
    if (worst * 1000 < lo || worst * 1000 > hi) {
      fail.push(
        `${style}: the ${tag} stands ${(worst * 1000).toFixed(0)} mm off the ${tag === "pillar" ? "glass" : "paint"}` +
          ` — allowed ${lo} to ${hi}`
      );
    }
    return (worst * 1000).toFixed(0).padStart(5);
  };

  const cuts = found.shutline?.length ?? 0;
  const handles = found.handle?.length ?? 0;
  const wantCuts = FOUR_DOOR.has(style) ? 3 : 2;
  const wantHandles = FOUR_DOOR.has(style) ? 2 : 1;
  console.log(
    `${style.padEnd(7)} |   ${cell("shutline")}  | ${cell("handle")}  | ${cell("pillar")}  | ${cell("crease")}  |${cell("belt")} |${cell("skirt")}  | ${cuts} cuts, ${handles} handle${handles === 1 ? "" : "s"}`
  );
  if (cuts !== wantCuts)
    fail.push(`${style}: ${cuts} door cuts per side, expected ${wantCuts} — ${FOUR_DOOR.has(style) ? "this one has four doors" : "this one is a coupe, a three-door or a single cab"}`);
  if (handles !== wantHandles)
    fail.push(`${style}: ${handles} door handles per side, expected ${wantHandles} — a car has as many handles as it has doors`);
}

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const m of fail) console.log(`  - ${m}`);
  process.exit(1);
}
console.log("\nthe door furniture sits on the door, and there is one handle per door");
