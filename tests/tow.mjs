// The tow, in the actual game.
//
//   npm run dev
//   node tests/tow.mjs
//
// tests/slipstream.mjs proves the arithmetic. It cannot prove the
// arithmetic reaches the car, and that is the failure mode a feature
// like this actually has: the module exports, the constants export, the
// parity harness agrees to twelve places, and the number arrives at a
// field nobody multiplied by. So nothing here inspects the model. The
// car is put behind another car and asked to coast.
//
// COASTING RATHER THAN ACCELERATING, on purpose. Under power the answer
// is confounded by the governor — every car in this game is limited, and
// a test that ran two cars at full throttle would find them both sitting
// on their limiter, agreeing perfectly, having measured nothing. Off the
// throttle the only thing deciding what happens to the speed is drag,
// which is exactly the term the wake is supposed to be discounting.

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
if (!exe) { console.error("no chromium"); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
await page.waitForTimeout(2000);

const out = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });

  const DT = 1 / 120;
  const START_SPEED = 60;      // m/s, comfortably under every governor
  const SECONDS = 6;

  /**
   * Coast from START_SPEED for SECONDS, with or without a car ahead.
   *
   * The car ahead is pinned each frame rather than driven, because the
   * question is what a fixed following distance is worth and a driven
   * car would drift away and change it. `centreGap` is centre to centre;
   * the collision hitbox is 4.4 m, so anything at or above about 5.5 is
   * a tow and not a shunt.
   */
  const coast = (centreGap, lane) => {
    const away = e.track.wrap(4200 + e.track.length / 2);
    e.player.s = 4200;
    e.player.lat = 0;
    e.player.speed = START_SPEED;
    for (const t of e.traffic) { t.s = away; t.lat = 8; }
    if (e.rival) e.rival.s = away;
    // Let the springs and the smoothers settle at this speed before the
    // clock starts, or the first half second is the load solver catching
    // up and not the air.
    for (let i = 0; i < 60; i++) {
      e.player.speed = START_SPEED;
      if (centreGap !== null) {
        e.traffic[0].s = e.track.wrap(e.player.s + centreGap);
        e.traffic[0].lat = lane;
        e.traffic[0].speed = START_SPEED;
      }
      e.update(DT);
    }
    e.player.s = 4200;
    e.player.speed = START_SPEED;

    let tow = 0, frontGrip = 1;
    for (let i = 0; i < SECONDS / DT; i++) {
      if (centreGap !== null) {
        e.traffic[0].s = e.track.wrap(e.player.s + centreGap);
        e.traffic[0].lat = lane;
        e.traffic[0].speed = e.player.speed;
      }
      e.update(DT);
      const d = window.__grnDebug;
      tow = Math.max(tow, d.tow);
      frontGrip = Math.min(frontGrip, d.towFrontGrip);
    }
    return { speed: e.player.speed, tow, frontGrip };
  };

  const clean = coast(null, 0);
  const wake = coast(6.5, 0);          // ~2 m of clear air to the bodywork
  const pulledOut = coast(6.5, 3.4);   // one lane over, same distance back
  const wayBack = coast(34, 0);        // past the reach

  /**
   * A rival chasing from a fixed distance back, in the wake or beside it.
   *
   * The other half of the mechanic, and the half that is easy to leave
   * out: a wake only the player may use is not a rule of the road, it is
   * an advantage. The rival is held at a fixed following distance and
   * asked what speed it settles at.
   *
   * `state` is set without `inBattle`, so the chase AI runs without the
   * SP referee — the referee would end the fight partway through and
   * take the AI with it.
   */
  const chase = (lane) => {
    const r = e.rival;
    if (!r) return null;
    const away = e.track.wrap(4200 + e.track.length / 2);
    for (const t of e.traffic) { t.s = away; t.lat = 8; }
    r.state = "battle";
    e.player.s = 4200;
    e.player.lat = 0;
    e.player.speed = 70;
    r.speed = 50;
    for (let i = 0; i < 5 / DT; i++) {
      e.player.speed = 70;                       // a steady car to follow
      r.s = e.track.wrap(e.player.s - 6.5);      // pinned two metres back
      r.lat = lane;
      r.targetLat = lane;
      e.update(DT);
    }
    return r.speed;
  };
  const chaseWake = chase(0);
  const chaseBeside = chase(3.4);

  e.setPaused(false);
  return { START_SPEED, SECONDS, clean, wake, pulledOut, wayBack, chaseWake, chaseBeside };
});

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

const kmh = (v) => (v * 3.6).toFixed(1);
console.log(
  `coasting from ${kmh(out.START_SPEED)} km/h for ${out.SECONDS} s, off the throttle\n`
);
console.log(`  clean air      ${kmh(out.clean.speed)} km/h left, tow ${(out.clean.tow * 100).toFixed(0)}%`);
console.log(`  in the wake    ${kmh(out.wake.speed)} km/h left, tow ${(out.wake.tow * 100).toFixed(0)}%`);
console.log(`  pulled out     ${kmh(out.pulledOut.speed)} km/h left, tow ${(out.pulledOut.tow * 100).toFixed(0)}%`);
console.log(`  34 m back      ${kmh(out.wayBack.speed)} km/h left, tow ${(out.wayBack.tow * 100).toFixed(0)}%`);
console.log(
  `\n  the wake is worth ${kmh(out.wake.speed - out.clean.speed)} km/h ` +
  `over ${out.SECONDS} seconds of coasting`
);
console.log(
  `  front grip in it  x${out.wake.frontGrip.toFixed(3)} against ` +
  `x${out.clean.frontGrip.toFixed(3)} in clean air`
);

if (out.chaseWake === null) {
  console.log("\n  no rival on the road at boot — the chase half was not measured");
} else {
  console.log(
    `\n  a rival chasing from the same 2 m settles at ${kmh(out.chaseWake)} km/h in the wake, ` +
    `${kmh(out.chaseBeside)} km/h beside it`
  );
  // A wake only the player may use is an advantage, not a rule of the
  // road — and it would make a lead something you reach rather than
  // something you defend.
  check(
    out.chaseWake > out.chaseBeside + 0.5,
    `the rival gained ${(out.chaseWake - out.chaseBeside).toFixed(2)} m/s from sitting in the ` +
    `player's wake — the tow is the player's alone`
  );
}

// The number has to reach the car.
check(
  out.wake.speed - out.clean.speed > 2,
  `the wake was worth only ${(out.wake.speed - out.clean.speed).toFixed(2)} m/s — ` +
  `the tow is not reaching the drag term`
);
check(out.wake.tow > 0.5, `sitting 2 m off a bumper only produced ${(out.wake.tow * 100).toFixed(0)}% of a tow`);
check(out.clean.tow === 0, "an empty road produced a tow");
// ...and it has to be leaveable, or it is not a decision.
check(
  out.pulledOut.tow < out.wake.tow * 0.5,
  `pulling out one lane left ${(out.pulledOut.tow * 100).toFixed(0)}% of the tow — nobody can escape it`
);
check(out.wayBack.tow === 0, `34 m back still produced ${(out.wayBack.tow * 100).toFixed(0)}% of a tow`);
// ...and it has to cost something.
check(out.wake.frontGrip < 1, "sitting in the wake cost the front axle nothing");
check(out.clean.frontGrip === 1, "clean air is not clean");

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nthe wake reaches the car: faster in it, escapable, and it costs the front end"
);
await browser.close();
process.exit(fail.length ? 1 : 0);
