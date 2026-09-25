// What a frame costs, and that the car cull keeps it down.
//
//   npm run dev
//   npm run test:framecost
//
// Measured on the city leg at 960x540 before the cull (engine.ts,
// applyCarLod): 5,713 draw calls and 6.8 M triangles a frame, 4,300 of
// the 5,400 meshes being the 46 traffic cars — ~90 meshes and ~90,000
// triangles each, drawn in full hundreds of metres away. After: about
// 2,250 calls and 3.7 M triangles, and a rendered frame that differs
// from the uncut one by less than two identical renders differ from each
// other.
//
// Absolute frame RATE means nothing on the software renderer this runs
// on; draw calls and triangles are what a real GPU pays for, and they
// are the same number here as there.
import { chromium } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }
const b = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"] });
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(900000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("gulf-road-nights-onboarded", "2"); localStorage.setItem("gulf-road-nights-coach", "3"); });
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnEngine, null, { timeout: 240000 });
await page.evaluate(() => window.__grnEngine.setExposure(0, false));
await page.waitForTimeout(3000);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok  " : "FAIL"; };

const r = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.skipCinematic?.(); e.setPaused(true);
  e.timeReal = false; e.timeCycling = false; e.timeHours = 2.5; e.world.setTimeOfDay(2.5); e.applyDaylight();
  const W = e.renderer.domElement.width, H = e.renderer.domElement.height;
  const c = document.createElement("canvas"); c.width = W; c.height = H; const ctx = c.getContext("2d");
  const info = e.renderer.info;
  const frame = (lod) => {
    e.carLod = lod;
    e.player.s = 587; e.player.lat = 0; e.player.speed = 0;
    e.update(1 / 60);
    info.autoReset = false; info.reset();
    e.composer.render();
    const cost = { calls: info.render.calls, tris: info.render.triangles };
    info.autoReset = true;
    ctx.drawImage(e.renderer.domElement, 0, 0);
    return { ...cost, px: ctx.getImageData(0, 0, W, H).data };
  };
  const on = frame(true), off = frame(false), on2 = frame(true);
  const changed = (a, bb) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.max(Math.abs(a[i] - bb[i]), Math.abs(a[i + 1] - bb[i + 1]), Math.abs(a[i + 2] - bb[i + 2])) > 8) n++;
    }
    return (n / (a.length / 4)) * 100;
  };
  // gpuName: asked of the driver once, not every frame.
  const gl = e.renderer.getContext();
  const real = gl.getParameter.bind(gl);
  let asks = 0;
  gl.getParameter = (p) => { asks++; return real(p); };
  for (let i = 0; i < 20; i++) e.gpuName();
  gl.getParameter = real;
  return {
    on: { calls: on.calls, tris: on.tris }, off: { calls: off.calls, tris: off.tris },
    diff: +changed(on.px, off.px).toFixed(3), noise: +changed(on.px, on2.px).toFixed(3), asks,
  };
});

const callCut = 1 - r.on.calls / r.off.calls, triCut = 1 - r.on.tris / r.off.tris;
console.log(`frame      ${r.off.calls} draw calls, ${(r.off.tris / 1e6).toFixed(2)} M triangles uncut -> ${r.on.calls} calls, ${(r.on.tris / 1e6).toFixed(2)} M with the car cull`);
console.log(`${check(callCut >= 0.5, `the car cull saves only ${(callCut * 100).toFixed(0)}% of draw calls`)} calls      ${(callCut * 100).toFixed(0)}% fewer draw calls, ${(triCut * 100).toFixed(0)}% fewer triangles`);
console.log(`${check(r.diff <= Math.max(0.1, r.noise * 1.5), `the cull changes ${r.diff}% of the frame against ${r.noise}% of render noise`)} picture    ${r.diff}% of pixels differ, against ${r.noise}% between two identical renders`);
console.log(`${check(r.asks === 0, `gpuName asked the driver ${r.asks} times in 20 calls`)} gpuName    20 calls, ${r.asks} driver queries (cached)`);
const src = readFileSync("src/game/engine.ts", "utf8");
check(/this\.applyCarLod\(\);/.test(src) && /emitsLight\(m\.material\)/.test(src), "the cull is not wired, or no longer spares the lamps");
check(errors.length === 0, `page errors: ${errors.join(" | ")}`);
console.log(fail.length ? `\nFAILURES:\n - ${fail.join("\n - ")}` : "\na frame costs what it looks like it costs");
await b.close();
process.exit(fail.length ? 1 : 0);
