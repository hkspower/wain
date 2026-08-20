// The same frame in every situation the game grades for.
//
//   npm run dev
//   node tools/shots/situations.mjs
//
// One position, one hour, one car, five looks. Anything that changes
// between these images is the situation grade and nothing else, which is
// the only way to judge whether a battle reads as a battle rather than
// as the sun going in.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
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

mkdirSync("press/situations", { recursive: true });
for (const situation of ["cruise", "challenge", "battle", "win", "lose"]) {
  const b64 = await page.evaluate(async (situation) => {
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
      e.player.s = e.track.length * 0.08;
      e.player.lat = 0;
      e.player.speed = 0;
    };
    park();
    e.setSituation(situation);
    // Long enough for the exponential blend to land.
    for (let i = 0; i < 150; i++) { e.update(1 / 60); park(); }
    for (let i = 0; i < 4; i++) e.composer.render();
    const gl = e.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = 1280; c.height = 720;
    const ctx = c.getContext("2d");
    ctx.drawImage(gl, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png").split(",")[1];
  }, situation);
  const out = `press/situations/${situation}.png`;
  writeFileSync(out, Buffer.from(b64, "base64"));
  console.log(`  ${out}`);
}
await page.evaluate(() => window.__grnEngine.setSituation(null));
await browser.close();
