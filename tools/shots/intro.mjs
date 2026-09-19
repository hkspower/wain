// The menu's race, at two moments of its loop.
//
//   npm run dev
//   npm run shot:intro
//
// The main menu is a loop of two cars fighting for a corner (attract.ts).
// tests/intro.mjs proves the scene; this shows it — the frame where your
// car has the lead and the frame where the other has taken it back and
// is on the brakes — with the numbers the scene reports for each, so a
// change to the corner or the fight can be looked at and not only
// measured. Written to press/intro/.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";

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
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.__grnAttract, null, { timeout: 120000 });
// Let the loop run so there is smoke in the air before the first frame.
await page.waitForTimeout(2500);
mkdirSync("press/intro", { recursive: true });
for (const [name, phase] of [["lead", 0.12], ["chased", 0.62]]) {
  const r = await page.evaluate((p) => {
    const a = window.__grnAttract;
    // Parked at the phase for the pose, released so the smoke keeps
    // moving and the frame is a frame of the loop rather than a still.
    a.park(p);
    a.park(null);
    return {
      drift: +(a.driftAngle * 57.3).toFixed(1),
      smoke: a.smoke,
      loop: +a.loopSeconds.toFixed(2),
      kmh: Math.round(a.speedMs * 3.6),
      radius: a.bendRadius,
    };
  }, phase);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `press/intro/${name}.png` });
  console.log(`${name.padEnd(7)} phase ${phase}  ${r.kmh} km/h on a ${r.radius} m radius, hero at ${r.drift}°, ${r.smoke} puffs, loop ${r.loop} s`);
}
console.log("wrote press/intro/lead.png, press/intro/chased.png");
await browser.close();
