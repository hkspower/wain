// How the shell sits on its springs.
//
//   npm run dev
//   node tests/body.mjs
//
// Body roll used to be a fraction of the angle the car was POINTING at:
// `heading * 0.06 + driftYaw * 0.1`. That is not why a car leans. A car
// leans because its tyres are pushing it sideways, so the old model got
// it backwards in both directions at once — a car crawling through a car
// park at full lock leant as hard as one at 200 through a sweeper, and a
// fast sweeper taken with the wheel nearly straight barely leant at all.
//
// Every check here is written to fail against that model specifically:
//
//   speed      same steering, more speed, more lean. The angle-based
//              model cannot do this: the angle is the same.
//   sweeper    the road's own curvature leans the car with the wheel
//              straight. The angle-based model gives zero.
//   direction  and it leans OUT of the corner, like a car.
//   springs    it settles rather than snapping, and rocks a little on
//              the way.
//   pitch      the nose follows what the car is DOING, not where the
//              pedals are: pinned against the governor is full throttle
//              and no acceleration, and must not squat.
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
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
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
await page.waitForTimeout(3000);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const DEG = 180 / Math.PI;

/** Hold a state for `frames` and report where the body ended up. */
const hold = (st) =>
  page.evaluate((s) => {
    const e = window.__grnEngine;
    e.setPaused(true);
    const at = s.at ?? 2400;
    const park = () => {
      const away = e.track.wrap(at + e.track.length / 2);
      for (const t of e.traffic) t.s = away;
      if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
      e.player.lat = 0;
    };
    // Reset the springs so each state is measured from rest rather than
    // from wherever the last one left the body rocking.
    e.roll = 0; e.rollVel = 0; e.pitch = 0; e.pitchVel = 0;
    e.heading = 0; e.driftYaw = 0; e.prevBeta = 0;
    e.player.s = at;
    e.player.speed = s.speed;
    e.prevSpeed = s.speed;
    const trace = [];
    for (let i = 0; i < (s.frames ?? 90); i++) {
      park();
      if (s.holdSpeed !== false) e.player.speed = s.speed;
      e.player.s = at;
      e.setTouchInput({ throttle: s.throttle ?? 0, brake: s.brake ?? 0, steer: s.steer ?? 0 });
      e.update(1 / 60);
      trace.push(+e.roll.toFixed(5));
    }
    return {
      roll: +e.roll.toFixed(5),
      pitch: +e.pitch.toFixed(5),
      lat: +e.latAccel.toFixed(3),
      speedKmh: +(e.player.speed * 3.6).toFixed(1),
      trace,
    };
  }, st);

// --- 1. Force, not angle -------------------------------------------
// The same steering input at three speeds. Lateral acceleration goes as
// v-squared, so the lean has to climb steeply. An angle-based model
// returns the same number three times.
const slow = await hold({ speed: 8, steer: 0.6 });
const mid = await hold({ speed: 22, steer: 0.6 });
const fast = await hold({ speed: 40, steer: 0.6 });
console.log(
  `speed     ${check(
    Math.abs(fast.roll) > Math.abs(mid.roll) * 1.4 &&
      Math.abs(mid.roll) > Math.abs(slow.roll) * 1.4,
    `the same lock leans the car ${(slow.roll * DEG).toFixed(2)} / ${(mid.roll * DEG).toFixed(2)} / ` +
      `${(fast.roll * DEG).toFixed(2)} deg at 29 / 79 / 144 km/h — the lean is not coming from force`
  )}  same lock at ${slow.speedKmh} / ${mid.speedKmh} / ${fast.speedKmh} km/h leans ` +
    `${(slow.roll * DEG).toFixed(2)} / ${(mid.roll * DEG).toFixed(2)} / ${(fast.roll * DEG).toFixed(2)} deg`
);

// --- 2. The road leans it, with the wheel straight ------------------
// s = 3060 is the Ras Al-Ard sweep, the tightest corner on the lap at a
// 162 m radius. No steering input at all.
const sweeper = await hold({ speed: 36, steer: 0, at: 3060 });
const straight = await hold({ speed: 36, steer: 0, at: 2400 });
console.log(
  `sweeper   ${check(
    Math.abs(sweeper.roll) > Math.abs(straight.roll) + 0.004,
    `the tightest corner on the lap leans the car ${(sweeper.roll * DEG).toFixed(2)} deg against ` +
      `${(straight.roll * DEG).toFixed(2)} on the straight — the road's own curvature is not being felt`
  )}  ${(sweeper.roll * DEG).toFixed(2)} deg through Ras Al-Ard, ` +
    `${(straight.roll * DEG).toFixed(2)} on the straight, wheel straight in both`
);

// --- 3. It leans OUT ------------------------------------------------
const leftLock = await hold({ speed: 40, steer: -0.6 });
const rightLock = await hold({ speed: 40, steer: 0.6 });
console.log(
  `direction ${check(
    Math.sign(leftLock.roll) !== Math.sign(rightLock.roll) &&
      Math.sign(leftLock.roll) === -Math.sign(leftLock.lat) &&
      Math.sign(rightLock.roll) === -Math.sign(rightLock.lat),
    `lean and cornering force do not oppose: left ${leftLock.roll} vs ${leftLock.lat}, ` +
      `right ${rightLock.roll} vs ${rightLock.lat} — the car is leaning INTO the corner`
  )}  left lock ${(leftLock.roll * DEG).toFixed(2)} deg at ${leftLock.lat} m/s2, ` +
    `right lock ${(rightLock.roll * DEG).toFixed(2)} deg at ${rightLock.lat} m/s2`
);
// And not so far that it looks like a boat.
const worst = Math.max(Math.abs(leftLock.roll), Math.abs(rightLock.roll));
console.log(
  `limit     ${check(
    worst * DEG < 6,
    `the shell leans ${(worst * DEG).toFixed(1)} degrees, which is a bus`
  )}  never past ${(worst * DEG).toFixed(2)} deg`
);

// --- 4. Springs, not a lerp -----------------------------------------
// A step input into a damped spring overshoots and settles. A first-
// order lerp approaches from one side and never crosses.
const step = await hold({ speed: 40, steer: 0.8, frames: 150 });
const peak = Math.max(...step.trace.map(Math.abs));
const settled = Math.abs(step.trace[step.trace.length - 1]);
console.log(
  `springs   ${check(
    peak > settled * 1.02,
    `roll rose to ${(peak * DEG).toFixed(3)} deg and settled at ${(settled * DEG).toFixed(3)} — ` +
      `no overshoot, so this is still a lerp rather than a suspension`
  )}  overshoots to ${(peak * DEG).toFixed(2)} deg, settles at ${(settled * DEG).toFixed(2)}`
);

// --- 5. Pitch follows the car, not the pedals -----------------------
const braking = await hold({ speed: 44, brake: 1, holdSpeed: false, frames: 40 });
const launching = await hold({ speed: 3, throttle: 1, holdSpeed: false, frames: 40 });
console.log(
  `pitch     ${check(
    braking.pitch > 0.008 && launching.pitch < -0.002,
    `braking pitches ${braking.pitch} and launching ${launching.pitch} — the nose is not moving`
  )}  nose down ${(braking.pitch * DEG).toFixed(2)} deg braking, ` +
    `up ${(-launching.pitch * DEG).toFixed(2)} deg launching`
);
// The falsifier for the pedal-based model. Pinned against the governor
// is full throttle and zero acceleration: a car that squats here is
// reading the pedal, not the road.
const governed = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.roll = 0; e.rollVel = 0; e.pitch = 0; e.pitchVel = 0;
  e.heading = 0; e.driftYaw = 0;
  const park = () => {
    const away = e.track.wrap(2400 + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
    e.player.s = 2400; e.player.lat = 0;
  };
  e.player.speed = e.tune.topSpeedKmh / 3.6;
  e.prevSpeed = e.player.speed;
  for (let i = 0; i < 120; i++) {
    park();
    e.setTouchInput({ throttle: 1, brake: 0, steer: 0 });
    e.update(1 / 60);
  }
  return { pitch: +e.pitch.toFixed(5), speedKmh: +(e.player.speed * 3.6).toFixed(1) };
});
console.log(
  `governor  ${check(
    Math.abs(governed.pitch) < 0.004,
    `pinned on the limiter at full throttle the nose sits at ${governed.pitch} rad — ` +
      `that is a car squatting because the pedal is down, not because it is accelerating`
  )}  ${governed.speedKmh} km/h, full throttle, nose within ` +
    `${(Math.abs(governed.pitch) * DEG).toFixed(2)} deg of level`
);

// --- The panels are crowned -------------------------------------------
//
// Every shell in this game is an ExtrudeGeometry: a side profile pushed
// across the width with a bevel round the edge, which gives a rounded
// EDGE around a perfectly FLAT slab. Real bodywork has none of that —
// the roof and bonnet dome across, the flanks bulge at the shoulder and
// tuck at the rocker, the glasshouse leans in.
//
// Asked of the FUNCTION rather than of a car. Whether a particular
// silhouette happens to look curved in a screenshot is a fact about the
// screenshot; what the surfacing pass does to a section is a fact about
// the surfacing pass, and it is the one that has to hold for all
// fifteen.
const crown = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const { crownShell, CROWN } = window.__grnCrown;
  // A plain box, 2 m across and 1 m tall: a slab with no curvature
  // anywhere, which is exactly what the shells were.
  const box = new THREE.BoxGeometry(2, 1, 4, 24, 24, 24);
  const before = { halfW: [], top: [] };
  const after = { halfW: [], top: [] };
  // Half-width at three heights, and the top surface's height at the
  // centre against its height at the edge.
  const sample = (geo, out) => {
    const p = geo.attributes.position;
    const bands = [0.2, 0.55, 0.9];
    for (const b of bands) {
      let w = 0;
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i) + 0.5;              // 0..1 up the box
        if (Math.abs(t - b) > 0.06) continue;
        w = Math.max(w, Math.abs(p.getX(i)));
      }
      out.halfW.push(+w.toFixed(4));
    }
    // The top surface: highest vertex near the centre line, and highest
    // near the edge.
    let mid = -9, edge = -9;
    for (let i = 0; i < p.count; i++) {
      const x = Math.abs(p.getX(i));
      const y = p.getY(i);
      if (x < 0.12) mid = Math.max(mid, y);
      if (x > 0.85) edge = Math.max(edge, y);
    }
    out.top.push(+mid.toFixed(4), +edge.toFixed(4));
  };
  sample(box, before);
  crownShell(box, CROWN.body);
  sample(box, after);
  return { before, after, spec: CROWN.body };
});
const [bLow, bMid, bHigh] = crown.before.halfW;
const [aLow, aMid, aHigh] = crown.after.halfW;
console.log(
  `\ncrown     a flat 2 m slab, half-width at 20/55/90% height: ` +
    `${bLow}/${bMid}/${bHigh} -> ${aLow}/${aMid}/${aHigh} m`
);
console.log(
  `tumblehome ${check(aHigh < aMid - 0.008,
    `the section is ${aHigh} m at the roof against ${aMid} at the shoulder — it is still a slab`)}  ` +
    `${((1 - aHigh / aMid) * 100).toFixed(1)}% narrower at the roof than at the shoulder`
);
console.log(
  `rocker     ${check(aLow < aMid - 0.004,
    `the section is ${aLow} m at the rocker against ${aMid} at the shoulder`)}  ` +
    `${((1 - aLow / aMid) * 100).toFixed(1)}% narrower at the rocker`
);
// And nothing got WIDER. Every detail on the flanks — mirrors, arch
// lips, side markers, the flag, a crew's decal — is anchored against the
// half-width the profile tables were written with, so a section that
// bulged outward would leave all of them sunk inside the paint.
console.log(
  `no bulge   ${check(Math.max(aLow, aMid, aHigh) <= Math.max(bLow, bMid, bHigh) + 1e-6,
    `the crown pushed the section out to ${Math.max(aLow, aMid, aHigh)} m from ${Math.max(bLow, bMid, bHigh)}`)}  ` +
    `widest point unmoved at ${Math.max(aLow, aMid, aHigh)} m — nothing on the flanks sinks`
);
const [bTopMid, bTopEdge] = crown.before.top;
const [aTopMid, aTopEdge] = crown.after.top;
console.log(
  `dome       ${check(aTopMid - aTopEdge > 0.012,
    `the top falls ${(aTopMid - aTopEdge).toFixed(4)} m from centre to edge (was ${(bTopMid - bTopEdge).toFixed(4)})`)}  ` +
    `the top falls ${((aTopMid - aTopEdge) * 1000).toFixed(0)} mm from centre line to edge ` +
    `(flat slab: ${((bTopMid - bTopEdge) * 1000).toFixed(0)} mm)`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe body moves on its springs.");
