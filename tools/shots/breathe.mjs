const byCeil = [];
for (const CEIL of CEILS) {
  console.log(CEIL === null ? "\nmaterial as it ships" : `\nmetalness capped at ${CEIL}`);
  console.log("paint                 crushed   p05   p50   p95   range");
  const rows = [];
  for (const p of chosen) {
    const r = await page.evaluate(async ([paintId, ceil]) => {
      const e = window.__grnEngine;
      const g = JSON.parse(localStorage.getItem("gulf-road-nights-garage") || "{}");
      localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
        ...g, car: "deera-sedan", cars: ["deera-sedan"], kd: 999999,
        builds: { "deera-sedan": { owned: [paintId], equipped: { paint: paintId }, tint: 0 } },
      }));
      e.applyGarage();
      await new Promise((r2) => setTimeout(r2, 200));
      // applyGarage rebuilds the shell, so the material handle is new
      // every time round. Reading it once outside the loop would have
      // capped a material that had already been thrown away.
      const m = e.carBody?.userData?.bodyMat;
      const shipped = m ? m.metalness : null;
      if (ceil !== null && m) { m.metalness = Math.min(m.metalness, ceil); m.needsUpdate = true; }
      const d = window.__breatheGrab();
      const mask = window.__breatheMask;
      const hist = new Uint32Array(256);
      let n = 0;
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        if (!mask[j]) continue;
        const y = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
        hist[Math.min(255, y)]++; n++;
      }
      if (!n) return null;
      const pct = (q) => {
        let acc = 0;
        for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= q * n) return v; }
        return 255;
      };
      let crushed = 0;
      for (let v = 0; v <= 8; v++) crushed += hist[v];
      return { crushed: crushed / n, p05: pct(0.05), p50: pct(0.5), p95: pct(0.95), n, shipped };
    }, [p.id, CEIL]);
    step(`read ${p.id}`);
    if (!r) { console.log(`${p.id.padEnd(20)}  no pixels`); continue; }
    const range = r.p95 - r.p05;
    rows.push({ id: p.id, ...r, range });
    console.log(
      `${p.id.padEnd(20)} ${(r.crushed * 100).toFixed(1).padStart(6)}% ` +
      `${String(r.p05).padStart(5)} ${String(r.p50).padStart(5)} ${String(r.p95).padStart(5)} ` +
      `${String(range).padStart(7)}`
    );
  }
  byCeil.push([CEIL, rows]);
}
// Does the paint breathe, or is it suffocating?
//
//   npm run dev
//   node tools/shots/breathe.mjs
//
// WHAT "BREATHABLE" HAS TO MEAN BEFORE IT CAN BE MEASURED
//
// "More breathable paint" is a phrase about air, and air is not a
// renderer setting. What it describes, though, is something a histogram
// can see: a panel that has ROOM in it. A paint breathes when its dark
// side is still the paint — dimmer, cooler, but present — and it
// suffocates when the dark side falls off a cliff into nothing. So two
// numbers, both taken off the car's own pixels:
//
//   CRUSHED   the share of painted bodywork at or under 8/255, where no
//             screen and no eye gets anything back. This is the airless
//             part. cars.ts already records a black car that came back
//             56.3% crushed; that is the failure this names.
//   RANGE     p95 minus p05 of the painted pixels. How much tonal
//             distance the paint spans from its shadow side to its
//             highlight. A paint with no range is a sticker: one flat
//             value wrapped round a shape, no matter how glossy the
//             material claims to be.
//
// Range and crush are different failures and a fix for one can cause
// the other, which is why both are printed. Pouring light into the dark
// side kills the crush and can flatten the range at the same time; that
// is a paint that breathes and has stopped being paint.
//
// HOW THE PIXELS ARE FOUND
//
// Not by colour keying and not by guessing a rectangle. The car's
// silhouette comes from rendering the frame with the car and without
// it — the pixels that changed ARE the car, the same method volume.mjs
// uses. Then the PAINT within that silhouette comes from a second
// difference: swing the body material from black to white and the
// pixels that move are the ones showing paint. Glass, lamps, tyres and
// the plate do not move, so they are not counted.
//
// Both masks are taken once. The geometry does not change when the
// colour does, so paying for it 23 times would only add noise.
//
// EXPOSURE IS PINNED, and that is not a detail. Auto-exposure is a
// feedback loop that closes around exactly this measurement: darken the
// paint, the meter sees a darker frame, exposure rises, and the paint
// measures back where it started. A previous session lost a headline to
// this — the first row of an A/B was five times darker than the rest
// purely because the meter had not settled — so there is a throwaway
// pose and a settle before anything is read.
//
// The full composer runs, not a bare scene render. Crush is mostly made
// in the grade: uToe, uShadowLift and uLift decide where the bottom of
// this picture is, and measuring before them would be measuring a frame
// nobody sees.

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium; set CHROME_PATH"); process.exit(2); }

// A ceiling on the paint's metalness, applied live, so the same
// instrument measures the fix as measured the fault.
//
//   GRN_METAL_CEIL=0.8 node tools/shots/breathe.mjs
//
// The knob is a CEILING rather than a value because that is the shape
// of the law being tested: paintMetalness already comes down at both
// ends of the luminance range for reasons of its own, and a sweep that
// overwrote those would be measuring a different material than the one
// that would ship.
// One ceiling, or a sweep of them:
//
//   GRN_METAL_CEIL=0.8            node tools/shots/breathe.mjs
//   GRN_METAL_CEIL=0.95,0.85,0.75 node tools/shots/breathe.mjs
//
// and a subset of the palette, because a sweep over 23 paints on a box
// that renders this game at two frames a second is an afternoon:
//
//   GRN_PAINTS=paint-black,paint-white,paint-red
const CEILS = process.env.GRN_METAL_CEIL
  ? process.env.GRN_METAL_CEIL.split(",").map((v) => Number(v.trim()))
  : [null];
for (const c of CEILS) {
  if (c !== null && !(c > 0 && c <= 1)) {
    console.error("GRN_METAL_CEIL values must be in (0, 1]"); process.exit(2);
  }
}
const ONLY = process.env.GRN_PAINTS ? new Set(process.env.GRN_PAINTS.split(",").map((v) => v.trim())) : null;

const paints = await fetch("http://localhost:3000/api/grn/v1/gamedata")
  .then((r) => r.json())
  .then((d) => d.palette.paints)
  .catch(() => { console.error("start the dev server: npm run dev"); process.exit(2); });

const chosen = ONLY ? paints.filter((p) => ONLY.has(p.id)) : paints;
if (!chosen.length) { console.error("GRN_PAINTS matched nothing in the palette"); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 760, height: 500 } });
// Fifteen minutes per step, which is absurd on a real machine and
// necessary here: this container has no GPU, renders the game at about
// two frames a second, and one grab is six composed frames. The mask
// step alone is four grabs. A timeout shorter than the work is not a
// safety net, it is a way of losing a measurement four minutes in.
page.setDefaultTimeout(900000);
page.on("console", (m) => { if (m.type() === "error") console.error("  page:", m.text()); });
page.on("pageerror", (e2) => console.error("  page threw:", e2.message));
// Every step announces itself. A silent hang inside one long
// page.evaluate is indistinguishable from a slow one, and this box
// runs the game at about two frames a second, so "slow" is the
// default hypothesis and has to be ruled out by a printed timestamp
// rather than by waiting.
let t0 = Date.now();
const step = (what) => { console.error(`  [${((Date.now()-t0)/1000).toFixed(1)}s] ${what}`); };
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
await page.waitForTimeout(4000);

// --- pose the car, pin the meter, build the masks ---------------------
step("engine up, posing");
const setup0 = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const THREE = window.__grnThree;
  e.setPaused(true);
  e.applyQualityTier("high");
  e.timeHours = 0.5;
  e.world.setTimeOfDay(0.5);
  e.applyDaylight();
  e.player.s = 587; e.player.lat = 0; e.player.speed = 0;
  for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length / 2);
  if (e.rival) e.rival.s = e.track.wrap(e.player.s + e.track.length / 2);
  for (let i = 0; i < 60; i++) e.update(1 / 60);

  const cam = e.camera;
  const p = new THREE.Vector3(), side = new THREE.Vector3(), tan = new THREE.Vector3();
  e.track.pose(e.player.s, 0, p, side);
  e.track.tangentAt(e.player.s, tan);
  cam.up.set(0, 1, 0);
  cam.position.set(p.x - tan.x * 7.5 + side.x * 3.6, 2.0, p.z - tan.z * 7.5 + side.z * 3.6);
  cam.lookAt(p.x, 0.65, p.z);
  cam.fov = 45;
  cam.updateProjectionMatrix();

  // Meter off, then let it settle before ANY reading is kept.
  e.setExposure(0, false);
  for (let i = 0; i < 30; i++) e.update(1 / 60);
  // The live probe is black until it has been swept; a metallic paint
  // takes most of its light from it.
  for (let i = 0; i < 6; i++) e.renderProbe();

  const grab = () => {
    e.exposurePass.dt = 0;
    for (let i = 0; i < 6; i++) e.composer.render();
    const gl = e.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = gl.width; c.height = gl.height;
    const x = c.getContext("2d");
    x.drawImage(gl, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  // Throwaway: the first composed frame after a re-pose is not the
  // frame the rest of the run is comparing against.
  grab();
  window.__breatheGrab = grab;
  return { posed: true };
});
step(`posed: ${JSON.stringify(setup0)}`);

// Masks in their own step. A single evaluate that poses the car, warms
// the meter, sweeps the probe and renders five frames is one number in
// a log when it hangs; four of them say which part hung.
const setup = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const grab = window.__breatheGrab;
  const withCar = grab();
  e.playerMesh.visible = false;
  const without = grab();
  e.playerMesh.visible = true;

  const gl = e.renderer.domElement;
  const W = gl.width, H = gl.height;
  const isCar = new Uint8Array(W * H);
  let carPx = 0;
  for (let i = 0, j = 0; i < withCar.length; i += 4, j++) {
    const d = Math.abs(withCar[i] - without[i])
      + Math.abs(withCar[i + 1] - without[i + 1])
      + Math.abs(withCar[i + 2] - without[i + 2]);
    if (d > 24) { isCar[j] = 1; carPx++; }
  }

  // Which of those pixels are PAINT: swing the body material from black
  // to white and keep what moved.
  const mat = e.carBody.userData.bodyMat;
  if (!mat) return { error: "no bodyMat on carBody" };
  const was = mat.color.getHex();
  mat.color.setHex(0x000000); mat.needsUpdate = true;
  const dark = grab();
  mat.color.setHex(0xffffff); mat.needsUpdate = true;
  const light = grab();
  mat.color.setHex(was); mat.needsUpdate = true;

  const isPaint = new Uint8Array(W * H);
  let paintPx = 0;
  for (let i = 0, j = 0; i < dark.length; i += 4, j++) {
    if (!isCar[j]) continue;
    const d = Math.abs(dark[i] - light[i])
      + Math.abs(dark[i + 1] - light[i + 1])
      + Math.abs(dark[i + 2] - light[i + 2]);
    if (d > 30) { isPaint[j] = 1; paintPx++; }
  }
  window.__breatheMask = isPaint;
  window.__breatheGrab = grab;
  return { W, H, carPx, paintPx };
});

step(`masks built: ${JSON.stringify(setup)}`);
if (setup.error) { console.error(setup.error); await browser.close(); process.exit(2); }
console.log(
  `car ${setup.carPx} px of ${setup.W}x${setup.H}; ` +
  `${setup.paintPx} of those are painted bodywork (${(100 * setup.paintPx / setup.carPx).toFixed(0)}%)`
);
if (setup.paintPx < 3000) {
  console.error("too few paint pixels to say anything; check the framing");
  await browser.close(); process.exit(2);
}

console.log(METAL_CEIL === null
  ? "\nmaterial as it ships"
  : `\nmetalness capped at ${METAL_CEIL}`);
console.log("paint                 crushed   p05   p50   p95   range");
const rows = [];
for (const p of paints) {
  const r = await page.evaluate(async ([paintId, ceil]) => {
    const e = window.__grnEngine;
    const g = JSON.parse(localStorage.getItem("gulf-road-nights-garage") || "{}");
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
      ...g, car: "deera-sedan", cars: ["deera-sedan"], kd: 999999,
      builds: { "deera-sedan": { owned: [paintId], equipped: { paint: paintId }, tint: 0 } },
    }));
    e.applyGarage();
    await new Promise((r2) => setTimeout(r2, 200));
    // applyGarage rebuilds the shell, so the material handle is new
    // every time round. Reading it once outside the loop would have
    // capped a material that had already been thrown away.
    if (ceil !== null) {
      const m = e.carBody?.userData?.bodyMat;
      if (m) { m.metalness = Math.min(m.metalness, ceil); m.needsUpdate = true; }
    }
    const d = window.__breatheGrab();
    const mask = window.__breatheMask;
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      if (!mask[j]) continue;
      const y = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      hist[Math.min(255, y)]++; n++;
    }
    if (!n) return null;
    const pct = (q) => {
      let acc = 0;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= q * n) return v; }
      return 255;
    };
    let crushed = 0;
    for (let v = 0; v <= 8; v++) crushed += hist[v];
    return { crushed: crushed / n, p05: pct(0.05), p50: pct(0.5), p95: pct(0.95), n };
  }, [p.id, METAL_CEIL]);
  step(`read ${p.id}`);
  if (!r) { console.log(`${p.id.padEnd(20)}  no pixels`); continue; }
  const range = r.p95 - r.p05;
  rows.push({ id: p.id, ...r, range });
  console.log(
    `${p.id.padEnd(20)} ${(r.crushed * 100).toFixed(1).padStart(6)}% ` +
    `${String(r.p05).padStart(5)} ${String(r.p50).padStart(5)} ${String(r.p95).padStart(5)} ` +
    `${String(range).padStart(7)}`
  );
}
await browser.close();

if (!byCeil.length || !byCeil[0][1].length) process.exit(1);
const mean = (rows, f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
console.log("\nsetting            mean crushed   mean range   most airless");
for (const [ceil, rows] of byCeil) {
  if (!rows.length) continue;
  const worst = rows.slice().sort((a, b) => b.crushed - a.crushed)[0];
  console.log(
    `${(ceil === null ? "as it ships" : `cap ${ceil}`).padEnd(18)} ` +
    `${(mean(rows, (r) => r.crushed) * 100).toFixed(1).padStart(12)}% ` +
    `${mean(rows, (r) => r.range).toFixed(1).padStart(12)}   ` +
    `${worst.id} ${(worst.crushed * 100).toFixed(1)}%`
  );
}
console.log("\nCrush and range are different failures. Pouring light into the dark");
console.log("side kills the crush and can flatten the range with it, and a paint");
console.log("that breathes but has no range has stopped being paint.");
