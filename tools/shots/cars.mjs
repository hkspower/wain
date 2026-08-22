// A showroom card for every car in the game.
//
//   npm run dev            # in another shell
//   npm run shots:cars
//
// Renders each car on the menu's own turntable — the same showroom
// lighting, environment map and paint the player sees before a race —
// and writes one PNG per car to press/cars/, plus cars.json with the
// stats beside it. Driving the real menu rather than a mock scene is the
// point: what comes out is what the game actually draws.
//
// The menu chrome is hidden for the shot and the turntable is parked at
// a fixed three-quarter angle, so the fourteen cards are comparable to
// each other rather than caught at fourteen different moments.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const OUT = "press/cars";
// Deliberately squarer than 16:9. The menu pushes the car into the right
// of the frame to leave room for its own column, and it only does that
// above an aspect of 1.15 — below it the shot centres and pulls in. So
// the card's proportions are what centre the car, rather than a special
// capture mode bolted onto the menu.
const W = +(process.argv.find((a) => a.startsWith("--w="))?.slice(4) ?? 820);
const H = Math.round(W / 1.1);

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}

const cars = await fetch("http://localhost:3000/api/grn/v1/cars")
  .then((r) => r.json())
  .catch((e) => {
    console.error(`Could not reach the dev server: ${e.message}`);
    console.error("Start it first: npm run dev");
    process.exit(2);
  });

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2.5 });
// A fixed crop around where the turntable puts the car. Fixed rather than
// fitted per car on purpose: the same rectangle means the same scale in
// every card, so a pickup reads as bigger than a coupe because it IS
// bigger, not because the framing flattered it.
const CLIP = { x: 180, y: 235, width: 480, height: 270 };
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
// The menu itself is a rolling two-car loop now. A card wants one car
// held still at a fixed three-quarter, so the capture asks for the old
// turntable stage by name.
await page.evaluate(() => localStorage.setItem("gulf-road-nights-attract", "turntable"));
await page.reload({ waitUntil: "networkidle" });
// Stay on the menu — the turntable only exists here.
await page.waitForFunction(() => !!window.__grnAttract, null, { timeout: 180000 });

// Hide the menu itself. The canvas keeps rendering underneath; without
// this every card carries the START ENGINE column across the shot.
await page.addStyleTag({
  content: `
    .attract-canvas { z-index: 9999 !important; }
    body > * > *:not(canvas) { visibility: hidden !important; }
    canvas.attract-canvas { visibility: visible !important; }
  `,
});

const shot = async (car) => {
  await page.evaluate((c) => {
    window.__grnAttract.setCar({
      body: parseInt(c.color.replace("#", ""), 16),
      accent: 0x007a3d,
      style: c.bodyStyle ?? "sedan",
      raceKit: c.kit === "attack",
      // The card has to show the car the showroom sells, and what the
      // showroom sells is a built car: arches, aero and a livery, as far
      // as its band goes. Five fields used to reach this call and three
      // of the things that decide what a car LOOKS like were not among
      // them, so every card in press/cars was a stripped version of a
      // machine you can never actually buy in that state.
      kit: c.kit,
      // NOT bought. The kit brings its own livery from the sport step
      // up; on the basic shelf the Rally Sticker Pack is still a 450 KD
      // purchase, so a basic card wearing one shows a car the showroom
      // does not sell in that state — which is the same fault as showing
      // a stripped supercar, pointing the other way.
      stickers: false,
      goldRims: false,
      // At its real length, or the card shows a silhouette rather than a
      // car: the fleet runs from a 3.95 m supermini to a 5.35 m pickup
      // and three of them share the saloon profile.
      lengthM: c.lengthM,
    });
  }, car);
  // Park the turntable at a fixed three-quarter so every car is caught
  // at the same angle; the menu otherwise sweeps continuously.
  await page.evaluate(() => {
    const h = window.__grnAttract;
    if (h.park) h.park(0.72);
  });
  await page.waitForTimeout(650);
  const path = `${OUT}/${car.id}.png`;
  await page.screenshot({ path, clip: CLIP });
  return path;
};

const index = [];
for (const car of cars.cars) {
  const path = await shot(car);
  index.push({ ...car, image: `${car.id}.png` });
  console.log(`  ${car.name.padEnd(20)} ${String(car.topSpeedKmh).padStart(3)} km/h  ${path}`);
}
writeFileSync(`${OUT}/cars.json`, JSON.stringify(index, null, 2) + "\n");
console.log(`\n${index.length} cars written to ${OUT}/ at ${W}x${H}`);
await browser.close();
