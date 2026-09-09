// The card and the stopwatch agree.
//
//   npm run dev
//   npm run test:accel
//
// Acceleration is the third headline number this game turned from a
// hand-tuned multiplier into DATA the simulation is solved to hit —
// after the governed top speed and the length in metres — and this is
// what holds it to that. Two claims, and they are different:
//
//   solvable  accel.ts's own arithmetic lands on the asked-for time.
//             Pure, no browser: a bisection that does not converge is a
//             bug in the solver and should not need a game to find.
//   driven    and the GAME, run at full throttle from a standstill,
//             lands there too. This is the one that matters and the one
//             that caught the first two attempts: the first solved as
//             if torque were 1 throughout and missed by up to 23%,
//             grouped by engine, because a 1.6 makes its power at 7,000
//             rpm and a standing start spends first gear at 2,000.
//
// It also holds the ROSTER to being a roster. Before any of this, every
// car in the game launched at its own grip figure — thrust came out
// above the traction cap on all seventeen — so `power` never bound, the
// Black Demon pulled 2.44 g, and a 195 km/h pickup reached 100 km/h
// quicker than four sports cars. Ordering and plausibility are checked
// here for that reason: they were both wrong and neither was visible
// from the code.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { CARS } from "../src/game/mods.ts";
import { launchThrustFor, timeTo100, launchG, LAUNCH_REF } from "../src/game/accel.ts";
import { getEngine } from "../src/game/engines.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// ---- 1. Every card is a number a road car could post ----------------
{
  // Named, not counted: "one card is out of band" sends you looking,
  // and the first version of this said which car had the HIGHEST g
  // whatever the fault was — so a failure at the bottom of the band
  // reported the quickest car in the game as the problem.
  const out = CARS.map((c) => ({ id: c.id, g: launchG(c.zeroTo100s), t: c.zeroTo100s }))
    .filter((c) => c.g < LAUNCH_REF.minG || c.g > LAUNCH_REF.maxG);
  for (const c of out) fail.push(`${c.id}: ${c.t}s is ${c.g.toFixed(3)} g`);
  const gs = CARS.map((c) => launchG(c.zeroTo100s));
  console.log(
    `plausible ${Math.min(...gs).toFixed(2)}–${Math.max(...gs).toFixed(2)} g across the roster  ` +
      check(out.length === 0, `outside ${LAUNCH_REF.minG}–${LAUNCH_REF.maxG} g: ${out.map((c) => c.id).join(", ")}`) +
      `  (a supermini is 0.20, a hypercar 1.3)`
  );
}

// ---- 2. Quicker cars have quicker cards -----------------------------
//
// Not a physical law, a ROSTER law: a showroom where the 195 km/h truck
// out-drags the sports saloon is a showroom nobody can read. Checked
// against price rather than top speed, because price is what the player
// is actually choosing between and the two agree everywhere it matters.
{
  // CORRELATION, not strict order.
  //
  // Strict monotonicity is the wrong claim and the roster says so in
  // three places on purpose: the Zeta 300 GTR is cheaper than the Black
  // Demon and launches harder because it drives all four wheels, and
  // the Jahra Pickup is the cheapest thing here with a V8 in it and is
  // meant to embarrass a saloon in a straight line. Those are the kind
  // of fact a showroom is INTERESTING for having.
  //
  // What must not happen is the roster reading backwards overall, which
  // is what it did before any of this: the ordering you saw was the
  // ordering of `grip`, and four cars were out of place. A rank
  // correlation catches that and lets a deliberate upset stand.
  const priced = CARS.filter((c) => c.price > 0);
  const byPrice = [...priced].sort((a, b) => b.price - a.price).map((c) => c.id);
  const byTime = [...priced].sort((a, b) => a.zeroTo100s - b.zeroTo100s).map((c) => c.id);
  const rank = (arr) => new Map(arr.map((id, i) => [id, i]));
  const rp = rank(byPrice), rt = rank(byTime);
  const n = priced.length;
  let d2 = 0;
  for (const c of priced) d2 += (rp.get(c.id) - rt.get(c.id)) ** 2;
  const rho = 1 - (6 * d2) / (n * (n * n - 1));
  const upsets = [];
  for (const c of priced) {
    const moved = Math.abs(rp.get(c.id) - rt.get(c.id));
    if (moved >= 2) upsets.push(`${c.name} (${moved} places)`);
  }
  console.log(
    `ordered   price against launch, rank correlation ${rho.toFixed(3)}  ` +
      check(rho >= 0.93, `the roster reads backwards: rho ${rho.toFixed(3)}`)
  );
  if (upsets.length) console.log(`          deliberate upsets: ${upsets.join(", ")}`);
}

// ---- 3. The solver hits what it is asked for ------------------------
{
  let worst = 0, worstId = "";
  for (const car of CARS) {
    const lc = {
      ceiling: Math.max(115, (car.topSpeedKmh / 3.6) * 1.25),
      gripAccel: car.grip,
      downforce: 0,
      tractionMult: 1,
      engine: getEngine(car.engine),
      boostMult: 0,
      twinTurbo: false,
    };
    const got = timeTo100(launchThrustFor(car.zeroTo100s, lc), lc);
    const err = Math.abs(got - car.zeroTo100s) / car.zeroTo100s;
    if (err > worst) { worst = err; worstId = car.id; }
  }
  console.log(
    `solvable  worst ${(worst * 100).toFixed(1)}% off on ${worstId}  ` +
      check(worst < 0.05, `the solver misses its own target by ${(worst * 100).toFixed(1)}% on ${worstId}`)
  );
}

// ---- 4. And the game does it ----------------------------------------
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
if (process.argv.includes("--records")) {
  if (fail.length) {
    console.log(`\nFAILURES:\n${fail.map((f) => ` - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nthe cards are sound; run without --records to drive them");
  process.exit(0);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
// Small: nothing here looks at a picture, and a full canvas on a
// software renderer takes the main thread off the thing being measured.
const page = await browser.newPage({ viewport: { width: 200, height: 150 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(1000);

const driven = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const S = window.__grnShowroom;
  const out = [];
  for (const id of S.ids()) {
    e.tune = S.tuneFor(id);
    const p = e.player;
    p.speed = 0; p.s = 0; p.lat = 0;
    e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
    // Traffic half a lap away: a bumper mid-run is not a launch, and
    // leaving it in reported a hundred g on two cars.
    for (const t of e.traffic) t.s = e.track.wrap(p.s + e.track.length / 2);
    for (let i = 0; i < 30; i++) e.update(1 / 60);
    p.speed = 0; p.s = 0; p.lat = 0;
    for (const t of e.traffic) t.s = e.track.wrap(p.s + e.track.length / 2);
    let t100 = null, prev = 0, bumped = false;
    const DT = 1 / 120;
    for (let i = 0; i < 120 * 40; i++) {
      e.setTouchInput({ throttle: 1 });
      e.update(DT);
      if (Math.abs((p.speed - prev) / DT) > 30) { bumped = true; break; }
      prev = p.speed;
      if (p.speed * 3.6 >= 100) { t100 = (i + 1) * DT; break; }
    }
    out.push({ id, t100: t100 === null ? null : +t100.toFixed(2), bumped });
  }
  return out;
});
await browser.close();

console.log("");
let worstErr = 0, worstId = "";
for (const r of driven) {
  const card = CARS.find((c) => c.id === r.id).zeroTo100s;
  const err = r.t100 === null ? Infinity : Math.abs(r.t100 - card) / card;
  if (err > worstErr) { worstErr = err; worstId = r.id; }
  console.log(
    `  ${r.id.padEnd(16)} card ${String(card).padStart(5)}s   drove ${String(r.t100 ?? "—").padStart(5)}s  ` +
      `${r.t100 === null ? "" : ((r.t100 - card >= 0 ? "+" : "") + (r.t100 - card).toFixed(2) + "s")}` +
      (r.bumped ? "  HIT SOMETHING" : "")
  );
}
// 8%: a manufacturer's own 0-100 claim is worth about ±5%, and the game
// has a gearbox whose change points are fixed speeds rather than fixed
// revs, so a car can land either side of a shift at 100 km/h and pay or
// save most of a change for it.
console.log(
  `\ndriven    worst ${(worstErr * 100).toFixed(1)}% off on ${worstId}  ` +
    check(worstErr < 0.08, `${worstId} is ${(worstErr * 100).toFixed(1)}% off its card`)
);

if (fail.length) {
  console.log(`\nFAILURES:\n${fail.map((f) => ` - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nevery card is a number the car actually posts");
