// How hot the bright end of the picture runs, across the game.
//
//   npm run dev
//   node tools/shots/highlights.mjs            # print, write press/highlights/*.png
//   node tools/shots/highlights.mjs --json     # one JSON line per view, for diffs
//
// "Too much spark and shine" is three different complaints, and this
// measures each one separately on the chase camera the player actually
// drives behind, at the auto exposure the game actually ships with:
//
//   blown     share of the frame whose luma is at 250/255 or above —
//             white that has lost all detail
//   chan      share with ONE channel at 250 or above but luma under 250:
//             a red or blue that has hit the ceiling and stopped, which is
//             where a hue bends (a red flank going pink) and a texture
//             flattens into a sticker
//   hot       share at luma 200 or above — how much of the frame is
//             spent near white at all
//   flicker   per thousand pixels, the bright pixels (luma >= 150) that
//             DISAPPEAR when the car rolls 5 cm forward: no pixel within
//             one of them in the next frame is within 80 levels of it.
//             A moving edge moves a pixel or so and is still found in the
//             3x3 window; a specular sparkle off a sub-pixel highlight, a
//             glint that exists at one sample position and not the next,
//             is not. It is the shimmer a still cannot show.
//
// Read through drawImage, like every instrument here — which is only the
// picture because the grade writes opaque alpha. Before it did, this
// measured 4.5% of the night street and 8% of noon blown; read straight
// off the GPU the same frames were at 0% and 0.01% (tests/shine.mjs).
//
// Views: the lit city street and the open coast at 22:30, the same two
// places glare.mjs measures, and the city at 13:00 for the daylight
// side of the same question (sun specular, white livery, sky).

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const JSON_OUT = process.argv.includes("--json");
const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(600000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 600000 });
await page.waitForTimeout(4000);

mkdirSync("press/highlights", { recursive: true });

const VIEWS = [
  ["city-night", 587, 22.5],
  ["coast-night", 3304, 22.5],
  ["city-noon", 587, 13.0],
];
const rows = [];
for (const [name, u, hour] of VIEWS) {
  const r = await page.evaluate(async ([u, hour]) => {
    const e = window.__grnEngine;
    e.setPaused(true);
    e.applyQualityTier("high");
    e.timeReal = false; e.timeCycling = false; e.timeHours = hour;
    e.world.setTimeOfDay(hour);
    e.applyDaylight();
    e.setExposure(0, true);
    let at = u;
    const park = () => {
      const away = e.track.wrap(e.player.s + e.track.length / 2);
      for (const t of e.traffic) t.s = away;
      if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
      e.player.s = at;
      e.player.lat = 0;
      e.player.speed = 0;
    };
    park();
    for (let i = 0; i < 60; i++) { e.update(1 / 60); park(); }
    // The meter adapts once per RENDERED frame, by that frame's dt, so a
    // handful of renders at 1/60 leaves it where the last view had it —
    // a noon frame metered at midnight's exposure. A quarter second a
    // render (the most the pass accepts) and thirty of them is seven and
    // a half seconds of eye: settled from any hour to any other.
    const dt0 = e.exposurePass.dt;
    e.exposurePass.dt = 0.25;
    for (let i = 0; i < 30; i++) { e.update(1 / 60); park(); e.composer.render(); }
    e.exposurePass.dt = dt0;
    const meter = await e.autoExp.sample(e.renderer);
    const W = 640, H = 360;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const grab = () => {
      for (let i = 0; i < 2; i++) { e.update(1 / 60); park(); }
      e.composer.render();
      ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
      return ctx.getImageData(0, 0, W, H);
    };
    const A = grab();
    const png = (() => { const d = A.data; for (let i = 3; i < d.length; i += 4) d[i] = 255; ctx.putImageData(A, 0, 0); return c.toDataURL("image/png").split(",")[1]; })();
    at = u + 0.05;
    const B = grab();
    const lum = (d) => {
      const L = new Float32Array(W * H);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) L[p] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return L;
    };
    const La = lum(A.data), Lb = lum(B.data);
    let blown = 0, chan = 0, hot = 0;
    const d = A.data;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const l = La[p];
      if (l >= 250) blown++;
      else if (Math.max(d[i], d[i + 1], d[i + 2]) >= 250) chan++;
      if (l >= 200) hot++;
    }
    let flick = 0;
    const gone = (X, Y) => {
      let n = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const v = X[y * W + x];
        if (v < 150) continue;
        let best = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) best = Math.max(best, Y[(y + dy) * W + x + dx]);
        if (best < v - 80) n++;
      }
      return n;
    };
    flick = gone(La, Lb) + gone(Lb, La);
    const N = W * H;
    return {
      blown: +((100 * blown) / N).toFixed(2),
      chan: +((100 * chan) / N).toFixed(2),
      hot: +((100 * hot) / N).toFixed(2),
      flicker: +((1000 * flick) / N).toFixed(2),
      exposure: +meter.exposure.toFixed(3),
      png,
    };
  }, [u, hour]);
  writeFileSync(`press/highlights/${name}.png`, Buffer.from(r.png, "base64"));
  delete r.png;
  rows.push({ view: name, ...r });
  if (JSON_OUT) console.log(JSON.stringify({ view: name, ...r }));
  else
    console.log(
      `${name.padEnd(12)} blown ${String(r.blown).padStart(5)}%  chan ${String(r.chan).padStart(5)}%  ` +
        `hot ${String(r.hot).padStart(5)}%  flicker ${String(r.flicker).padStart(6)}/1000  exposure ${r.exposure}`
    );
}
await browser.close();
