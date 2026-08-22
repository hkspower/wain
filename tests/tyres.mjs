// The tyres roll, and rolling means one specific thing.
//
//   npm run dev
//   node tests/tyres.mjs
//
// A wheel that is rolling and not sliding lays exactly as much tread on
// the road as the road it covers: turn it through an angle and the car
// moves that angle times the radius, no more and no less. Get that wrong
// and the car skates — the wheels turn, they just turn at a rate that
// belongs to a different car — and it is the one thing about a vehicle
// nobody has to be told to look for.
//
// It was wrong on every car in this game. The engine turned every wheel
// at v / 0.36, which is the radius in the CAR'S OWN units and was
// correct until each car was fitted to its real length in metres; the
// scales that fit ranges from 0.826 to 1.064, so the wheels ran 5.5% to
// 21.8% slow. The Zeta 300's turned 22% too slowly, which is a wheel
// skidding forward down a dry road at every speed.
//
// What follows checks the arithmetic that has to hold — arc equals
// distance — rather than "the number in the code is the number I
// expected", and it checks it on the car the player is driving.

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

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
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
await page.waitForFunction(() => !!window.__grnBuildCar, null, { timeout: 240000 });
await page.waitForTimeout(1500);

// --- 1. Every car knows its own radius --------------------------------
//
// The bookkeeping half, checked across the whole fleet because that is
// where the bug lived: one constant, right for the shape the wheel is
// modelled at and wrong for every shape it is actually built at. The
// recorded figure has to agree with the wheel that was actually built,
// to a millimetre, on all fifteen.
const fleet = await page.evaluate(async () => {
  const THREE = window.__grnThree;
  const res = await fetch("/api/grn/v1/cars").then((r) => r.json()).catch(() => null);
  const list = res?.cars ?? res ?? [];
  const out = [];
  for (const car of list) {
    const g = window.__grnBuildCar({
      body: 0x888888, accent: 0x007a3d, style: car.bodyStyle ?? "sedan",
      raceKit: car.kit === "attack", lengthM: car.lengthM, spoiler: false, stickers: false,
    });
    g.updateMatrixWorld(true);
    const w = (g.userData.wheels ?? [])[0];
    if (!w) continue;
    // Measured as the furthest any tread vertex sits from the axle, in
    // world units — NOT as the bounding box, which under-reports a
    // cylinder by up to (1 - cos(pi/segments)). The tyre is a 22-sided
    // prism, so its box is half a percent short of the circle it
    // stands for, and comparing a recorded radius against it fails
    // every car by about two millimetres for no reason anyone can act
    // on. The rolling radius is the circle, not the polygon.
    const centre = new THREE.Vector3();
    w.getWorldPosition(centre);
    let maxR = 0;
    w.traverse((o) => {
      if (!o.isMesh || o.userData.wheelPart !== "tire") return;
      const pos = o.geometry.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).sub(centre);
        // Perpendicular to the axle, which runs along x.
        maxR = Math.max(maxR, Math.hypot(v.y, v.z));
      }
    });
    out.push({
      name: car.name,
      recorded: +(g.userData.wheelR ?? 0).toFixed(5),
      measured: +maxR.toFixed(5),
    });
    g.traverse((o) => o.geometry && o.geometry.dispose?.());
  }
  return out;
});
console.log("car                  recorded   measured    error");
let worst = 0;
for (const c of fleet) {
  const err = Math.abs(c.recorded - c.measured);
  worst = Math.max(worst, err);
  console.log(
    `  ${c.name.padEnd(20)} ${c.recorded.toFixed(4)}    ${c.measured.toFixed(4)}   ` +
      `${(err * 1000).toFixed(2)} mm`
  );
}
console.log(
  `\nradius     ${check(fleet.length >= 15 && worst < 0.001,
    `the worst car is out by ${(worst * 1000).toFixed(1)} mm across ${fleet.length} cars`)}  ` +
    `${fleet.length} cars, worst recorded radius out by ${(worst * 1000).toFixed(2)} mm`
);
// And they are genuinely different from each other — if they were not,
// one constant would have been fine and this whole change is noise.
const spread = Math.max(...fleet.map((c) => c.measured)) - Math.min(...fleet.map((c) => c.measured));
console.log(
  `spread     ${check(spread > 0.05,
    `every car's wheel is within ${(spread * 1000).toFixed(0)} mm of every other`)}  ` +
    `${(Math.min(...fleet.map((c) => c.measured)) * 1000).toFixed(0)}-` +
    `${(Math.max(...fleet.map((c) => c.measured)) * 1000).toFixed(0)} mm across the fleet — ` +
    `no single constant could have been right`
);

// --- 2. Arc equals distance -------------------------------------------
//
// The physics half. Rolling without sliding IS this equation, and it is
// asked of the car the player is driving rather than of the function
// that turns the wheel.
const roll = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.skipCinematic?.();
  e.setPaused(true);
  const wheels = e.carBody.userData.wheels;
  const R = e.carBody.userData.wheelR;
  const drive = (n, input) => {
    for (let i = 0; i < n; i++) {
      e.setTouchInput(input);
      e.update(1 / 60);
      if (window.__vclock) window.__vclock.t += 1000 / 60;
    }
  };
  // Up to a steady speed first: measuring through the launch would
  // measure the wheelspin, which is a different question and is asked
  // below.
  drive(600, { throttle: 1, brake: 0, steer: 0 });
  const s0 = e.player.s;
  const a0 = wheels.map((w) => w.rotation.x);
  drive(180, { throttle: 0.35, brake: 0, steer: 0 });
  const dS = e.track.deltaAhead(s0, e.player.s);
  const arcs = wheels.map((w, i) => (w.rotation.x - a0[i]) * R);
  return {
    R: +R.toFixed(4),
    travelled: +dS.toFixed(3),
    arcs: arcs.map((a) => +a.toFixed(3)),
    speed: +(e.player.speed * 3.6).toFixed(0),
  };
});
console.log(
  `\nrolling    at ${roll.speed} km/h the car covered ${roll.travelled} m; the tread laid ` +
    `${roll.arcs.map((a) => a.toFixed(1)).join(" / ")} m (radius ${roll.R} m)`
);
// Front wheels only for the equality: the rear pair carries whatever
// wheelspin the throttle is asking for, which is real slip and belongs
// in the next check rather than in this one.
const slipFront = roll.arcs.slice(0, 2).map((a) => Math.abs(a / roll.travelled - 1));
console.log(
  `no slip    ${check(Math.max(...slipFront) < 0.02,
    `the front tread is out by ${(Math.max(...slipFront) * 100).toFixed(1)}% against the road`)}  ` +
    `the front tyres are within ${(Math.max(...slipFront) * 100).toFixed(2)}% of the ground they covered`
);
// The specific failure this replaces: with 0.36 assumed on a car whose
// wheel is 0.3167, the tread would come up 12% short of the road.
console.log(
  `not 0.36   ${check(Math.abs(roll.R - 0.36) > 0.005,
    `this car's wheel really is 0.36 m, so the check above cannot tell the two apart`)}  ` +
    `this car's wheel is ${roll.R} m, not the 0.36 the engine used to assume ` +
    `(${((0.36 / roll.R - 1) * 100).toFixed(1)}% out)`
);

// --- 3. A locked wheel stops, a spinning one runs on -------------------
//
// Race brakes first, and the car is REBUILT to fit them — which happens
// on its own clock. Reading `carBody.userData.wheels` before that lands
// hands back the wheels of the car that has just been thrown away, and
// they sit at whatever angle they were left at for ever. That is a
// false pass, not a failure: "the wheels did not turn" is exactly what
// the locked-wheel check is looking for.
await page.evaluate(() => {
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car: "wain-special", cars: ["wain-special"], kd: 99999,
    builds: { "wain-special": { owned: ["brakes-race", "intake-basic"],
      equipped: { brakes: "brakes-race", intake: "intake-basic" } } },
  }));
  window.__grnEngine.applyGarage();
});
await page.waitForTimeout(400);
const extremes = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.bs.lock = 0; e.bs.temp = 0; e.bs.pulse = 0;
  const wheels = e.carBody.userData.wheels;
  const drive = (n, input) => {
    for (let i = 0; i < n; i++) {
      e.setTouchInput(input);
      e.update(1 / 60);
      if (window.__vclock) window.__vclock.t += 1000 / 60;
    }
  };
  // ABS is standard on every car in this game and its whole job is to
  // stop this happening: it holds the pedal at 97% of the tyre's limit
  // and pulses at 14 Hz, so a buried pedal on a stock car reports a
  // lock of zero and SHOULD. The two uprated brake kits delete it,
  // which is the trade they are sold on — hence the race brakes above.
  e.player.speed = 40;
  drive(24, { throttle: 0, brake: 1, steer: 0 });
  const a0 = wheels.map((w) => w.rotation.x);
  const v0 = e.player.speed;
  drive(20, { throttle: 0, brake: 1, steer: 0 });
  const locked = wheels.map((w, i) => +(w.rotation.x - a0[i]).toFixed(4));
  const lockAmt = +(e.brakeOut?.lock ?? 0).toFixed(2);

  // ...and a standing burnout: the driven pair turning faster than the
  // pair that is only being pushed.
  e.player.speed = 0;
  e.heading = 0;
  drive(10, { throttle: 1, brake: 0, steer: 0 });
  const b0 = wheels.map((w) => w.rotation.x);
  drive(20, { throttle: 1, brake: 0, steer: 0 });
  const burn = wheels.map((w, i) => +(w.rotation.x - b0[i]).toFixed(4));
  return {
    locked, lockAmt, v0: +v0.toFixed(1), burn, spin: +e.wheelspin.toFixed(2),
    // Proof these are the wheels the engine is actually turning: a
    // discarded set never moves at all, which would sail through the
    // locked check below.
    live: wheels === e.carBody.userData.wheels,
    abs: e.tune.hasAbs,
  };
});
console.log(
  `\nlive       ${check(extremes.live && extremes.abs === false,
    `measuring wheels the engine is not turning (live=${extremes.live}), or ABS is still fitted (abs=${extremes.abs})`)}  ` +
    `race brakes fitted, ABS gone, and these are the wheels on the car`
);
console.log(
  `locked     brake buried from ${extremes.v0} m/s: lock ${extremes.lockAmt}, ` +
    `wheels turned ${extremes.locked.map((a) => a.toFixed(2)).join(" / ")} rad in a third of a second`
);
console.log(
  `stops      ${check(extremes.lockAmt > 0.5 && Math.max(...extremes.locked) < 1.2,
    `with lock at ${extremes.lockAmt} the wheels still turned ${Math.max(...extremes.locked).toFixed(2)} rad`)}  ` +
    `a locked wheel stops turning while the car keeps going — which is what a locked wheel is`
);
console.log(
  `burnout    front ${extremes.burn.slice(0, 2).map((a) => a.toFixed(2)).join("/")} rad, ` +
    `rear ${extremes.burn.slice(2).map((a) => a.toFixed(2)).join("/")} rad (wheelspin ${extremes.spin})`
);
console.log(
  `driven     ${check(
    Math.min(...extremes.burn.slice(2)) > Math.max(...extremes.burn.slice(0, 2)) + 0.5,
    `the rear pair turned ${Math.min(...extremes.burn.slice(2)).toFixed(2)} rad against the front's ` +
      `${Math.max(...extremes.burn.slice(0, 2)).toFixed(2)} — a burnout with all four spinning is a ` +
      `four-wheel-drive car, and none of these are`
  )}  only the driven pair spins`
);

// --- 4. And every other car on the road rolls too ----------------------
//
// The player's car is the one that gets looked at least: it is in front
// of you and mostly behind its own bodywork. The traffic and the rival
// are the wheels in the middle of the frame.
const others = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  const sample = (mesh) => (mesh?.userData.wheels ?? []).map((w) => w.rotation.x);
  const traffic = e.traffic.filter((t) => t.speed > 5).slice(0, 3);
  const before = traffic.map((t) => sample(t.mesh));
  const rivalBefore = e.rival ? sample(e.rival.mesh) : null;
  for (let i = 0; i < 60; i++) {
    e.setTouchInput({ throttle: 0.5, brake: 0, steer: 0 });
    e.update(1 / 60);
    if (window.__vclock) window.__vclock.t += 1000 / 60;
  }
  const after = traffic.map((t) => sample(t.mesh));
  const rivalAfter = e.rival ? sample(e.rival.mesh) : null;
  return {
    traffic: traffic.map((t, i) => ({
      speed: +t.speed.toFixed(1),
      turned: +(after[i][0] - before[i][0]).toFixed(3),
      radius: +(t.mesh.userData.wheelR ?? 0).toFixed(4),
    })),
    rival: rivalBefore
      ? { turned: +(rivalAfter[0] - rivalBefore[0]).toFixed(3), radius: +(e.rival.mesh.userData.wheelR ?? 0).toFixed(4) }
      : null,
  };
});
for (const t of others.traffic) {
  console.log(`traffic    ${t.speed} m/s, wheel ${t.radius} m, turned ${t.turned} rad in a second`);
}
if (others.rival) console.log(`rival      wheel ${others.rival.radius} m, turned ${others.rival.turned} rad`);
console.log(
  `others     ${check(
    others.traffic.length > 0 &&
      others.traffic.every((t) => Math.abs(t.turned) > 1 && t.radius > 0.2) &&
      (!others.rival || others.rival.radius > 0.2),
    "a traffic car or the rival is rolling on a wheel of no recorded size"
  )}  the traffic and the rival roll on their own wheels, not on a constant`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} FAILED`);
  for (const f of fail) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nthe tread lays exactly as much road as it covers");
