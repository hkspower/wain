#!/usr/bin/env node
// Capture the game's reference stills.
//
//   npm run shots                  # everything, 1600x900
//   npm run shots -- menu night    # just those
//   npm run shots -- --w 3840      # at 4K
//
// These are test images in the useful sense: every one is a KNOWN state,
// not a lucky frame. The hour, the position on the track and the picture
// settings are all pinned, traffic and the rival are parked out of shot,
// and the car is stopped — the camera carries a speed-scaled rumble, so
// a still taken at road speed is framed differently every time and two
// runs cannot be compared. Re-running this on a change and flicking
// between the old and new file is the whole point.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found."); process.exit(2); }

const argv = process.argv.slice(2);
const wIdx = argv.indexOf("--w");
const W = wIdx >= 0 ? +argv[wIdx + 1] : 1600;
const H = Math.round((W / 16) * 9);
const wanted = argv.filter((a) => !a.startsWith("--") && a !== String(W));

const OUT = "press/shots";
mkdirSync(OUT, { recursive: true });

// Each shot is a name, an hour, and where on the lap to stand. `m` is
// METRES from the start line, not a fraction of the lap: the lap got
// 1.15 km longer when the invented inland leg became the Second Ring
// Road, and every fraction here would have framed a different place
// while still looking like a valid still. The old "coast" shot was
// already proof of that — at u=0.62 it was standing on the inland leg,
// half the map from any water.
const SHOTS = [
  { name: "menu", menu: true },
  { name: "night", hour: 22.5, m: 2203 },
  { name: "dawn", hour: 5.6, m: 2203 },
  { name: "noon", hour: 12.5, m: 2203 },
  { name: "dusk", hour: 18.2, m: 2203 },
  { name: "coast", hour: 22.5, m: 1300 },   // the seaward leg, water on the left
  { name: "city", hour: 22.5, m: 587 },     // towers behind the road
  { name: "signal", hour: 22.5, m: 197 },   // on the approach to a signalised junction
  { name: "ring", hour: 22.5, m: 5400 },    // the Second Ring through Mansuriya
  { name: "love", hour: 22.5, m: 6155 },    // Love Street, at its own sign
  { name: "towers", hour: 22.5, m: -110 },  // Kuwait Towers on the approach
  { name: "towersday", hour: 16.5, m: -110 }, // same frame by day, so the pair compares
  { name: "drift", hour: 22.5, m: 2203, drift: true },
];

const list = wanted.length ? SHOTS.filter((s) => wanted.includes(s.name)) : SHOTS;
if (!list.length) {
  console.error(`no such shot. known: ${SHOTS.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

const b = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});
const page = await b.newPage({ viewport: { width: W, height: H }, reducedMotion: "no-preference" });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });

let started = false;
for (const shot of list) {
  if (shot.menu) {
    // The menu shot is taken before the engine exists, with the
    // turntable given a moment to spin up.
    await page.waitForSelector("nav[aria-label='Main menu']");
    await page.waitForTimeout(2500);
  } else {
    if (!started) {
      await page.click("text=START ENGINE");
      await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
      // Let the streamed assets land: authored shells, wheels, palm
      // crowns and the reflection probe all arrive after "ready".
      await page.waitForTimeout(4000);
      started = true;
    }
    await page.evaluate(async (s) => {
      const e = window.__grnEngine;
      e.setPaused(true);
      e.applyQualityTier("high");            // pin the resolution
      e.timeHours = s.hour;
      e.world.setTimeOfDay(s.hour);
      e.applyDaylight();
      const at = s.m < 0 ? e.track.length + s.m : s.m; // negative = before the line
      e.player.s = at;
      e.player.lat = 0;
      e.player.speed = 0;                    // a rumbling camera reframes every still
      e.setTouchInput({ steer: s.drift ? 0.7 : 0, throttle: 0, brake: 0 });
      const away = () => {
        const far = e.track.wrap(e.player.s + e.track.length / 2);
        for (const t of e.traffic) t.s = far;
        if (e.rival) { e.rival.s = far; e.rival.speed = 0; }
      };
      // Settle twice: one pass still carries the previous shot's state.
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < 40; i++) {
          e.update(1 / 60);
          away();
          e.player.s = at;
          e.player.lat = 0;
          e.player.speed = 0;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }, shot);
    // The loop renders even while paused, so the canvas is live.
    await page.waitForTimeout(700);
  }
  const path = `${OUT}/${shot.name}.png`;
  await page.screenshot({ path, clip: { x: 0, y: 0, width: W, height: H } });
  console.log(`${shot.name.padEnd(7)} ${W}x${H}  ${path}`);
}

await b.close();
console.log(`\n${list.length} reference still${list.length === 1 ? "" : "s"} in ${OUT}/`);
console.log("Contact sheet:  python3 tools/shots/sheet.py");
