// Does the car sound the same on every machine?
//
//   npm run dev            # in another shell
//   npm run test:soundtiming
//
// THE LAW: a lift performed over the same amount of TIME must produce
// the same sounds, whatever frame rate the machine is running at. What
// the driver did is a fact about the car; how often the browser managed
// to redraw it is not.
//
// This file exists because sound.ts already records this exact bug once
// and fixed it in one place. The rev limiter's stutter used to advance
// `+= limited * 0.55` on every call to update(), which made the cut rate
// a function of the frame rate: 5.3 Hz at 60 fps and 12.6 Hz at 144, so
// "two players holding the same car against the same limiter heard two
// different engines". That one is now pinned to the clock.
//
// The overrun sounds were not. Both of them detect a lift by comparing
// the throttle against ITS VALUE ON THE PREVIOUS FRAME:
//
//   sound.ts    lastThrottle - throttle > 0.35   -> the decel burble
//   engine.ts   lastThrottleFx - throttle > 0.4  -> the backfire, flame and bang
//
// A frame is not a unit of time. Releasing an analogue trigger takes a
// human about 120 ms, which is a drop of 0.07 per frame at 144 fps and
// 0.33 at 30 — so the same lift by the same driver crosses neither
// threshold on a fast machine and both on a slow one. A keyboard hides
// it completely, because a key release is 1 to 0 in a single frame at
// any rate, which is why this has never been noticed by anyone testing
// with the arrow keys.
//
// So the test drives the car from the SIMULATION side, stepping update()
// with an explicit dt, and performs the identical lift — the same
// travel over the same simulated seconds — at three frame rates. The
// sounds are counted by standing in front of the two functions that
// make them.

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium; set CHROME_PATH"); process.exit(2); }

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); return ok ? "ok" : "FAIL"; };

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 700, height: 460 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
await page.waitForTimeout(2500);

const r = await page.evaluate(async () => {
  const e = window.__grnEngine;
  if (!e.sound) return { noSound: true };

  // One lift, described in seconds and in throttle travel. Nothing here
  // is per-frame: this is what the driver's foot did.
  // Two lifts, both real. A FLICK is the foot coming straight off; a
  // BRISK lift is an analogue trigger released at a normal pace. Both
  // are overrun, both should pop, and neither is a frame rate.
  const LIFTS = [["flick", 0.04], ["brisk", 0.12]];
  const SOAK_S = 1.5;       // held flat before it, so revs are up
  const TAIL_S = 0.8;       // coasting after, for the burble to land

  // Find a speed where the engine is actually revving.
  //
  // The burble is gated on revs as well as on the foot, and revs come
  // from the gearbox, not from the speedometer: 45 m/s put the car in a
  // tall gear at 0.31 of redline, under the gate, so the first version
  // of this test proved the backfire rate-independent and said nothing
  // at all about the burble. Asking the car where its revs are high,
  // rather than hardcoding a number, also means a change to the gear
  // ratios cannot quietly switch this half of the test off.
  // The revs are PINNED, not driven.
  //
  // The burble is gated on engine speed as well as on the foot, and two
  // attempts to reach that gate through the gearbox both failed: at 45
  // m/s the car settles into a tall gear at 0.31 of redline, and a
  // search for the revviest speed reported 1.0 at 56 m/s — a car caught
  // mid-shift, which had fallen to 0.12 by the time the run measured it.
  // 56 m/s is a shift point, and a test balanced on one is measuring the
  // gearbox rather than the thing it came to measure.
  //
  // So the engine speed is held at a fixed fraction of redline for the
  // whole run. That is what a fixture is for: pin everything the test is
  // not about — here the gearbox — and vary only what it is about, which
  // is how fast the foot moved and how often the game was stepped.
  const REVS = 0.8; // comfortably over the burble's 0.55 gate

  const run = (fps, RELEASE_S) => {
    const dt = 1 / fps;
    const s = e.sound;
    let backfires = 0;
    let burbles = 0;
    // Stand in front of the two functions that make the overrun noise.
    // Counting the CALLS rather than listening to the output, because
    // this is a question about when the game decides to make a sound,
    // not about what the sound is.
    // Pin the engine speed WHERE THE SOUND READS IT, and count the
    // updates that got past the context check.
    //
    // The first attempt set e.revFrac after each update(), which is
    // after updateAudio() has already run and handed the old value to
    // the mixer — so the fixture reported 0.8 and the sound had been
    // seeing 0.12 the whole time. Pinning it on the frame itself puts
    // it exactly on the variable the burble gates against, and stops
    // the test arguing with the gearbox at all.
    s.__sawUpdate = 0;
    const realUpdate = s.update;
    s.update = function (f) {
      if (this.audioContext.state === "running") s.__sawUpdate++;
      return realUpdate.call(this, { ...f, rpmFrac: REVS });
    };
    const realBackfire = s.backfire;
    const realBurble = s.burble;
    s.backfire = () => { backfires++; };
    s.burble = () => { burbles++; };
    // A clean slate for every rate: the edge detectors and the burble's
    // own rate limit both carry state between runs.
    s.lastThrottle = 1;
    s.nextBurbleAt = 0;
    e.lastThrottleFx = 1;

    e.setPaused(false);
    e.locked = false;
    const hold = (v, seconds) => {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) {
        e.setTouchInput({ throttle: v(i / n) });
        // Keep the car fast and straight; this is about the foot, not
        // about where the road goes.
        e.player.speed = 45;
        e.update(dt);
      }
    };
    hold(() => 1, SOAK_S);
    hold((f) => 1 - f, RELEASE_S);   // the lift, over the same 120 ms every time
    hold(() => 0, TAIL_S);

    s.backfire = realBackfire;
    s.burble = realBurble;
    s.update = realUpdate;
    e.setTouchInput({ throttle: 0 });
    return { fps, backfires, burbles, revs: REVS,
      steps: Math.round((SOAK_S + RELEASE_S + TAIL_S) / dt) };
  };

  // 30 is a phone, 60 is a laptop panel, 144 is what the game is played
  // on by anybody who bought a monitor for it.
  e.setPaused(false);
  e.locked = false;
  const out = [];
  for (const [name, secs] of LIFTS) {
    for (const fps of [30, 60, 144]) out.push({ lift: name, ms: secs * 1000, ...run(fps, secs) });
  }
  e.setPaused(true);
  // sound.update() returns immediately unless the context is running,
  // and the backfire is called from engine.ts rather than through it —
  // so a green backfire column says nothing about whether the audio
  // update ran at all. Report the state rather than assume it.
  return { out, revs: REVS, ctxState: e.sound.audioContext.state,
           sawUpdate: e.sound.__sawUpdate ?? null };
});
await browser.close();

if (r.noSound) { console.log("no audio context — nothing to measure"); process.exit(2); }

console.log("\n=== SOUND TIMING vs FRAME RATE ===");
console.log(`  the same lift, driven from the simulation, at three frame rates`);
console.log(`  at 45 m/s with the engine pinned at ${r.revs} of redline, over the burble's rev gate`);
console.log(`  audio context is "${r.ctxState}"; ${r.sawUpdate} audio updates ran in the last pass\n`);
console.log("  lift          fps    steps   revs   backfires   decel burbles");
for (const row of r.out) {
  console.log(
    `  ${row.lift.padEnd(6)} ${String(row.ms).padStart(3)}ms  ${String(row.fps).padStart(3)}  ` +
    `${String(row.steps).padStart(7)}  ${String(row.revs).padStart(5)}   ${String(row.backfires).padStart(9)}   ${String(row.burbles).padStart(13)}`
  );
}

const kinds = [...new Set(r.out.map((x) => x.lift))];
console.log("");
for (const kind of kinds) {
  const rows = r.out.filter((x) => x.lift === kind);
  const bf = new Set(rows.map((x) => x.backfires));
  const bu = new Set(rows.map((x) => x.burbles));
  console.log(`  ${kind} lift, same at every rate  ${check(bf.size === 1 && bu.size === 1,
    `a ${rows[0].ms} ms lift fires ` +
    rows.map((x) => `${x.backfires}/${x.burbles} at ${x.fps} fps`).join(", ") +
    " (backfires/burbles) — the overrun depends on the frame rate")}`);
}
// The burble path has to be EXERCISED, not just consistent. Three zeros
// are perfectly consistent and prove nothing about the code under test.
console.log(`  the burble path is exercised ${check(r.out.some((x) => x.burbles > 0),
  `no run produced a decel burble at all — at ${r.revs} of redline the rev gate should be clear, ` +
  "so the burble's rate-independence is untested rather than proved")}`);
// And it has to actually happen. A lift this brisk at these revs IS an
// overrun; a car that never pops is not rate-independent, it is mute.
for (const kind of kinds) {
  const rows = r.out.filter((x) => x.lift === kind);
  console.log(`  ${kind} lift makes a sound       ${check(rows.every((x) => x.backfires > 0 || x.burbles > 0),
    `a ${rows[0].ms} ms lift at 162 km/h produced no overrun sound at all at ` +
    rows.filter((x) => !x.backfires && !x.burbles).map((x) => `${x.fps} fps`).join(", "))}`);
}

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length > 1 ? "s" : ""}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe same lift makes the same noise at 30, 60 and 144 fps.");
