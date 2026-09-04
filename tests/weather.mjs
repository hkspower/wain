// Rain, and what a wet road does to a car.
//
//   npm run test:weather      (no browser, no dev server)
//
// The interesting claim in weather.ts is not that rain exists, it is that
// WETNESS IS A STATE: the road takes time to change and much longer to
// change back, so the grip a driver has is a function of how long it has
// been raining rather than of whether it is raining now. A boolean flag
// would hand them a step change at the instant the sky changed, which no
// road does.
//
// These drive the solver frame by frame at 60 Hz, the way the engine
// does, and read the numbers off it.

import { HANDLING as H } from "../src/game/handling.ts";
import { newWeatherState, solveWeather, wetGripMult } from "../src/game/weather.ts";
import { readFileSync } from "node:fs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };
const F = (n, d = 2) => Number(n).toFixed(d);
const DT = 1 / 60;

/** Run the model for `secs`, returning the last result. */
function run(state, secs, input) {
  let out = null;
  for (let t = 0; t < secs; t += DT) out = solveWeather(state, { dt: DT, ...input });
  return out;
}
/** Seconds until `pred` holds, or null. */
function timeUntil(state, input, pred, cap = 3600) {
  for (let t = 0; t < cap; t += DT) {
    const r = solveWeather(state, { dt: DT, ...input });
    if (pred(r)) return t;
  }
  return null;
}

// --- 1. A dry night stays dry ----------------------------------------
{
  const s = newWeatherState();
  const r = run(s, 600, { raining: false });
  check(r.wetness === 0, `ten dry minutes left the road at ${r.wetness}`);
  check(r.gripMult === 1, "a dry road must not change grip");
  check(r.fall === 0, "no rain must fall when it is not raining");
  console.log("ten minutes of dry: wetness 0, grip unchanged, nothing falling");
}

// --- 2. Rain wets the road, and it takes time -------------------------
// The step-change failure this model exists to avoid: if wetness reached
// its target in one frame, the driver would lose a third of their grip
// between two frames.
{
  const s = newWeatherState();
  const first = solveWeather(s, { dt: DT, raining: true });
  check(first.wetness < 0.02,
    `one frame of rain soaked the road to ${F(first.wetness, 3)} — that is a step change in grip`);
  const halfway = timeUntil(newWeatherState(), { raining: true }, (r) => r.wetness >= 0.35);
  const soaked = timeUntil(newWeatherState(), { raining: true }, (r) => r.wetness >= 0.69);
  // Minutes, not seconds. A road that soaks in eight seconds is a step
  // change in grip wearing a state's clothes.
  check(halfway > 10 && halfway < 120, `half wet took ${F(halfway, 1)} s`);
  check(soaked > halfway, "soaked must take longer than half wet");
  console.log(`rain: half wet in ${F(halfway, 1)} s, soaked in ${F(soaked, 1)} s`);
}

// --- 3. ...and the road stays wet long after it stops ------------------
// The asymmetry is the whole point. If drying were as fast as soaking,
// the road would be dry before the driver had finished the corner they
// were worried about.
{
  const s = newWeatherState();
  run(s, 300, { raining: true });
  const wetAtStop = s.wetness;
  const dryish = timeUntil(s, { raining: false }, (r) => r.wetness < 0.05);
  check(dryish !== null, "the road must eventually dry");
  // A quarter of an hour, which is the claim the constant makes. Not a
  // corner: a road that dries inside one is a road the driver never has
  // to think about after the rain stops.
  check(dryish > 600, `the road dried in ${F(dryish, 0)} s — far too quick to matter`);
  check(H.wetDryRate < H.wetSoakRate / 5,
    "drying must be far slower than soaking, or wetness is just a flag with extra steps");
  console.log(`stopped raining at wetness ${F(wetAtStop, 2)}: still damp for ${F(dryish, 0)} s (${F(dryish / 60, 1)} min)`);
}

// --- 4. Drizzle cannot flood a road -----------------------------------
// A spell's intensity is the wetness it approaches, not a rate that gets
// there eventually. Light rain leaves a damp road for as long as it
// falls, and never a soaked one.
{
  const light = newWeatherState();
  const r = run(light, 1800, { raining: true, intensity: 0.25 });
  check(Math.abs(r.wetness - 0.25) < 0.01,
    `half an hour of drizzle reached ${F(r.wetness, 3)}, not its 0.25 ceiling`);
  const heavy = run(newWeatherState(), 1800, { raining: true, intensity: 1 });
  check(heavy.wetness > 0.98, `a downpour must reach standing water, got ${F(heavy.wetness, 3)}`);
  console.log(`drizzle settles at ${F(r.wetness, 2)}; a downpour reaches ${F(heavy.wetness, 2)}`);
}

// --- 5. Wet costs grip, and only grip ---------------------------------
{
  check(wetGripMult(0) === 1, "a dry road must be exactly 1");
  check(Math.abs(wetGripMult(1) - (1 - H.wetGripLoss)) < 1e-12, "a soaked road must be the published loss");
  check(wetGripMult(1) > 0.5, "a wet road must not halve the car — it is water, not ice");
  let prev = 2, mono = true;
  for (let w = 0; w <= 1; w += 0.01) {
    const g = wetGripMult(w);
    if (g > prev + 1e-12) mono = false;
    prev = g;
  }
  check(mono, "grip must fall monotonically with wetness");
  // Out-of-range wetness must not manufacture grip.
  check(wetGripMult(-1) === 1 && wetGripMult(5) === wetGripMult(1),
    "wetness outside 0..1 must clamp rather than invert the multiplier");
  const dry = 12, wet = 12 * wetGripMult(1);
  console.log(`grip ${dry} -> ${F(wet, 2)} m/s² soaked (${F(100 * H.wetGripLoss, 0)}% lost), monotonic and clamped`);
}

// --- 6. What that means for a corner and a stop -----------------------
// Both fall out of the one multiplier, which is the reason it is applied
// to grip rather than to the systems that read grip.
{
  const g = 12, mult = wetGripMult(1);
  // v = sqrt(a r) for a steady radius — the Ras Al-Ard bend is 169 m.
  const R = 169.3;
  const vDry = Math.sqrt(g * R), vWet = Math.sqrt(g * mult * R);
  // d = v^2 / 2a from 130 km/h.
  const v0 = 130 / 3.6;
  const dDry = (v0 * v0) / (2 * g), dWet = (v0 * v0) / (2 * g * mult);
  check(vWet < vDry, "a wet corner must be slower");
  check(dWet > dDry, "a wet stop must be longer");
  check(dWet / dDry > 1.4, `wet stopping distance only grew ${F(dWet / dDry, 2)}x`);
  console.log(
    `Ras Al-Ard at ${F(R, 0)} m: ${F(vDry * 3.6, 0)} -> ${F(vWet * 3.6, 0)} km/h; ` +
    `130-0 in ${F(dDry, 1)} -> ${F(dWet, 1)} m (${F(dWet / dDry, 2)}x)`
  );
}

// --- 7. Shelter -------------------------------------------------------
// Under the underpass no rain reaches the road, so it neither soaks nor
// dries — and the screen clears, which the driver can see.
{
  const s = newWeatherState();
  run(s, 300, { raining: true });
  const before = s.wetness;
  const r = run(s, 4, { raining: true, sheltered: true });
  check(Math.abs(s.wetness - before) < 1e-9,
    `shelter changed the wetness by ${F(s.wetness - before, 6)} — under a deck it should do neither`);
  check(r.fall === 0, "no rain falls under a roof");
  check(r.gripMult < 1, "the road under the deck is still as wet as it was");
  console.log(`sheltered: wetness held at ${F(before, 2)}, nothing falling, grip still ${F(r.gripMult, 2)}`);
}

// --- 8. The rain fades in rather than switching on ---------------------
{
  const s = newWeatherState();
  const first = solveWeather(s, { dt: DT, raining: true });
  check(first.changed, "the frame the sky changes must say so, once");
  check(first.fall < 0.05, `rain appeared at ${F(first.fall, 3)} on its first frame — a wall of water`);
  const later = run(s, H.rainFadeS + 1, { raining: true });
  check(later.fall > 0.6, `rain never reached full: ${F(later.fall, 2)}`);
  const second = solveWeather(s, { dt: DT, raining: true });
  check(!second.changed, "the sky must only change once per change");
  console.log(`rain fades in over ${H.rainFadeS} s: ${F(first.fall, 3)} -> ${F(later.fall, 2)}`);
}

// --- 9. A player can actually make it rain ----------------------------
// The model can be as good as it likes; if nothing sets `raining` the
// feature does not exist. This checks the whole path from the setting a
// player picks to the number the solver runs on.
{
  const settings = readFileSync("src/game/settings.ts", "utf8");
  const engine = readFileSync("src/game/engine.ts", "utf8");
  const client = readFileSync("src/app/race/RaceClient.tsx", "utf8");

  check(/weather: "clear" \| "shower" \| "downpour"/.test(settings),
    "the weather must be a setting, not an internal field");
  check(/weather: "clear",/.test(settings), "a player who has not been asked gets a dry road");
  check(/setWeather\(mode:/.test(engine),
    "the names a player picks and the numbers the model runs on need one translation, in one place");
  check(/k === "weather"/.test(client), "changing the setting must reach the engine");
  check(/boot\.weather !== "clear"/.test(client), "and it must survive a reload");
  check(/updateSetting\("weather", mode\)/.test(client), "there must be something to click");

  // The three modes must be genuinely different roads, not three labels.
  const shower = run(newWeatherState(), 1800, { raining: true, intensity: H.rainDefaultIntensity });
  const downpour = run(newWeatherState(), 1800, { raining: true, intensity: 1 });
  check(downpour.wetness > shower.wetness + 0.2,
    `a downpour must be a wetter road than a shower (${F(shower.wetness, 2)} vs ${F(downpour.wetness, 2)})`);
  check(shower.gripMult < 0.85, "a shower must cost real grip, or it is weather-as-decoration");
  console.log(
    `settings: clear / shower (${F(shower.wetness, 2)} wet, grip x${F(shower.gripMult, 2)}) / ` +
    `downpour (${F(downpour.wetness, 2)} wet, grip x${F(downpour.gripMult, 2)})`
  );
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
