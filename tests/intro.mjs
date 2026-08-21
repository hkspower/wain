// The menu is a rolling loop, and the loop has no seam.
//
//   npm run dev
//   node tests/intro.mjs
//
// The menu used to be a turntable: one car, revolving on a disc of
// light. What it shows now is the game — two cars abreast on the
// corniche at ninety, lamps coming over the roof, road running out from
// under them — and it is a LOOP, not a clip: the cars stand still and
// the world scrolls past them, every prop recycled once it is behind the
// camera. Nothing fades in, nothing is created, and every period in the
// scene divides the twelve seconds it takes to come back around.
//
// So this asks the scene, because it cannot ask the picture — WebGL has
// thrown the drawing buffer away by the time a script can read it:
//
//   rolling    the world actually moves, at the speed it claims to
//   abreast    two cars, side by side in their own lanes, not one car
//              twice and not one behind the other
//   different  the machine alongside is the next legend's, not a copy
//   wheels     turning at the speed the road is going under them
//   seam       the last frame of the loop and the first are one frame
//              apart, not a jump — the check that catches a period that
//              does not divide the loop
//   recycled   a lamp only ever jumps forward, and only behind the
//              camera where nobody can see it happen
//   still      prefers-reduced-motion gets one frame and silence
//   showroom   the turntable is still there for the capture tool, which
//              needs fifteen cars held at the same angle
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const open = async (extra = {}) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(90000);
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
  await page.evaluate((kv) => {
    localStorage.clear();
    localStorage.setItem("gulf-road-nights-onboarded", "2");
    localStorage.setItem("gulf-road-nights-coach", "3");
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, extra);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__grnAttract, null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  return page;
};

const page = await open();

// --- It rolls, and everything in it rolls at the same speed. --------
//
// Not measured against the clock. This suite runs on a software
// rasteriser at a frame or two a second, and the loop clamps its own dt
// so a stalled tab does not teleport the road — so wall time here would
// measure the test box. What has to be true is frame-rate independent:
// the lamps, the lane markings and the tyres all move by the SAME
// distance, and the distance the loop covers in the time it says it
// takes is the speed it claims.
const state = () =>
  page.evaluate(() => {
    const a = window.__grnAttract;
    a.scene.updateMatrixWorld(true);
    const lamps = [];
    let road = 0;
    a.scene.traverse((o) => {
      if (o.name === "lamp") lamps.push(o.position.z);
      if (o.name === "road") road = o.material.map.offset.y;
    });
    const car = a.cars[0];
    const w = car.userData.wheels[0];
    // The tyre's radius, measured off the built wheel rather than taken
    // from the thing being tested: outermost bound of any part of the
    // wheel, times the silhouette's own scale.
    let maxY = 0;
    w.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      maxY = Math.max(maxY, Math.abs(o.position.y + b.max.y), Math.abs(o.position.y + b.min.y));
    });
    return {
      travelled: a.travelled,
      loop: a.loopSeconds,
      lamps,
      road,
      spin: w.rotation.x,
      wheelR: maxY * car.scale.y,
      tris: a.triangles,
    };
  });

const s0 = await state();
await page.waitForTimeout(1500);
const s1 = await state();
const SPAN = s0.loop * 25;
const wrap = (d, m) => ((d % m) + m) % m;
const rolled = wrap(s1.travelled - s0.travelled, SPAN);
console.log(
  `rolling   ${check(
    s0.loop > 0 && rolled > 0.5,
    s0.loop <= 0
      ? "the menu built a turntable — the intro is not rolling at all"
      : "the world did not move — the intro is a still with a road painted on it"
  )}  ${rolled.toFixed(1)} m of road, loop ${s0.loop} s, ${s1.tris} triangles`
);

// Lamp spacing, straight off the scene: the loop covers the whole span
// of them in loopSeconds, which is what fixes the speed.
const zs = [...new Set(s0.lamps.map((z) => +z.toFixed(2)))].sort((a, b) => a - b);
const spacing = zs.length > 2 ? zs[2] - zs[0] : 0;
const speed = SPAN / s0.loop;
console.log(
  `speed     ${check(
    Math.abs(speed - 25) < 0.01 && Math.abs(spacing * (s0.lamps.length / 2) - SPAN) < 1,
    `${s0.lamps.length} lamps ${spacing.toFixed(1)} m apart do not span the ${SPAN} m ` +
      `the loop covers in ${s0.loop} s`
  )}  ${(speed * 3.6).toFixed(0)} km/h — ${s0.lamps.length} lamps, ${spacing.toFixed(0)} m apart`
);

// Everything moves together, or the scene is sliding against itself.
const lampMoved = wrap(s0.lamps[0] - s1.lamps[0], SPAN);
const roadMoved = wrap((s1.road - s0.road) * 15, 15); // 15 m per dash tile
const treadMoved = (s1.spin - s0.spin) * s0.wheelR;
console.log(
  `together  ${check(
    Math.abs(lampMoved - rolled) < 0.5 &&
      Math.abs(wrap(roadMoved - rolled, 15)) < 0.5 &&
      Math.abs(treadMoved - rolled) < rolled * 0.12 + 0.2,
    Math.abs(lampMoved - rolled) >= 0.5
      ? `the lamps moved ${lampMoved.toFixed(2)} m while the road moved ${rolled.toFixed(2)}`
      : Math.abs(wrap(roadMoved - rolled, 15)) >= 0.5
        ? `the lane markings moved ${roadMoved.toFixed(2)} m while the road moved ${rolled.toFixed(2)}`
        : `the tyres laid down ${treadMoved.toFixed(2)} m of tread over ${rolled.toFixed(2)} m of ` +
          `road — they are spinning or dragging`
  )}  road ${rolled.toFixed(2)} m, lamps ${lampMoved.toFixed(2)} m, ` +
    `markings ${roadMoved.toFixed(2)} m, tread ${treadMoved.toFixed(2)} m on a ` +
    `${s0.wheelR.toFixed(2)} m tyre`
);

// --- Two cars, abreast. ----------------------------------------------
const pair = await page.evaluate(() => {
  const a = window.__grnAttract;
  a.scene.updateMatrixWorld(true);
  return (a.cars ?? []).map((c) => {
    // Each car hangs off its own holder, and the holder is what the loop
    // moves — so the holder IS the car's position on the road.
    const h = c.parent;
    let paint = null;
    c.traverse((o) => {
      if (!paint && o.isMesh && o.material?.isMeshPhysicalMaterial && o.material.clearcoat > 0.5) {
        paint = o.material.color.getHexString();
      }
    });
    return {
      x: +h.position.x.toFixed(3),
      z: +h.position.z.toFixed(3),
      paint,
      wheels: (c.userData.wheels ?? []).length,
    };
  });
});
const gap = pair.length === 2 ? Math.abs(pair[0].x - pair[1].x) : 0;
const stagger = pair.length === 2 ? Math.abs(pair[0].z - pair[1].z) : 99;
console.log(
  `abreast   ${check(
    pair.length === 2 && gap > 2.4 && gap < 5 && stagger < 1,
    pair.length !== 2
      ? `${pair.length} car(s) on the menu — the intro is meant to be two`
      : gap <= 2.4 || gap >= 5
        ? `the two cars are ${gap.toFixed(2)} m apart, which is not a lane`
        : `one car is ${stagger.toFixed(2)} m ahead of the other — they are not side by side`
  )}  ${pair.length} cars, ${gap.toFixed(2)} m apart, ${stagger.toFixed(2)} m of stagger`
);
console.log(
  `different ${check(
    pair.length === 2 && pair[0].paint && pair[1].paint && pair[0].paint !== pair[1].paint,
    pair[0]?.paint && pair[0].paint === pair[1]?.paint
      ? `both cars are painted #${pair[0].paint} — the machine alongside is a copy of yours`
      : "could not read the paint off both cars"
  )}  #${pair[0]?.paint} beside #${pair[1]?.paint}`
);

// --- The seam that is not there. -------------------------------------
//
// Park the loop either side of the wrap and compare. If every period in
// the scene divides the loop this is one frame of movement; if one of
// them does not, the picture jumps here and only here, which is the
// hardest kind of bug to see and the easiest kind to measure.
const sample = async (phase) =>
  page.evaluate((p) => {
    const a = window.__grnAttract;
    a.park(p);
    a.scene.updateMatrixWorld(true);
    const lamps = [];
    let road = null;
    a.scene.traverse((o) => {
      if (o.name === "lamp") lamps.push(+o.position.z.toFixed(4));
      if (o.name === "road") road = +o.material.map.offset.y.toFixed(5);
    });
    return {
      lamps,
      road,
      cars: a.cars.map((c) => ({
        x: +c.parent.position.x.toFixed(4),
        y: +c.parent.position.y.toFixed(4),
        roll: +c.parent.rotation.z.toFixed(5),
      })),
      cam: {
        x: +a.camera.position.x.toFixed(4),
        y: +a.camera.position.y.toFixed(4),
        z: +a.camera.position.z.toFixed(4),
      },
    };
  }, phase);

const DT = 0.01 * s0.loop; // the gap either side of the wrap, in seconds
const before = await sample(0.995);
const after = await sample(0.005);
const moved = [];
for (let i = 0; i < before.lamps.length; i++) {
  // A lamp that recycled across the wrap is expected to be a span apart.
  let d = Math.abs(after.lamps[i] - before.lamps[i]);
  if (d > SPAN / 2) d = Math.abs(d - SPAN);
  moved.push(d);
}
const lampJump = Math.max(...moved);
const carJump = Math.max(
  ...before.cars.map((c, i) =>
    Math.max(
      Math.abs(after.cars[i].x - c.x),
      Math.abs(after.cars[i].y - c.y),
      Math.abs(after.cars[i].roll - c.roll)
    )
  )
);
const camJump = Math.max(
  Math.abs(after.cam.x - before.cam.x),
  Math.abs(after.cam.y - before.cam.y),
  Math.abs(after.cam.z - before.cam.z)
);
// In metres of road, like the lamps, rather than in fractions of a tile
// — the two are then the same number and a threshold on one is a
// threshold on the other.
let roadJump = Math.abs(after.road - before.road);
if (roadJump > 0.5) roadJump = Math.abs(roadJump - 1);
roadJump *= 15;
// 2% of the loop at 25 m/s is 6 m of road; everything else in the scene
// moves in centimetres over that time.
console.log(
  `seam      ${check(
    lampJump < 25 * DT * 2 + 0.05 &&
      carJump < 0.05 &&
      camJump < 0.1 &&
      roadJump < 25 * DT * 2 + 0.05,
    lampJump >= 25 * DT * 2 + 0.05
      ? `a lamp is ${lampJump.toFixed(2)} m out across the wrap — the road jumps once a loop`
      : carJump >= 0.05
        ? `a car jumps ${carJump.toFixed(3)} across the wrap — its weave does not divide the loop`
        : camJump >= 0.1
          ? `the camera jumps ${camJump.toFixed(3)} m across the wrap`
          : `the lane markings jump ${roadJump.toFixed(2)} m across the wrap`
  )}  lamps ${lampJump.toFixed(3)} m, cars ${carJump.toFixed(4)}, ` +
    `camera ${camJump.toFixed(4)} m, markings ${roadJump.toFixed(3)} m ` +
    `(one frame at this speed is ${(25 * DT).toFixed(2)} m)`
);

// --- And a lamp only ever recycles out of sight. ---------------------
const recycle = await page.evaluate((steps) => {
  const a = window.__grnAttract;
  const seen = [];
  for (let i = 0; i <= steps; i++) {
    a.park(i / steps);
    const zs = [];
    a.scene.traverse((o) => {
      if (o.name === "lamp") zs.push(o.position.z);
    });
    seen.push(zs);
  }
  a.park(null);
  return { seen, camZ: a.camera.position.z };
}, 240);
let forwardJumps = 0;
let visibleJump = 0;
for (let i = 1; i < recycle.seen.length; i++) {
  for (let k = 0; k < recycle.seen[i].length; k++) {
    const d = recycle.seen[i][k] - recycle.seen[i - 1][k];
    if (d > 1) {
      forwardJumps++;
      // The jump must happen behind the camera. In front of it, a lamp
      // visibly teleports up the road.
      if (recycle.seen[i - 1][k] > recycle.camZ) visibleJump++;
    }
  }
}
console.log(
  `recycled  ${check(
    forwardJumps > 0 && visibleJump === 0,
    forwardJumps === 0
      ? "no lamp ever recycled over a whole loop — the road runs out instead of repeating"
      : `${visibleJump} lamp(s) jumped forward while still in front of the camera`
  )}  ${forwardJumps} recycles over one loop, none of them in shot`
);

await page.close();

// --- Reduced motion draws once and stops. ----------------------------
{
  const still = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  still.setDefaultTimeout(90000);
  await still.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
  await still.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("gulf-road-nights-onboarded", "2");
    localStorage.setItem("gulf-road-nights-coach", "3");
  });
  await still.reload({ waitUntil: "networkidle" });
  await still.waitForFunction(() => !!window.__grnAttract, null, { timeout: 90000 });
  const frozen = await still.evaluate(async () => {
    const a = window.__grnAttract;
    const f0 = a.frames;
    await new Promise((r) => setTimeout(r, 900));
    return { f0, f1: a.frames, tris: a.triangles };
  });
  console.log(
    `still     ${check(
      frozen.f1 === frozen.f0 && frozen.tris > 5000,
      frozen.f1 !== frozen.f0
        ? `the intro drew ${frozen.f1 - frozen.f0} more frames with reduced motion asked for`
        : `only ${frozen.tris} triangles in the one frame it did draw`
    )}  one frame, ${frozen.tris} triangles, and then nothing`
  );
  await still.close();
}

// --- The turntable is still there for the capture tool. --------------
{
  const shop = await open({ "gulf-road-nights-attract": "turntable" });
  const t = await shop.evaluate(async () => {
    const a = window.__grnAttract;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const a0 = a.angle;
    await wait(900);
    const swept = Math.abs(a.angle - a0);
    a.park(0.72);
    await wait(300);
    const p0 = a.angle;
    await wait(400);
    return { loop: a.loopSeconds, cars: a.cars.length, swept, parked: Math.abs(a.angle - p0) };
  });
  console.log(
    `showroom  ${check(
      t.loop === 0 && t.cars === 1 && t.swept > 0.001 && t.parked < 1e-6,
      t.loop !== 0
        ? "asking for the turntable still built the rolling loop"
        : t.cars !== 1
          ? `${t.cars} cars on the turntable — a showroom card wants one`
          : t.swept <= 0.001
            ? "the turntable does not turn"
            : "park() no longer holds the turntable still, so the cards are caught at fifteen different angles"
    )}  one car, sweeps ${t.swept.toFixed(3)} rad, dead still when parked`
  );
  await shop.close();
}

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\ntwo cars, one road, no seam.");
