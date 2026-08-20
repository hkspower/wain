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
  e.player.s = e.track.length * 0.62;
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
  return {
    alive: e.smokeFx.alive,
    distinctAges: new Set(ages).size,
    distinctSizes: new Set(sizes).size,
    spreadX: +(maxX - minX).toFixed(2),
    rise: +(maxY - minY).toFixed(2),
    visible: e.smokeFx.points.visible,
    grow: e.smokeFx.material.uniforms.uGrow.value,
    spin: e.smokeFx.material.uniforms.uSpin.value,
  };
});
console.log(`smoke      ${smoke.alive} puffs, ${smoke.distinctAges} distinct ages, ${smoke.distinctSizes} sizes, spread ${smoke.spreadX} m, rise ${smoke.rise} m`);
check(smoke.alive > 25, `only ${smoke.alive} smoke particles alive in a drift`);
check(smoke.distinctAges > 15, `smoke shares ages (${smoke.distinctAges} distinct) — the old one-clock pool`);
check(smoke.distinctSizes > 10, "every puff is the same size");
check(smoke.grow > 1 && smoke.spin > 0, "smoke does not expand or turn");
check(smoke.visible, "smoke is not visible while drifting");

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

// --- sparks stay near the panel that made them ---------------------
// Grinding steel along a barrier throws sparks out and back along the
// flank. They should skip down the car and die on the asphalt, not arc
// over its roof — which is what they were doing, to 1.48 m.
const sparkHeight = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.player.s = e.track.length * 0.62;
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
  const bodies = new Set(reflect.cars.map((c) => c.bodyI));
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
