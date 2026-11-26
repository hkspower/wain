// The racing stripes are paint on the car, not planks across it.
//
//   npm run test:stripes         (no browser, no dev server)
//
// The bonnet and boot bar was four 12 mm plates, each pitched on its own
// chord, and the twin stripes on the Anniversary were twenty-six a side.
// Every plate caught the light at its own angle, so the green stepped by
// 10-13% at each join; every plate end was a rounded groove, a dark line
// 24-36% down the bar; and the bar stood 20 mm off the paint. Each run is
// one ribbon now, with its vertices on the surface.
//
// Asked the way a camera above the car would ask: a ray straight down at
// stations along each stripe, at its centre and 0.03 m in from each edge,
// against the car as built (front faces only, as it renders). What it
// meets first has to be the stripe, and the stripe has to stand a few
// millimetres over whatever the next thing down is.
//
//   up        the ray meets the stripe, not the paint under it: a ribbon
//             wound the wrong way is culled from above and vanishes
//   on        it stands 3 to 15 mm over the surface under it, at the
//             centre and at both edges, so it neither sinks into the
//             crown nor floats off it
//   whole     one mesh per run: a bar that is two meshes has a joint
//   smooth    the stripe's own height changes by no more than the
//             surface does from one station to the next (a step in the
//             car, like the cowl, may be climbed over a few centimetres)
//   glass     (twin stripes) every 5 cm along the run, against the three
//             shells alone: the stripe is over the highest of bonnet, glass
//             and roof, no more than 15 mm over it on the screen, and no
//             more than 50 mm over the roof itself, where it rides the
//             sunroof's pane. The pane hangs past the roof's
//             front edge over the windscreen on the pony, and a stripe
//             carried along it stood 0.15-0.25 m off the screen while every
//             other check here called the pane its surface.
//
// Every body, in two kits, with the pack and without it, and the one car
// with twin stripes.
import * as THREE from "three";
import "./lib/dom-stub.mjs";
import { createCar } from "../src/game/cars.ts";

const STYLES = ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"];
const fail = [];
const mm = (v) => `${(v * 1000).toFixed(0)} mm`;
const ray = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

/** The most meshes a run may be, by body. A gtr with the rally pack cuts
 *  its bonnet bar at the power bulge's two ends, on purpose: stub, slab,
 *  stub. */
const RUNS = { sedan: 2, gtr: 4, twin: 2 };

/** The gtr's power bulge is the one slab on the car 1.0 m long and 0.78 wide. */
const isBulge = (o) => {
  o.geometry.computeBoundingBox();
  const size = o.geometry.boundingBox.getSize(new THREE.Vector3());
  return Math.abs(size.x - 0.778) < 0.004 && Math.abs(size.z - 1.0) < 0.002 && size.y > 0.1 && size.y < 0.13;
};

function measure(label, opts, expectMeshes) {
  const car = createCar({ body: 0x3f66c4, accent: 0x007a3d, name: "Test", ...opts });
  car.scale.set(1, 1, 1);
  car.updateMatrixWorld(true);
  const stripes = [];
  const under = [];
  car.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material?.name === "accent-stripe") stripes.push(o);
    // What the stripe lies on. The bonnet and boot bar is draped on the
    // body shell and the gtr's power bulge; it runs on under the glass of
    // the windscreen or the rear window for a few centimetres where the
    // run is longer than the paint, by design and as it always did, so the
    // canopy is not its surface. The twin stripes go over the top and lie
    // on whichever of the three shells is highest, and on the sunroof's
    // glass. Not what stands on the paint — wipers, a ducktail, the third
    // brake light's bar, a wing: a stripe passes under those by design.
    else if (o.userData.shell === "body" || isBulge(o)) under.push(o);
    else if (opts.stripes === "twin" && (o.userData.shell || o.userData.seeThrough)) under.push(o);
  });
  if (!stripes.length) { fail.push(`${label}: no accent stripe on the car`); return; }

  const problems = [];
  if (stripes.length !== expectMeshes) problems.push(`${stripes.length} meshes, want ${expectMeshes} (one a run)`);

  let worstLo = Infinity, worstHi = -Infinity, misses = 0, n = 0;
  for (const s of stripes) {
    const b = new THREE.Box3().setFromObject(s);
    const xs = [b.min.x + 0.03, (b.min.x + b.max.x) / 2, b.max.x - 0.03];
    // Stations clear of the ribbon's two ends, where the bevel of whatever
    // it meets rolls away.
    for (let k = 1; k <= 5; k++) {
      const z = b.min.z + ((b.max.z - b.min.z) * (k - 0.5)) / 5;
      for (const x of xs) {
        ray.set(new THREE.Vector3(x, 4, z), DOWN);
        const hits = ray.intersectObjects([s, ...under], false);
        n++;
        // The sunroof's pane hangs over the windscreen past the roof's edge
        // and the stripe goes under it there, as it must: it is on the
        // screen, and the glass is over it. That is the stripe seen through
        // the pane, not paint in front of it.
        const glassed = opts.stripes === "twin" && hits[0]?.object.userData.seeThrough && hits[1]?.object === s;
        const mine = glassed ? hits[1] : hits[0];
        if (mine?.object !== s) { misses++; continue; }
        const next = hits.find((h) => h !== mine && h.object !== s && h.distance > mine.distance);
        if (!next) continue;
        const lift = mine.point.y - next.point.y;
        worstLo = Math.min(worstLo, lift);
        worstHi = Math.max(worstHi, lift);
      }
    }
    // Smooth: no two neighbouring vertices of a centreline further apart
    // in height than the slope the ribbon is allowed to climb, and stations
    // close enough that a stripe is not a polyline.
    const pa = s.geometry.getAttribute("position");
    let maxGap = 0;
    for (let i = 2; i < pa.count; i += 2) {
      maxGap = Math.max(maxGap, Math.abs(pa.getZ(i) - pa.getZ(i - 2)));
      if (Math.abs(pa.getY(i) - pa.getY(i - 2)) > Math.tan(1.2) * Math.abs(pa.getZ(i) - pa.getZ(i - 2)) + 1e-6) {
        problems.push(`a ${mm(Math.abs(pa.getY(i) - pa.getY(i - 2)))} step in ${mm(Math.abs(pa.getZ(i) - pa.getZ(i - 2)))} of run`);
        break;
      }
    }
    if (maxGap > 0.06) problems.push(`vertices ${mm(maxGap)} apart`);
  }
  if (opts.stripes === "twin") {
    // Against the shells alone. The pane is not a surface the stripe lies
    // on past the roof's front edge, where it hangs over the screen.
    const skins = under.filter((o) => o.userData.shell);
    const roof = under.find((o) => o.userData.shell === "roof");
    const canopy = under.find((o) => o.userData.shell === "canopy");
    const roofFront = new THREE.Box3().setFromObject(roof).max.z;
    // The screen's foot, where it meets the bonnet: a step, which the
    // stripe climbs over a few centimetres.
    const cowl = new THREE.Box3().setFromObject(canopy).max.z;
    let stations = 0, lo = Infinity, loAt = 0, hiScreen = -Infinity, hiRoof = -Infinity, atScreen = 0, atRoof = 0;
    for (const s of stripes) {
      const b = new THREE.Box3().setFromObject(s);
      for (let z = b.min.z + 0.05; z < b.max.z - 0.05; z += 0.05) {
        for (const x of [b.min.x + 0.03, (b.min.x + b.max.x) / 2, b.max.x - 0.03]) {
          ray.set(new THREE.Vector3(x, 4, z), DOWN);
          const own = ray.intersectObject(s, false)[0];
          if (!own) continue;
          const skin = ray.intersectObjects(skins, false);
          if (!skin.length) continue;
          const over = own.point.y - Math.max(...skin.map((h) => h.point.y));
          stations++;
          if (over < lo) { lo = over; loAt = z; }
          // Over the roof the stripe may ride the pane, which stands up to
          // 17 mm off the skin and more where the roof falls away under
          // its flat. Ahead of the roof, and 0.1 m past its edge (the
          // step down off the pane) to 0.1 m short of the cowl, it is on
          // the screen.
          if (z > roofFront + 0.1 && z < cowl - 0.1) { if (over > hiScreen) { hiScreen = over; atScreen = z; } }
          else if (z <= roofFront + 0.1 && over > hiRoof) { hiRoof = over; atRoof = z; }
        }
      }
    }
    console.log(
      `    follows the glass: ${stations} stations, ${mm(lo)} over the skin at the least; ` +
      `${mm(hiScreen)} at the most on the screen, ${mm(hiRoof)} over the roof and behind it`
    );
    // The ribbon is sampled down the centreline, and the crown and the
    // hand-over between shells differ by a few millimetres across it.
    if (lo < 0.001) problems.push(`glass: stands only ${mm(lo)} off the skin at z ${loAt.toFixed(2)}`);
    if (hiScreen > 0.015) problems.push(`glass: floats ${mm(hiScreen)} off the screen or bonnet at z ${atScreen.toFixed(2)}`);
    if (hiRoof > 0.05) problems.push(`glass: floats ${mm(hiRoof)} off the roof at z ${atRoof.toFixed(2)}`);
  }
  if (misses) problems.push(`${misses} of ${n} rays met paint before the stripe: it is under the surface or faces down`);
  if (worstLo < 0.003) problems.push(`stands only ${mm(worstLo)} off the surface somewhere`);
  if (worstHi > 0.015) problems.push(`floats ${mm(worstHi)} off the surface somewhere`);
  console.log(
    `  ${label.padEnd(18)} ${problems.length ? "FAIL" : "ok  "}  ${stripes.length} mesh${stripes.length > 1 ? "es" : ""}, ` +
      `${Number.isFinite(worstLo) ? `${mm(worstLo)} to ${mm(worstHi)} over the surface` : "no stations"}` +
      (problems.length ? `  ${problems.join("; ")}` : "")
  );
  for (const p of problems) fail.push(`${label}: ${p}`);
}

for (const kit of ["street", "attack"]) {
  console.log(kit);
  for (const style of STYLES) {
    const want = style === "sedan" ? RUNS.sedan : style === "gtr" ? RUNS.gtr : 1;
    measure(style, { style, kit, raceKit: kit === "attack" }, want);
  }
}
console.log("twin stripes");
measure("pony (twin)", { style: "pony", kit: "sport", stripes: "twin", accent: 0xf04b16, body: 0xf2f2ee }, RUNS.twin);

// The Black Demon wears the bar like any gtr: its bonnet run and its boot
// run. Its mark was on the lid for a while and the boot run was left off to
// keep it off the green; the mark is on the tail now, so the run is back.
{
  console.log("the Black Demon");
  const car = createCar({ body: 0x0b0a0d, accent: 0x007a3d, style: "gtr", kit: "attack", raceKit: true, livery: "demon" });
  car.scale.set(1, 1, 1);
  car.updateMatrixWorld(true);
  const boxes = [];
  car.traverse((o) => { if (o.isMesh && o.material?.name === "accent-stripe") boxes.push(new THREE.Box3().setFromObject(o)); });
  const boot = boxes.filter((b) => b.max.z < 0);
  const bonnet = boxes.filter((b) => b.min.z > 0);
  console.log(`  ${boot.length === 1 && bonnet.length >= 1 ? "ok  " : "FAIL"}  ${boxes.length} stripe meshes, ${boot.length} on the boot, ${bonnet.length} on the bonnet`);
  if (boot.length !== 1) fail.push(`the Black Demon has ${boot.length} boot stripes, not the one run every gtr wears`);
  if (!bonnet.length) fail.push("the Black Demon lost its bonnet bar");
}

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe stripes are one ribbon a run, on the surface, facing up.");
