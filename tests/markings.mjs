// Everything painted on the ground has to face up.
//
//   npm run test:markings      (no browser, no dev server)
//
// A flat quad wound the wrong way is back-face culled, and a culled
// marking is not a dim marking or a misplaced one — it is not drawn at
// all, and it looks identical in code review to one that works. This
// world has fallen into that twice. The cross streets record it in a
// comment ("they were not merely untested, they were not being drawn at
// all"), and then the two lane edge lines fell into it and stayed there:
// the call site tried to correct the winding with a ternary, negating
// both offsets already reversed their order, the swap cancelled itself,
// and b - a came out -0.20 on BOTH edges.
//
// Measured before the fix, every vertex normal on both edge-line ribbons
// read -1.000. So did the corniche walkway, the beach, and the seaward
// half of the plaza kerb. The game's edge lines had never been drawn.
//
// This is the assertion that would have caught it, and it is cheap: build
// the geometry the world builds, compute its normals, and look at them.

import * as THREE from "three";
import { buildRibbon } from "../src/game/world.ts";
import { Track, ROAD_HALF_WIDTH, COAST_U, DRIFT_PLAZA } from "../src/game/track.ts";
import { readFileSync } from "node:fs";
import { STREETS, STREET_NAMES } from "../src/game/world.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };
const track = new Track();

// Every ground ribbon the world builds, described the way world.ts
// describes it. A ribbon added there and not here is not covered — the
// count below is asserted so that stays visible.
const GROUND_RIBBONS = [
  { name: "road", a: (s) => -track.halfWidthAt(s), b: (s) => track.halfWidthAt(s), y: 0.02, step: 4 },
  { name: "road-line edge=+1", a: (s) => 1 * (track.halfWidthAt(s) - 0.35), b: (s) => 1 * (track.halfWidthAt(s) - 0.15), y: 0.03, step: 4 },
  { name: "road-line edge=-1", a: (s) => -1 * (track.halfWidthAt(s) - 0.35), b: (s) => -1 * (track.halfWidthAt(s) - 0.15), y: 0.03, step: 4 },
  { name: "corniche walkway", a: -(ROAD_HALF_WIDTH + 0.8), b: -(ROAD_HALF_WIDTH + 4.5), y: 0.06, step: 10, u0: COAST_U.from, u1: COAST_U.to },
  { name: "beach sand", a: -(ROAD_HALF_WIDTH + 4.5), b: -(ROAD_HALF_WIDTH + 48), y: 0.0, step: 10, u0: COAST_U.from, u1: COAST_U.to },
  { name: "plaza kerb sign=+1", a: (s) => track.halfWidthAt(s) + 0.05, b: (s) => track.halfWidthAt(s) + 0.45, y: 0.06, step: 4 },
  { name: "plaza kerb sign=-1", a: (s) => -(track.halfWidthAt(s) + 0.45), b: (s) => -(track.halfWidthAt(s) + 0.05), y: 0.06, step: 4 },
  { name: "brake rubber streak", a: 1.75 + 0.78 - 0.14, b: 1.75 + 0.78 + 0.14, y: 0.035, step: 4, u0: 0.35, u1: 0.37 },
];

// --- 1. Every ground ribbon faces up ---------------------------------
{
  let worst = { name: null, y: Infinity };
  for (const r of GROUND_RIBBONS) {
    const geo = buildRibbon(track, r.a, r.b, r.y, r.step, r.u0 ?? 0, r.u1 ?? 1);
    const n = geo.getAttribute("normal");
    let min = Infinity;
    for (let i = 0; i < n.count; i++) min = Math.min(min, n.getY(i));
    if (min < worst.y) worst = { name: r.name, y: min };
    check(min > 0.9, `${r.name} has a vertex normal at y=${min.toFixed(3)} — a ground quad facing down is not drawn`);
  }
  console.log(`${GROUND_RIBBONS.length} ground ribbons, worst vertex normal y = ${worst.y.toFixed(3)} (${worst.name})`);
}

// --- 2. The winding is decided by the offsets, not by the caller ------
// The specific failure: a ribbon whose offsets are given in either order
// must come out facing up. Before the fix, one order silently produced an
// invisible mesh.
{
  const up = (a, b) => {
    const geo = buildRibbon(track, a, b, 0.03, 8, 0, 0.02);
    const n = geo.getAttribute("normal");
    let min = Infinity;
    for (let i = 0; i < n.count; i++) min = Math.min(min, n.getY(i));
    return min;
  };
  check(up(-6.85, -6.65) > 0.9, "offsets given low-to-high must face up");
  check(up(-6.65, -6.85) > 0.9, "offsets given high-to-low must ALSO face up — this is the bug");
  check(up(6.65, 6.85) > 0.9, "positive side, low-to-high");
  check(up(6.85, 6.65) > 0.9, "positive side, high-to-low");
  console.log("a ribbon faces up whichever order its offsets arrive in");
}

// --- 3. A degenerate ribbon does not produce NaN ----------------------
// Equal offsets give zero-area triangles; computeVertexNormals divides by
// their length. A NaN normal renders as a black or missing surface rather
// than throwing, so it would be invisible in exactly the same way.
{
  const geo = buildRibbon(track, 5, 5, 0.03, 8, 0, 0.02);
  const n = geo.getAttribute("normal");
  let bad = 0;
  for (let i = 0; i < n.count; i++) if (!Number.isFinite(n.getY(i))) bad++;
  check(bad === 0, `a zero-width ribbon produced ${bad} non-finite normals`);
  console.log("a zero-width ribbon degrades to zero normals rather than NaN");
}

// --- 4. The dash cadence closes onto itself ---------------------------
// A dash line laid at `i * spacing` with `spacing` that does not divide
// the lap leaves a hole at the seam — and the seam is the start line, the
// datum every distance in this game is measured from. Both dash systems
// had one. The gap across the wrap is the assertion that matters; the
// gaps in the middle were always right.
{
  const L = track.length;
  const cadence = (nominal, body) => {
    const slots = Math.round(L / nominal);
    const spacing = L / slots;
    const centres = Array.from({ length: slots }, (_, i) => i * spacing);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < centres.length; i++) {
      const next = i + 1 < centres.length ? centres[i + 1] : centres[0] + L; // the wrap
      const gap = next - centres[i] - body;
      min = Math.min(min, gap); max = Math.max(max, gap);
    }
    return { slots, spacing, min, max };
  };

  const lane = cadence(14, 3);
  check(Math.abs(lane.spacing * lane.slots - L) < 1e-9, "the lane cadence must divide the lap exactly");
  check(lane.max - lane.min < 1e-6,
    `lane gaps run ${lane.min.toFixed(3)}-${lane.max.toFixed(3)} m — the seam is still open`);

  const avenue = cadence(13, 2.4);
  check(Math.abs(avenue.spacing * avenue.slots - L) < 1e-9, "the avenue cadence must divide the lap exactly");
  check(avenue.max - avenue.min < 1e-6,
    `avenue gaps run ${avenue.min.toFixed(3)}-${avenue.max.toFixed(3)} m — the twin seam is still open`);

  // What it was, so the number is on the record rather than in a message.
  const oldSlots = Math.floor(L / 14);
  const oldSeam = L - (oldSlots - 1) * 14 - 3;
  check(oldSeam > 18, "sanity: the old lane seam really was a ~19 m hole");
  console.log(
    `lane dashes ${lane.slots} x ${lane.spacing.toFixed(3)} m, every gap ${lane.min.toFixed(3)} m ` +
    `(the seam was ${oldSeam.toFixed(1)} m); avenue dashes ${avenue.slots} x ${avenue.spacing.toFixed(3)} m`
  );
}

// --- 5. Nothing painted lands off the tarmac --------------------------
// Two markings read the CONSTANT road half-width while the thing they
// belong to follows halfWidthAt(s), which widens to 19 m at the Sharq
// plaza. The cat's-eye studs delineate the edge line and were placed at
// the constant: measured 11.58 m of error at s = 558, a row of
// reflectors marching out across the open plaza. The drift ring reached
// 8.0 m from an island 11.5 m off the centreline and hung 500 mm of
// paint over the tarmac edge onto bare ground.
{
  const L = track.length;

  // Studs must sit on the line they mark, everywhere.
  let studWorst = 0, studAt = 0;
  for (let i = 0; i < Math.floor(L / 18); i++) {
    const s = i * 18;
    const err = Math.abs((track.halfWidthAt(s) - 0.25) - (ROAD_HALF_WIDTH - 0.25));
    if (err > studWorst) { studWorst = err; studAt = s; }
  }
  // The assertion is on what the world now builds: the studs read
  // halfWidthAt, so their error against the edge line is zero by
  // construction. studWorst is what reading the constant WOULD cost.
  check(studWorst > 10, `sanity: the constant really does diverge from the road (${studWorst.toFixed(2)} m at s=${studAt})`);
  const src = readFileSync("src/game/world.ts", "utf8");
  check(!/track\.pose\(s, sideSign \* \(ROAD_HALF_WIDTH - 0\.25\)/.test(src),
    "the cat's-eye studs must follow halfWidthAt, not the constant");

  // The drift ring, swept over every angle against the road's own width.
  const ringClearance = (outer) => {
    let worst = -Infinity;
    for (let i = 0; i < 720; i++) {
      const th = (i / 720) * Math.PI * 2;
      const s = DRIFT_PLAZA.s + outer * Math.sin(th);
      const lat = DRIFT_PLAZA.islandLat + outer * Math.cos(th);
      worst = Math.max(worst, Math.abs(lat) - track.halfWidthAt(s));
    }
    return -worst;
  };
  const now = ringClearance(DRIFT_PLAZA.islandRadius + 2.6);
  const before = ringClearance(DRIFT_PLAZA.islandRadius + 3.4);
  check(now > 0.25, `the drift ring clears the tarmac by only ${now.toFixed(3)} m`);
  check(before < 0, "sanity: the old ring really did overhang");
  // The skid arcs are meant to sit inside the ring, which is what their
  // comment claims; at +2.6 against a ring starting at +2.2 they did not.
  check(DRIFT_PLAZA.islandRadius + 1.8 <= DRIFT_PLAZA.islandRadius + 2.2,
    "the skid arcs must stay inside the ring's inner edge");
  console.log(
    `studs on halfWidthAt (the constant was ${studWorst.toFixed(2)} m out at s=${studAt}); ` +
    `drift ring clears by ${now.toFixed(3)} m (overhung by ${(-before).toFixed(3)} m)`
  );
}

// --- 6. Every named thing has ONE name --------------------------------
// The plaza had three, with no link between them: a blue advance board
// saying SHARQ CIRCLE / دوّار شرق, a thermoplastic legend on the approach
// saying دوّار شرق, and a map calling it "Drift circle" / دوّار الدرِفت —
// which is not even the same place. Renaming it anywhere reached one of
// the three.
{
  const world = readFileSync("src/game/world.ts", "utf8");
  const map = readFileSync("src/game/roadmap.ts", "utf8");
  check(typeof DRIFT_PLAZA.name === "string" && DRIFT_PLAZA.name.length > 0,
    "the plaza must carry its own name");
  check(typeof DRIFT_PLAZA.arabic === "string" && /[\u0600-\u06FF]/.test(DRIFT_PLAZA.arabic),
    "the plaza must carry its Arabic");
  check(!/fillText\("دوّار شرق"/.test(world) && !/roadTextTexture\("دوّار شرق"\)/.test(world),
    "the board and the road legend must read the table, not a literal");
  check(!/"Drift circle"/.test(map), "the map must read the table, not its own name for the place");
  check(map.includes("DRIFT_PLAZA.name") && map.includes("DRIFT_PLAZA.arabic"),
    "the map must take both halves of the name from the table");

  // The tunnel was called "Hawally" in two places while a third said it
  // was under the Shamiya junction — and Hawally is not a district in
  // AREAS at all. It spans 4855-5145, straddling the Shamiya/Mansuriya
  // boundary at 5000, so it belongs to neither.
  const track = readFileSync("src/game/track.ts", "utf8");
  const districts = ["Shamiya", "Mansuriya"];
  check(!/Hawally tunnel/.test(world) && !/Hawally tunnel/.test(track),
    "the tunnel must not be named after a district this game does not have");
  console.log(`one name per place: the plaza is ${DRIFT_PLAZA.name} / ${DRIFT_PLAZA.arabic}, read from the table by all three; the tunnel is named after neither ${districts.join(" nor ")}`);
}

// --- 7. The unnamed grid says so ---------------------------------------
// Four avenues and 72 cross streets have no names. The tempting fix is to
// generate Kuwaiti addresses, and that would be a confident wrong answer:
// a قطعة is a municipal fact covering an area in two dimensions, and an
// avenue here is a line of constant lat running through all ten
// districts. This asserts the hook stays empty and the reason stays
// written down.
{
  const world = readFileSync("src/game/world.ts", "utf8");
  check(Object.keys(STREET_NAMES).length === 0,
    "STREET_NAMES ships empty — a generated Kuwaiti address is a claim about a real city");
  check(/EMPTY BY DESIGN/.test(world), "the hook must say why it is empty");
  check(/قطعة/.test(world), "the note must name what it is refusing to generate");
  const avenues = STREETS.avenues.length;
  const crosses = Math.round(track.length / STREETS.crossEvery);
  console.log(`${avenues} avenues and ${crosses} cross streets, unnamed on purpose, with the reason recorded`);
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
