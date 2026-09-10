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

// --- The rival is a car too --------------------------------------------
// Rival and traffic shells were oriented by lookAt alone: through the
// same Ras Al-Ard sweep a rival sat dead flat beside a player leaning
// two degrees, its wheels welded to that flat shell. They now go
// through the one attitude law with their own rollMax, the one hub
// solver, and the one road-wheel lock. Measured off the world matrix
// rather than the mesh's Euler angles — lookAt leaves those on the ±π
// branch, so rotation.z reads −3.14 on a car that is perfectly level.
const rivalCase = await page.evaluate(() => {
  const e = window.__grnEngine;
  const r = e.rival;
  if (!r) return null;
  e.setPaused(true);
  const V = e.camera.position.constructor;
  const tilt = (mesh) => {
    mesh.updateWorldMatrix(true, true);
    const x = new V().setFromMatrixColumn(mesh.matrixWorld, 0).normalize();
    const z = new V().setFromMatrixColumn(mesh.matrixWorld, 2).normalize();
    return { roll: Math.asin(x.y), pitch: -Math.asin(z.y) };
  };
  const hubs = (mesh) => {
    const R = mesh.userData.wheelR;
    return mesh.userData.wheels.map((w) => {
      w.updateWorldMatrix(true, false);
      return new V().setFromMatrixPosition(w.matrixWorld).y - mesh.position.y - R;
    });
  };
  const blobUp = (mesh) => {
    const c = mesh.userData.contact;
    c.updateWorldMatrix(true, false);
    // The blob is a plane whose local +z is its normal.
    return new V().setFromMatrixColumn(c.matrixWorld, 2).normalize().y;
  };
  // Park everyone else far away, put the player on the straight, and
  // hold the rival on the sweep at a steady 33 m/s (the AI would
  // otherwise govern it down to its cruise speed).
  const away = e.track.wrap(3060 + e.track.length / 2);
  for (const t of e.traffic) t.s = away;
  e.player.s = 2400; e.player.speed = 30; e.player.lat = 0;
  e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
  r.state = "cruise";
  r.lat = 0; r.targetLat = 0;
  let worstHub = 0, worstBlob = 0, peak = 0;
  for (let i = 0; i < 90; i++) {
    r.s = 3040 + i * 0.4; r.speed = 33; r.sp = 100;
    e.update(1 / 60);
    r.speed = 33;
    const t = tilt(r.mesh);
    peak = Math.max(peak, Math.abs(t.roll));
    for (const h of hubs(r.mesh)) worstHub = Math.max(worstHub, Math.abs(h));
    worstBlob = Math.max(worstBlob, Math.abs(1 - blobUp(r.mesh)));
  }
  const sweep = tilt(r.mesh);
  const bodyRoll = r.body.roll;
  const lat = r.body.latAccel;
  // The player through the same corner, the same way, for the sign.
  e.player.s = 3070; e.player.speed = 33;
  e.roll = 0; e.rollVel = 0; e.prevBeta = 0;
  for (let i = 0; i < 90; i++) { e.player.s = 3070; e.player.speed = 33; e.update(1 / 60); }
  const playerRoll = e.roll;
  // A lane change turns the road wheels the way the hands are turned.
  r.s = 2400; r.lat = 0; r.targetLat = 4;
  let roadY = 0, handZ = 0;
  for (let i = 0; i < 14; i++) {
    r.speed = 33;
    e.update(1 / 60);
    const w = r.mesh.userData.wheels[0].rotation.y;
    if (Math.abs(w) > Math.abs(roadY)) { roadY = w; handZ = r.mesh.userData.driver.wheel.rotation.z; }
  }
  const order = r.mesh.userData.wheels[0].rotation.order;
  // Traffic: one civilian on the same sweep, held there.
  const t0 = e.traffic[0];
  t0.s = 3050; t0.lat = 0;
  let tPeak = 0, tHub = 0;
  for (let i = 0; i < 90; i++) {
    t0.s = 3040 + i * 0.4; t0.speed = 33;
    e.update(1 / 60);
    tPeak = Math.max(tPeak, Math.abs(tilt(t0.mesh).roll));
    for (const h of hubs(t0.mesh)) tHub = Math.max(tHub, Math.abs(h));
  }
  t0.s = away;
  return {
    roll: sweep.roll, pitch: sweep.pitch, bodyRoll, lat, playerRoll, peak, worstHub, worstBlob,
    rollMax: r.body.rollMax, car: r.def.carId, roadY, handZ, order, tPeak, tHub, tRollMax: t0.body.rollMax,
  };
});
// --- ...and it is THEIR car, not a sedan ------------------------------
//
// The check above reads rollMax back off the rival's own body and
// compares the lean to it, so it agrees with whatever the code put
// there. That is not nothing — it catches the shell and the law drifting
// apart — but it cannot catch the rival being given the WRONG law, and
// the rival it measures is Abu Shanab in the Hawally 2T, which is a
// street sedan. rollMaxFor("sedan", "street") and rollMaxFor() are the
// same 5.99 degrees, so the one rival on the road is the one car in the
// roster where a fallback to the default is invisible.
//
// Verified by mutation: replacing the rival's
// rollMaxFor(car.style, car.kit) with a bare rollMaxFor() — every rival
// in the game leaning like a saloon, the Storm S8 2.6 times softer than
// it should be — left this file entirely green.
//
// So walk the roster. Seven of the eight rivals drive something that is
// not a street sedan, and their spread is the evidence: a supercar on an
// attack kit leans 2.26 degrees where the saloon leans 5.99.
const rivalSpread = await page.evaluate(() => {
  const e = window.__grnEngine;
  const proto = Object.getPrototypeOf(e);
  const seen = [];
  const was = e.rivalIndex;
  for (let i = 0; i < 8; i++) {
    e.rivalIndex = i;
    proto.spawnRival.call(e);
    if (!e.rival) continue;
    seen.push({ car: e.rival.def.carId ?? "?", rollMax: +e.rival.body.rollMax.toFixed(6) });
  }
  e.rivalIndex = was;
  proto.spawnRival.call(e);
  return seen;
});
{
  const DEGF = (r) => (r * DEG).toFixed(2);
  const values = rivalSpread.map((r) => r.rollMax);
  const distinct = new Set(values).size;
  const soft = Math.max(...values), stiff = Math.min(...values);
  console.log(
    `roster    ${rivalSpread.length} rivals, ${distinct} different roll gradients between them  ` +
      rivalSpread.map((r) => `${r.car}:${DEGF(r.rollMax)}`).join("  ")
  );
  console.log(
    `each own  ${check(distinct > 1,
      "every rival on the roster leans by the same number — they are being given the default gradient instead of their own car's")}  ` +
      `softest ${DEGF(soft)} deg, stiffest ${DEGF(stiff)} deg  ` +
      // A supercar and a saloon must not lean alike. Ratio rather than a
      // level, so retuning ROLL_DEG_PER_G does not move the bar.
      check(soft / stiff > 1.8,
        `the softest rival leans only ${(soft / stiff).toFixed(2)}x the stiffest — the roster has lost its spread`)
  );
}

if (!rivalCase) fail.push("no rival to measure");
else {
  const c = rivalCase;
  console.log(
    `rival     ${check(Math.abs(c.roll) > 0.004 && Math.sign(c.roll) === Math.sign(c.playerRoll),
      `the rival leans ${(c.roll * DEG).toFixed(2)} deg through Ras Al-Ard against the player's ${(c.playerRoll * DEG).toFixed(2)}`)}  ` +
      `${c.car} leans ${(c.roll * DEG).toFixed(2)} deg through Ras Al-Ard at ${c.lat.toFixed(1)} m/s2 ` +
      `(player ${(c.playerRoll * DEG).toFixed(2)}, its rollMax ${(c.rollMax * DEG).toFixed(2)})`
  );
  console.log(
    `          ${check(Math.abs(c.roll - c.bodyRoll) < 1e-3, `the shell shows ${c.roll} while the law holds ${c.bodyRoll}`)}  ` +
      `shell and law agree; peak ${(c.peak * DEG).toFixed(2)} deg never past rollMax ${check(c.peak <= c.rollMax * 1.06, `overshot rollMax: ${c.peak} vs ${c.rollMax}`)}`
  );
  console.log(
    `hubs      ${check(c.worstHub < 0.002, `a rival hub left the road by ${(c.worstHub * 1000).toFixed(1)} mm`)}  ` +
      `worst ${(c.worstHub * 1000).toFixed(1)} mm off the road through the lean; ` +
      `shadow ${check(c.worstBlob < 1e-4, `the contact blob tilted with the shell (${c.worstBlob})`)} stays flat`
  );
  console.log(
    `steer     ${check(Math.abs(c.roadY) > 0.02 && Math.sign(c.roadY) === Math.sign(c.handZ),
      `road wheel ${c.roadY.toFixed(3)} rad vs hand wheel ${c.handZ.toFixed(3)} in a lane change`)}  ` +
      `road wheel ${c.roadY.toFixed(3)} rad, hand wheel ${c.handZ.toFixed(3)} rad, order ${c.order} ${check(c.order === "YZX", `wheel order ${c.order}`)}`
  );
  console.log(
    `traffic   ${check(c.tPeak > 0.004 && c.tHub < 0.002, `a civilian leans ${(c.tPeak * DEG).toFixed(2)} deg, hubs ${(c.tHub * 1000).toFixed(1)} mm off`)}  ` +
      `a civilian leans ${(c.tPeak * DEG).toFixed(2)} deg (rollMax ${(c.tRollMax * DEG).toFixed(2)}, the softest car), hubs within ${(c.tHub * 1000).toFixed(1)} mm`
  );
}

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe body moves on its springs.");
