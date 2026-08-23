// The tow, as arithmetic.
//
//   npm run test:tow
//
// A slipstream model is easy to write and easy to get subtly wrong in
// ways that only show up as a race that feels broken: cars that tow each
// other out of a car park, a line of traffic that adds up to infinite
// speed, an indicator that flickers at a steady following distance. Each
// of those is a property, so each of them is a check.

import {
  solveTow,
  bestTow,
  TOW_REACH,
  TOW_MAX,
  NO_TOW,
} from "../src/game/slipstream.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

const FAST = 55; // m/s, about 200 km/h — where a tow is worth having

// --- 1. It is strongest on the bumper and gone at the reach ----------
{
  const close = solveTow({ gap: 1.5, lat: 0, speed: FAST });
  const mid = solveTow({ gap: 10, lat: 0, speed: FAST });
  const far = solveTow({ gap: TOW_REACH, lat: 0, speed: FAST });
  const past = solveTow({ gap: TOW_REACH + 0.1, lat: 0, speed: FAST });
  console.log(
    `along the wake   1.5 m: ${(close.strength * 100).toFixed(0)}%  ` +
    `10 m: ${(mid.strength * 100).toFixed(0)}%  ` +
    `${TOW_REACH} m: ${(far.strength * 100).toFixed(1)}%`
  );
  console.log(
    `                 drag x${close.drag.toFixed(3)} on the bumper, ` +
    `x${mid.drag.toFixed(3)} at 10 m`
  );
  check(close.strength > mid.strength && mid.strength > far.strength,
    "the tow does not decay with distance");
  check(close.drag < 1 - TOW_MAX * 0.7,
    `on the bumper the drag is only x${close.drag.toFixed(3)} — the tow barely does anything`);

  // No step at the edge. If strength jumped from a few percent straight
  // to zero, the HUD's tow indicator would blink on and off at a steady
  // following distance and read as a bug in the game rather than a
  // property of the air.
  console.log(
    `edge             ${far.strength.toExponential(1)} at the reach, ` +
    `${past.strength} just past it`
  );
  check(far.strength < 1e-9, `there is a ${(far.strength * 100).toFixed(2)}% step at the edge of the reach`);
  check(past.strength === 0, "past the reach the tow is not zero");
}

// --- 2. Pulling out breaks it ----------------------------------------
//
// This is the whole reason a driver can choose to leave the wake, and
// the reason a car two lanes over gets nothing.
{
  const behind = solveTow({ gap: 4, lat: 0, speed: FAST });
  const edge = solveTow({ gap: 4, lat: 1.2, speed: FAST });
  const beside = solveTow({ gap: 4, lat: 2.0, speed: FAST });
  console.log(
    `\nacross the wake  centred: ${(behind.strength * 100).toFixed(0)}%  ` +
    `1.2 m off: ${(edge.strength * 100).toFixed(0)}%  ` +
    `2.0 m off: ${(beside.strength * 100).toFixed(0)}%`
  );
  check(edge.strength < behind.strength, "moving off line does not weaken the tow");
  check(beside.strength === 0, "a car a full lane over still gets a tow");
  // Symmetric: which side you pull out to cannot matter.
  check(
    solveTow({ gap: 4, lat: -1.2, speed: FAST }).strength === edge.strength,
    "the wake is not symmetric about the car making it"
  );
}

// --- 3. A wider car throws a wider wake ------------------------------
{
  const car = solveTow({ gap: 4, lat: 1.0, speed: FAST, halfWidth: 0.9 });
  const bus = solveTow({ gap: 4, lat: 1.0, speed: FAST, halfWidth: 1.3 });
  console.log(
    `width            behind a car ${(car.strength * 100).toFixed(0)}%, ` +
    `behind a bus ${(bus.strength * 100).toFixed(0)}% at the same 1.0 m offset`
  );
  check(bus.strength > car.strength, "a wider car does not throw a wider wake");
}

// --- 4. Nobody tows anybody out of a car park -------------------------
{
  const crawl = solveTow({ gap: 2, lat: 0, speed: 4 });
  const town = solveTow({ gap: 2, lat: 0, speed: 16 });
  const fast = solveTow({ gap: 2, lat: 0, speed: FAST });
  console.log(
    `\nwith speed       4 m/s: ${(crawl.strength * 100).toFixed(0)}%  ` +
    `16 m/s: ${(town.strength * 100).toFixed(0)}%  ` +
    `${FAST} m/s: ${(fast.strength * 100).toFixed(0)}%`
  );
  check(crawl.strength === 0, "cars tow each other at walking pace");
  check(town.strength > 0 && town.strength < fast.strength,
    "the tow does not build with speed");
}

// --- 5. Not behind anything is not a tow ------------------------------
{
  for (const gap of [0, -1, -30]) {
    const t = solveTow({ gap, lat: 0, speed: FAST });
    check(t.strength === 0 && t.drag === 1,
      `a gap of ${gap} m — alongside or past — still produced a tow`);
  }
  check(NO_TOW.drag === 1 && NO_TOW.frontGrip === 1, "NO_TOW is not neutral");
}

// --- 6. Wakes do not add up ------------------------------------------
//
// The bug a naive implementation ships with: three cars in a line, three
// drag reductions multiplied together, and a car that reaches a speed no
// engine in the game can produce.
{
  const line = [
    { gap: 3, lat: 0, speed: FAST },
    { gap: 9, lat: 0, speed: FAST },
    { gap: 15, lat: 0, speed: FAST },
  ];
  const best = bestTow(line);
  const alone = solveTow(line[0]);
  console.log(
    `\nthree in a line  best ${(best.strength * 100).toFixed(0)}%, ` +
    `nearest alone ${(alone.strength * 100).toFixed(0)}% — drag x${best.drag.toFixed(3)}`
  );
  check(Math.abs(best.strength - alone.strength) < 1e-12,
    "a queue of cars gives more tow than the nearest one alone");
  check(bestTow([]).strength === 0, "an empty field produced a tow");
  // Order must not matter.
  check(
    Math.abs(bestTow([...line].reverse()).strength - best.strength) < 1e-12,
    "the answer depends on the order the cars are listed in"
  );
}

// --- 7. The tow costs something --------------------------------------
//
// Free speed would be a button everybody holds forever. The front axle
// has to go light, or there is no decision in it.
{
  const deep = solveTow({ gap: 1.5, lat: 0, speed: FAST });
  console.log(
    `\ndirty air        front grip x${deep.frontGrip.toFixed(3)} at ` +
    `${(deep.strength * 100).toFixed(0)}% tow`
  );
  check(deep.frontGrip < 1, "sitting in the wake costs nothing at the front");
  check(deep.frontGrip > 0.9,
    `front grip falls to x${deep.frontGrip.toFixed(3)} — that is a punishment, not a trade`);
  check(solveTow({ gap: 40, lat: 0, speed: FAST }).frontGrip === 1,
    "clean air is not clean");
}

// --- 8. Monotone, everywhere -----------------------------------------
//
// Swept rather than spot-checked: anywhere the strength rises with gap,
// the driver is rewarded for backing off, and the mechanic inverts.
{
  let worst = 0;
  let prev = solveTow({ gap: 0.05, lat: 0, speed: FAST }).strength;
  for (let gap = 0.1; gap <= TOW_REACH + 2; gap += 0.05) {
    const s = solveTow({ gap, lat: 0, speed: FAST }).strength;
    worst = Math.max(worst, s - prev);
    prev = s;
  }
  console.log(`monotone         largest rise with distance: ${worst.toExponential(1)}`);
  check(worst <= 1e-12, `strength rises by ${worst.toExponential(2)} somewhere as the gap grows`);
}

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nthe wake is real, it is worth having, and it costs something"
);
process.exit(fail.length ? 1 : 0);
