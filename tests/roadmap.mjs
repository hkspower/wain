// The road map, as arithmetic.
//
//   npm run test:roadmap      (no browser, no dev server)
//
// A map is a projection, and a projection is the kind of thing that can
// look perfectly convincing on screen while being wrong in a way nobody
// can name. The old minimap was: it normalised x and z independently, so
// the lap's shape was a function of the shape of the box it was drawn
// in. It looked like a road. It was not the shape of THIS road.
//
// So what is asserted here is not "it draws something" but the promises
// a map makes to whoever reads it:
//
//   SHAPE      A metre is the same length in both directions, so the
//              road's proportions on the map are the road's proportions.
//   FIT        All of it is inside the box, with the margin it claims.
//   PLACES     Every district, both roads, both petrol stations and the
//              drift circle are on it, at the distances the world uses.
//   ROUTING    The next pump is the next pump, from anywhere, including
//              from the far side of the lap.

import { Track } from "../src/game/track.ts";
import { buildRoadMap, nextStation, legAt } from "../src/game/roadmap.ts";
import { AREAS, ROADS } from "../src/game/world.ts";
import { STATIONS, DRIFT_PLAZA, COAST_END_M } from "../src/game/track.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const track = new Track();
const map = buildRoadMap(track);
const L = map.lapLength;

console.log(
  `lap          ${L.toFixed(0)} m drawn with ${map.path.length} points, ` +
  `${map.legs.length} roads, ${map.markers.length} marks`
);

// --- 1. A metre is a metre, whichever way you go -----------------------
//
// The one thing the old projection got wrong, so it is measured directly
// rather than inferred from the scale factor: consecutive samples are
// equally far apart along the ROAD, so grouping the steps they make on
// the map by direction and comparing the groups isolates a stretched
// axis — an aspect error makes east-west steps a different length from
// north-south ones, and nothing else does.
{
  const pairs = [];
  for (let i = 0; i < map.path.length - 1; i++) {
    const a = map.path[i], b = map.path[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const onMap = Math.hypot(dx, dy);
    if (onMap < 1e-9) continue;
    pairs.push({ onMap, angle: Math.atan2(dy, dx) });
  }
  const eastWest = pairs.filter((p) => Math.abs(Math.cos(p.angle)) > 0.94);
  const northSouth = pairs.filter((p) => Math.abs(Math.sin(p.angle)) > 0.94);
  const mean = (xs) => xs.reduce((a, b) => a + b.onMap, 0) / Math.max(1, xs.length);
  const ew = mean(eastWest), ns = mean(northSouth);
  const skew = Math.abs(ew - ns) / Math.max(ew, ns);
  console.log(
    `\nscale        ${eastWest.length} east-west steps average ${(ew * 1e3).toFixed(3)}, ` +
    `${northSouth.length} north-south ${(ns * 1e3).toFixed(3)} (x1000)`
  );
  check(eastWest.length > 20 && northSouth.length > 20,
    "not enough steps in each direction to compare — the sample is too coarse to judge");
  // A few percent is the chord effect: a straight run and a bend do not
  // sample identically. A stretched axis shows up as tens of percent —
  // this lap is 2.0 by 3.5 km, so the old projection skewed it by 43%.
  check(skew < 0.08,
    `a step east is ${(skew * 100).toFixed(1)}% a different length from a step north — the map is stretched`);
  console.log(`             skew ${(skew * 100).toFixed(2)}%`);
}

// --- 2. All of it is in the box ---------------------------------------
{
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of [...map.path, ...map.markers]) {
    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
  }
  console.log(
    `\nfit          x ${minX.toFixed(3)}..${maxX.toFixed(3)}, y ${minY.toFixed(3)}..${maxY.toFixed(3)}`
  );
  check(minX >= 0 && maxX <= 1 && minY >= 0 && maxY <= 1,
    `something is drawn outside the box: x ${minX.toFixed(3)}..${maxX.toFixed(3)}, y ${minY.toFixed(3)}..${maxY.toFixed(3)}`);
  // ...and it fills it. A map that fits by being tiny fits trivially.
  const filled = Math.max(maxX - minX, maxY - minY);
  check(filled > 0.8, `the road only fills ${(filled * 100).toFixed(0)}% of the box`);
  // Centred on the loose axis, or the road sits against one wall with
  // all the empty space on the other side.
  const offCentreX = Math.abs((minX + maxX) / 2 - 0.5);
  const offCentreY = Math.abs((minY + maxY) / 2 - 0.5);
  check(offCentreX < 0.02 && offCentreY < 0.02,
    `the road is off centre by ${offCentreX.toFixed(3)}, ${offCentreY.toFixed(3)}`);
}

// --- 3. It is a closed loop -------------------------------------------
{
  const a = map.path[0], b = map.path[map.path.length - 1];
  const gap = Math.hypot(b.x - a.x, b.y - a.y) / map.unitsPerMetre;
  console.log(`\nclosure      start and finish are ${gap.toFixed(2)} m apart on the map`);
  check(gap < 1, `the lap does not close: ${gap.toFixed(1)} m between the first and last point`);
}

// --- 4. Everything the world has a name for is on it -------------------
{
  const byKind = {};
  for (const m of map.markers) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
  console.log(
    `\nmarks        ` +
    Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")
  );
  check(byKind.district === AREAS.length,
    `${byKind.district ?? 0} districts on the map against ${AREAS.length} in the world`);
  check(byKind.station === STATIONS.length,
    `${byKind.station ?? 0} petrol stations on the map against ${STATIONS.length} in the world`);
  check(byKind.plaza === 1, "the drift circle is not on the map");
  check(byKind.start === 1, "the start line is not on the map");
  // Landmarks are registered by buildWorld, which needs a browser, so
  // node sees none — and the map must not invent any.
  check(!byKind.landmark, "landmarks appeared without a world having been built");

  // Every marker is where the world says it is, not near it.
  let worstOff = 0;
  for (const m of map.markers) {
    const want = map.at(m.s);
    worstOff = Math.max(worstOff, Math.hypot(want.x - m.x, want.y - m.y));
  }
  check(worstOff < 1e-9, `a marker is ${worstOff} off its own distance`);

  // The districts must come round in lap order. A map that lists them
  // correctly but places them out of sequence is worse than no map.
  const districts = map.markers.filter((m) => m.kind === "district");
  const names = districts.map((d) => d.name);
  check(
    names.join("|") === AREAS.map((a) => a.name).join("|"),
    `districts are in the wrong order:\n  ${names.join(", ")}`
  );
  for (let i = 1; i < districts.length; i++) {
    check(districts[i].s > districts[i - 1].s,
      `${districts[i].name} is placed before ${districts[i - 1].name}`);
  }
}

// --- 5. Two roads, and the split is where the signs change ------------
{
  console.log(
    `\nroads        ` +
    map.legs.map((l) => `${l.name} (${l.to - l.from} pts)`).join(", ")
  );
  check(map.legs.length === ROADS.length,
    `${map.legs.length} roads drawn against ${ROADS.length} named`);
  check(map.legs[0].name === ROADS[0].name, "the first leg is not the coastal road");
  // The legs must tile the whole lap with no gap and no overlap, or a
  // stretch of road is drawn twice or not at all.
  check(map.legs[0].from === 0, "the first leg does not start at the start line");
  for (let i = 1; i < map.legs.length; i++) {
    check(map.legs[i].from === map.legs[i - 1].to,
      `there is a gap or an overlap between ${map.legs[i - 1].name} and ${map.legs[i].name}`);
  }
  check(map.legs[map.legs.length - 1].to === map.path.length - 1,
    "the last leg does not reach the start line again");
  // ...and the boundary is the one the signs use.
  const splitS = map.pathS[map.legs[0].to];
  console.log(`             they change over at ${splitS.toFixed(0)} m (COAST_END_M is ${COAST_END_M})`);
  check(Math.abs(splitS - COAST_END_M) < L / 480 + 1,
    `the roads change over at ${splitS.toFixed(0)} m rather than ${COAST_END_M}`);
  check(legAt(0).name === ROADS[0].name && legAt(L - 1).name === ROADS[1].name,
    "legAt disagrees with the legs the map drew");
}

// --- 6. The next pump is the next pump --------------------------------
//
// The one piece of routing this game needs: the tank has a fail state,
// and "which way is the nearest pump" gets asked with a litre left.
{
  console.log("");
  let worst = 0;
  for (let s = 0; s < L; s += 37) {
    const n = nextStation(L, s);
    // It must be ahead, never behind.
    check(n.metres >= 0 && n.metres <= L, `from ${s.toFixed(0)} m the next pump is ${n.metres.toFixed(0)} m away`);
    // ...and no station may be closer ahead than the one it named.
    for (const st of STATIONS) {
      let d = st.s - s;
      while (d < 0) d += L;
      if (d < n.metres - 1e-9) {
        fail.push(`from ${s.toFixed(0)} m it named a pump ${n.metres.toFixed(0)} m ahead, but one is ${d.toFixed(0)} m ahead`);
      }
    }
    worst = Math.max(worst, n.metres);
  }
  console.log(`pumps        the furthest you are ever from one is ${worst.toFixed(0)} m`);
  check(worst < L, "somewhere on the lap there is no pump ahead at all");
  // Standing on one is zero away, not a lap away.
  check(nextStation(L, STATIONS[0].s).metres === 0,
    "standing on a forecourt, the next pump is reported a lap away");
}

// --- 7. The drift circle is on the coast ------------------------------
{
  const plaza = map.markers.find((m) => m.kind === "plaza");
  check(plaza.s === DRIFT_PLAZA.s, `the drift circle is marked at ${plaza.s} rather than ${DRIFT_PLAZA.s}`);
  check(plaza.s < COAST_END_M, "the drift circle has ended up on the ring road");
}

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nthe map is the shape of the road, and everything with a name is on it"
);
process.exit(fail.length ? 1 : 0);
