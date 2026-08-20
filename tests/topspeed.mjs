// Every car is governed at its own number, and the number has to be
// true: drive each one flat out on a straight and see where it settles.
// A limiter the car cannot reach is a lie printed on a card.
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
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const rows = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const res = await fetch("/api/grn/v1/cars").then((r) => r.json()).catch(() => null);
  const list = res?.cars ?? res ?? [];
  if (!Array.isArray(list) || !list.length) return [];
  const out = [];
  e.setPaused(true);
  for (const car of list) {
    const g = {
      car: car.id, cars: [car.id], owned: [], kd: 999999,
      equipped: { paint: "paint-white", glow: "glow-none" },
    };
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify(g));
    e.applyGarage();
    e.player.s = 2400;
    e.player.lat = 0;
    e.player.speed = 0;
    e.heading = 0; e.steerSmooth = 0; e.driftYaw = 0; e.slipVel = 0;
    // Straight, empty road: this measures the drivetrain, not the corners
    for (let i = 0; i < 60 * 120; i++) {
      e.setTouchInput({ throttle: 1 });
      e.heading = 0; e.slipVel = 0; e.player.lat = 0;
      for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length / 2);
      e.update(1 / 60);
    }
    out.push({
      id: car.id,
      name: car.name,
      stated: car.topSpeedKmh,
      reached: +(e.player.speed * 3.6).toFixed(1),
    });
  }
  return out;
});

console.log("car                        stated   reached");
const stated = new Set();
for (const r of rows) {
  const err = Math.abs(r.reached - r.stated);
  console.log(`  ${r.name.padEnd(22)} ${String(r.stated).padStart(5)}   ${String(r.reached).padStart(6)}  ` +
    check(err <= 2, `${r.name}: governed at ${r.stated} but reached ${r.reached} km/h`));
  stated.add(r.stated);
}
console.log(`\n${rows.length} cars, ${stated.size} distinct limits  ` +
  check(rows.length >= 10, `only ${rows.length} cars enumerated — the catalogue never loaded`) + " " +
  check(stated.size === rows.length, "two cars share a top speed"));
const lo = Math.min(...rows.map((r) => r.stated));
const hi = Math.max(...rows.map((r) => r.stated));
console.log(`range ${lo} - ${hi} km/h  ` +
  check(lo === 180 && hi === 400, `range ${lo}-${hi} is not the requested 180-400`));

// The governor must also hold against a modded car and against NOS
const modded = await page.evaluate(async () => {
  const e = window.__grnEngine;
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car: "wain-special", cars: ["wain-special"], kd: 999999,
    owned: ["nos", "ecu", "exhaust", "intake", "weight", "lsd"],
    equipped: { paint: "paint-white", glow: "glow-none", aspiration: "twin-turbo", gearbox: "gearbox-tall" },
  }));
  e.applyGarage();
  const limit = e.tune.topSpeedKmh;
  e.player.s = 2400;
  e.player.speed = 0; e.heading = 0; e.slipVel = 0; e.player.lat = 0;
  let peak = 0;
  for (let i = 0; i < 60 * 150; i++) {
    e.setTouchInput({ throttle: 1 });
    e.keys?.add?.("n"); // NOS held down the whole way
    e.heading = 0; e.slipVel = 0; e.player.lat = 0;
    for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length / 2);
    e.update(1 / 60);
    peak = Math.max(peak, e.player.speed * 3.6);
  }
  e.keys?.delete?.("n");
  return { limit, peak: +peak.toFixed(1) };
});
console.log(`\nmodded starter (twin turbo + tall gears + NOS): governor ${modded.limit} km/h, peak ${modded.peak}  ` +
  check(modded.peak <= modded.limit + 0.5, `NOS punched through the governor: ${modded.peak} > ${modded.limit}`) + " " +
  check(modded.peak > modded.limit - 3, "the modded build never reached its own governor"));

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nevery car is governed, and every governor is true");
await browser.close();
process.exit(fail.length ? 1 : 0);
