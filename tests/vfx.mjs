// The VFX pass, measured on live engine state. Particle systems are the
// easiest thing in a game to "improve" without changing a single pixel,
// so nothing here trusts that a pool exists — each effect is provoked
// and its particles counted, aged and placed.
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

const stage = () => page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.player.s = 2400;
  e.player.lat = 0; e.player.speed = 0;
  e.heading = 0; e.steerSmooth = 0; e.driftYaw = 0; e.slipVel = 0; e.shake = 0;
  e.scrapeCooldown = 0; e.rotorHeat = 0;
  for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length / 2);
  e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
  e.touch.drift = false;
});

// --- 1. Smoke: per-particle ages, growth, and a real spread ---
await stage();
const smoke = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.player.speed = 40;
  for (let i = 0; i < 90; i++) {
    e.player.speed = Math.max(e.player.speed, 32);
    e.setTouchInput({ throttle: 0.9, steer: 1 });
    e.touch.drift = true;
    e.update(1 / 60);
    e.player.lat = 0;
  }
  e.touch.drift = false;
  const g = e.smokeFx.points.geometry;
  const age = g.getAttribute("aAge"), life = g.getAttribute("aLife"), size = g.getAttribute("aSize");
  const pos = g.getAttribute("position");
  const ages = [], sizes = [];
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let i = 0; i < life.count; i++) {
    if (life.getX(i) <= 0) continue;
    ages.push(+(age.getX(i) / life.getX(i)).toFixed(3));
    sizes.push(+size.getX(i).toFixed(3));
    minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i));
    minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i));
  }
  // Drawn far to near: the pool's index lists exactly the live slots, and
  // the distance from the camera never grows along it. Squared distance,
  // the same arithmetic the sort does, so there is no rounding to argue
  // with.
  let sorted = null;
  if (g.index) {
    const idx = g.index.array, cam = e.camera.position;
    const n = g.drawRange.count;
    let ok = n === e.smokeFx.alive, prev = Infinity;
    for (let j = 0; j < n && ok; j++) {
      const i = idx[j];
      if (life.getX(i) <= 0) ok = false;
      const dx = pos.getX(i) - cam.x, dy = pos.getY(i) - cam.y, dz = pos.getZ(i) - cam.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > prev + 1e-9) ok = false;
      prev = d;
    }
    sorted = { ok, n };
  }
  // The sprite has a shape to turn. Cell 0 of the billow atlas (the top-
  // left 128 texels of the canvas, centred on 64,64): round a ring 0.45
  // of the way out its alpha has to vary — a turned disc samples the
  // same value — and at 0.98 of the way out it has to be nothing, or a
  // turned sprite's corner would show the next cell.
  let ring = null;
  const img = e.smokeFx.material.uniforms.uMap.value?.image;
  if (img && typeof img.getContext === "function" && img.width >= 128) {
    const d = img.getContext("2d").getImageData(0, 0, 128, 128).data;
    const alphaAt = (r, a) => {
      const x = Math.min(127, Math.round(64 + Math.cos(a) * r * 64));
      const y = Math.min(127, Math.round(64 + Math.sin(a) * r * 64));
      return d[(y * 128 + x) * 4 + 3];
    };
    const mid = [];
    for (let k = 0; k < 24; k++) mid.push(alphaAt(0.45, (k / 24) * Math.PI * 2));
    const mean = mid.reduce((a, b) => a + b, 0) / mid.length;
    const sd = Math.sqrt(mid.reduce((a, b) => a + (b - mean) ** 2, 0) / mid.length);
    let rim = 0;
    for (let k = 0; k < 8; k++) rim = Math.max(rim, alphaAt(0.98, (k / 8) * Math.PI * 2));
    ring = { cv: mean > 0 ? +(sd / mean).toFixed(3) : 0, rim };
  }
  return {
    alive: e.smokeFx.alive,
    distinctAges: new Set(ages).size,
    distinctSizes: new Set(sizes).size,
    spreadX: +(maxX - minX).toFixed(2),
    rise: +(maxY - minY).toFixed(2),
    maxY: +maxY.toFixed(2),
    visible: e.smokeFx.points.visible,
    grow: e.smokeFx.material.uniforms.uGrow.value,
    spin: e.smokeFx.material.uniforms.uSpin.value,
    sorted,
    ring,
  };
});
console.log(`smoke      ${smoke.alive} puffs, ${smoke.distinctAges} distinct ages, ${smoke.distinctSizes} sizes, spread ${smoke.spreadX} m, rise ${smoke.rise} m, top ${smoke.maxY} m, uGrow ${smoke.grow}`);
check(smoke.alive > 25, `only ${smoke.alive} smoke particles alive in a drift`);
check(smoke.distinctAges > 15, `smoke shares ages (${smoke.distinctAges} distinct) — the old one-clock pool`);
check(smoke.distinctSizes > 10, "every puff is the same size");
check(smoke.grow > 1, "smoke does not expand as it ages");
check(smoke.visible, "smoke is not visible while drifting");
// Low enough to see the car over. The old launch (0.24-0.46 m up at
// 1.3-2.8 m/s, rising at 0.35 m/s²) put puffs 2.2 m up, over the roof of
// every car in the game, and a spin is exactly when the driver needs to
// see which way the car is pointing.
check(smoke.maxY < 1.5, `smoke climbs to ${smoke.maxY} m — over the roofline`);
// Far to near, so a lit puff blends over the one behind it and not the
// other way round.
console.log(`           draw order ${smoke.sorted ? `${smoke.sorted.n} listed, ${smoke.sorted.ok ? "far to near" : "NOT sorted"}` : "no index"}`);
check(smoke.sorted?.ok === true, smoke.sorted ? "the smoke's index is not far-to-near over exactly the live puffs" : "the smoke pool has no index — it is drawn in slot order");
// `spin` IS asserted again, and the sprite is measured to show it can be
// seen. It used to be deliberately left out: the sprite was radialSprite(),
// a radially symmetric falloff, and turning gl_PointCoord about the centre
// of a symmetric sprite samples the identical value — uSpin had no visual
// consequence at any value, and a check on it would have gone on passing
// with the rotation deleted. The billow atlas has lobes, so a turn moves
// them; the ring measurement is what makes the uniform mean something.
console.log(`           sprite ring std/mean ${smoke.ring?.cv ?? "-"} at 0.45 r, rim ${smoke.ring?.rim ?? "-"} at 0.98 r, uSpin ${smoke.spin}`);
check(smoke.spin > 0, "smoke does not turn");
check(!!smoke.ring && smoke.ring.cv > 0.15, `the smoke sprite is round (ring std/mean ${smoke.ring?.cv}) — turning it changes nothing`);
check(!!smoke.ring && smoke.ring.rim === 0, `the smoke sprite reaches its cell's edge (alpha ${smoke.ring?.rim}) — a turned corner shows`);

// --- 1a. The paint does not reflect the particles -------------------
//
// A sprite's pixel size is worked out for the main buffer, so inside a
// 256-texel probe face a puff two metres off filled the face and washed
// the paint grey. Checked on the probe's own render call, while the
// drift above is still in the air.
const probe = await page.evaluate(() => {
  const e = window.__grnEngine;
  const pools = [e.sparkFx, e.smokeFx, e.dustFx, e.flameFx];
  const before = e.smokeFx.points.visible;
  const seen = [];
  const render = e.renderer.render;
  e.renderer.render = function (scene, cam) {
    seen.push(pools.map((f) => f.points.visible));
    return render.call(this, scene, cam);
  };
  try {
    e.renderProbe();
  } finally {
    e.renderer.render = render;
  }
  return { before, seen, after: e.smokeFx.points.visible };
});
{
  const drawn = probe.seen.flat();
  console.log(`probe      ${probe.seen.length} render(s); particle pools drawn into it: ${drawn.filter(Boolean).length} of ${drawn.length}; smoke ${probe.before} -> ${probe.after}`);
  check(probe.before, "no smoke in the air to test the probe against");
  check(probe.seen.length > 0 && drawn.every((v) => v === false), "particles are drawn into the reflection probe");
  check(probe.after === true, "the probe left the smoke hidden");
}

// --- 1b. Sand off the shoulder -------------------------------------
//
// This road has a hard edge and beyond it is scenery. Before this there
// was nothing at all between "on the racing surface" and "hitting an
// invisible barrier" — no dust, no grip change, and a kerb buzz on the
// sound bus that was capped at 31% of its range by a constant that
// disagreed with the wall by 250 mm.
//
// What has to be true: running wide throws sand, it comes off the side
// the car ran wide on, and staying on the racing surface throws none.
const dust = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const wait = (n) => new Promise((r) => setTimeout(r, n));
  // The attributes are named aAge/aLife/aSize, as the smoke block above
  // reads them — `geometry.attributes.life` is undefined.
  const read = () => {
    const g = e.dustFx.points.geometry;
    const pos = g.getAttribute("position"), life = g.getAttribute("aLife");
    let n = 0, sum = 0;
    for (let i = 0; i < life.count; i++) {
      if (life.getX(i) <= 0) continue;
      n++;
      sum += pos.getX(i);
    }
    return { n, meanX: n ? sum / n : 0 };
  };
  // Mid-road at speed: no shoulder, so no sand.
  e.setTouchInput({ throttle: 1, steer: 0 });
  e.player.lat = 0;
  for (let i = 0; i < 90; i++) { e.player.lat = 0; e.update(1 / 60); }
  await wait(60);
  const clean = read().n;
  // Now put a wheel on the shoulder, on the right, and hold it there.
  // And watch the lowest grain every frame: sand settles ON the road.
  const lowest = () => {
    const g = e.dustFx.points.geometry;
    const pos = g.getAttribute("position"), life = g.getAttribute("aLife");
    let m = Infinity;
    for (let i = 0; i < life.count; i++) if (life.getX(i) > 0) m = Math.min(m, pos.getY(i));
    return m;
  };
  const wide = e.track.halfWidthAt(e.player.s) - 1.2;
  let minY = Infinity;
  for (let i = 0; i < 90; i++) { e.player.lat = wide; e.update(1 / 60); minY = Math.min(minY, lowest()); }
  const onEdge = read();
  const carX = e.playerMesh.position.x;
  return { clean, n: onEdge.n, meanX: onEdge.meanX, carX, lat: e.player.lat, speed: e.player.speed, minY };
});
console.log(`dust       ${dust.clean} grains mid-road, ${dust.n} with a wheel on the shoulder at ${dust.speed.toFixed(0)} m/s, lowest ${Number.isFinite(dust.minY) ? dust.minY.toFixed(3) : "-"} m`);
check(dust.clean === 0, `${dust.clean} grains of sand came up in the middle of the road`);
check(dust.n > 10, `only ${dust.n} grains with a wheel on the shoulder — running wide throws no sand`);
// The floor is groundY, 0.03. Without it the sand fell straight through:
// 0.06 m up at 0.9 m/s, drag 1.5 and gravity 1.1 is 7 cm under the road
// by the end of a 1.5 s life.
check(dust.minY >= 0.029, `sand sinks into the road, to ${dust.minY.toFixed(3)} m`);

// --- 1c. A burnout smokes the tyres that are spinning ---------------
//
// The driven ones. Every straight-line puff used to go to the FRONT axle,
// which was right for the five front-driven cars and wrong for every
// rear-driven one — the default car lit up its fronts. Read in the car's
// own frame (+z forward), from puffs too young to have drifted far.
//
// And BOTH of them. Which tyre a puff came off was picked by its index
// in the frame's batch, and a batch is one puff or none — 50 a second
// on Battery's budget is 0.46 a frame — so every puff of a burnout came
// off the same rear tyre and the axle's mean z above could not tell.
// Where each puff is born is read off spawn() itself, in the car's
// frame at that instant: +x is one side of the car, -x the other.
await stage();
const burn = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const births = [];
  const b = new THREE.Vector3();
  const own = Object.getPrototypeOf(e.smokeFx).spawn;
  e.smokeFx.spawn = function (x, y, z) {
    e.carBody.updateWorldMatrix(true, false);
    e.carBody.worldToLocal(b.set(x, y, z));
    births.push(b.x);
    return own.apply(this, arguments);
  };
  e.player.speed = 3;
  let spin = 0;
  try {
    for (let i = 0; i < 40; i++) {
      e.setTouchInput({ throttle: 1, steer: 0 });
      e.update(1 / 60);
      e.player.lat = 0;
      spin = Math.max(spin, e.wheelspin);
    }
  } finally {
    // Back to the prototype's own spawn.
    delete e.smokeFx.spawn;
  }
  e.setTouchInput({ throttle: 0 });
  // A two-wheeled driven axle to split: a trike's one front wheel sits
  // on the centre line and has no sides.
  const wheels = e.carBody.userData.wheels ?? [];
  const front = e.carBody.userData.wheelPlan?.front ?? 2;
  const axle = e.tune.drive === "fwd" ? front : wheels.length - front;
  const left = births.filter((x) => x > 0).length;
  const right = births.filter((x) => x < 0).length;
  const g = e.smokeFx.points.geometry;
  const pos = g.getAttribute("position"), life = g.getAttribute("aLife"), age = g.getAttribute("aAge");
  const v = new THREE.Vector3();
  let n = 0, sum = 0;
  for (let i = 0; i < life.count; i++) {
    if (life.getX(i) <= 0 || age.getX(i) >= 0.1) continue;
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    e.carBody.worldToLocal(v);
    sum += v.z;
    n++;
  }
  return {
    drive: e.tune.drive, spin: +spin.toFixed(2), n, meanZ: n ? +(sum / n).toFixed(2) : null, speed: +e.player.speed.toFixed(1),
    left, right, axle,
  };
});
if (burn.spin > 3 && burn.n > 0) {
  console.log(`burnout    ${burn.drive}, wheelspin ${burn.spin}, ${burn.n} young puffs at car-local z ${burn.meanZ} m (at ${burn.speed} m/s); born ${burn.left} on +x, ${burn.right} on -x`);
  if (burn.drive === "rwd") check(burn.meanZ < -0.8, `a rear-driven burnout smokes at z ${burn.meanZ} — not the rear tyres`);
  if (burn.drive === "fwd") check(burn.meanZ > 0.5, `a front-driven burnout smokes at z ${burn.meanZ} — not the front tyres`);
  // Taken in turns, so the split is even to within a puff; 0.3 of them
  // on the lighter side leaves room for that puff from two puffs up (1
  // of 2, 1 of 3, 2 of 5).
  const born = burn.left + burn.right;
  if (burn.axle === 2 && born >= 2) {
    check(Math.min(burn.left, burn.right) >= 0.3 * born,
      `a burnout smokes one side of the car: ${burn.left} puffs born on +x, ${burn.right} on -x`);
  }
} else {
  console.log(`burnout    skipped: wheelspin ${burn.spin}, ${burn.n} young puffs — the launch did not light the tyres`);
}

// A spin is every tyre sliding, so every tyre smokes: the fronts as well
// as the rears, both sides of each. The same frame-index pick meant the
// fronts never did — at 60 Hz the batch index reached 1 now and then and
// never 2, which is where the fronts started. Held in a spin the way the
// audio test holds one — spinT AND a rate, or solveDrift ends it inside
// the frame — and only puffs born while it was still a spin are counted.
await stage();
const spun = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const births = [];
  const b = new THREE.Vector3();
  const own = Object.getPrototypeOf(e.smokeFx).spawn;
  e.smokeFx.spawn = function (x, y, z) {
    if (e.ds.spinT > 0) {
      e.carBody.updateWorldMatrix(true, false);
      e.carBody.worldToLocal(b.set(x, y, z));
      births.push([b.x, b.z]);
    }
    return own.apply(this, arguments);
  };
  try {
    for (let i = 0; i < 40; i++) {
      e.player.speed = 33;
      e.driftYaw = 0.6;
      e.ds.spinT = 0.1;
      e.ds.spinRate = 3;
      e.update(1 / 60);
      e.player.lat = 0;
    }
  } finally {
    delete e.smokeFx.spawn;
    e.ds.spinT = 0;
    e.ds.spinRate = 0;
    e.driftYaw = 0;
    e.player.speed = 0;
  }
  // Corners by the car's own axes: z > 0 is the front half.
  const q = { fl: 0, fr: 0, rl: 0, rr: 0 };
  for (const [x, z] of births) q[(z > 0 ? "f" : "r") + (x > 0 ? "l" : "r")]++;
  const wheels = e.carBody.userData.wheels ?? [];
  const front = e.carBody.userData.wheelPlan?.front ?? 2;
  return { n: births.length, q, four: wheels.length === 4 && front === 2 };
});
if (spun.n >= 8 && spun.four) {
  const { fl, fr, rl, rr } = spun.q;
  console.log(`spin       ${spun.n} puffs born: front ${fl} +x / ${fr} -x, rear ${rl} +x / ${rr} -x`);
  // Each hub in turn, so each corner has a quarter to within a puff; 0.15
  // of them is that quarter with room at eight or more.
  check(Math.min(fl, fr, rl, rr) >= 0.15 * spun.n,
    `a spin does not smoke all four tyres: front ${fl}/${fr}, rear ${rl}/${rr} of ${spun.n}`);
} else {
  console.log(`spin       skipped: ${spun.n} puffs born in the spin${spun.four ? "" : ", and the car is not four-wheeled"}`);
}

// --- 1d. Smoke is lit by the hour and by the car --------------------
//
// It used to be one flat colour at every hour: 0.58 in luma at midnight,
// three times too bright for the night it hung in. What it answers to now
// is the rig's own key, fill and sky — read here straight off the
// uniforms both pools share — and the car's tail lamps behind it.
await stage();
const lit = await page.evaluate(() => {
  const e = window.__grnEngine;
  const u = e.smokeFx.material.uniforms;
  if (!u.uKey || !u.uFill || !u.uTail) return null;
  const was = { h: e.timeHours, real: e.timeReal, cycling: e.timeCycling };
  e.timeReal = false;
  e.timeCycling = false;
  const luma = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const park = () => {
    const away = e.track.wrap(587 + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
    e.player.s = 587; e.player.lat = 0; e.player.speed = 0;
  };
  const at = (h) => {
    e.timeHours = h;
    e.world.setTimeOfDay(h);
    e.applyDaylight();
    for (let i = 0; i < 60; i++) { park(); e.update(1 / 60); }
    return +(luma(u.uKey.value) + luma(u.uFill.value)).toFixed(3);
  };
  const noon = at(12.5);
  const night = at(0.5);
  // The tail lamps, at night: braking, then idle. touch.drift is the
  // handbrake and lights the lamps too — stage() cleared it.
  const tail = (brake) => {
    e.setTouchInput({ throttle: 0, brake });
    for (let i = 0; i < 3; i++) { park(); e.update(1 / 60); }
    return u.uTail.value.w;
  };
  const braking = tail(1);
  const idle = tail(0);
  e.timeHours = was.h;
  e.timeReal = was.real;
  e.timeCycling = was.cycling;
  e.world.setTimeOfDay(was.h);
  e.applyDaylight();
  return { night, noon, braking: +braking.toFixed(3), idle: +idle.toFixed(3) };
});
if (!lit) {
  console.log("lighting   the smoke has no light uniforms  FAIL");
  fail.push("the smoke is not lit — one flat colour at every hour");
} else {
  console.log(`lighting   sky ${lit.night} at 0:30, ${lit.noon} at 12:30 (x${(lit.noon / lit.night).toFixed(2)}); tail ${lit.braking} braking, ${lit.idle} idle (x${(lit.braking / Math.max(1e-6, lit.idle)).toFixed(2)})  ` +
    check(lit.night >= 0.12 && lit.night <= 0.28, `the night sky lights smoke at ${lit.night} — outside 0.12-0.28`) + " " +
    check(lit.noon >= 0.45 && lit.noon >= 2.5 * lit.night, `noon lights smoke at ${lit.noon} — not a day's worth over ${lit.night} at night`) + " " +
    check(lit.idle > 0 && lit.braking >= 2.5 * lit.idle, `the tail lamps light smoke at ${lit.braking} braking, ${lit.idle} idle — braking should be 2.5x`));
}

// --- 2. Sparks: side-correct, and they bounce instead of sinking ---
await stage();
const sparks = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.player.speed = 45;
  e.player.lat = 0;
  e.heading = 0.42;
  let frames = 0;
  while (frames < 240 && e.sparkFx.alive === 0) {
    e.setTouchInput({ throttle: 0.6 });
    e.heading = 0.42;
    e.update(1 / 60);
    frames++;
  }
  const wallSide = Math.sign(e.player.lat);
  const born = e.sparkFx.alive;
  // Where are they, relative to the car, and do they stay above the road?
  const g = e.sparkFx.points.geometry;
  const pos = g.getAttribute("position"), life = g.getAttribute("aLife");
  const car = e.playerMesh.position;
  let sameSide = 0, total = 0;
  for (let i = 0; i < life.count; i++) {
    if (life.getX(i) <= 0) continue;
    total++;
    const dx = pos.getX(i) - car.x, dz = pos.getZ(i) - car.z;
    // Project onto the road's side vector
    const t = e.track.tangentAt(e.player.s, e.v3.clone());
    const sx = -t.z, sz = t.x;
    if (Math.sign(dx * sx + dz * sz) === wallSide) sameSide++;
  }
  // Let them fall and bounce
  let below = 0;
  for (let i = 0; i < 40; i++) {
    e.update(1 / 60);
    for (let k = 0; k < life.count; k++) {
      if (life.getX(k) > 0 && pos.getY(k) < 0) below++;
    }
  }
  return { born, total, sameSide, below, alive: e.sparkFx.alive, wallSide };
});
console.log(`sparks     ${sparks.born} born on wall contact, ${sparks.sameSide}/${sparks.total} on the contact side, ${sparks.below} sank through the road`);
check(sparks.born > 20, `only ${sparks.born} sparks on a wall hit`);
check(sparks.sameSide > sparks.total * 0.7, "sparks are not coming off the panel that hit");
check(sparks.below === 0, "sparks fall through the asphalt instead of bouncing");

// --- 3. Brake rotors glow with heat, and cool down again ---
await stage();
const brakes = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const rotor = () => {
    const w = e.carBody.userData.wheels[0];
    return w.userData.rotorMat?.emissiveIntensity ?? -1;
  };
  e.player.speed = 60;
  const cold = rotor();
  for (let i = 0; i < 90; i++) {
    e.player.speed = Math.max(e.player.speed, 45);
    e.setTouchInput({ brake: 1, throttle: 0 });
    e.update(1 / 60);
    e.player.lat = 0;
  }
  const hot = rotor();
  for (let i = 0; i < 240; i++) {
    e.setTouchInput({ brake: 0, throttle: 0.3 });
    e.update(1 / 60);
    e.player.lat = 0;
  }
  return { cold: +cold.toFixed(3), hot: +hot.toFixed(3), cooled: +rotor().toFixed(3) };
});
console.log(`rotors     cold ${brakes.cold} -> hot ${brakes.hot} -> cooled ${brakes.cooled}`);
check(brakes.cold === 0, "rotors glow before any braking");
check(brakes.hot > 0.4, `rotors barely heat up (${brakes.hot})`);
check(brakes.cooled < brakes.hot * 0.5, "rotors never cool down");

// --- 4. Exhaust: backfire on a hard lift, flame while NOS is open ---
await stage();
const flames = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.player.speed = 45;
  // Hold throttle, then drop it — the falling edge is the backfire
  for (let i = 0; i < 30; i++) { e.setTouchInput({ throttle: 1 }); e.update(1 / 60); e.player.lat = 0; }
  const before = e.flameFx.alive;
  let peak = 0;
  for (let i = 0; i < 10; i++) {
    e.setTouchInput({ throttle: 0 });
    e.update(1 / 60);
    peak = Math.max(peak, e.flameFx.alive);
    e.player.lat = 0;
  }
  return { before, peak };
});
console.log(`exhaust    flame particles on lift: ${flames.before} -> ${flames.peak}  ` +
  check(flames.peak > 0, "no backfire when the throttle is dropped at speed"));

// --- 4b. The two bangs a closing pedal cannot explain ----------------
//
// A lift is not the only thing that lights a pipe, and for a long time
// it was the only thing this car knew about.
//
//   upshift  a flat-out change cuts the fuel for shiftUpTime with the
//            foot still down. liftRate is zero through all of it, so
//            the lift rule above cannot fire — and the crack between
//            gears is the one people know a loud exhaust by.
//   overrun  a trailing throttle crackles for as long as it trails.
//            One lockout-gated bang cannot do that, and the systems in
//            the shop are sold on exactly this ("it spits flame").
//
// Counted as BURSTS — frames where the live flame count jumped — not
// as particles, because a burst is the event a player hears as one pop.
await stage();
const pops = await page.evaluate(() => {
  const e = window.__grnEngine;
  const fitExhaust = (id) => {
    const g = window.__grnLoadGarage();
    const b = (g.builds[g.car] ??= { owned: [], equipped: {} });
    if (!b.owned.includes(id)) b.owned.push(id);
    b.equipped.exhaust = id;
    window.__grnSaveGarage(g);
    e.refreshGarage();
    return e.tune.exhaust.pop;
  };

  // Upshift: force the car through its ratios with the pedal pinned.
  const pop = fitExhaust("exhaust-race");
  e.player.s = 1200; e.player.lat = 0; e.player.speed = 20;
  for (let i = 0; i < 20; i++) { e.setTouchInput({ throttle: 1 }); e.update(1 / 60); e.player.lat = 0; }
  let bursts = 0, prev = e.flameFx.alive, maxLift = 0, shifts = 0, lastGear = e.gearHeld;
  for (let i = 0; i < 260; i++) {
    e.setTouchInput({ throttle: 1 });
    e.player.speed = Math.min(88, 20 + i * 0.26);
    e.update(1 / 60);
    e.player.lat = 0;
    if (e.gearHeld !== lastGear) { shifts++; lastGear = e.gearHeld; }
    const now = e.flameFx.alive;
    if (now > prev) bursts++;
    prev = now;
    maxLift = Math.max(maxLift, e.liftRate);
  }
  const upshift = { pop, bursts, shifts, maxLift: +maxLift.toFixed(2) };

  // Overrun: let it actually decelerate. Pinning the speed instead
  // locks a tall gear at ~0.39 revs and measures nothing — a state a
  // real decel never holds, which is how the first version of this
  // reported a system that crackles as one that does not.
  const overrun = (id) => {
    const p = fitExhaust(id);
    e.player.s = 1200; e.player.lat = 0; e.player.speed = 62;
    for (let i = 0; i < 40; i++) { e.setTouchInput({ throttle: 1 }); e.update(1 / 60); e.player.lat = 0; e.player.speed = 62; }
    let n = 0, was = e.flameFx.alive;
    for (let i = 0; i < 240; i++) {
      e.setTouchInput({ throttle: 0 });
      e.update(1 / 60);
      e.player.lat = 0;
      const now = e.flameFx.alive;
      if (now > was) n++;
      was = now;
    }
    return { pop: p, bursts: n };
  };
  return { upshift, stock: overrun("stock"), race: overrun("exhaust-race"), ti: overrun("exhaust-ti") };
});
console.log(
  `upshift    ${pops.upshift.bursts} flame bursts across ${pops.upshift.shifts} changes, ` +
    `peak liftRate ${pops.upshift.maxLift}  ` +
    check(pops.upshift.bursts > 0, "a flat-out upshift does not light the pipe") + " " +
    // The whole point: the pedal never moved, so the lift rule was not
    // what fired. If this ever reads non-zero the test has stopped
    // proving the thing it exists to prove.
    check(pops.upshift.maxLift < 0.01,
      `the pedal moved during the shift run (liftRate ${pops.upshift.maxLift}) — this no longer isolates the shift`)
);
// What this asserts, and what it deliberately does not. The gate on
// pop is a threshold, so "stock is silent" is deterministic and worth
// pinning. The RATE is a random interval scaled by pop, and race (2.2)
// against titanium (2.4) is a 9% difference in the mean drawn from a
// spread three times wider than that — one four-second sample cannot
// resolve it, and an earlier version of this asserted the ordering and
// failed on race 9 / ti 8, which was the test being wrong rather than
// the car. Both are checked against stock, where the gap is the design.
console.log(
  `overrun    stock ${pops.stock.bursts}, race ${pops.race.bursts}, ti ${pops.ti.bursts} bursts on a 4 s decel  ` +
    check(pops.stock.bursts <= 1, `the factory system crackled ${pops.stock.bursts} times — stock has a cat in it`) + " " +
    check(pops.race.bursts > pops.stock.bursts + 1, "a straight pipe barely out-crackles the factory system") + " " +
    check(pops.ti.bursts > pops.stock.bursts + 1, "a titanium quad barely out-crackles the factory system")
);

// --- sparks stay near the panel that made them ---------------------
// Grinding steel along a barrier throws sparks out and back along the
// flank. They should skip down the car and die on the asphalt, not arc
// over its roof — which is what they were doing, to 1.48 m.
const sparkHeight = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.player.s = 2400;
  e.player.lat = 0;
  e.player.speed = 45;
  e.heading = 0.42;
  e.driftYaw = 0;
  e.sparkFx.update(3, { gravity: 17, drag: 0.7, bounce: 0.42, groundY: 0.03 });
  let maxY = 0, above = 0, n = 0;
  for (let f = 0; f < 150; f++) {
    e.setTouchInput({ throttle: 0.6 });
    e.heading = 0.42;
    e.update(1 / 60);
    const g = e.sparkFx.points.geometry;
    const pos = g.getAttribute("position"), life = g.getAttribute("aLife");
    for (let i = 0; i < life.count; i++) {
      if (life.getX(i) <= 0) continue;
      const y = pos.getY(i);
      if (y > maxY) maxY = y;
      if (y > 1) above++;
      n++;
    }
  }
  return { maxY: +maxY.toFixed(2), abovePct: n ? +(100 * above / n).toFixed(1) : 0, n };
});
console.log(`spark arc  peak ${sparkHeight.maxY} m, ${sparkHeight.abovePct}% of the shower above 1 m  ` +
  check(sparkHeight.n > 100, "no sparks to measure") + " " +
  check(sparkHeight.maxY < 1.0, `sparks reach ${sparkHeight.maxY} m — they are arcing over the car`) + " " +
  check(sparkHeight.abovePct < 1, `${sparkHeight.abovePct}% of the shower is above roof height`));

// --- every car reflects the same world, the same way ----------------
// The player's paint used to be the only thing dressed with the live
// probe; rivals, traffic and other players ran on the materials' own
// defaults against the baked environment. The two do not land in the
// same place — swapping only these settings on one car under one camera
// moved it 11% brighter and clipped five times as many pixels — so the
// hero car was the only one on the street that was not blown out.
//
// Checked as identity rather than by eye: whatever the policy is, every
// car must be wearing it. A new kind of car that nobody remembered to
// dress fails here rather than in a screenshot months later.
const reflect = await page.evaluate(() => {
  const e = window.__grnEngine;
  const cars = [];
  const push = (label, group) => {
    if (!group) return;
    const body = group.userData.bodyMat;
    if (!body) return;
    cars.push({
      label,
      envMap: body.envMap ? body.envMap.uuid : null,
      bodyI: +body.envMapIntensity.toFixed(3),
      // The policy, not the number: gain divided by the finish's own
      // scale. A satin player beside gloss traffic is two numbers and
      // one policy, and it is the policy this check exists to hold.
      policy: +(body.envMapIntensity / (group.userData.envScale ?? 1)).toFixed(3),
      metals: (group.userData.reflectMats ?? []).map((m) => ({
        envMap: m.envMap ? m.envMap.uuid : null,
        ratio: +(m.envMapIntensity / (m.userData.baseEnvIntensity ?? 1.5)).toFixed(3),
      })),
    });
  };
  push("player", e.carBody);
  if (e.rival) push("rival", e.rival.mesh);
  e.traffic.slice(0, 3).forEach((t, i) => push(`traffic${i}`, t.mesh));
  const probe = e.cubeRT?.texture?.uuid ?? null;
  return { cars, probe, live: e.liveReflections };
});
{
  const maps = new Set(reflect.cars.map((c) => c.envMap));
  const bodies = new Set(reflect.cars.map((c) => c.policy));
  const ratios = new Set(reflect.cars.flatMap((c) => c.metals.map((m) => m.ratio)));
  console.log(`reflections ${reflect.cars.length} cars: ${reflect.cars.map((c) => `${c.label} i=${c.bodyI}`).join(", ")}`);
  console.log(`            env sources ${maps.size}, body gains ${bodies.size}, metal gains ${ratios.size}  ` +
    check(maps.size === 1, `cars reflect ${maps.size} different environments — they will not match`) + " " +
    check(bodies.size === 1, `paint runs at ${bodies.size} different gains across the cars: ${[...bodies].join(", ")}`) + " " +
    check(ratios.size <= 1, `metals run at ${ratios.size} different gains across the cars`));
  if (reflect.live) {
    check(reflect.cars.every((c) => c.envMap === reflect.probe),
      "the live probe is on but some cars are still reflecting the baked environment");
  }
}

// --- Glare falloff: a light must decay, not plateau ---
// Every glow in the game is drawn ADDITIVELY, and an additive sprite
// whose alpha is still a quarter of its peak a third of the way out does
// not read as a light — it reads as a flat white disc with a soft edge.
// That is what every street lamp looked like, and it is what "too much
// flare" actually was: the wrong shape, not too much brightness. The old
// curve held 0.25 of 0.85 (29%) at t=0.35 and 0.3 of 0.85 (35%) at 0.55.
const falloff = await page.evaluate(() => {
  const e = window.__grnEngine;
  // Any material carrying the shared point glow will do; they all use
  // the one texture.
  let canvas = null;
  e.scene.traverse((o) => {
    if (canvas) return;
    const mats = [].concat(o.material ?? []);
    for (const m of mats) {
      const img = m?.map?.image;
      if (img && typeof img.getContext === "function" && img.width === 128 && m.blending === 2) {
        canvas = img;
        return;
      }
    }
  });
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const d = ctx.getImageData(0, 0, 128, 128).data;
  // Walk out along the horizontal radius from the centre.
  const alphaAt = (t) => {
    const x = Math.min(127, Math.round(64 + t * 63));
    return d[(64 * 128 + x) * 4 + 3] / 255;
  };
  const peak = alphaAt(0);
  return {
    peak: +peak.toFixed(3),
    at15: +(alphaAt(0.15) / peak).toFixed(3),
    at35: +(alphaAt(0.35) / peak).toFixed(3),
    at55: +(alphaAt(0.55) / peak).toFixed(3),
    edge: +(alphaAt(0.99) / peak).toFixed(3),
  };
});
if (!falloff) {
  console.log("glare       no additive glow sprite found to measure  FAIL");
  fail.push("no additive glow sprite found");
} else {
  console.log(`glare       peak ${falloff.peak}; of that ${falloff.at15} at 15% of the radius, ` +
    `${falloff.at35} at 35%, ${falloff.at55} at 55%, ${falloff.edge} at the rim  ` +
    check(falloff.at35 < 0.12, `the glow plateaus: still ${falloff.at35} of peak a third of the way out`) + " " +
    check(falloff.at55 < 0.05, `the glow's tail is a slab: ${falloff.at55} of peak past halfway`) + " " +
    check(falloff.edge < 0.01, "the glow does not reach zero at the sprite's edge, so the quad shows"));
}

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nall VFX checks passed");
await browser.close();
process.exit(fail.length ? 1 : 0);
