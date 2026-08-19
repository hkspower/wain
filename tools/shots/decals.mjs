// Dump every decal a car is wearing, at the size it was drawn.
//
//   npm run dev
//   node tools/shots/decals.mjs zeta-300
//
// A decal is a 0.3 m plane on a car. On any render of the whole vehicle
// it is a smudge twenty pixels across, which is enough to see THAT it is
// there and nowhere near enough to see whether the artwork is right —
// the Arabic under a wordmark either shapes or it does not, and that is
// not a question a screenshot of a car can answer.

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

const carId = process.argv[2] ?? "zeta-300";
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
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
await page.waitForTimeout(3000);

mkdirSync("press/decals", { recursive: true });
const shots = await page.evaluate(async (carId) => {
  const e = window.__grnEngine;
  e.setPaused(true);
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car: carId, cars: [carId], owned: ["stickers"], kd: 99999,
    equipped: { paint: "paint-white", glow: "glow-none" },
  }));
  e.applyGarage();
  await new Promise((r) => setTimeout(r, 300));
  // Decal materials are the transparent ones carrying a canvas map. One
  // entry per distinct canvas — both flanks share a material.
  const seen = new Set();
  const out = [];
  e.carBody.traverse((o) => {
    const m = o.material;
    if (!o.isMesh || !m || !m.transparent || !m.map || !m.map.image) return;
    const img = m.map.image;
    if (typeof img.toDataURL !== "function" || seen.has(img)) return;
    seen.add(img);
    out.push({
      w: img.width, h: img.height,
      // The plane it is applied to, in metres, so the drawn aspect can
      // be compared against the shape it actually lands on.
      plane: o.geometry.parameters
        ? [o.geometry.parameters.width, o.geometry.parameters.height]
        : null,
      png: img.toDataURL("image/png").split(",")[1],
    });
  });
  return out;
}, carId);

shots.forEach((s, i) => {
  const path = `press/decals/${carId}-${i}.png`;
  writeFileSync(path, Buffer.from(s.png, "base64"));
  const ar = s.plane ? ` on a ${s.plane[0]}x${s.plane[1]} m plane` : "";
  console.log(`  ${path}  ${s.w}x${s.h}${ar}`);
});
console.log(`\n${shots.length} decals on ${carId}`);
await browser.close();
