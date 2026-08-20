// How far a light spreads, and how much of the frame it eats.
//
//   npm run dev
//   node tools/shots/glare.mjs
//
// "Too much flare" is a claim about a falloff curve. A lamp core is
// supposed to be white and is supposed to have a halo; what makes glare
// look cheap is the halo still being bright a tenth of the screen away,
// and the count of pixels the whole frame gives up to white.
//
// So: find the brightest pixel, walk rings outward from it, and report
// the mean luma in each ring as a fraction of the core. A real lamp
// falls off fast. It also reports the blown budget — how much of the
// frame is at 250/255 or above — because flare and clipping are the
// same problem seen from two sides.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

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
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(4000);

mkdirSync("press/glare", { recursive: true });

// Two places worth measuring: a lit street (lamps overhead, the worst
// case for halo bloat) and the open coast (the moon and the car's own
// lights, the worst case for a specular on paint).
const SPOTS = [["city", 587], ["coast", 3304]]; // metres from the line
for (const [where, u] of SPOTS) {
  const r = await page.evaluate(async ([u]) => {
    const e = window.__grnEngine;
    e.setPaused(true);
    e.applyQualityTier("high");
    e.timeHours = 22.5;
    e.world.setTimeOfDay(22.5);
    e.applyDaylight();
    e.setExposure(0, false);
    const park = () => {
      const away = e.track.wrap(e.player.s + e.track.length / 2);
      for (const t of e.traffic) t.s = away;
      if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
      e.player.s = u;
      e.player.lat = 0;
      e.player.speed = 0;
    };
    park();
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 30; i++) { e.update(1 / 60); park(); }
      for (let i = 0; i < 4; i++) e.composer.render();
    }
    for (let i = 0; i < 4; i++) e.composer.render();

    const W = 640, H = 360;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const lum = new Float32Array(W * H);
    let blown = 0, hot = 0, best = 0, bx = 0, by = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      lum[p] = l;
      if (l >= 250) blown++;
      if (l >= 200) hot++;
      if (l > best) { best = l; bx = p % W; by = (p / W) | 0; }
    }
    // Rings out from the brightest pixel, in percent of frame width, so
    // the number means the same thing at any resolution.
    const rings = [];
    for (const pct of [1, 2, 4, 8, 16]) {
      const rad = (pct / 100) * W;
      let sum = 0, n = 0;
      for (let y = Math.max(0, by - rad | 0); y < Math.min(H, by + rad); y++) {
        for (let x = Math.max(0, bx - rad | 0); x < Math.min(W, bx + rad); x++) {
          const dx = x - bx, dy = y - by;
          const dist = Math.hypot(dx, dy);
          if (dist > rad || dist < rad * 0.7) continue;
          sum += lum[y * W + x];
          n++;
        }
      }
      rings.push({ pct, frac: n ? +(sum / n / (best || 1)).toFixed(3) : 0 });
    }
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    ctx.putImageData(img, 0, 0);
    return {
      blown: +((blown / (W * H)) * 100).toFixed(2),
      hot: +((hot / (W * H)) * 100).toFixed(2),
      core: Math.round(best),
      rings,
      png: c.toDataURL("image/png").split(",")[1],
    };
  }, [u]);
  writeFileSync(`press/glare/${where}.png`, Buffer.from(r.png, "base64"));
  console.log(
    `${where.padEnd(6)} core ${String(r.core).padStart(3)}  blown ${String(r.blown).padStart(5)}%  ` +
      `hot(>=200) ${String(r.hot).padStart(5)}%   halo ` +
      r.rings.map((x) => `${x.pct}%:${x.frac}`).join("  ")
  );
}
await browser.close();
