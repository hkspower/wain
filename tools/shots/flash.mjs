// What the headlight flash actually does to the lamps.
//
//   npm run dev
//   node tools/shots/flash.mjs
//
// Flashing is how you start a race in this game: three hits inside a
// three-second window and the rival turns round. So the flash is not a
// decoration, it is the game's primary verb — and it is driven by a
// setInterval that captures the lamp's current brightness as its
// "baseline" and restores it at the end.
//
// Capture that baseline DURING another flash and the restore writes the
// blink back instead of the light.
//
// POSED, NOT RACED. The first version of this probe pressed the key and
// sampled on a timer, and could not see anything: a flash is 445 ms end
// to end and this browser renders the game at under two frames a second,
// so the first sample landed fifteen SECONDS after the press. The flash
// is a level read off a clock — that is the whole point of the rewrite —
// so the clock can be posed, and every reading below is taken by moving
// the mark rather than by waiting.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found."); process.exit(2); }
const b = await chromium.launch({executablePath:exe,args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"],headless:true});
const page = await b.newPage({viewport:{width:1000,height:640}});
page.setDefaultTimeout(180000);
page.on("pageerror",(e)=>console.log("PAGEERROR:",e.message));
await page.goto("http://localhost:3000/race",{waitUntil:"networkidle"});
await page.evaluate(()=>{localStorage.clear();localStorage.setItem("gulf-road-nights-onboarded","2");localStorage.setItem("gulf-road-nights-coach","3");});
await page.reload({waitUntil:"networkidle"});
await page.click("text=START ENGINE");
await page.waitForFunction(()=>!!window.__grnDebug,null,{timeout:180000});
await page.waitForTimeout(1200);
await page.evaluate((d)=>{ window.__flashDirect = d; }, process.env.DIRECT ?? "");

/** Pose the flash at `age` seconds old and read the lamps. */
const at = (age) => page.evaluate((age) => {
  const e = window.__grnEngine;
  e.flashStart = performance.now() / 1000 - age;
  e.applyFlashBeam();
  return {
    spot: +e.headlight.intensity.toFixed(2),
    off: +e.headlightR.intensity.toFixed(2),
    angle: +e.headlight.angle.toFixed(4),
    reach: +e.headlight.distance.toFixed(1),
  };
}, age);

await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.timeHours = 1.5; e.world.setTimeOfDay(1.5); e.applyDaylight();
  e.applyFlashBeam(); // settle, so the rest state is learned
});
const rest = await at(9);   // long past any flash: the dipped beam
console.log(`\nthe dipped beam at night: ${rest.spot} spot, ${rest.off} offside, ` +
  `${rest.angle} rad, ${rest.reach} m`);

console.log("\n  age(s)   spot    off   angle   reach");
const rows = [];
for (let a = 0; a <= 0.5; a += 0.025) {
  const r = await at(+a.toFixed(3));
  rows.push({ a: +a.toFixed(3), ...r });
  console.log(`  ${String(a.toFixed(3)).padStart(6)} ${String(r.spot).padStart(6)} ` +
    `${String(r.off).padStart(6)} ${String(r.angle).padStart(7)} ${String(r.reach).padStart(7)}`);
}

const fail = [];
const peak = Math.max(...rows.map((r) => r.spot));
// A flash is the main beam going ON. The old one blinked the lamps out
// and never once got brighter than the dipped beam it started from.
if (peak <= rest.spot * 1.5)
  fail.push(`the brightest the lamps got was ${peak} against a dipped ${rest.spot} — that is not a main beam`);
// Nothing may ever go DIMMER than the dipped beam. A driver flashing you
// does not turn their lights off.
const dimmest = Math.min(...rows.map((r) => r.spot));
if (dimmest < rest.spot - 0.01)
  fail.push(`the lamps dropped to ${dimmest}, below the dipped ${rest.spot} — the flash goes down as well as up`);
// The cone has to open and throw with it, or it is a brighter dipped beam.
if (Math.max(...rows.map((r) => r.angle)) <= rest.angle + 1e-4)
  fail.push("the beam does not widen — brightness alone reads as a lamp fault, not a main beam");
if (Math.max(...rows.map((r) => r.reach)) <= rest.reach + 0.1)
  fail.push("the beam does not throw any further than the dipped one");
// Two pulses, the way a hand on a stalk actually moves.
let pulses = 0;
for (let i = 1; i < rows.length - 1; i++)
  if (rows[i].spot > rows[i - 1].spot + 0.5 && rows[i].spot >= rows[i + 1].spot) pulses++;
console.log(`\npulses in one press: ${pulses}`);
if (pulses < 2) fail.push(`one press gave ${pulses} pulse(s) — a flash is a double-blip`);

// And it always gives the car back, however many presses overlap.
const settled = await page.evaluate(() => {
  const e = window.__grnEngine;
  const before = +e.headlight.intensity.toFixed(2);
  // Three presses inside the window, which is what the ritual demands.
  for (const age of [0.3, 0.15, 0.02]) {
    e.flashStart = performance.now() / 1000 - age;
    e.applyFlashBeam();
  }
  e.flashStart = performance.now() / 1000 - 9;
  e.applyFlashBeam();
  return { before, after: +e.headlight.intensity.toFixed(2) };
});
console.log(`three overlapping presses: settled at ${settled.after} (dipped ${rest.spot})`);
if (Math.abs(settled.after - rest.spot) > 0.01)
  fail.push(`after three overlapping presses the lamps settled at ${settled.after}, not ${rest.spot}`);

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe flash is a main beam, twice, and it gives the car back");
await b.close();
