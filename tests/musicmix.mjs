// Does the game ever ask the music to open?
//
//   npm run test:musicmix
//
// The audio suite already proves the SYNTH responds: it calls
// setIntensity(1), waits, and watches the filter climb 5,200 Hz to
// 8,400. That is a test of the instrument, not of the game, and the two
// answers turned out to be different. The synth was perfect and nothing
// in the game ever asked it for more than 0.45.
//
// The old ladder was speed 0.45 + closeness 0.30 + desperation 0.35,
// with the fight terms held at zero outside a battle:
//
//   free roam, flat out ............ 0.45   at most
//   battle, side by side, healthy .. 0.75
//   battle, side by side, losing ... 1.10 -> clamped to 1.00
//
// So free roam — most of a game about driving around Kuwait at night —
// could never open the mix past halfway, and the sum overran 1.0, so
// the last tenth of the ladder was dead and two different fights
// arrived at the same sound.
//
// The very top still belongs to a fight you are losing, and that is
// left alone on purpose: a desperate finish IS the most intense thing
// that happens. What changed is that desperation is a garnish at 0.15
// rather than a third of the entire range.
//
// This is a pure-node test because musicIntensity() is now a pure
// function. It runs in a second, and none of the three faults above
// needed a browser to see — they needed somebody to add the weights up.

import { musicIntensity, MUSIC_MIX } from "../src/game/music.ts";

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); return ok ? "ok" : "FAIL"; };
const r = (v) => +v.toFixed(3);

const parked = musicIntensity(0, null);
const cruising = musicIntensity(0.5, null);
const flatOut = musicIntensity(1, null);
const fightHealthy = musicIntensity(1, { closeness: 1, desperation: 0 });
const fightLosing = musicIntensity(1, { closeness: 1, desperation: 1 });
const fightFar = musicIntensity(1, { closeness: 0, desperation: 0 });

console.log("\n=== MUSIC INTENSITY LADDER ===");
console.log(`  weights            speed ${MUSIC_MIX.speed}  closeness ${MUSIC_MIX.closeness}  desperation ${MUSIC_MIX.desperation}`);
console.log(`  parked                        ${r(parked)}`);
console.log(`  cruising, half speed          ${r(cruising)}`);
console.log(`  free roam, flat out           ${r(flatOut)}`);
console.log(`  battle, alongside, healthy    ${r(fightHealthy)}`);
console.log(`  battle, alongside, losing     ${r(fightLosing)}`);

console.log("");
// 1. Silence belongs to a stopped car and nothing else.
console.log(`  parked is closed        ${check(parked === 0, `a parked car asks for ${r(parked)}`)}`);

// 2. THE ONE THAT WAS WRONG. Free roam is most of this game; if it
//    cannot open the mix, the mix does not open.
console.log(`  free roam opens it      ${check(flatOut >= 0.55,
  `flat out on an empty road asks for only ${r(flatOut)} — free roam is most of this game and it never opens the mix`)}`);

// 3. The top has to be reachable at all.
console.log(`  the top is reachable    ${check(fightLosing >= 0.999,
  `the loudest the game can get is ${r(fightLosing)} — the top of the range is unreachable`)}`);

// 4. No dead zone: the ladder must not overrun 1.0, or distinct states
//    collapse onto the same sound.
{
  const raw = MUSIC_MIX.speed + MUSIC_MIX.closeness + MUSIC_MIX.desperation;
  console.log(`  nothing is clamped away ${check(raw <= 1.0001,
    `the weights total ${r(raw)}, so everything above 1.0 collapses to one value and that much of the ladder is dead`)}`);
}

// 5. Every step has to be audible as a step: winning alongside somebody
//    must sound different from cruising past them, and from losing.
console.log(`  the fight adds to speed ${check(fightHealthy > flatOut + 0.05,
  `alongside a rival (${r(fightHealthy)}) sounds the same as an empty road (${r(flatOut)})`)}`);
console.log(`  losing adds again       ${check(fightLosing > fightHealthy + 0.05,
  `about to lose (${r(fightLosing)}) sounds the same as winning comfortably (${r(fightHealthy)})`)}`);
console.log(`  distance still counts   ${check(fightHealthy > fightFar + 0.05,
  `side by side (${r(fightHealthy)}) sounds the same as a rival 120 m away (${r(fightFar)})`)}`);

// 6. Monotonic in speed, so the music never goes DOWN as you go faster.
{
  let worst = null;
  for (let i = 1; i <= 20; i++) {
    const a = musicIntensity((i - 1) / 20, null);
    const b = musicIntensity(i / 20, null);
    if (b < a) worst = { at: i / 20, a: r(a), b: r(b) };
  }
  console.log(`  rises with speed        ${check(!worst,
    `intensity falls as the car speeds up, at ${worst?.at}: ${worst?.a} -> ${worst?.b}`)}`);
}

// 7. Rubbish in does not put rubbish on the mix bus.
{
  const bad = [musicIntensity(NaN, null), musicIntensity(-5, null), musicIntensity(99, null),
               musicIntensity(1, { closeness: NaN, desperation: 2 })];
  console.log(`  survives bad input      ${check(bad.every((v) => v >= 0 && v <= 1),
    `out of range: ${bad.map(r).join(", ")} — a NaN reaching an AudioParam silences the node for good`)}`);
}

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length > 1 ? "s" : ""}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe ladder runs from a parked car to the climax, and reaches both ends.");
