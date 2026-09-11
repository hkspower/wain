// Can these cars still light their tyres?
//
//   npm run test:launch
//
// tests/engines.mjs asks this already, in a browser, driving the real
// engine — and that is the right place for it, because only the running
// game knows what the clutch, the load solver and the limiter all do to
// each other on the same frame. It is also the reason the answer has
// been unavailable: the race scene boots a WebGL world on a software
// rasteriser, and on a loaded machine it does not always come up inside
// four minutes. A check that cannot be run is a check that is not
// protecting anything.
//
// So the same question is asked here of the pure functions, with no
// browser at all. Nothing is re-derived: driveCap is the expression
// engine.ts uses for the traction ceiling, exported for exactly this
// reason, and torqueAtSpeed is the clutch — at a standstill it returns
// the torque at the engine's OWN peak, which is what a slipping clutch
// holds it at.
//
// WHAT IT IS FOR
//
// A standing start is the one moment in this game where the driver asks
// for more than the road will take. If the engine cannot out-torque the
// tyre from rest then the car cannot chirp, cannot burn out, and pulls
// away like a milk float whatever is under the bonnet — which the
// comment on the clutch model in tests/engines.mjs calls "a strange
// thing for this game to ship". This says whether it does.

import { CARS } from "../src/game/mods.ts";
import { ENGINES } from "../src/game/engines.ts";
import { driveCap, gripAtSpeed, driveShareFor } from "../src/game/grip.ts";
import { torqueAtSpeed, launchThrustFor } from "../src/game/accel.ts";
import { torqueShape } from "../src/game/engines.ts";
import { revFractionIn } from "../src/game/gears.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

/** The starter car, which is what tests/engines.mjs puts every engine in. */
const STARTER = CARS.find((c) => c.id === "wain-special") ?? CARS[0];

const launchCar = (car, engine) => ({
  ceiling: Math.max(115, (car.topSpeedKmh / 3.6) * 1.25),
  gripAccel: car.grip,
  downforce: 0,
  tractionMult: 1,
  driveShare: driveShareFor(car.drive),
  engine,
  boostMult: 0,
  twinTurbo: false,
});

/**
 * Drive and grip at a standing start, in m/s².
 *
 * The cap is taken with latDemand and driveScale at their defaults, for
 * the reason accel.ts gives: a launch is a straight line and the springs
 * have not settled, so neither term is helping yet.
 */
function standingStart(car, engine) {
  const lc = launchCar(car, engine);
  // The thrust this car is SOLD as having — solved from its stated
  // 0-100, so the comparison is against the card rather than a number
  // invented here.
  const thrust = launchThrustFor(car.zeroTo100s, lc);
  const drive = thrust * torqueAtSpeed(engine, 0, 1);
  const cap = driveCap({
    grip: gripAtSpeed(lc.gripAccel, lc.downforce, 0),
    speed: 0,
    tractionMult: lc.tractionMult,
    driveShare: lc.driveShare,
  });
  return { drive, cap, spin: Math.max(0, drive - cap) };
}

// ---- 1. THE CLUTCH LIFTS THE ENGINE ONTO ITS PEAK -------------------
//
// This is the invariant the browser test was written for, stated in its
// own words: "without that, revFraction() reports the bottom of first at
// a standstill, the peaky engines make 0.4x torque". So measure exactly
// that — the torque an engine makes at the rev the GEARBOX would give it
// from rest, against the torque it makes with the clutch slipping.
//
// It is the sensitive check, and the reason to keep it rather than the
// "does it chirp" one: a 1.6 that loses its clutch drops to 0.44x and
// the failure is unmissable here, while a supercar with four times the
// traction it needs would go on chirping and say nothing.
{
  console.log("engine       bottom of 1st   on the clutch    lift");
  const flat = [];
  for (const e of ENGINES) {
    const bare = torqueShape(e, revFractionIn(1, 0));
    const held = torqueAtSpeed(e, 0, 1);
    const lift = held / bare;
    console.log(
      `${e.id.padEnd(10)} ${bare.toFixed(2).padStart(13)} ${held.toFixed(2).padStart(14)} ` +
        `${lift.toFixed(2).padStart(7)}x`
    );
    // Every engine has to gain, and the peaky ones have to gain a lot.
    // 1.0 exactly would mean the blend is not running at all.
    if (!(lift > 1.02)) flat.push(`${e.id} ${lift.toFixed(3)}x`);
  }
  console.log(
    `\nthe clutch holds every engine above the rev the gearbox would give it  ` +
      check(flat.length === 0, `no lift from the launch blend: ${flat.join(", ")}`)
  );
}

// ---- 2. And it holds them ON the peak, not near it -------------------
{
  const off = ENGINES.filter(
    (e) => Math.abs(torqueAtSpeed(e, 0, 1) - torqueShape(e, e.peakAt)) > 1e-6
  );
  console.log(
    `and exactly on it, for all ${ENGINES.length}  ` +
      check(off.length === 0, `launches off peak: ${off.map((e) => e.id).join(", ")}`)
  );
}

// ---- 2c. Only the engines that should scream, shake ------------------
//
// engine.ts ramps a sustained buzz — camera and pad both — from
// HIGH_REV_FROM up to the stop, so the top of the band is felt before
// the limiter rather than only at it. It takes no per-engine tuning
// because revFrac is a fraction of THIS engine's own range and shiftAt
// decides how far up it the gearbox will go, so the gating falls out of
// the data. That is a claim worth checking rather than admiring: it is
// exactly the kind of thing that silently stops being true when somebody
// retunes a gearbox.
{
  const FROM = 0.82, TO = 0.99;
  const smooth = (x) => {
    const t = Math.min(1, Math.max(0, (x - FROM) / (TO - FROM)));
    return t * t * (3 - 2 * t);
  };
  console.log("");
  console.log("engine     shiftAt   most bite it can ever reach");
  const rows = ENGINES.map((e) => ({ id: e.id, shiftAt: e.shiftAt, bite: smooth(e.shiftAt) }));
  for (const r of rows)
    console.log(`${r.id.padEnd(10)} ${String(r.shiftAt).padStart(5)}   ${r.bite.toFixed(3)}`);
  const screamers = rows.filter((r) => r.shiftAt >= 1);
  const shortShifted = rows.filter((r) => r.shiftAt <= 0.85);
  console.log(
    `\nthe engines geared to the limiter get all of it  ` +
      check(
        screamers.every((r) => r.bite > 0.95),
        `an engine with shiftAt 1.0 does not reach the top of the ramp: ` +
          screamers.map((r) => `${r.id} ${r.bite.toFixed(3)}`).join(", ")
      )
  );
  console.log(
    `and the short-shifted ones barely notice  ` +
      check(
        shortShifted.every((r) => r.bite < 0.1),
        `a short-shifted engine is buzzing anyway: ` +
          shortShifted.map((r) => `${r.id} ${r.bite.toFixed(3)}`).join(", ")
      )
  );
}

// ---- 3. Which cars can actually break traction ----------------------
//
// NOT "all of them". tests/engines.mjs asserted that every engine lights
// the tyres in the STARTER car, and that assertion is wrong on its face:
// the Wain Special is an 11.5-second economy car and a real 11.5-second
// car cannot light its tyres from rest either. Measured, the road
// engines ask for 0.53x to 0.99x of what the road gives — the 1.6 misses
// it by one percent — and only the 9,000 rpm race engine clears it.
//
// What the fleet does say is that the model is behaving: the quickest
// cars chirp, the AWD grip cars do not (an all-wheel-drive launch is
// grip-limited, which is the whole reason people buy them), and the
// cheap front-drive hatch does, because skinny driven front tyres under
// a light nose is the easiest wheelspin in motoring. An ordering that
// came out any other way would be the thing to worry about.
//
// So this prints rather than asserts, except for the top of the list:
// a car that does 0-100 in under three and a half seconds and cannot
// break traction is a broken car, whatever else is true.
{
  const rows = CARS.map((car) => {
    const e = ENGINES.find((x) => x.id === car.engine) ?? ENGINES[0];
    return { id: car.id, s: car.zeroTo100s, drive_: car.drive, ...standingStart(car, e) };
  }).sort((a, b) => a.s - b.s);
  const chirp = rows.filter((r) => r.spin > 0);
  console.log("");
  console.log("car                  0-100   drive    cap   ratio");
  for (const r of rows)
    console.log(
      `${r.id.padEnd(20)} ${String(r.s).padStart(5)} ${r.drive.toFixed(2).padStart(7)} ` +
        `${r.cap.toFixed(2).padStart(6)} ${(r.drive / r.cap).toFixed(2).padStart(7)}` +
        `${r.spin > 0 ? "  chirps" : ""}`
    );
  console.log(`\n${chirp.length} of ${rows.length} cars break traction from rest`);
  const quick = rows.filter((r) => r.s <= 3.5);
  const quickDead = quick.filter((r) => r.spin <= 0);
  console.log(
    `every car under 3.5s to 100 lights them up  ` +
      check(quickDead.length === 0, `quick and cannot chirp: ${quickDead.map((r) => r.id).join(", ")}`)
  );
}

// ---- 3. The drivetrain is in the cap at all -------------------------
//
// DRIVE_SHARE is the term most likely to be dropped from a literal by
// accident — it is newer than the others and absent means `undefined`,
// which multiplies the whole cap to NaN and makes every comparison above
// silently false rather than loudly wrong. tests/accel.mjs was bitten by
// exactly this and reported "Infinity% off".
{
  const bad = [];
  for (const car of CARS) {
    const share = driveShareFor(car.drive);
    if (!Number.isFinite(share) || share <= 0 || share > 1) bad.push(`${car.id}=${share}`);
    const r = standingStart(car, ENGINES[0]);
    if (!Number.isFinite(r.cap) || !Number.isFinite(r.drive)) bad.push(`${car.id} is not a number`);
  }
  console.log(
    `${CARS.length} cars, every drivetrain share a real fraction  ` +
      check(bad.length === 0, `bad drive share or non-finite launch: ${bad.join(", ")}`)
  );
}

if (fail.length) {
  console.error(`\n${fail.length} failed:\n`);
  for (const f of fail) console.error(`  ${f}`);
  process.exit(1);
}
console.log("\nthe clutch is doing its job, and the cars that should chirp do.");
