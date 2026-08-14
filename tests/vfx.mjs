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

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nall VFX checks passed");
await browser.close();
process.exit(fail.length ? 1 : 0);
