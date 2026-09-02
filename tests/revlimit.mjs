// Which engines actually rev out, and which only claim to.
//
//   npm run dev            # in another shell
//   npm run test:revlimit
//
// THE LAW: an engine reaches its rev limiter if, and only if, its
// gearbox is geared to take it there.
//
// The game had five engines with five redlines — 8,400 for the 1.6 and
// 6,200 for the 5.7 — and one gearbox for all of them. GEARS is a list
// of SPEEDS, identical for every car, so every engine ran to the top of
// every gear and every engine bounced off its limiter in every one. The
// dial's numerals differed and nothing else did: "high revving" was a
// label printed on the tacho rather than something a car does.
//
// Gearing is chosen for an engine, which is why EngineSpec.shiftAt
// exists. A short-stroke screamer with nothing underneath its power
// peak is geared to be held against the stop, because that is the only
// place it works. A 5.7 with flat torque is geared long and changed up
// early, and revving it out would be noise rather than speed.
//
// So this drives each engine up through the box at full throttle and
// asks two things of it: how far up its own band the needle actually
// went, and whether the limiter ever fired. Both come off the HUD,
// which is what the player reads, rather than off an internal the test
// would have to trust.

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

const engines = await fetch("http://localhost:3000/api/grn/v1/gamedata")
  .then((r) => r.json())
  .then((d) => d.engines)
  .catch(() => null);

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
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
await page.waitForTimeout(2000);

const r = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const specs = window.__grnEngines;

  // Read the HUD the way the player does — by standing in front of the
  // event the shell listens to. The engine has no snapshot getter, and
  // inventing one for a test would mean the test was reading a number
  // nothing else reads.
  let last = null;
  const realHud = e.events.onHud;
  e.events.onHud = (d) => { last = d; return realHud?.call(e.events, d); };

  const out = [];
  for (const spec of specs) {
    // Fit the engine through the GARAGE, not by assigning to tune.
    // applyGarage is what rebuilds the tune, the sound and the shell,
    // and a test that pokes tune.engine directly would be measuring a
    // car the game cannot actually be in.
    const g = JSON.parse(localStorage.getItem("gulf-road-nights-garage") || "{}");
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
      ...g, car: "deera-sedan", cars: ["deera-sedan"], kd: 999999,
      builds: { "deera-sedan": {
        owned: [`engine-${spec.id}`],
        equipped: { engine: `engine-${spec.id}` },
        tint: 0,
      } },
    }));
    e.applyGarage();
    await new Promise((r2) => setTimeout(r2, 120));

    e.setPaused(false);
    e.locked = false;
    e.player.speed = 2;
    e.gearHeld = 0;
    e.setTouchInput({ throttle: 1 });
    for (let i = 0; i < 30; i++) e.update(1 / 60);

    let peakFrac = 0;
    let peakLimiter = 0;
    const gearsSeen = new Set();
    let fitted = null;
    for (let i = 0; i < 60 * 60; i++) {
      e.setTouchInput({ throttle: 1 });
      e.update(1 / 60);
      const t = last?.tach;
      if (!t) continue;
      fitted = t.redline;
      gearsSeen.add(t.gear);
      // Intermediate gears only: in top there is no gear above to change
      // into, so every car sits against its governor there and the
      // question this test asks does not apply.
      if (t.gear > 0 && t.gear < 6) {
        if (t.frac > peakFrac) peakFrac = t.frac;
        if (t.limiter > peakLimiter) peakLimiter = t.limiter;
      }
      if (e.player.speed * 3.6 > 300) break;
    }
    out.push({
      id: spec.id, name: spec.name, redline: spec.redlineRpm, shiftAt: spec.shiftAt,
      fitted,
      peakFrac: +peakFrac.toFixed(3), peakLimiter: +peakLimiter.toFixed(3),
      peakRpm: Math.round(spec.idleRpm + (spec.redlineRpm - spec.idleRpm) * peakFrac),
      gears: gearsSeen.size,
    });
  }
  e.events.onHud = realHud;
  e.setPaused(true);
  return out;
});
await browser.close();

console.log("\n=== WHICH ENGINES REV OUT ===");
console.log("  engine            redline  shiftAt   peak rev   peak rpm   limiter");
for (const x of r) {
  console.log(
    `  ${x.name.padEnd(16)} ${String(x.redline).padStart(7)}  ${String(x.shiftAt).padStart(7)}   ` +
    `${x.peakFrac.toFixed(2).padStart(8)}   ${String(x.peakRpm).padStart(8)}   ${x.peakLimiter.toFixed(2).padStart(7)}`
  );
}

// The garage actually fitted what the test asked for. Without this the
// table can be five rows describing one engine, all agreeing perfectly.
const wrong = r.filter((x) => x.fitted !== x.redline);
console.log(`\n  the garage fitted each one ${check(wrong.length === 0,
  `${wrong.length} engine(s) never reached the car: asked for ${wrong[0]?.name} at ${wrong[0]?.redline} rpm and the HUD showed ${wrong[0]?.fitted}`)}`);

for (const x of r) {
  const shouldRevOut = x.shiftAt >= 0.999;
  if (shouldRevOut) {
    console.log(`  ${x.name.padEnd(16)} revs out       ${check(x.peakLimiter > 0,
      `${x.name} is geared to the limiter (shiftAt ${x.shiftAt}) and never reached it — peak ${x.peakFrac} of the band`)}`);
  } else {
    console.log(`  ${x.name.padEnd(16)} is short-shifted ${check(x.peakLimiter === 0,
      `${x.name} changes up at ${x.shiftAt} of its band and still hit its limiter (${x.peakLimiter}) — the box is not respecting the engine`)}`);

  }
}
// The needle has to visibly stop short, and this is the tolerance-free
// way to say it: every short-shifted engine peaks below every engine
// geared to the limiter. Comparing the engines against EACH OTHER needs
// no allowance for the shift hysteresis, which is a real 2.5 km/h and
// carries every engine about 0.05 of a gear span past its own shift
// point — a first draft asserted peak <= shiftAt + 0.02 and failed
// three engines for behaving correctly.
{
  const out = r.filter((x) => x.shiftAt < 0.999).map((x) => x.peakFrac);
  const revvers = r.filter((x) => x.shiftAt >= 0.999).map((x) => x.peakFrac);
  const worst = Math.max(...out, 0);
  const least = Math.min(...revvers, 1);
  console.log(`\n  short-shifted stop lower  ${check(out.length === 0 || worst < least,
    `a short-shifted engine reached ${worst} of its band while an engine geared to the limiter reached only ${least}`)}`);
}

// The whole point is that they are NOT all the same any more.
const fracs = new Set(r.map((x) => x.peakFrac.toFixed(2)));
console.log(`\n  the five differ      ${check(fracs.size > 1,
  `every engine peaked at the same ${[...fracs][0]} of its band — the gearbox still has no opinion about which engine it is bolted to`)}`);

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length > 1 ? "s" : ""}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nonly the engines geared to scream, scream.");
