// The five engines, measured on the live game.
//
//   npm run dev
//   node tests/engines.mjs
//
// An engine swap is the easiest feature in a racing game to fake. Five
// entries in a shop, five prices, five paragraphs of prose, one number
// each that goes up — and nothing that a driver could tell apart with
// their eyes shut. So nothing here reads the catalogue and believes it.
// Every claim is taken off the running sim or the running audio graph:
//
//   the split      two fours, two sixes, one eight
//   the honesty    every curve averages the same, so a swap is a CHOICE
//                  and not a purchase
//   the shape      the 1.6 and the 5.7 are mirror images, and the sim
//                  agrees with the spec sheet at both ends of the tacho
//   the note       firing frequency is rpm/60 x cylinders/2, off the
//                  actual oscillator, for all five
//   the lope       the V8 modulates its exhaust and nothing else does
//   the road       fit each engine to the SAME car and time it: the V8
//                  has to win the low-speed pull and the 1.6 the top end
//   the governor   and none of it may cost a car its top speed
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
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--autoplay-policy=no-user-gesture-required"],
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
await page.evaluate(() => window.__grnEngine.sound?.resume());
await page.waitForTimeout(500);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// --- 1. The roster ---------------------------------------------------
const specs = await page.evaluate(() => window.__grnEngines.map((e) => ({ ...e })));
const counts = specs.reduce((a, e) => ((a[e.cylinders] = (a[e.cylinders] ?? 0) + 1), a), {});
console.log(
  `roster    ${check(
    specs.length === 5 && counts[4] === 2 && counts[6] === 2 && counts[8] === 1,
    `roster is ${specs.length} engines: ${JSON.stringify(counts)} — want two 4s, two 6s, one 8`
  )}  ${specs.map((e) => `${e.name.split(" ")[0]}(${e.cylinders})`).join(" ")}`
);

// --- 2. Every curve is worth the same on average ---------------------
// This is the whole design. If one engine's mean torque is higher than
// another's, the shop has a best engine and the choice evaporates.
const shapes = await page.evaluate(() => {
  const { torqueShape } = window.__grnEngineMath;
  return window.__grnEngines.map((e) => {
    const N = 400;
    let sum = 0;
    const at = {};
    for (let i = 0; i < N; i++) sum += torqueShape(e, 0.12 + (0.88 * (i + 0.5)) / N);
    for (const r of [0.15, 0.3, 0.5, 0.7, 0.9, 1.0]) at[r] = +torqueShape(e, r).toFixed(3);
    return { id: e.id, cylinders: e.cylinders, mean: +(sum / N).toFixed(4), at };
  });
});
const worstMean = Math.max(...shapes.map((s) => Math.abs(s.mean - 1)));
console.log(
  `average   ${check(
    worstMean < 0.005,
    `a curve averages ${(1 + worstMean).toFixed(4)} instead of 1.0 — that engine is a free upgrade`
  )}  every engine means 1.000 ±${worstMean.toFixed(4)} across the rev range`
);
console.log("curve     " + [0.15, 0.3, 0.5, 0.7, 0.9, 1.0].map((r) => String(r).padStart(6)).join(""));
for (const s of shapes) {
  console.log(
    `  ${s.id.padEnd(8)}` +
      [0.15, 0.3, 0.5, 0.7, 0.9, 1.0].map((r) => s.at[r].toFixed(2).padStart(6)).join("")
  );
}

// --- 3. The shapes are actually different ----------------------------
const byId = Object.fromEntries(shapes.map((s) => [s.id, s]));
const small = byId["i4-16"], big = byId["v8-57"];
console.log(
  `character ${check(
    big.at[0.15] > small.at[0.15] * 2 && small.at[0.9] > big.at[0.9] * 1.6,
    `the 1.6 and the 5.7 are not opposites: low ${small.at[0.15]} vs ${big.at[0.15]}, ` +
      `high ${small.at[0.9]} vs ${big.at[0.9]}`
  )}  off idle the V8 makes ${(big.at[0.15] / small.at[0.15]).toFixed(1)}x the 1.6; ` +
    `at 90% revs the 1.6 makes ${(small.at[0.9] / big.at[0.9]).toFixed(1)}x the V8`
);
// No two engines may peak in the same place, or two of the five are the
// same engine with different prose.
const peaks = specs.map((e) => e.peakAt).sort((a, b) => a - b);
const closest = Math.min(...peaks.slice(1).map((p, i) => p - peaks[i]));
console.log(
  `distinct  ${check(closest >= 0.05, `two engines peak ${closest.toFixed(3)} apart — they are the same engine`)}` +
    `  peaks at ${peaks.join(", ")}`
);

// --- 4. The note is the firing frequency -----------------------------
// Read off the real oscillator after fitting each engine and driving the
// sound engine at a known point in the rev range.
const notes = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const s = e.sound;
  // Pause first. The live loop calls sound.update() every frame with the
  // car's REAL state, so a hand-fed frame is overwritten before the
  // automation has moved — which is how the first run of this test
  // measured every engine at idle and reported all five as wrong.
  e.setPaused(true);
  const out = [];
  for (const spec of window.__grnEngines) {
    s.setEngine(spec);
    const rev = 0.8;
    const f = { speedKmh: 160, throttle: 1, rpmFrac: rev, gear: 4, skid: 0 };
    for (let i = 0; i < 12; i++) s.update(f);
    await new Promise((r) => setTimeout(r, 320));
    const crankRpm = spec.idleRpm + (spec.redlineRpm - spec.idleRpm) * rev;
    out.push({
      id: spec.id,
      cylinders: spec.cylinders,
      crankRpm: Math.round(crankRpm),
      want: +((crankRpm / 60) * (spec.cylinders / 2)).toFixed(1),
      got: +s.engOscs[0].frequency.value.toFixed(1),
      sub: +s.engOscs[2].frequency.value.toFixed(1),
    });
  }
  return out;
});
let worstNote = 0;
for (const n of notes) {
  worstNote = Math.max(worstNote, Math.abs(n.got - n.want) / n.want);
  check(
    Math.abs(n.got - n.want) / n.want < 0.04,
    `${n.id} sings ${n.got} Hz at ${n.crankRpm} rpm; ${n.cylinders} cylinders fire at ${n.want} Hz`
  );
  check(
    Math.abs(n.sub - n.got / 2) / n.got < 0.05,
    `${n.id}'s sub-octave is at ${n.sub} Hz, not half of ${n.got}`
  );
}
console.log(
  `note      ${check(worstNote < 0.04, "an engine does not sing at its own firing rate")}  ` +
    notes.map((n) => `${n.id.split("-")[0]}:${n.got}Hz`).join(" ")
);
// Same rpm, twice the cylinders, twice the firing rate. The one fact
// that makes cylinder count audible rather than decorative.
const four = notes.find((n) => n.id === "i4-20t");
const eight = notes.find((n) => n.id === "v8-57");
const ratioAtSameRpm =
  (eight.got / eight.crankRpm) / (four.got / four.crankRpm);
console.log(
  `cylinders ${check(
    Math.abs(ratioAtSameRpm - 2) < 0.06,
    `at the same rpm the V8 fires ${ratioAtSameRpm.toFixed(2)}x as often as the four, not 2x`
  )}  V8 fires ${ratioAtSameRpm.toFixed(2)}x per revolution against the four`
);

// --- 5. Only the V8 lopes --------------------------------------------
const lope = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const s = e.sound;
  e.setPaused(true);
  const out = [];
  for (const spec of window.__grnEngines) {
    s.setEngine(spec);
    const f = { speedKmh: 30, throttle: 0.6, rpmFrac: 0.2, gear: 1, skid: 0 };
    for (let i = 0; i < 12; i++) s.update(f);
    await new Promise((r) => setTimeout(r, 320));
    out.push({
      id: spec.id,
      depth: +s.lopeAmt.gain.value.toFixed(5),
      hz: +s.lopeOsc.frequency.value.toFixed(2),
      exhaust: +s.exhaustGain.gain.value.toFixed(5),
    });
  }
  return out;
});
const v8 = lope.find((l) => l.id === "v8-57");
const others = lope.filter((l) => l.id !== "v8-57");
console.log(
  `lope      ${check(
    v8.depth > 0 && others.every((o) => o.depth === 0),
    others.some((o) => o.depth > 0)
      ? `${others.find((o) => o.depth > 0).id} lopes and it has no business doing so`
      : "the V8 does not lope"
  )}  V8 modulates ${((v8.depth / v8.exhaust) * 100).toFixed(0)}% of its exhaust at ${v8.hz} Hz; ` +
    `the other four are flat`
);
// Half crank order, or it is a tremolo rather than a firing interval.
const v8spec = specs.find((s) => s.id === "v8-57");
const wantHz = (v8spec.idleRpm + (v8spec.redlineRpm - v8spec.idleRpm) * 0.2) / 120;
check(
  Math.abs(v8.hz - wantHz) / wantHz < 0.06,
  `the lope runs at ${v8.hz} Hz where half crank order is ${wantHz.toFixed(2)} Hz`
);

// --- 6. On the road --------------------------------------------------
// The payoff, and the one section that has to be set up carefully to
// mean anything.
//
// Revs are not speed. The gearbox sweeps the needle from the bottom of
// its range to the top INSIDE EVERY GEAR, so "accelerating from 10 to 90
// km/h" runs through the whole tacho twice and asks every engine the
// same question in the same order — which is why the first version of
// this measured a near dead heat and proved nothing.
//
// So both runs happen inside ONE gear, over the same stretch of road at
// the same drag, and differ only in which part of the rev range they
// cover: the bottom of fifth, and the top of it.
//
// Only the curve is swapped. powerMult, the mass tax and everything else
// an engine brings with it in the garage are held constant here on
// purpose — this is a question about curve shape, and letting the other
// knobs move would answer a different one.
const road = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const out = [];
  // A reference car fast enough to have a top gear worth measuring — the
  // starter car is governed at 180 km/h and never reaches fifth — and a
  // real one, taken from the showroom rather than made up.
  Object.assign(e.tune, window.__grnTuneFor("efreet-rx-kai"));
  // Everything else on the road, moved half a lap away. The car is pinned
  // at one point on the track for these runs, so traffic that is left
  // circulating drives straight into a stationary target — which is what
  // dragged a car sitting on its 400 km/h limiter down to 135.
  const clearRoad = () => {
    const away = e.track.wrap(2400 + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
  };
  const drive = (from, to) => {
    e.setPaused(true);
    clearRoad();
    e.player.speed = from / 3.6;
    e.player.lat = 0;
    e.heading = 0;
    e.driftYaw = 0;
    e.setTouchInput({ throttle: 1, brake: 0, steer: 0 });
    let t = 0;
    for (let i = 0; i < 20000 && e.player.speed * 3.6 < to; i++) {
      // Pinned every frame, not once before the loop. Gulf Road bends,
      // and a car left to itself at 300-plus km/h wanders across the lane
      // and scrubs speed on the barrier — which is a cornering
      // measurement wearing an acceleration test's clothes. The first
      // version of this did exactly that and reported a car losing 250
      // km/h while sitting on its own limiter.
      e.player.s = 2400;
      e.player.lat = 0;
      e.heading = 0;
      e.driftYaw = 0;
      clearRoad();
      e.update(1 / 120);
      t += 1 / 120;
    }
    return e.player.speed * 3.6 >= to ? +t.toFixed(3) : null;
  };
  for (const spec of window.__grnEngines) {
    e.tune.engine = spec;
    out.push({
      id: spec.id,
      // Fifth runs 260-320 km/h, so these are revs 0.12-0.58 and
      // 0.63-0.97 of the same gear.
      low: drive(265, 295),
      high: drive(298, 318),
    });
  }
  return out;
});
for (const r of road) {
  console.log(
    `  ${r.id.padEnd(8)} bottom of fifth ${String(r.low).padStart(6)} s   top of fifth ${String(r.high).padStart(6)} s`
  );
}
const rBy = Object.fromEntries(road.map((r) => [r.id, r]));
console.log(
  `low revs  ${check(
    rBy["v8-57"].low !== null &&
      rBy["i4-16"].low !== null &&
      rBy["v8-57"].low < rBy["i4-16"].low * 0.92,
    `down low the V8 takes ${rBy["v8-57"].low} s and the 1.6 ${rBy["i4-16"].low} s — ` +
      `torque off the bottom buys nothing`
  )}  V8 ${rBy["v8-57"].low} s vs 1.6 ${rBy["i4-16"].low} s`
);
console.log(
  `high revs ${check(
    rBy["i4-16"].high !== null &&
      rBy["v8-57"].high !== null &&
      rBy["i4-16"].high < rBy["v8-57"].high * 0.92,
    `up top the 1.6 takes ${rBy["i4-16"].high} s and the V8 ${rBy["v8-57"].high} s — revs buy nothing`
  )}  1.6 ${rBy["i4-16"].high} s vs V8 ${rBy["v8-57"].high} s`
);
// And the flat one is never the best or the worst at either end, which
// is exactly what "flat" is supposed to buy.
const order = (k) => road.filter((r) => r[k] !== null).sort((a, b) => a[k] - b[k]).map((r) => r.id);
console.log(`             bottom: ${order("low").join(" < ")}`);
console.log(`             top:    ${order("high").join(" < ")}`);

// --- 7. And nothing lost its governor --------------------------------
// The torque curve is folded into `power` ABOVE the ceiling solve
// precisely so this stays true. Move it below — scale the thrust after
// the curve has been solved — and every car quietly asymptotes short of
// its own limiter, which looks like nothing at all from the cockpit.
// `npm run test:topspeed` is the thorough guard on this across all
// fourteen cars; this is the same question asked of all five engines.
const governed = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const out = [];
  const clearRoad = () => {
    const away = e.track.wrap(2400 + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
  };
  // The fastest car in the showroom, because it has the least headroom
  // and is therefore the one a mistake shows up on first. A comfortable
  // reference car passes this check even when the torque IS applied in
  // the wrong place — measured, not assumed.
  //
  // Its REAL tune, not a plausible pair of numbers: an invented car whose
  // power and governor do not match falls a couple of km/h short of its
  // own limiter for reasons that have nothing to do with engines, and
  // then this check reports a bug that is entirely its own.
  Object.assign(e.tune, window.__grnTuneFor("efreet-rx-kai"));
  for (const spec of window.__grnEngines) {
    e.tune.engine = spec;
    e.setPaused(true);
    // Start AT the governor and see whether the car can hold it.
    //
    // Sitting exactly on the limiter is the sharp version of this
    // question: the curve is solved so that thrust equals drag at that
    // speed, so a correct build sits there indefinitely and a build with
    // the torque applied in the wrong place slides away from it at once.
    // Starting below it instead measures how FAST each engine converges
    // on an asymptote they all share, which is a real difference and
    // completely beside the point.
    e.player.speed = e.tune.topSpeedKmh / 3.6;
    e.player.lat = 0;
    e.heading = 0;
    e.driftYaw = 0;
    e.setTouchInput({ throttle: 1, brake: 0, steer: 0 });
    let held = Infinity;
    for (let i = 0; i < 1200; i++) {
      e.player.s = 2400;
      e.player.lat = 0;
      e.heading = 0;
      e.driftYaw = 0;
      clearRoad();
      e.update(1 / 120);
      held = Math.min(held, e.player.speed * 3.6);
    }
    out.push({
      id: spec.id,
      governor: Math.round(e.tune.topSpeedKmh),
      peak: Math.round(held * 10) / 10,
    });
  }
  return out;
});
const shortfall = Math.max(...governed.map((g) => g.governor - g.peak));
console.log(
  `governor  ${check(
    shortfall <= 1,
    `an engine leaves the car ${shortfall.toFixed(1)} km/h short of its governor: ` +
      governed.map((g) => `${g.id} ${g.peak}/${g.governor}`).join(", ")
  )}  governed at ${governed[0].governor}: ` + governed.map((g) => `${g.id.split("-")[0]} ${g.peak}`).join(", ")
);

// --- 8. The clutch -----------------------------------------------------
// A standing start is a slipping clutch holding the engine near its own
// torque peak. Without that, revFraction() reports the bottom of first
// at a standstill, the peaky engines make 0.4x torque, and the small
// cars physically cannot break traction — a car that can no longer chirp
// its tyres, which is a strange thing for this game to ship.
const clutch = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const out = [];
  const clearRoad = () => {
    const away = e.track.wrap(2400 + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
  };
  Object.assign(e.tune, window.__grnTuneFor("wain-special")); // the starter car
  for (const spec of window.__grnEngines) {
    e.tune.engine = spec;
    e.setPaused(true);
    e.player.speed = 0;
    e.player.lat = 0;
    e.heading = 0;
    e.driftYaw = 0;
    clearRoad();
    e.setTouchInput({ throttle: 1, brake: 0, steer: 0 });
    let spin = 0;
    let rev = 0;
    for (let i = 0; i < 12; i++) {
      e.player.s = 2400;
      e.player.speed = 0;              // held on the line, foot buried
      clearRoad();
      e.update(1 / 120);
      spin = Math.max(spin, e.wheelspin);
      rev = e.revFrac;
    }
    out.push({ id: spec.id, peakAt: spec.peakAt, rev: +rev.toFixed(3), spin: +spin.toFixed(2) });
  }
  return out;
});
const noSpin = clutch.filter((c) => c.spin <= 0);
const offPeak = clutch.filter((c) => Math.abs(c.rev - c.peakAt) > 0.02);
console.log(
  `clutch    ${check(
    noSpin.length === 0 && offPeak.length === 0,
    noSpin.length
      ? `${noSpin.map((c) => c.id).join(", ")} cannot break traction from a standstill`
      : `${offPeak.map((c) => `${c.id} launches at ${c.rev} not ${c.peakAt}`).join("; ")}`
  )}  every engine launches on its own torque peak and lights the tyres: ` +
    clutch.map((c) => `${c.id.split("-")[0]} ${c.spin}`).join(" ")
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nfive engines, and all five drive like themselves.");
