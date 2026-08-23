// The two builds run the same game, or they do not.
//
//   npm run test:parity          (needs g++; no dev server, no browser)
//
// scripts/check-unreal-sync.mjs proves the UE5 header carries the same
// NUMBERS as the web build. That check passed for months while
// GRNVehiclePawn.cpp was running a different, older model — no brake
// lock, no ABS, no fade, no momentum spin, no counter-steer, no chain,
// no feint, no lift-off, no load transfer, no downforce.
// src/game/handling.ts said so out loud, against driftYawClamp:
//
//   "the ports carry the numbers but not yet src/game/drift.ts"
//
// A table of constants agreeing says nothing about what is done with
// them. This compares TRAJECTORIES: four thousand steps of scripted
// driving through src/game/{drift,brakes,grip}.ts and through
// unreal/Source/GulfRoadNights/GRNSim.h, step by step, on fourteen
// state variables.
//
// The script is generated identically on both sides rather than passed
// between them: the same 32-bit LCG, the same three lines of integer
// arithmetic, which JavaScript's doubles hold exactly. So the inputs
// are identical by construction and every difference in the output is a
// difference in the model.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { solveDrift, newDriftState } from "../src/game/drift.ts";
import { solveBrakes, brakeCeiling } from "../src/game/brakes.ts";
import { solveLoad, newLoadState, gripAtSpeed } from "../src/game/grip.ts";
import { HANDLING as H } from "../src/game/handling.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// --- Build the C++ side ------------------------------------------------
let cxx = null;
for (const c of ["g++", "clang++"]) {
  try { execFileSync(c, ["--version"], { stdio: "ignore" }); cxx = c; break; } catch {}
}
if (!cxx) {
  console.error("no C++ compiler — this test needs g++ or clang++ to build GRNSim.h");
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "grn-parity-"));
const bin = join(dir, "parity");
try {
  execFileSync(cxx, [
    "-O2", "-std=c++17",
    "-I", "unreal/Source/GulfRoadNights",
    "tools/parity/parity.cpp",
    "-o", bin,
  ], { stdio: "pipe" });
} catch (e) {
  console.error("GRNSim.h did not compile:\n" + (e.stderr?.toString() ?? e.message));
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}
console.log(`built    GRNSim.h with ${cxx}, engine-free`);

const csv = execFileSync(bin, [], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
rmSync(dir, { recursive: true, force: true });
const lines = csv.trim().split("\n");
const cols = lines[0].split(",");
const cpp = lines.slice(1).map((l) => {
  const v = l.split(",").map(Number);
  return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
});

// --- The same script, in JavaScript ------------------------------------
//
// Mirrors `struct Script` in tools/parity/parity.cpp line for line. The
// multiply is done in BigInt because 1103515245 * (2^32 - 1) is past
// 2^53 and would lose its low bits as a double — which is exactly the
// sort of thing that makes two "identical" sequences diverge on step
// four hundred and nobody can say why.
class Script {
  constructor(seed) { this.state = BigInt(seed); }
  next() {
    this.state = (1103515245n * this.state + 12345n) & 0xffffffffn;
    return Number(this.state);
  }
  unit() { return this.next() / 4294967296; }
  range(lo, hi) { return lo + this.unit() * (hi - lo); }
}

const tune = {
  gripAccel: 12.4,
  brakeForce: 30.0,
  brakeThermalMult: 1.0, // stock discs, so fade is reachable
  hasAbs: false,
};
const downforce = 0.9;

// The same six manoeuvres, in the same order, held for the same number
// of steps. Mirrors the switch in tools/parity/parity.cpp; integer and
// rational arithmetic only, because libm's sin and Math.sin are allowed
// to differ in the last place and a script that disagrees with itself
// makes the whole comparison meaningless.
// How long the run-up is, in steps. Measured, not guessed: at 90 steps
// the car reached 20 m/s and the trail-brake entry peaked at 0.058 rad/s
// against a threshold of 0.12, because that entry is scaled by
// (v-12)/18. At 240 the car arrives at about 30.
const RUNUP = 240;
const STEPS = 8000;
const DT = 1 / 120;
const js = [];
/** Which branch of each solver the run actually took. Counted rather
 *  than inferred from magnitudes: "the disc got hot" is a proxy, "the
 *  fade branch ran" is the thing. */
const cover = {
  entry: {}, spun: 0, linked: 0, banked: 0, jolt: 0,
  locked: 0, abs: 0, faded: 0, hottest: 0,
};

// Two passes over the same script: without ABS, then with it. The
// controller is a whole branch of the brake solver, and with it off for
// the whole run that branch is never taken and its parity never checked.
for (let pass = 0; pass < 6; pass++) {
tune.hasAbs = pass % 2 === 1;
// Six passes: three drivetrains, each with ABS off and on. Two was
// enough while every car in the game was a rear-driver; it is not enough
// now, and a parity run that only exercises one drivetrain proves the
// ports agree about one third of the model.
const drive = pass < 2 ? "rwd" : pass < 4 ? "fwd" : "awd";
const rng = new Script(20260822);
const drift = newDriftState();
const load = newLoadState();
const bs = { lock: 0, temp: 0, pulse: 0 };
let speed = 30.0;
let steer = 0;
let throttle = 0;
let brake = 0;
let hold = 0;
let mode = 6; // so the first cycle starts at 0
let holdTotal = 0;
let phase = 0;
let way = 1;
let handbrake = false;

for (let i = 0; i < STEPS; i++) {
  if (hold <= 0) {
    // Cycled, not drawn. Coverage by construction rather than by luck:
    // chosen at random, the fade stint — which needs a thousand steps to
    // get a disc to 320 degrees — crowded four of the other six out of a
    // pass, and the run "proved" parity on branches it never took. The
    // generator still decides which way each one goes and how long.
    mode = (mode + 1) % 7;
    hold = 20 + (rng.next() % 90);

    // ...and threshold braking gets held long enough to FADE. Heat is
    // decel times speed against a cooling term with an eighteen-second
    // time constant, so reaching the 320 degrees fade starts at takes
    // six or seven seconds of continuous braking.
    if (mode === 2) hold += 1400;
    // The trail-brake entry needs the pedal EASED, not buried: rotation
    // is weight times spare front grip and their product peaks partway
    // through the travel. Mode 3 ramps off at 0.02 a step, so it has to
    // run long enough to reach about a quarter pedal.
    if (mode === 3) hold += RUNUP + 120;
    // The handbrake entry is held far longer than the rest, and it has
    // to be: from the entry cap the sustain term winds the angle on at
    // about 0.38 rad/s, so reaching the 1.05 rad spin trip takes the
    // better part of two seconds — after a run-up long enough to have
    // the speed the entry needs at all. Held for the same fifth of a
    // second as everything else, this script produced not one spin in
    // four thousand steps, which would have "proved" the spin model
    // matched by never once invoking it.
    if (mode === 4) hold += RUNUP + 640;
    if (mode === 5) hold += 200;
    if (mode === 6) hold += RUNUP + 100;
    holdTotal = hold;
    phase = 0;
    way = rng.next() % 2 ? 1 : -1;
  }
  hold--;
  phase++;

  switch (mode) {
    case 0: // cruising, weaving gently in lane
      steer = way * 0.15 * (phase % 40 < 20 ? 1 : -1);
      throttle = 0.5; brake = 0; handbrake = false;
      break;
    case 1: // flat out, straight
      steer = 0; throttle = 1; brake = 0; handbrake = false;
      break;
    case 2: // threshold braking, long enough to heat the discs
      steer = way * 0.1; throttle = 0; brake = 1; handbrake = false;
      break;
    // Modes 3, 4 and 6 open with a run-up, and they have to. Every one
    // needs SPEED — the trail entry is scaled by (v-12)/18, the handbrake
    // entry wants 14 m/s and power-over 18 — and each follows whatever
    // left the car where it did. Following the fade stint, which ends on
    // the speed floor, all three fired exactly nothing.
    case 3: { // trail braking in: easing off as the lock goes on
      if (phase <= RUNUP) { steer = 0; throttle = 1; brake = 0; handbrake = false; break; }
      const q = phase - RUNUP;
      // From a HALF pedal, not a buried one: rotation is weight times
      // SPARE front grip, so a pedal on the floor rotates nothing.
      // Left-foot braking: a light pedal held against part throttle, at
      // MODERATE lock. Sized from the arithmetic rather than nudged
      // toward it — rotation is weight times SPARE front grip, and what
      // was killing spare was the speed collapsing (so the throttle
      // holds it up) and full lock eating the brake ceiling through the
      // friction circle (so the lock comes back to 0.6). Ramping a pedal
      // down from half, at full lock, peaked at 0.115 against a 0.12 trip.
      void q;
      steer = way * 0.6; throttle = 0.85; brake = 0.32; handbrake = false;
      break;
    }
    case 4: { // handbrake entry, then lock INTO it on the throttle
      if (phase <= RUNUP) { steer = 0; throttle = 1; brake = 0; handbrake = false; break; }
      const q = phase - RUNUP;
      steer = way * 0.9;
      throttle = q > 12 ? 1 : 0.2;
      brake = 0; handbrake = q <= 12;
      // ...and then hands off: a big angle dropped with no correction
      // snaps back with a jolt, and every manoeuvre here used to be
      // followed by another one holding lots of lock.
      // Hands off — but only after the slide has had time to go all the
      // way. Dropped at 200 the lock came off at almost exactly the step
      // the angle reached the spin trip, and the car recovered.
      if (q > 280) { steer = 0; throttle = 0.4; }
      break;
    }
    case 6: // lifting off mid-corner. Gentle lock and a brush of pedal:
      // enough deceleration to take the weight off the rear, not enough
      // rotation to trip the trail entry, which outranks this one. That
      // gap is exactly where lift-off oversteer lives.
      if (phase <= RUNUP) { steer = 0; throttle = 1; brake = 0; handbrake = false; break; }
      // A three-tenths pedal, not a tenth. The lift entry needs the rear
      // unloaded past 0.18, and the harness's own longitudinal model puts
      // 0.1 of brake at 1.4 m/s^2 — which unloads it to 0.112 and never
      // trips. Still far below the trail entry's rotation threshold,
      // which is the gap this manoeuvre is for.
      steer = way * 0.3; throttle = 0; brake = 0.3; handbrake = false;
      break;
    default: { // transitions: lock flicked from one side to the other,
      // which links a drift chain — and then the wheel is let go, SLOWLY.
      //
      // The release has to be slow, and that is the whole point of it. A
      // big angle dropped with no correction snaps back with a jolt, but
      // an ABRUPT release is a fast reversal of lock at speed, which is a
      // feint — so it arms the feint entry, the feint entry owns the next
      // 0.45 s, and the recover branch where the jolt lives is never
      // reached. Letting go over half a second is 1.9 rad/s of lock,
      // under the 4.2 the feint detector trips at.
      const release = holdTotal - 180;
      if (phase > release) {
        // From whichever side the flick happened to be on when the
        // release began. Ramping from a fixed side jumped the wheel
        // across centre half the time — 1.9 rad in one step, which is a
        // fast reversal at speed, which is a feint, which arms the very
        // entry the slow release exists to avoid.
        const s0 = Math.trunc(release / 40) % 2 ? way : -way;
        const r = phase - release;
        if (r <= 90) {
          // Hold the slide first, and for long enough. There has to be
          // a big angle to snap back FROM: released straight out of a
          // flick the car was passing through centre, and even a
          // quarter-second hold only reached 0.27 rad against a jolt
          // threshold of 0.3. Three quarters of a second on the throttle
          // at full lock winds it past half a radian.
          steer = s0 * 0.95; throttle = 0.95;
        } else {
          const t = Math.min(1, (r - 90) / 60);
          steer = s0 * 0.95 * (1 - t);
          throttle = 0.3;
        }
        brake = 0; handbrake = false;
        break;
      }
      steer = (Math.trunc(phase / 40) % 2 ? way : -way) * 0.95;
      // Enough throttle to light the rears, so power-over holds the angle
      // between flicks. At 0.7 the slide collapsed under grip before the
      // next flick and the chain never linked: linking needs a LIVE slide
      // reversed through centre, not two separate ones.
      throttle = 0.95; brake = 0; handbrake = false;
      break;
    }
  }

  // Straighten between manoeuvres. Two reasons, and the second is the
  // one that matters: a driver does straighten up, and a big angle
  // DROPPED with no correction is the only way to reach the snap-back
  // jolt — every manoeuvre here used to be followed immediately by
  // another one holding a lot of lock, which counts as counter-steer and
  // takes the jolt branch off the table.
  if (phase <= 30) steer = 0;

  const grip = gripAtSpeed(tune.gripAccel, downforce, speed);
  const l = solveLoad(load, { dt: DT, aLong: throttle * 9 - brake * 14 - 1.2, drive, throttle });
  const latDemand = Math.min(1, (Math.abs(steer) * speed) / H.latDemandSpeed);
  const b = solveBrakes(bs, {
    dt: DT, tune, brake, speed, latDemand, steer, throttle, grip,
  });
  const d = solveDrift(drift, {
    dt: DT,
    speed,
    steer,
    throttle,
    handbrake,
    wheelspin: throttle > 0.85 ? (throttle - 0.85) * 14 : 0,
    brakeRotate: b.rotate,
    rearLight: l.rearLight,
    drive,
    driftAngleMult: 1,
  });

  speed += (throttle * 9 * l.driveScale - b.decel - 1.2) * DT;
  speed *= 1 - d.scrubRate * DT;
  // A road-speed floor rather than a standstill: brake heat is force
  // times SPEED, and a car that trickles to a halt stops heating its
  // discs and can never reach the 320-degree fade threshold.
  if (speed < 12) speed = 12;
  if (speed > 95) speed = 95;

  cover.entry[d.entry || "none"] = (cover.entry[d.entry || "none"] ?? 0) + 1;
  cover.byMode ??= {};
  cover.byMode[mode] ??= {};
  cover.byMode[mode][d.entry || "none"] = (cover.byMode[mode][d.entry || "none"] ?? 0) + 1;
  cover.rearLight = Math.max(cover.rearLight ?? 0, l.rearLight);
  if (d.spun) cover.spun++;
  if (d.linked) cover.linked++;
  if (d.banked > 0) cover.banked++;
  if (d.jolt > 0) cover.jolt++;
  if (b.lock > 0.5) cover.locked++;
  if (b.abs) cover.abs++;
  if (b.fade > 0) cover.faded++;
  cover.maxRotate = Math.max(cover.maxRotate ?? 0, Math.abs(b.rotate));
  cover.maxAngle = Math.max(cover.maxAngle ?? 0, Math.abs(d.angle));
  if (!d.entry && !d.spinning && Math.abs(d.angle) > 0.3) cover.recoverBig = (cover.recoverBig ?? 0) + 1;
  if (!d.entry && !d.spinning) cover.recoverAngles = Math.max(cover.recoverAngles ?? 0, Math.abs(d.angle));
  cover.hottest = Math.max(cover.hottest, b.temp);

  js.push({
    step: pass * STEPS + i,
    angle: d.angle, spinRate: d.spinRate, scrub: d.scrubRate, chain: d.chain, run: drift.run,
    lock: b.lock, temp: b.temp, rotate: b.rotate, decel: b.decel,
    front: l.front, steerScale: l.steerScale, driveScale: l.driveScale, grip,
  });
}
}

// --- Compare -----------------------------------------------------------
console.log(`ran      ${STEPS} steps of scripted driving through both models`);
console.log(
  `steps    ${check(cpp.length === js.length,
    `the C++ side produced ${cpp.length} steps against ${js.length}`)}  ` +
    `${cpp.length} steps from each`
);

// Relative where the value has scale, absolute where it does not — an
// angle of 1e-9 against 2e-9 is not a hundred per cent error, it is two
// numbers that are both zero.
const FIELDS = cols.filter((c) => c !== "step");
const worst = {};
for (const f of FIELDS) worst[f] = { err: 0, step: -1, a: 0, b: 0 };
let firstBad = null;
const TOL = 1e-9;
for (let i = 0; i < Math.min(cpp.length, js.length); i++) {
  for (const f of FIELDS) {
    const a = js[i][f];
    const b = cpp[i][f];
    const scale = Math.max(Math.abs(a), Math.abs(b), 1e-3);
    const err = Math.abs(a - b) / scale;
    if (err > worst[f].err) worst[f] = { err, step: i, a, b };
    if (err > TOL && !firstBad) firstBad = { f, i, a, b, err };
  }
}

console.log("\nfield         worst relative error   at step   web            unreal");
for (const f of FIELDS) {
  const w = worst[f];
  console.log(
    `  ${f.padEnd(12)} ${w.err.toExponential(2).padStart(10)}        ` +
      `${String(w.step).padStart(5)}   ${w.a.toPrecision(8).padStart(13)}  ${w.b.toPrecision(8)}`
  );
}

const maxErr = Math.max(...FIELDS.map((f) => worst[f].err));
console.log(
  `\nagree      ${check(maxErr < TOL,
    firstBad
      ? `they diverge at step ${firstBad.i} on ${firstBad.f}: web ${firstBad.a}, unreal ${firstBad.b}`
      : "")}  worst disagreement anywhere is ${maxErr.toExponential(2)} relative`
);

// --- Coverage ----------------------------------------------------------
//
// A trajectory where nothing ever spun, locked, faded or linked would
// agree perfectly and prove nothing about any of them. Counted by
// BRANCH rather than by magnitude: "the disc got hot" is a proxy for
// "the fade branch ran", and the proxy is what let the first version of
// this script pass with zero spins in four thousand steps.
const need = [
  ["handbrake entry", cover.entry.handbrake ?? 0],
  ["power-over entry", cover.entry.power ?? 0],
  ["trail-brake entry", cover.entry.brake ?? 0],
  ["feint entry", cover.entry.feint ?? 0],
  ["lift-off entry", cover.entry.lift ?? 0],
  ["spun", cover.spun],
  ["chain linked", cover.linked],
  ["run banked", cover.banked],
  ["snap-back jolt", cover.jolt],
  ["wheels locked", cover.locked],
  ["ABS pulsing", cover.abs],
  ["brakes faded", cover.faded],
];
console.log("\nbranch                 steps");
for (const [name, n] of need) {
  console.log(`  ${name.padEnd(20)} ${String(n).padStart(6)}${n === 0 ? "   <- never taken" : ""}`);
}
console.log(`  hottest disc         ${cover.hottest.toFixed(0)}\u00b0C`);
console.log(
  `  peak brake rotation  ${(cover.maxRotate ?? 0).toFixed(3)} rad/s ` +
    `(the trail entry trips at ${H.driftBrakeEntry})`
);
console.log(
  `  peak drift angle     ${(cover.maxAngle ?? 0).toFixed(3)} rad ` +
    `(the spin trips at ${H.driftSpinAngle})`
);
console.log(
  `  recovering on grip   ${cover.recoverBig ?? 0} steps past 0.3 rad, ` +
    `biggest ${(cover.recoverAngles ?? 0).toFixed(3)} rad (the jolt needs a crossing of 0.3)`
);
for (const m of Object.keys(cover.byMode).sort()) {
  console.log(`  mode ${m}: ${JSON.stringify(cover.byMode[m])}`);
}
console.log(`  peak rear unload     ${(cover.rearLight ?? 0).toFixed(3)} (lift trips at ${H.driftLiftEntry})`);
const missed = need.filter(([, n]) => n === 0).map(([name]) => name);
console.log(
  `\ncovers     ${check(missed.length === 0,
    `the script never took: ${missed.join(", ")}`)}  ` +
    `every branch of all three solvers is on this trajectory`
);

if (fail.length) {
  console.log(`\n${fail.length} FAILED`);
  for (const f of fail) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nboth builds drive the same car");
