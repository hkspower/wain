// The paint's reflection probe contains the sky.
//
//   npm run dev
//   npm run test:probesky
//
// The night dome is a 1900 m sphere and the probe's cameras stop at
// 420 m, so for the whole life of the live probe it held no sky at all:
// every direction the city did not fill was the clear colour, black. A
// car's flanks and roof mirror mostly sky — Fresnel is strongest at the
// grazing angles they present — so they mirrored nothing. Measured with
// tools/shots/paintcolors.mjs at the exposure players get (0.55, satin):
// red went from 31.5% of its bodywork dead to 0.6% once the sky was in,
// and black from 83% to about 20%.
//
// The fix draws the dome shrunk inside the probe's far plane for each
// probe face (engine.ts, renderProbeFace). This checks, on the probe
// itself rather than through a paint measurement that takes minutes per
// colour:
//
//   sky      no texel of the cube is left empty. The same sweep with the
//            dome withheld — the old behaviour, reproduced in this run —
//            must leave a real share of it empty, or the check is not
//            measuring anything.
//   restore  the dome is put back exactly — scale 1, where the main
//            camera's re-centring left it — so the picture is untouched.
//   cost     one extra draw call per face at most. The far-plane version
//            of this fix took a sweep from 606 calls to 1,332.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }

const b = await chromium.launch({ executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"] });
const page = await b.newPage({ viewport: { width: 550, height: 320 } });
page.setDefaultTimeout(600000);
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.log("PAGEERROR:", e.message); });
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3"); });
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
// The metered exposure path is slow on a software renderer, and nothing
// here is about exposure.
await page.evaluate(() => window.__grnEngine.setExposure(0, false));

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok  " : "FAIL"; };

const r = await page.evaluate(() => {
  const e = window.__grnEngine, THREE = window.__grnThree;
  e.skipCinematic?.();
  e.setPaused(true);
  e.timeHours = 2.5; e.world.setTimeOfDay(2.5); e.applyDaylight();
  const m = 587;
  e.player.s = m; e.player.lat = 0; e.player.speed = 0;
  for (let i = 0; i < 10; i++) e.update(1 / 60);

  const rt = e.cubeRT, size = rt.width;
  const half = rt.texture.type === THREE.HalfFloatType;
  const info = e.renderer.info;
  const sweep = () => {
    while (e.probeFace !== 0) e.renderProbe();
    info.autoReset = false; info.reset();
    for (let i = 0; i < 6; i++) e.renderProbe();
    const calls = info.render.calls;
    info.autoReset = true;
    return calls;
  };
  // Every texel of all six faces; "empty" is the clear colour, which no
  // lit or emissive surface in a night scene comes within a hair of.
  const empty = () => {
    let n = 0, total = 0;
    const buf = half ? new Uint16Array(size * size * 4) : new Uint8Array(size * size * 4);
    for (let face = 0; face < 6; face++) {
      e.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf, face);
      for (let i = 0; i < size * size; i++) {
        const v = half
          ? Math.max(THREE.DataUtils.fromHalfFloat(buf[i * 4]), THREE.DataUtils.fromHalfFloat(buf[i * 4 + 1]), THREE.DataUtils.fromHalfFloat(buf[i * 4 + 2]))
          : Math.max(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]) / 255;
        if (v < 1e-5) n++;
        total++;
      }
    }
    return +((n / total) * 100).toFixed(2);
  };

  // With the dome: the engine as it ships. The cached lookup is primed
  // by the first sweep.
  const callsWith = sweep();
  const emptyWith = empty();
  const dome = e.world.skyFollowers.find((o) => o.name === "sky");
  const off = dome.userData.skyOffset;
  const restore = {
    scale: dome.scale.x,
    dx: Math.abs(dome.position.x - (e.camera.position.x + off.x)),
    dz: Math.abs(dome.position.z - (e.camera.position.z + off.z)),
  };

  // Without: the probe as it was before, by withholding the dome.
  const keep = e.probeDome;
  e.probeDome = null;
  const callsWithout = sweep();
  const emptyWithout = empty();
  e.probeDome = keep;
  sweep();
  return { size, half, emptyWith, emptyWithout, callsWith, callsWithout, restore, found: !!keep };
});

console.log(`probe      ${r.size}px cube, ${r.half ? "half-float" : "8-bit"}; dome found: ${r.found}`);
console.log(`${check(r.found, "the engine never found the sky dome to draw into the probe")} sky        ` +
  `${r.emptyWith}% of the cube empty with the dome, ${r.emptyWithout}% without (the old probe)`);
check(r.emptyWith === 0, `${r.emptyWith}% of the probe is still the clear colour: some direction has no sky in it`);
check(r.emptyWithout > 5, `withholding the dome left only ${r.emptyWithout}% empty — this check cannot tell the fix from its absence`);
console.log(`${check(r.restore.scale === 1 && r.restore.dx < 1e-6 && r.restore.dz < 1e-6,
  `the dome was left at scale ${r.restore.scale}, ${r.restore.dx.toFixed(3)} / ${r.restore.dz.toFixed(3)} m off the camera`)} restore    ` +
  `dome back at scale ${r.restore.scale}, on the camera to ${Math.max(r.restore.dx, r.restore.dz).toExponential(1)} m`);
console.log(`${check(r.callsWith - r.callsWithout <= 6,
  `the sky cost ${r.callsWith - r.callsWithout} draw calls a sweep`)} cost       ` +
  `${r.callsWithout} -> ${r.callsWith} draw calls per six-face sweep`);
check(errors.length === 0, `page errors: ${errors.join(" | ")}`);
console.log(fail.length ? `\nFAILURES:\n - ${fail.join("\n - ")}` : "\nthe probe has a sky in it, and the picture is untouched");
await b.close();
process.exit(fail.length ? 1 : 0);
