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
// TWICE, because there are two bodies. createCar builds the extrusion; the
// game wears the authored loft (public/models/car-<style>.glb), which
// models.ts swaps in a moment later and then calls refitShell / refitCabin
// for. The loft's bonnet is 3-5 mm above the extrusion's on the zx, and a
// stripe laid once at +6 mm on the one stood 1 mm over the other (18 of 123
// stations on the zx, and 2-3 mm on the sedan, rx7, pony and super), which
// no number taken from the extrusion could show. So every car below is
// measured as createCar leaves it AND with the loft put on it the way the
// game puts it on (tests/lib/loft.mjs), and the same numbers are asked of
// both.
//
//   up        the ray meets the stripe, not the paint under it: a ribbon
//             wound the wrong way is culled from above and vanishes
//   on        it stands 3 to 8 mm over the surface under it, at the centre
//             and at both edges, so it neither sinks into the crown nor
//             floats off it; the five stations a run always had, and one
//             every 5 cm besides
//   whole     one mesh per run: a bar that is two meshes has a joint
//   smooth    the stripe's own height changes by no more than the
//             surface does from one station to the next (a step in the
//             car, like the cowl, may be climbed over a few centimetres)
//   glass     (twin stripes) every 5 cm along the run, three across, by
//             what the stripe is on: the sunroof's pane, the screen, the
//             bonnet and the roof's own skin are each 3 to 8 mm under it.
//             The pane stands 11 mm over the roof (SUNROOF_STAND; it was
//             worked out as 17, and the stripe rode 12 mm over the glass),
//             and the pony's hangs past the roof's front edge over the
//             windscreen, where the stripe is on the screen under it. Where
//             it hands over from one shell to the next (both ends of the
//             pane, the roof's two edges, the cowl) it may not sink, and may
//             stand as high as the step it is climbing or falling.
//
//   carbon    over a carbon panel the stripe is on the panel, 3 to 8 mm over
//             it, not level with it or under it
//
// Every body, in two kits, with the pack and without it, and the one car
// with twin stripes; and every body again in full dry carbon.
import * as THREE from "three";
import "./lib/dom-stub.mjs";
import { createCar } from "../src/game/cars.ts";
import { wearLoft } from "./lib/loft.mjs";

const STYLES = ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"];
const fail = [];
const mm = (v) => `${(v * 1000).toFixed(1)} mm`;
const ray = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

/** The most meshes a run may be, by body. A gtr with the rally pack cuts
 *  its bonnet bar at the power bulge's two ends, on purpose: stub, slab,
 *  stub. */
const RUNS = { sedan: 2, gtr: 4, twin: 2 };

/** How far over the surface a stripe may stand: paint, a few millimetres. */
const LO = 0.003, HI = 0.008;

/** The gtr's power bulge is the one slab on the car 1.0 m long and 0.78 wide. */
const isBulge = (o) => {
  o.geometry.computeBoundingBox();
  const size = o.geometry.boundingBox.getSize(new THREE.Vector3());
  return Math.abs(size.x - 0.778) < 0.004 && Math.abs(size.z - 1.0) < 0.002 && size.y > 0.1 && size.y < 0.13;
};

// ------------------------------------------------------------ the loft
// The game does not wear the extrusion createCar builds: models.ts swaps in
// the authored loft (public/models/car-<style>.glb) a moment later and
// calls refitShell / refitCabin, and the loft's bonnet is 3-5 mm above the
// extrusion's on the zx and differs elsewhere. A stripe laid at +6 mm on the
// one stood 1 mm over the other, which no check against the extrusion could
// see. So every car below is measured twice: as createCar leaves it, and
// as the game has it once the swap is done, slot for slot, as models.ts's
// settle() does it (crown the loft, refuse it if shellFit would, put it on
// the car, refit).
/** Build a car and, when asked, put the loft on it the way models.ts does.
 *  Returns the car and what each slot ended up wearing. */
async function build(opts, wear) {
  const car = createCar({ body: 0x3f66c4, accent: 0x007a3d, name: "Test", ...opts });
  const worn = wear === "loft" ? await wearLoft(car, opts.style) : {};
  car.scale.set(1, 1, 1);
  car.updateMatrixWorld(true);
  return { car, worn };
}

let loftMeasured = 0;
async function measure(label, opts, expectMeshes, wear = "extruded") {
  const { car, worn } = await build(opts, wear);
  if (wear === "loft") {
    if (worn.body !== "loft") {
      // The game would not wear it either: what it draws is the extrusion,
      // which the other pass has measured.
      console.log(`  ${label.padEnd(18)} skip  the loft is not worn (${worn.body})`);
      return;
    }
    loftMeasured++;
  }
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
    // The carbon panels the stripe crosses are what it lies on there: the
    // player sees the panel and not the paint under it.
    else if (o.userData.shell === "body" || isBulge(o) || o.userData.trim === "carbon") under.push(o);
    else if (opts.stripes === "twin" && (o.userData.shell || o.userData.seeThrough)) under.push(o);
  });
  if (!stripes.length) { fail.push(`${label}: no accent stripe on the car`); return; }

  // Where a carbon panel starts and stops along z (the mirror caps are not
  // under a stripe). A stripe is longer than its panel and steps down off it,
  // a few millimetres, over one 5 cm stride of the ribbon: those strides are
  // hand-overs, like the cowl, and are asked not to sink, not to be 3-8 mm.
  const panelEnds = under
    .filter((o) => o.userData.trim === "carbon")
    .map((o) => new THREE.Box3().setFromObject(o))
    .filter((b) => b.max.x - b.min.x > 0.5)
    .flatMap((b) => [b.min.z, b.max.z]);
  const atPanelEnd = (z) => panelEnds.some((e) => Math.abs(z - e) < 0.06);

  const problems = [];
  if (stripes.length !== expectMeshes) problems.push(`${stripes.length} meshes, want ${expectMeshes} (one a run)`);

  let worstLo = Infinity, worstHi = -Infinity, misses = 0, n = 0;
  for (const s of stripes) {
    const b = new THREE.Box3().setFromObject(s);
    const xs = [b.min.x + 0.03, (b.min.x + b.max.x) / 2, b.max.x - 0.03];
    // Stations clear of the ribbon's two ends, where the bevel of whatever
    // it meets rolls away: five spread along the run, as it always was, and
    // one every 5 cm besides (a bar; see below for the twin stripes). Five
    // stations missed a stripe that was 1 mm over the loft at three places
    // in a run of a hundred and twenty.
    const zs = [];
    for (let k = 1; k <= 5; k++) zs.push(b.min.z + ((b.max.z - b.min.z) * (k - 0.5)) / 5);
    // The twin stripes go over three shells and a pane, and the block below
    // asks every 5 cm of them station by station, by what the stripe is on.
    if (opts.stripes !== "twin") for (let z = b.min.z + 0.05; z < b.max.z - 0.05; z += 0.05) zs.push(z);
    for (const z of zs) {
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
        if (atPanelEnd(z)) continue;
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
    // What a camera above the car sees under the stripe, every 5 cm along
    // the run: the highest of the three shells and the sunroof's pane.
    const skins = under.filter((o) => o.userData.shell || o.userData.trim === "carbon");
    const panes = under.filter((o) => o.userData.seeThrough && !o.userData.shell);
    const roof = under.find((o) => o.userData.shell === "roof");
    const canopy = under.find((o) => o.userData.shell === "canopy");
    const roofBox = new THREE.Box3().setFromObject(roof);
    const roofFront = roofBox.max.z;
    const paneBoxes = panes.map((pn) => new THREE.Box3().setFromObject(pn));
    const near = (z, a, b, m = 0.1) => z > a - m && z < b + m;
    // The screen's foot, where it meets the bonnet: a step, which the
    // stripe climbs over a few centimetres.
    const cowl = new THREE.Box3().setFromObject(canopy).max.z;
    // pane    the stripe rides the sunroof's glass
    // screen  ahead of the roof and 0.1 m past its edge (the step down off
    //         the pane) to 0.1 m short of the cowl, it is on the screen
    // bonnet  0.1 m clear of the cowl, forward
    // roof    the rest: the roof's skin round the pane, and the hand-over
    const cls = {};
    const note = (c, over, z) => {
      const r = (cls[c] ??= { n: 0, lo: Infinity, loAt: 0, hi: -Infinity, hiAt: 0 });
      r.n++;
      if (over < r.lo) { r.lo = over; r.loAt = z; }
      if (over > r.hi) { r.hi = over; r.hiAt = z; }
    };
    for (const sMesh of stripes) {
      const b = new THREE.Box3().setFromObject(sMesh);
      for (let z = b.min.z + 0.05; z < b.max.z - 0.05; z += 0.05) {
        for (const x of [b.min.x + 0.03, (b.min.x + b.max.x) / 2, b.max.x - 0.03]) {
          ray.set(new THREE.Vector3(x, 4, z), DOWN);
          const own = ray.intersectObject(sMesh, false)[0];
          if (!own) continue;
          const skin = ray.intersectObjects(skins, false);
          if (!skin.length) continue;
          const skinTop = Math.max(...skin.map((h) => h.point.y));
          const glass = ray.intersectObjects(panes, false)[0];
          // The pane is the surface only where the stripe is over it. Where
          // the pane hangs over the stripe (the pony's, past the roof's
          // front edge) the stripe is on the screen under it.
          const onPane = glass && glass.point.y < own.point.y && glass.point.y > skinTop - 0.002;
          const over = own.point.y - (onPane ? glass.point.y : skinTop);
          // The steps between one shell and the next, where the stripe
          // climbs or falls at the slope it is held to: both ends of the
          // pane (it is held a station past each, and the average takes
          // another to come down), the roof's front and back edges, the cowl.
          const hand =
            atPanelEnd(z) ||
            paneBoxes.some((pb) => near(z, pb.min.z, pb.max.z, 0.15)) ||
            near(z, roofBox.min.z, roofBox.min.z) || near(z, roofFront, roofFront) || near(z, cowl, cowl);
          const c = onPane ? "pane"
            : hand ? "handover"
            : z > cowl ? "bonnet"
            : z > roofFront ? "screen"
            : z >= roofBox.min.z ? "roof" : "rear";
          note(c, over, z);
        }
      }
    }
    const f1 = (v) => `${(v * 1000).toFixed(1)}`;
    console.log(
      "    follows the glass, mm over what is under it: " +
      Object.entries(cls).map(([c, r]) => `${c} ${f1(r.lo)}@${r.loAt.toFixed(2)}..${f1(r.hi)}@${r.hiAt.toFixed(2)} (${r.n})`).join(", ")
    );
    // Where it lies on paint or glass it is paint on it: 3-8 mm. Between
    // shells it may not sink (the ribbon is sampled down the centreline, and
    // the crown differs a little across it) or leave the glass by more than
    // the old ceilings, which were all that was asked of it there.
    const want = { pane: [LO, HI], screen: [LO, HI], bonnet: [LO, HI], roof: [LO, HI], rear: [0.001, 0.015], handover: [0.001, 0.05] };
    for (const [c, [lo, hi]] of Object.entries(want)) {
      const r = cls[c];
      if (!r) continue;
      if (r.lo < lo) problems.push(`glass: stands only ${mm(r.lo)} off the ${c} at z ${r.loAt.toFixed(2)}`);
      if (r.hi > hi) problems.push(`glass: floats ${mm(r.hi)} off the ${c} at z ${r.hiAt.toFixed(2)}`);
    }
    if (!cls.pane && wear === "loft") problems.push("glass: never met the sunroof's pane, so the pane was not measured");
  }
  if (misses) problems.push(`${misses} of ${n} rays met paint before the stripe: it is under the surface or faces down`);
  if (worstLo < LO) problems.push(`stands only ${mm(worstLo)} off the surface somewhere`);
  if (worstHi > HI) problems.push(`floats ${mm(worstHi)} off the surface somewhere`);
  console.log(
    `  ${label.padEnd(18)} ${problems.length ? "FAIL" : "ok  "}  ${stripes.length} mesh${stripes.length > 1 ? "es" : ""}, ` +
      `${Number.isFinite(worstLo) ? `${mm(worstLo)} to ${mm(worstHi)} over the surface` : "no stations"}` +
      (problems.length ? `  ${problems.join("; ")}` : "")
  );
  for (const p of problems) fail.push(`${label}: ${p}`);
}

for (const wear of ["extruded", "loft"]) {
  console.log(`\n=== ${wear === "loft" ? "worn as the game wears it: the authored loft swapped in, refitted" : "as createCar builds it: the extrusion"}`);
  for (const kit of ["street", "attack"]) {
    console.log(kit);
    for (const style of STYLES) {
      const want = style === "sedan" ? RUNS.sedan : style === "gtr" ? RUNS.gtr : 1;
      await measure(style, { style, kit, raceKit: kit === "attack" }, want, wear);
    }
  }
  console.log("twin stripes");
  await measure("pony (twin)", { style: "pony", kit: "sport", stripes: "twin", accent: 0xf04b16, body: 0xf2f2ee }, RUNS.twin, wear);
  // Over carbon the stripe is on the panel, which is what shows: a panel is
  // laid 5-6 mm over the skin, and a stripe laid on the skin beside it was
  // level with it, or under it by up to 2 mm, and hidden (carbon panels drew
  // nothing from above until their winding was turned round, so nothing had
  // ever asked). Full dry carbon: the bonnet, the boot where there is one,
  // and the roof.
  console.log("over carbon (full dry carbon)");
  for (const style of STYLES) {
    const want = style === "sedan" ? RUNS.sedan : style === "gtr" ? RUNS.gtr : 1;
    await measure(`${style} + carbon`, { style, kit: "attack", raceKit: true, carbon: "full" }, want, wear);
  }
  await measure("pony (twin) + carbon", { style: "pony", kit: "sport", stripes: "twin", accent: 0xf04b16, body: 0xf2f2ee, carbon: "full" }, RUNS.twin, wear);
}

// The Black Demon wears the bar like any gtr: its bonnet run and its boot
// run. Its mark was on the lid for a while and the boot run was left off to
// keep it off the green; the mark is on the tail now, so the run is back.
for (const wear of ["extruded", "loft"]) {
  console.log(`the Black Demon, on the ${wear === "loft" ? "loft" : "extrusion"}`);
  const car = createCar({ body: 0x0b0a0d, accent: 0x007a3d, style: "gtr", kit: "attack", raceKit: true, livery: "demon" });
  // Refitted, the stripes are laid again: the old ones must have gone.
  if (wear === "loft") await wearLoft(car, "gtr");
  car.scale.set(1, 1, 1);
  car.updateMatrixWorld(true);
  const boxes = [];
  car.traverse((o) => { if (o.isMesh && o.material?.name === "accent-stripe") boxes.push(new THREE.Box3().setFromObject(o)); });
  const boot = boxes.filter((b) => b.max.z < 0);
  const bonnet = boxes.filter((b) => b.min.z > 0);
  console.log(`  ${boot.length === 1 && bonnet.length >= 1 ? "ok  " : "FAIL"}  ${boxes.length} stripe meshes, ${boot.length} on the boot, ${bonnet.length} on the bonnet`);
  if (boot.length !== 1) fail.push(`the Black Demon (${wear}) has ${boot.length} boot stripes, not the one run every gtr wears`);
  if (!bonnet.length) fail.push(`the Black Demon (${wear}) lost its bonnet bar`);
  if (boxes.length !== 2) fail.push(`the Black Demon (${wear}) wears ${boxes.length} stripe meshes, not its two runs`);
}

if (!loftMeasured) fail.push("no car wore the authored loft, so the pass that matters measured nothing");
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\nthe stripes are one ribbon a run, on the surface, facing up: on the extrusion and on the loft (${loftMeasured} cars).`);
