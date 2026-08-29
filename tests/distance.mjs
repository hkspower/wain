// Race distances, and the ladder that is built out of them.
//
//   npm run test:distance      (no browser, no dev server)
//
// WHAT A DISTANCE IS FOR
//
// An SP fight between two evenly matched cars has no end: they drain
// each other at the same rate and it runs until somebody makes a
// mistake, which on a straight empty corniche can be a very long time. A
// stated length guarantees a result without changing how the result is
// reached — whoever spent the night in front has more SP when the line
// arrives, and that is who takes it.
//
// So the properties worth holding are about the SET, not about any one
// number: every rival has to name a length that exists, the ladder has
// to climb, and the shortest race has to be long enough to be a race.

import { RACE_DISTANCES, DEFAULT_DISTANCE, distanceById, distanceMetres } from "../src/game/distances.ts";
import { RIVALS } from "../src/game/rivals.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

// --- 1. Every distance is a distance ---------------------------------
{
  const ids = new Set();
  let prev = 0;
  for (const d of RACE_DISTANCES) {
    if (ids.has(d.id)) fail.push(`two distances share the id "${d.id}"`);
    ids.add(d.id);
    check(d.km > prev, `the list is not in order: ${d.id} is ${d.km} km after ${prev}`);
    prev = d.km;
    check(d.name.trim().length > 0, `${d.id} has no name`);
    check(/[؀-ۿ]/.test(d.ar), `${d.id} has no Arabic name`);
    check(d.blurb.trim().length > 0, `${d.id} says nothing about what it asks of a car`);
  }
  // The shortest has to be long enough that the SP fight can happen at
  // all: a race over before anybody has drained anybody is a drag strip,
  // and this game is not one. At 200 km/h, 2 km is 36 seconds.
  check(RACE_DISTANCES[0].km >= 1, `the shortest race is ${RACE_DISTANCES[0].km} km`);
  // ...and the longest has to stay a race rather than a commute. The
  // tank is the real ceiling: run past it and the finish line is decided
  // by who stopped for petrol.
  check(RACE_DISTANCES.at(-1).km <= 30, `the longest race is ${RACE_DISTANCES.at(-1).km} km`);
  console.log(
    `${RACE_DISTANCES.length} distances: ${RACE_DISTANCES.map((d) => d.km + " km").join(", ")}`
  );
}

// --- 2. The default exists -------------------------------------------
{
  check(
    RACE_DISTANCES.some((d) => d.id === DEFAULT_DISTANCE),
    `the default distance "${DEFAULT_DISTANCE}" is not in the list`
  );
  // An unknown id must fall back rather than return nothing: a race with
  // no distance would end on its first frame, and a save from an older
  // build or a hand-edited one is exactly where an unknown id comes
  // from.
  check(distanceById("nonsense").id === DEFAULT_DISTANCE, "an unknown id did not fall back");
  check(distanceById(undefined).id === DEFAULT_DISTANCE, "an absent id did not fall back");
  check(distanceMetres("nonsense") > 0, "an unknown id produced a zero-length race");
  console.log(`default is ${distanceById(DEFAULT_DISTANCE).km} km, and junk falls back to it`);
}

// --- 3. Metres are metres --------------------------------------------
{
  for (const d of RACE_DISTANCES) {
    check(
      Math.abs(distanceMetres(d.id) - d.km * 1000) < 1e-9,
      `${d.id}: ${d.km} km came back as ${distanceMetres(d.id)} m`
    );
  }
  console.log("every distance converts to metres, which is what the engine counts in");
}

// --- 4. Every rival calls you out at a length that exists -------------
//
// A rival naming a distance the list does not have would silently open
// the challenge card on the default, and the roster's difficulty curve
// would quietly flatten with nothing to show for it.
{
  const ids = new Set(RACE_DISTANCES.map((d) => d.id));
  for (const r of RIVALS) {
    check(!!r.distance, `${r.id} names no distance`);
    check(ids.has(r.distance), `${r.id} calls you out at "${r.distance}", which does not exist`);
  }
  const km = RIVALS.map((r) => distanceById(r.distance).km);
  console.log(`rival ladder: ${km.join(" → ")} km`);

  // The ladder climbs. Not strictly — two sprinters in a row is a
  // roster, not a bug — but the last rival must ask for more than the
  // first, or the order on the card is not an order at all.
  check(km.at(-1) > km[0], `the roster ends at ${km.at(-1)} km and starts at ${km[0]}`);
  // ...and it must actually use more than one length, or the chooser is
  // decoration.
  check(new Set(km).size >= 3, `the whole roster uses only ${new Set(km).size} distinct distances`);
  // Nobody may be sent further than the longest race on offer.
  for (const r of RIVALS) {
    check(
      distanceById(r.distance).km <= RACE_DISTANCES.at(-1).km,
      `${r.id} wants ${distanceById(r.distance).km} km and the longest race is ${RACE_DISTANCES.at(-1).km}`
    );
  }
}

// --- 5. The engine ends a race on the distance ------------------------
//
// Read out of the source rather than simulated: driving a full race
// needs a browser and a track, and the property worth guarding is that
// the finish line EXISTS in the battle loop at all. It was added late,
// and a race whose only exit is an SP bar reaching zero is the bug this
// whole file is about.
{
  const { readFileSync } = await import("node:fs");
  const eng = readFileSync("src/game/engine.ts", "utf8");
  check(
    /this\.bstat\.dist >= this\.raceDistanceM/.test(eng),
    "engine.ts no longer ends a battle on distance — races can run forever again"
  );
  check(
    /raceDistanceM = distanceMetres/.test(eng),
    "the race length is no longer set from distances.ts"
  );
  console.log("the battle loop still has a finish line in it");
}

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nevery race has a length, every rival names one that exists, and the ladder climbs"
);
process.exit(fail.length ? 1 : 0);
