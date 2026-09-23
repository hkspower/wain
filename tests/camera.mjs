// The camera's motion, checked without a browser.
//
//   npm run test:camera
//
// The laws live in src/game/camera.ts for the reason police.ts and
// spring.ts exist: a rule about how the view moves should be checkable
// without standing up a renderer, and the one suite that used to read
// camera state (tests/motion.mjs) stepped at exactly 1/60, so every
// frame-rate dependence in the camera was invisible to it.
//
// WHAT WAS WRONG, measured on the real engine before this change
// (a browser capture against the old code, not a transcription of it):
//
//   trailing at 100 km/h   11.02 / 11.49 / 11.76 m behind the car at
//                          30 / 60 / 144 Hz — 0.74 m of framing that
//                          depended on the player's monitor
//   bumper -> chase        lens 77.2 deg on the frame after the cut,
//                          still 53.1 a full second later (target 52)
//   session start          lens 60.5 deg after 1.5 s of running: it was
//                          initialised to 62, the chase lens before
//                          cc779f4a brought it to 52
//   film hand-off          the camera jumped 3.54 m in ONE frame while
//                          the car moved 0.30 m, dropped 0.60 m, then
//                          slid back over a third of a second
//
// Where a check below also runs a transcription of the old law, that is
// a second witness only — the engine numbers above are the evidence.
import * as THREE from "three";
import { readFileSync } from "node:fs";
import {
  newFollow, seedFollow, stepFollow, trailing, lagTo, decay, lensFov, easeAspect,
  filmTimeScale, filmExit, filmFov, filmEase, fovTarget,
  FOLLOW_LAG, CUT_JUMP, SHOVE_M, FILM_FOV, FILM_SLOWMO, HANDOFF_WINDOW, ASPECT_RATE,
} from "../src/game/camera.ts";
import { verticalFov, horizontalFov, MAX_HFOV } from "../src/game/aspect.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const V = 27.78; // 100 km/h

// A drive whose position is known EXACTLY at any instant, so three frame
// rates can be compared at the same moments: 2 s of launch to 100 km/h,
// then cruise, then a 1 s stop, then parked.
const zAt = (t) => {
  const a = V / 2;
  if (t <= 2) return 0.5 * a * t * t;
  const z2 = 0.5 * a * 4;
  if (t <= 4) return z2 + V * (t - 2);
  const z4 = z2 + 2 * V;
  if (t <= 5) { const u = t - 4; return z4 + V * u - 0.5 * V * u * u; }
  return z4 + 0.5 * V;
};
const vAt = (t) => (t <= 2 ? (V / 2) * t : t <= 4 ? V : t <= 5 ? V * (5 - t) : 0);

function drive(hz, law) {
  const dt = 1 / hz;
  const f = newFollow();
  const T = new THREE.Vector3(0, 2.8, 0);
  seedFollow(f, T, new THREE.Vector3());
  const old = new THREE.Vector3().copy(T);
  const at = {};
  let maxAhead = -Infinity;
  const steps = Math.round(6 * hz);
  for (let i = 1; i <= steps; i++) {
    const t = i * dt;
    T.set(0, 2.8, zAt(t));
    if (law === "new") stepFollow(f, T, dt);
    else old.lerp(T, Math.min(1, dt * 5.5));
    const x = law === "new" ? f.x : old;
    maxAhead = Math.max(maxAhead, x.z - T.z);
    for (const m of [1, 3, 4.5, 6]) if (Math.abs(t - m) < dt / 2) at[m] = x.z - T.z;
  }
  return { at, maxAhead };
}

// --- 1. The follow is the same at every frame rate -------------------
{
  const runs = [30, 60, 144].map((hz) => drive(hz, "new"));
  const olds = [30, 60, 144].map((hz) => drive(hz, "old"));
  let spread = 0, oldSpread = 0;
  for (const m of [1, 3, 4.5, 6]) {
    const v = runs.map((r) => r.at[m]);
    const o = olds.map((r) => r.at[m]);
    spread = Math.max(spread, Math.max(...v) - Math.min(...v));
    oldSpread = Math.max(oldSpread, Math.max(...o) - Math.min(...o));
  }
  // On the cruise the target moves at constant velocity, which is the
  // case the closed form is exact for.
  const cruise = runs.map((r) => r.at[3]);
  const cruiseSpread = Math.max(...cruise) - Math.min(...cruise);
  console.log(`follow     at 30/60/144 Hz: cruise ${(cruiseSpread * 1e6).toFixed(3)} um apart; through launch and a 2.8 g stop ${(spread * 1000).toFixed(2)} mm (old law ${(oldSpread * 1000).toFixed(0)} mm)`);
  console.log(`  ${check(cruiseSpread < 1e-6, `on the cruise the follow lands ${(cruiseSpread * 1000).toFixed(4)} mm apart across frame rates`)}  on the cruise, the shot does not depend on the monitor at all`);
  // Under acceleration the per-frame straight-line hold is an O(a dt^2)
  // approximation. Bounded, not claimed away: under a hundredth of the
  // old law's disagreement on the same drive.
  console.log(`  ${check(spread < 0.005 && spread < oldSpread / 100, `through a launch and a stop the follow is ${(spread * 1000).toFixed(2)} mm apart across frame rates`)}  through a launch and a hard stop, within 5 mm (the a*dt^2 residual)`);
  console.log(`  ${check(oldSpread > 0.3, "the old law's transcription agrees across frame rates — the witness is wrong")}  (second witness: the old law disagreed by ${(oldSpread).toFixed(2)} m)`);
  // Never passes the car on the stop — critically damped, no overshoot.
  const over = Math.max(...runs.map((r) => r.maxAhead));
  console.log(`  ${check(over <= 1e-9, `the camera ran ${(over * 1000).toFixed(1)} mm past its target when the car stopped`)}  and never overshoots when the car stops`);
  const parked = runs.map((r) => Math.abs(r.at[6]));
  console.log(`  ${check(Math.max(...parked) < 0.05, `still ${Math.max(...parked).toFixed(3)} m off a car that stopped a second ago`)}  and has arrived a second after the stop`);
}

// --- 2. Nothing a 60 Hz player has ever seen moves -------------------
{
  const f = newFollow();
  const T = new THREE.Vector3();
  seedFollow(f, T, new THREE.Vector3(0, 0, V));
  for (let i = 0; i < 240; i++) { T.z += V / 60; stepFollow(f, T, 1 / 60); }
  const lag = T.z - f.x.z;
  // The old law's 60 Hz steady state, derived: a first-order discrete lag
  // with factor a trails by v·dt·(1−a)/a, and a = 5.5/60.
  const a = 5.5 / 60;
  const old60 = V * (1 / 60) * (1 - a) / a;
  console.log(`steady     trailing ${lag.toFixed(4)} m at 100 km/h; FOLLOW_LAG x v = ${(FOLLOW_LAG * V).toFixed(4)}; the old 60 Hz law settled at ${old60.toFixed(4)}`);
  console.log(`  ${check(Math.abs(lag - FOLLOW_LAG * V) < 1e-6, "the steady trailing is not FOLLOW_LAG x speed")}  trails by exactly FOLLOW_LAG x speed`);
  console.log(`  ${check(Math.abs(lag - old60) < 1e-6, `the 60 Hz framing moved by ${((lag - old60) * 1000).toFixed(2)} mm`)}  which is precisely where a 60 Hz player's camera always sat`);
}

// --- 3. A shove is a translation, not a velocity ---------------------
{
  const response = (hz) => {
    const f = newFollow(); const T = new THREE.Vector3();
    seedFollow(f, T, new THREE.Vector3(0, 0, V));
    let off0 = null, peakV = 0;
    for (let i = 1; i <= hz; i++) {
      T.z += V / hz;
      if (i === Math.round(hz / 2)) { T.x += 3; off0 = null; }
      stepFollow(f, T, 1 / hz);
      if (i === Math.round(hz / 2)) off0 = f.x.x - T.x;
      peakV = Math.max(peakV, Math.abs(f.v.x));
    }
    return { off0, peakV, end: f.x.x };
  };
  const a = response(30), b = response(144);
  console.log(`shove      a 3 m push-out in one frame: camera keeps its offset (${a.off0.toFixed(4)} m), sideways speed peaks ${b.peakV.toFixed(3)} m/s`);
  console.log(`  ${check(Math.abs(a.off0) < 1e-9 && Math.abs(b.off0) < 1e-9, "a shove was fed in as velocity rather than carried as a translation")}  moves with the car the frame it is shoved`);
  console.log(`  ${check(Math.abs(a.end - b.end) < 1e-6, `the response to a shove differs by ${Math.abs(a.end - b.end).toFixed(4)} m between 30 and 144 Hz`)}  and the same at every frame rate`);
  console.log(`  ${check(3 > SHOVE_M, "the test shove is under SHOVE_M")}  (SHOVE_M ${SHOVE_M} m)`);
}

// --- 3b. A real change of speed is velocity, not a shove -------------
// A rear-end can take the car from 90 to 30 m/s in one frame. Measured
// against last frame's velocity that looks like a shove at 30 Hz and
// below, and the camera then trailed at the OLD speed's lag for as long
// as the car stayed slow — 14.86 m at 30 Hz against 4.95 at 60 (found
// by review, reproduced before the fix). The engine passes the target's
// velocity at the car's CURRENT speed, and this is that path.
{
  const after = (hz) => {
    const f = newFollow(); const T = new THREE.Vector3();
    const fast = new THREE.Vector3(0, 0, 90), slow = new THREE.Vector3(0, 0, 30);
    seedFollow(f, T, fast);
    for (let i = 0; i < hz; i++) { T.z += 90 / hz; stepFollow(f, T, 1 / hz, fast); }
    for (let i = 0; i < hz * 1.5; i++) { T.z += 30 / hz; stepFollow(f, T, 1 / hz, slow); }
    return { lag: T.z - f.x.z, r: f.r.z };
  };
  const res = [20, 30, 60, 144].map((hz) => ({ hz, ...after(hz) }));
  const want = FOLLOW_LAG * 30;
  console.log(`crash      90 -> 30 m/s in one frame, 1.5 s later: trailing ${res.map((x) => x.lag.toFixed(3)).join(" / ")} m at 20/30/60/144 Hz (steady at 30 m/s: ${want.toFixed(3)})`);
  console.log(`  ${check(res.every((x) => Math.abs(x.lag - want) < 0.1 && Math.abs(x.r - 30) < 1e-6), `after a one-frame speed drop the camera trails ${res.map((x) => x.lag.toFixed(2)).join("/")} m at 20/30/60/144 Hz`)}  a crash's speed drop is taken as velocity at every frame rate`);
}

// --- 4. Cuts are refused as steps ------------------------------------
{
  const f = newFollow(); const T = new THREE.Vector3();
  seedFollow(f, T, new THREE.Vector3());
  const teleport = stepFollow(f, T.clone().set(0, 0, CUT_JUMP + 1), 1 / 60);
  const pause = stepFollow(f, T, 1);
  console.log(`cuts       teleport past ${CUT_JUMP} m refused: ${!teleport}; a whole-second step refused: ${!pause}`);
  console.log(`  ${check(!teleport && !pause, "the follow integrated across a teleport or a stall instead of asking for a cut")}  a teleport and a stall are cuts, not steps`);
}

// --- 5. The scalar eases are exact -----------------------------------
{
  const ease = (hz) => { let v = 0; for (let i = 0; i < hz; i++) v = lagTo(v, 1, 3, 1 / hz); return v; };
  const sh = (hz) => { let v = 1; for (let i = 0; i < hz; i++) v = decay(v, 1 / hz); return v; };
  const e = [30, 60, 144].map(ease), d = [30, 60, 144].map(sh);
  console.log(`eases      lens after 1 s ${e.map((x) => x.toFixed(9)).join(" / ")}; jolt ${d.map((x) => x.toFixed(9)).join(" / ")}`);
  console.log(`  ${check(Math.max(...e) - Math.min(...e) < 1e-12 && Math.max(...d) - Math.min(...d) < 1e-12, "a camera ease depends on the frame rate")}  lens, roll, race framing and jolt land together at every rate`);
  console.log(`  ${check(decay(1, 0.5) > 0, "the jolt decay went negative on a long frame")}  and a long frame cannot drive the jolt negative`);
}

// --- 6. The lens -----------------------------------------------------
{
  let exact = true, bounded = true;
  for (const design of [52, 58, 66, 72, 78, 101]) {
    for (const a of [0.5, 0.75, 1, 4 / 3, 16 / 9, 2, 21 / 9, 32 / 9, 48 / 9]) {
      if (lensFov(design, a, a) !== verticalFov(design, a)) exact = false;
      for (const la of [16 / 9, 21 / 9, 32 / 9]) {
        if (horizontalFov(lensFov(design, la, a), a) > MAX_HFOV + 1e-9) bounded = false;
      }
    }
  }
  console.log(`lens       settled lens === verticalFov: ${exact}; wider than ${MAX_HFOV} deg mid-transition: ${!bounded}`);
  console.log(`  ${check(exact, "a settled lens differs from verticalFov — the letterbox work changed the ordinary lens")}  a settled lens is exactly the old one`);
  console.log(`  ${check(bounded, "the lens exceeded MAX_HFOV while a letterbox edge was being eased")}  and never a funhouse mirror while easing`);
  // Both directions of the race letterbox on an ultrawide: continuous.
  const walk = (from, to) => {
    let la = from, worst = 0, prev = lensFov(52, la, to);
    for (let i = 0; i < 180; i++) {
      la = easeAspect(la, to, 1 / 60);
      const v = lensFov(52, la, to);
      worst = Math.max(worst, Math.abs(v - prev));
      prev = v;
    }
    return { worst, end: la };
  };
  const on = walk(32 / 9, 16 / 9), off = walk(16 / 9, 32 / 9);
  const jumpOld = Math.abs(verticalFov(52, 16 / 9) - verticalFov(52, 32 / 9));
  console.log(`letterbox  32:9 race start: worst frame step ${on.worst.toFixed(3)} deg; race end ${off.worst.toFixed(3)} deg (old: ${jumpOld.toFixed(2)} deg in one frame)`);
  // Eased means the biggest single frame is a small fraction of the old
  // snap. The vertical field is not linear in log-aspect, so the honest
  // bound is relative to the one-frame jump it replaces.
  console.log(`  ${check(on.worst < jumpOld / 10 && off.worst < jumpOld / 10, "the lens still jumps across a letterbox edge")}  eased on and off: no frame moves more than a tenth of the old snap`);
  // An exponential never arrives; the engine snaps the last 1e-4 of
  // log-aspect, so arrival is checked in the same units.
  const arrived = (x, y) => Math.abs(Math.log(x / y)) < 1e-3;
  console.log(`  ${check(arrived(on.end, 16 / 9) && arrived(off.end, 32 / 9), "the lens has not reached the new shape after three seconds")}  and is at the new shape within three seconds (rate ${ASPECT_RATE}/s)`);
  const guard = easeAspect(NaN, 16 / 9, 1 / 60), guard2 = easeAspect(16 / 9, NaN, 1 / 60);
  console.log(`  ${check(guard === 16 / 9 && guard2 === 16 / 9, "a NaN aspect poisons the lens until the next cut")}  a NaN or zero aspect recovers on the next frame`);
}

// --- 7. The film --------------------------------------------------------
{
  const SET = 12, LEN = 14;
  const scale = [0, 6, 11.99, 12, 12.5, 13, 13.5, 13.99, 14].map((t) => filmTimeScale(t, SET, LEN));
  let mono = true, worst = 0;
  for (let t = SET; t < LEN; t += 1 / 60) {
    const a = filmTimeScale(t, SET, LEN), b = filmTimeScale(t + 1 / 60, SET, LEN);
    if (b < a - 1e-12) mono = false;
    worst = Math.max(worst, b - a);
  }
  console.log(`slow-mo    ${scale.map((x) => x.toFixed(2)).join(" ")}; biggest step between frames ${worst.toFixed(3)} (old: ${(1 - FILM_SLOWMO).toFixed(2)} in the frame the film ended)`);
  console.log(`  ${check(scale[0] === FILM_SLOWMO && Math.abs(scale[scale.length - 1] - 1) < 1e-9 && mono, "the film's time scale does not run from slow motion to real time, monotonically")}  slow through the shots, real time by the flag`);
  console.log(`  ${check(worst < 0.05, `the world's speed still steps by ${worst.toFixed(2)} in one frame`)}  and never lurches`);
  console.log(`  ${check(filmExit(LEN - 2, LEN) === "cut" && filmExit(LEN - HANDOFF_WINDOW + 0.01, LEN) === "handoff" && filmExit(LEN, LEN) === "handoff", "the skip policy is wrong")}  an early skip is an edit; a skip in the last ${HANDOFF_WINDOW} s is a hand-off`);
  const handK = filmEase((LEN - HANDOFF_WINDOW - SET) / (LEN - SET));
  console.log(`  ${check(handK > 0.9, `a hand-off can begin with the settle only ${(handK * 100).toFixed(0)}% done`)}  a hand-off only happens with the settle at least ${(handK * 100).toFixed(0)}% done`);
  const f0 = filmFov(0, SET, LEN, 52.8), f1 = filmFov(LEN, SET, LEN, 52.8);
  console.log(`  ${check(f0 === FILM_FOV && Math.abs(f1 - 52.8) < 1e-9, "the film lens does not run from its own to the chase's")}  the film's lens walks to the chase's own by the flag`);
}

// --- 8. The launch kick, as a law -------------------------------------
{
  const kick = fovTarget(52, 8, 90, 1) - fovTarget(52, 8, 90, 0);
  console.log(`kick       ${kick.toFixed(2)} deg of launch kick at 8 m/s under full throttle`);
  console.log(`  ${check(Math.abs(kick - 4) < 1e-9, "the launch kick is not 5 x (1 - 8/40)")}  is the documented five degrees, fading to nothing at 40 m/s`);
}

// --- 9. The engine uses the laws, and the stale numbers are gone -------
{
  const all = readFileSync("src/game/engine.ts", "utf8");
  // The camera's own functions only: the headlamp swivel elsewhere still
  // eases with Math.min(1, dt * 4), and it is not the camera.
  const body = (name) => {
    const at = all.indexOf(`  private ${name}(`);
    if (at < 0) return "";
    const next = all.indexOf("\n  private ", at + 10);
    return all.slice(at, next < 0 ? undefined : next);
  };
  const src = ["updateCamera", "applyFov", "updateMountedCamera", "updateCineCamera", "chaseRig", "seedHandoff", "endCinematic"]
    .map(body).join("\n") + (all.match(/private fovCurrent = [^;]+;/)?.[0] ?? "") + (all.match(/setView\([\s\S]{0,900}/)?.[0] ?? "");
  const gone = [
    ["the pre-cc779f4a settle arm", /9\.5 \+ p\.speed \* 0\.02/],
    ["the pre-cc779f4a settle height", /3\.4 \+ p\.speed \* 0\.007/],
    ["the 62-degree start lens", /fovCurrent = 62/],
    ["the linearised follow", /camBase\.lerp\(/],
    ["the per-frame film lens blend", /fovCurrent \+= \(58 - this\.fovCurrent\) \* 0\.1/],
    ["a linearised camera ease", /Math\.min\(1, dt \* (5\.5|4|3|2\.5)\)/],
    ["the explicit-Euler jolt", /this\.shake - this\.shake \* 3\.5 \* dt/],
  ];
  const present = gone.filter(([, re]) => re.test(src)).map(([n]) => n);
  const uses = ["stepFollow(", "seedFollow(", "filmTimeScale(", "filmExit(", "filmFov(", "lensFov(", "chaseRig(p.s"].filter((u) => !all.includes(u));
  // Asked of updateCineCamera's OWN body. The first version of this ran a
  // regex across the joined bodies, where updateCamera's call to
  // updateCineCamera is followed by updateCamera's own chaseRig call — so
  // it matched the live chase and could not fail.
  const settleUsesRig = body("updateCineCamera").includes("this.chaseRig(");
  const cutsLens = /setView\([^)]*\)[^{]*\{[\s\S]{0,700}?this\.lensPending = true/.test(src);
  console.log(`engine     stale literals left: ${present.length ? present.join(", ") : "none"}; laws not called: ${uses.length ? uses.join(" ") : "none"}`);
  console.log(`  ${check(!present.length, `engine.ts still carries ${present.join(", ")}`)}  the old camera numbers are gone`);
  console.log(`  ${check(!uses.length, `engine.ts does not call ${uses.join(" ")}`)}  and the engine drives the camera through these laws`);
  console.log(`  ${check(settleUsesRig, "the film's settle shot does not use the live chase rig")}  the film settles onto the SAME rig the chase uses`);
  console.log(`  ${check(cutsLens, "setView does not cut the lens")}  a view change cuts the lens with the position`);
}

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe camera moves the same at every frame rate, and cuts when it cuts");
process.exit(fail.length ? 1 : 0);
