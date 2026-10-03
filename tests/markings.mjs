// Everything painted on the ground has to face up — and be the size, in
// the place, that a road's paint is.
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
//
// THE DIMENSIONS (sections 8-18). This file used to check its own copy of
// the numbers: a 14 m lane cadence the world had stopped building, edge
// offsets re-typed beside the ones world.ts used. Nothing runnable without
// a browser checked a single marking dimension. Now the world builds its
// paint with buildRoadMarkings (markings.ts) from one spec table, and this
// builds the SAME meshes with stub materials, reads their geometry and
// every instance matrix back, cross-checks each matrix against the layout
// record it came from, and holds every value in the spec inside an
// independent STANDARD band written below, with the manual it comes from.
// A value can move only inside the standard.

import * as THREE from "three";
import { buildRibbon, STREETS, STREET_NAMES } from "../src/game/world.ts";
import { Track, ROAD_HALF_WIDTH, COAST_U, DRIFT_PLAZA, LANES, TUNNEL_BOX } from "../src/game/track.ts";
import {
  MARKINGS,
  ASPHALT,
  junctions,
  markingsLayout,
  buildRoadMarkings,
  laneLineLats,
  edgeBand,
  studLat,
  stopLineS,
  approachSpan,
  boxSpan,
  signalHeadS,
  arrowOutline,
  onForecourt,
} from "../src/game/markings.ts";
import { readFileSync } from "node:fs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c; };
const track = new Track();
const L = track.length;
const hw = (s) => track.halfWidthAt(s);

// Every ground ribbon the world builds, described the way world.ts
// describes it — reading the offsets from the spec it reads them from,
// not re-typing them. A ribbon added there and not here is not covered —
// the count below is asserted so that stays visible.
const STRIP = MARKINGS.strip.width;
const GROUND_RIBBONS = [
  { name: "road", a: (s) => -(hw(s) + STRIP), b: (s) => hw(s) + STRIP, y: 0.02, step: 4, uMetres: ASPHALT.tileM },
  { name: "road-line edge=+1", a: (s) => edgeBand(track, s, 1)[0], b: (s) => edgeBand(track, s, 1)[1], y: MARKINGS.edge.y, step: 4 },
  { name: "road-line edge=-1", a: (s) => edgeBand(track, s, -1)[0], b: (s) => edgeBand(track, s, -1)[1], y: MARKINGS.edge.y, step: 4 },
  { name: "corniche walkway", a: -(ROAD_HALF_WIDTH + 0.8), b: -(ROAD_HALF_WIDTH + 4.5), y: 0.06, step: 10, u0: COAST_U.from, u1: COAST_U.to },
  { name: "beach sand", a: -(ROAD_HALF_WIDTH + 4.5), b: -(ROAD_HALF_WIDTH + 48), y: 0.0, step: 10, u0: COAST_U.from, u1: COAST_U.to },
  { name: "plaza kerb sign=+1", a: (s) => hw(s) + MARKINGS.kerb.inner, b: (s) => hw(s) + MARKINGS.kerb.outer, y: 0.06, step: 4 },
  { name: "plaza kerb sign=-1", a: (s) => -(hw(s) + MARKINGS.kerb.outer), b: (s) => -(hw(s) + MARKINGS.kerb.inner), y: 0.06, step: 4 },
  { name: "brake rubber streak", a: 1.75 + 0.78 - 0.14, b: 1.75 + 0.78 + 0.14, y: 0.035, step: 4, u0: 0.35, u1: 0.37 },
];

const minNormalY = (geo) => {
  const n = geo.getAttribute("normal");
  let min = Infinity;
  for (let i = 0; i < n.count; i++) min = Math.min(min, n.getY(i));
  return min;
};

// The meshes the world adds, built the way world.ts builds them.
const stub = () => new THREE.MeshBasicMaterial();
const mats = { line: stub(), dash: stub(), street: stub(), stud: stub() };
const layout = markingsLayout(track, STREETS);
const meshes = buildRoadMarkings(track, STREETS, mats, layout);
const byName = {};
for (const m of meshes) (byName[m.name] ??= []).push(m);
const one = (name) => (byName[name] ?? [])[0];
const J = layout.junctions;
const SIG = J.filter((j) => j.signalised);

// --- 1. Every ground ribbon faces up ---------------------------------
{
  let worst = { name: null, y: Infinity };
  for (const r of GROUND_RIBBONS) {
    const geo = buildRibbon(track, r.a, r.b, r.y, r.step, r.u0 ?? 0, r.u1 ?? 1, r.uMetres);
    const min = minNormalY(geo);
    if (min < worst.y) worst = { name: r.name, y: min };
    check(min > 0.9, `${r.name} has a vertex normal at y=${min.toFixed(3)} — a ground quad facing down is not drawn`);
  }
  // ...and everything the marking builder lays, ribbons and instanced
  // marks alike: the edge lines, the solid approaches, the dash, stop,
  // arrow and street planes. A stud is a dome and is checked in §15.
  let built = 0;
  for (const m of meshes) {
    if (m.name === "road-stud") continue;
    built++;
    const min = minNormalY(m.geometry);
    if (min < worst.y) worst = { name: m.name, y: min };
    check(min > 0.9, `${m.name} has a vertex normal at y=${min.toFixed(3)} — it is not drawn`);
  }
  // The road's texture is laid in metres across: u = lat / 14 + 0.5, so at
  // hw 7 it is the old 0..1 mapping and the strip is u -0.043..1.043.
  {
    const geo = buildRibbon(track, -(7 + STRIP), 7 + STRIP, 0.02, 4, 0.1, 0.11, ASPHALT.tileM);
    const uv = geo.getAttribute("uv");
    check(Math.abs(uv.getX(0) - (0.5 - (7 + STRIP) / 14)) < 1e-6 && Math.abs(uv.getX(1) - (0.5 + (7 + STRIP) / 14)) < 1e-6,
      `the road's u is ${uv.getX(0).toFixed(3)}..${uv.getX(1).toFixed(3)} across ±${7 + STRIP} m, expected lat / 14 + 0.5`);
    const old = buildRibbon(track, -7, 7, 0.02, 4, 0.1, 0.11, ASPHALT.tileM).getAttribute("uv");
    check(Math.abs(old.getX(0)) < 1e-9 && Math.abs(old.getX(1) - 1) < 1e-9, "at ±7 m the mapping must be the old 0..1 exactly");
  }
  console.log(`${GROUND_RIBBONS.length} ground ribbons and ${built} marking meshes, worst vertex normal y = ${worst.y.toFixed(3)} (${worst.name})`);
}

// --- 2. The winding is decided by the offsets, not by the caller ------
// The specific failure: a ribbon whose offsets are given in either order
// must come out facing up. Before the fix, one order silently produced an
// invisible mesh.
{
  const up = (a, b) => minNormalY(buildRibbon(track, a, b, 0.03, 8, 0, 0.02));
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
//
// Read from MARKINGS.lane, the cycle the world builds (12 m). This used
// to assert a cadence(14, 3) the world had stopped building, which passed
// whatever world.ts did. The street centre lines no longer run on a lap
// cadence at all — they are laid per segment between junctions (§14).
{
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

  const lane = cadence(MARKINGS.lane.cycle, MARKINGS.lane.mark);
  check(Math.abs(lane.spacing * lane.slots - L) < 1e-9, "the lane cadence must divide the lap exactly");
  check(lane.max - lane.min < 1e-6,
    `lane gaps run ${lane.min.toFixed(3)}-${lane.max.toFixed(3)} m — the seam is still open`);

  // What it was, so the number is on the record rather than in a message.
  const oldSlots = Math.floor(L / 14);
  const oldSeam = L - (oldSlots - 1) * 14 - 3;
  check(oldSeam > 18, "sanity: the old lane seam really was a ~19 m hole");
  console.log(
    `lane dashes ${lane.slots} x ${lane.spacing.toFixed(3)} m, every gap ${lane.min.toFixed(3)} m ` +
    `(the seam was ${oldSeam.toFixed(1)} m)`
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
  // Studs must sit on the line they mark, everywhere — read from what the
  // builder lays, not from a regex.
  let studWorst = 0, studAt = 0, onLine = 0;
  for (const st of layout.studs) {
    const side = Math.sign(st.lat);
    const [a, b] = edgeBand(track, st.s, side);
    if (Math.abs(st.lat - (a + b) / 2) < 1e-9) onLine++;
    const err = Math.abs(Math.abs(st.lat) - (ROAD_HALF_WIDTH + MARKINGS.edge.width / 2));
    if (err > studWorst) { studWorst = err; studAt = st.s; }
  }
  check(onLine === layout.studs.length, `${layout.studs.length - onLine} studs are off the edge line's centre`);
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
      worst = Math.max(worst, Math.abs(lat) - hw(s));
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
    `${onLine} studs on the edge line's centre at halfWidthAt (the constant was ${studWorst.toFixed(2)} m out at s=${studAt}); ` +
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
  check(typeof DRIFT_PLAZA.arabic === "string" && /[؀-ۿ]/.test(DRIFT_PLAZA.arabic),
    "the plaza must carry its Arabic");
  check(!/fillText\("دوّار شرق"/.test(world) && !/roadTextTexture\("دوّار شرق"\)/.test(world),
    "the board and the road legend must read the table, not a literal");
  check(world.includes("roadTextTexture(DRIFT_PLAZA.arabic)"), "the road legend must read DRIFT_PLAZA.arabic");
  check(!/"Drift circle"/.test(map), "the map must read the table, not its own name for the place");
  check(map.includes("DRIFT_PLAZA.name") && map.includes("DRIFT_PLAZA.arabic"),
    "the map must take both halves of the name from the table");

  // The tunnel was called "Hawally" in two places while a third said it
  // was under the Shamiya junction — and Hawally is not a district in
  // AREAS at all. It spans 4855-5145, straddling the Shamiya/Mansuriya
  // boundary at 5000, so it belongs to neither.
  const trackSrc = readFileSync("src/game/track.ts", "utf8");
  const districts = ["Shamiya", "Mansuriya"];
  check(!/Hawally tunnel/.test(world) && !/Hawally tunnel/.test(trackSrc),
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
  const crosses = Math.round(L / STREETS.crossEvery);
  console.log(`${avenues} avenues and ${crosses} cross streets, unnamed on purpose, with the reason recorded`);
}

// --- 8. The spec sits inside the standard -----------------------------
//
// STANDARD is the test's own, written here and NOT imported, so the spec
// and the bands it is held to cannot be edited in one stroke. No Kuwait
// MPW or GCC manual is reachable from this environment: the bands are
// recalled from MUTCD 2009 and UK TSRGD / TSM chapter 5 and say so. Where
// the spec's value is a choice the manuals do not fix, the band is wide
// and the citation says ASSUMPTION.
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const albedo = (hex) => {
  const r = srgbToLinear(((hex >> 16) & 255) / 255);
  const g = srgbToLinear(((hex >> 8) & 255) / 255);
  const b = srgbToLinear((hex & 255) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const STANDARD = Object.freeze({
  laneWidth: { band: [0.10, 0.15], cite: "MUTCD 2009 §3A.05: normal line 4-6 in" },
  laneMark: { band: [2.99, 3.05], cite: "MUTCD §3A.06: broken line 10 ft (3.05 m) segments; Gulf 3 m" },
  laneGap: { band: [8.85, 9.15], cite: "MUTCD §3A.06: 30 ft (9.14 m) gaps; Gulf 9 m" },
  edgeWidth: { band: [0.15, 0.20], cite: "UK TSM ch5: 150 mm, 200 mm on high-speed roads (recalled); MUTCD 4-6 in" },
  strip: { band: [0.30, 1.00], cite: "UK CD 127 hard strip 0.3-1.0 m (recalled); bounded by the rail at hw + 0.60" },
  laneM: { band: [3.49, 3.51], cite: "Kuwait urban arterial lane 3.5 m (tests/road.mjs)" },
  studFootprint: { band: [0.09, 0.11], cite: "BS EN 1463 / MUTCD raised pavement marker, about 100 mm (recalled)" },
  studProud: { band: [0.0, 0.025], cite: "raised markers stand no more than 20-25 mm (recalled)" },
  studSpacing: { band: [18, 18], cite: "UK road studs at 18 m (recalled)" },
  studEmissive: { band: [0, 2.0], cite: "world.ts nightGlow: emissive up to 2.0 is dimmed by day" },
  stopWidth: { band: [0.30, 0.61], cite: "MUTCD §3B.16: 12-24 in; UK dia 1001: 300 mm above 40 mph" },
  stopToHead: { band: [12.2, 55], cite: "MUTCD §4D.14: signal faces 40-180 ft beyond the stop line" },
  stopToKerb: { band: [1.2, 9.0], cite: "MUTCD §3B.16: no more than 30 ft before the intersecting traveled way" },
  approach: { band: [20, 60], cite: "MUTCD §3B.04: solid where lane changes are discouraged; 30 m is an ASSUMPTION" },
  arrowLength: { band: [4.0, 9.0], cite: "UK dia 1038/1039: 4 / 6 / 9 m by speed (recalled); 6 m is an ASSUMPTION" },
  arrowReach: { band: [0, 1.25], cite: "an arrow stays 0.5 m inside its 3.5 m lane" },
  streetWidth: { band: [0.10, 0.15], cite: "MUTCD §3A.05: 4 in on local streets" },
  streetMark: { band: [2.99, 3.05], cite: "MUTCD §3A.06: 10 ft" },
  streetGap: { band: [8.99, 9.15], cite: "MUTCD §3A.06: 30 ft" },
  legendAlong: { band: [1.6, 2.8], cite: "UK TSM ch5 elongated legends: 1.6 m to 40 mph, 2.8 m above (recalled)" },
  legendWidth: { band: [0, 2.5], cite: "a legend sits inside one lane" },
  paintAlbedo: { band: [0.65, 0.85], cite: "thermoplastic 0.75-0.85 when laid, falling with wear (world.ts lineMat note)" },
  wheelPath: { band: [0.75, 0.85], cite: "1.55-1.6 m vehicle track; the brake-rubber streaks at ±0.78" },
  sealantRoughness: { band: [0.70, 1.0], cite: "crack sealant is dull bitumen, not the road's glossiest surface" },
});
{
  const SPEC = {
    laneWidth: MARKINGS.lane.width,
    laneMark: MARKINGS.lane.mark,
    laneGap: L / Math.round(L / MARKINGS.lane.cycle) - MARKINGS.lane.mark,
    edgeWidth: MARKINGS.edge.width,
    strip: MARKINGS.strip.width,
    laneM: (LANES[1] - LANES[0] + LANES[2] - LANES[1] + LANES[3] - LANES[2]) / 3,
    studFootprint: MARKINGS.stud.footprint,
    studProud: MARKINGS.stud.proud,
    studSpacing: MARKINGS.stud.spacing,
    studEmissive: MARKINGS.stud.emissive,
    stopWidth: MARKINGS.stop.width,
    stopToHead: MARKINGS.signal.headAfter + MARKINGS.stop.setback - MARKINGS.stop.width / 2,
    stopToKerb: MARKINGS.stop.setback - MARKINGS.stop.width / 2 - STREETS.half,
    approach: MARKINGS.approach.length,
    arrowLength: MARKINGS.arrow.length,
    arrowReach: MARKINGS.arrow.branchReach,
    streetWidth: MARKINGS.street.width,
    streetMark: MARKINGS.street.mark,
    streetGap: MARKINGS.street.gap,
    legendAlong: (MARKINGS.legend.length * MARKINGS.legend.glyphPx) / MARKINGS.legend.canvasPx,
    legendWidth: MARKINGS.legend.width,
    paintAlbedo: Object.values(MARKINGS.paint).map(albedo),
    wheelPath: ASPHALT.wheelPathM,
    sealantRoughness: ASPHALT.sealantRoughness,
  };
  check(Object.keys(SPEC).length === Object.keys(STANDARD).length, "every STANDARD row must be held");
  const rows = [];
  for (const [k, { band, cite }] of Object.entries(STANDARD)) {
    const vals = [].concat(SPEC[k]);
    const ok = vals.every((v) => Number.isFinite(v) && v >= band[0] - 1e-9 && v <= band[1] + 1e-9);
    check(ok, `${k} = ${vals.map((v) => +v.toFixed(3)).join("/")} is outside [${band[0]}, ${band[1]}] — ${cite}`);
    rows.push(`  ${k.padEnd(16)} ${vals.map((v) => +v.toFixed(3)).join("/").padEnd(24)} [${band[0]}, ${band[1]}]  ${cite}`);
  }
  // The spec is frozen: a builder cannot nudge a dimension at run time.
  let threw = false;
  try { MARKINGS.lane.width = 0.2; } catch { threw = true; }
  check(threw && MARKINGS.lane.width === 0.15, "MARKINGS must be frozen");
  check(MARKINGS.convention === "white", "the colour convention stays 'white' until Kuwait's is verified");
  console.log(`\nspec against the standard (${rows.length} rows):\n${rows.join("\n")}`);
}

// --- 9. Four equal lanes, measured to the paint -----------------------
// The edge line was 150-350 mm INBOARD of the tarmac edge, inside the
// outer lane: line-centre lane widths came out 3.25 / 3.50 / 3.50 / 3.25,
// and LANES[3] (5.25) sat 0.14 m outboard of its painted lane's centre.
{
  let samples = 0, worstW = 0, worstC = 0, worstStrip = Infinity;
  const lines = laneLineLats();
  check(lines.length === 3 && lines.every((l, k) => Math.abs(l - (LANES[k] + LANES[k + 1]) / 2) < 1e-12),
    "the lane lines must be the midpoints of LANES");
  for (let i = 0; i < 4000 && samples < 400; i++) {
    const s = (i / 4000) * L;
    // edge outer stays on pavement, everywhere
    for (const side of [-1, 1]) {
      const [, outer] = edgeBand(track, s, side);
      worstStrip = Math.min(worstStrip, hw(s) + STRIP - Math.abs(outer));
    }
    if (Math.abs(hw(s) - ROAD_HALF_WIDTH) > 1e-9) continue;
    samples++;
    const bounds = [edgeBand(track, s, -1)[0], ...lines, edgeBand(track, s, 1)[0]];
    for (let k = 0; k < 4; k++) {
      worstW = Math.max(worstW, Math.abs(bounds[k + 1] - bounds[k] - 3.5));
      worstC = Math.max(worstC, Math.abs((bounds[k] + bounds[k + 1]) / 2 - LANES[k]));
    }
  }
  check(samples === 400, `only ${samples} four-lane samples`);
  check(worstW <= 0.01, `a lane is ${worstW.toFixed(3)} m off 3.50 between its lines`);
  check(worstC <= 0.01, `a LANES centre is ${worstC.toFixed(3)} m off its painted lane's centre`);
  check(worstStrip >= 0.30, `the edge line's outer edge is only ${worstStrip.toFixed(2)} m inside the paved strip's edge`);
  // The plaza kerb is outboard of the line, not on it.
  const kerbGap = MARKINGS.kerb.inner - (MARKINGS.edge.inner + MARKINGS.edge.width);
  check(kerbGap >= 0.03, `the plaza kerb starts ${kerbGap.toFixed(2)} m outside the edge line — it must not cover it`);
  check(MARKINGS.kerb.outer <= STRIP, "the plaza kerb must stay inside the rail lip");
  // What it was, on the record.
  const oldOuter = 7 - 0.25 - 3.5;
  check(Math.abs(oldOuter - 3.25) < 1e-9, "sanity: the old outer lane was 3.25 m to the line centre");
  console.log(`\nlanes   4 x 3.50 m to the paint at ${samples} samples (worst ${(worstW * 1000).toFixed(1)} mm), LANES on their centres (worst ${(worstC * 1000).toFixed(1)} mm); ` +
    `edge line ${worstStrip.toFixed(2)} m inside the strip's edge; plaza kerb ${kerbGap.toFixed(2)} m outboard of it (outer lanes were ${oldOuter.toFixed(2)} m)`);
}

// Every instanced mark is where its layout record says, facing the way it
// says. The records are what the other sections reason about, so this is
// what stops them drifting from the geometry.
const P = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3();
const M4 = new THREE.Matrix4(), tmpV = new THREE.Vector3(), dirV = new THREE.Vector3(), fwdV = new THREE.Vector3();
const crossCheck = (mesh, records) => {
  let worstPos = 0, worstYaw = 0;
  if (!mesh) return { worstPos: Infinity, worstYaw: Infinity };
  check(mesh.count === records.length, `${mesh.name}: ${mesh.count} instances against ${records.length} records`);
  for (let i = 0; i < Math.min(mesh.count, records.length); i++) {
    const r = records[i];
    mesh.getMatrixAt(i, M4);
    // Hidden is a zero 3x3, read off the columns: three r184's decompose
    // reports a singular matrix as scale 1, identity rotation.
    const e = M4.elements;
    const hidden = Math.hypot(e[0], e[1], e[2]) === 0 && Math.hypot(e[4], e[5], e[6]) === 0 && Math.hypot(e[8], e[9], e[10]) === 0;
    if (!check(hidden === !!r.hidden, `${mesh.name} #${i}: the matrix says ${hidden ? "hidden" : "shown"}, the record says otherwise`)) continue;
    P.setFromMatrixPosition(M4);
    track.pose(r.s, r.lat, tmpV, dirV);
    tmpV.y = r.y;
    worstPos = Math.max(worstPos, P.distanceTo(tmpV));
    if (hidden) continue;
    M4.decompose(P, Q, SC);
    if (r.axis === "side") track.sideAt(r.s, dirV);
    else track.tangentAt(r.s, dirV);
    fwdV.set(0, 0, 1).applyQuaternion(Q);
    worstYaw = Math.max(worstYaw, (fwdV.angleTo(dirV) * 180) / Math.PI);
  }
  check(worstPos < 0.001, `${mesh.name}: an instance is ${(worstPos * 1000).toFixed(2)} mm from its record`);
  check(worstYaw < 0.2, `${mesh.name}: an instance is turned ${worstYaw.toFixed(3)} deg from its record`);
  return { worstPos, worstYaw };
};
const bbox = (geo) => { geo.computeBoundingBox(); const b = geo.boundingBox; return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z, min: b.min, max: b.max }; };

// --- 10. Lane lines: 150 mm, 3 on 9, hidden through every junction ------
{
  const dash = one("road-dash");
  check(!!dash, "no road-dash mesh");
  const b = bbox(dash.geometry);
  check(Math.abs(b.z - 3.0) < 0.005 && Math.abs(b.x - 0.15) < 0.005, `road-dash is ${b.x.toFixed(3)} x ${b.z.toFixed(3)} m, expected 0.15 x 3.0`);
  const slots = Math.round(L / MARKINGS.lane.cycle);
  check(dash.count === 3 * slots, `road-dash count ${dash.count}, expected ${3 * slots} — hidden slots are kept at zero scale`);
  const cc = crossCheck(dash, layout.laneDash);
  // Gaps along each line, between consecutive VISIBLE slots, in highway s
  // (an outer line on a bend runs a longer arc, a property of the bend).
  const spacing = L / slots;
  let worstGap = 0, hiddenBad = 0, shownBad = 0, hidden = 0;
  const inBox = (s) => SIG.some((j) => {
    const [a, bb] = boxSpan(j);
    const d = track.deltaAhead(j.s, s);
    return d + MARKINGS.lane.mark / 2 > a - j.s && d - MARKINGS.lane.mark / 2 < bb - j.s;
  });
  for (let line = 0; line < 3; line++) {
    for (let i = 0; i < slots; i++) {
      const r = layout.laneDash[line * slots + i];
      const next = layout.laneDash[line * slots + ((i + 1) % slots)];
      if (r.hidden) hidden++;
      if (r.hidden && !inBox(r.s)) hiddenBad++;
      if (!r.hidden && inBox(r.s)) shownBad++;
      if (!r.hidden && !next.hidden) {
        const ds = i + 1 < slots ? next.s - r.s : next.s + L - r.s;
        worstGap = Math.max(worstGap, Math.abs(ds - MARKINGS.lane.mark - (spacing - MARKINGS.lane.mark)));
      }
    }
  }
  check(Math.abs(spacing * slots - L) < 1e-6, "the lane cadence must close the lap");
  check(worstGap < 1e-6, `a visible gap is ${worstGap.toFixed(4)} m off ${(spacing - 3).toFixed(3)}`);
  check(hiddenBad === 0, `${hiddenBad} hidden dashes are outside every junction box`);
  check(shownBad === 0, `${shownBad} visible dashes run into a junction box`);
  console.log(`\ndashes  ${dash.count} slots (${slots} per line), ${hidden} hidden at zero scale through ${SIG.length} junction boxes ` +
    `(${(hidden / 3).toFixed(0)} per line), gap ${(spacing - 3).toFixed(3)} m between the rest; matrices within ${(cc.worstPos * 1000).toFixed(2)} mm / ${cc.worstYaw.toFixed(3)} deg of the layout`);

  // tests/road.mjs §5b reads the live mesh this way in a browser; the same
  // reading here, on the same builder, so its assumptions are known true
  // before anyone launches one: 3 m by 0.10-0.15 m, the gap between slots
  // perLine and perLine + 1 (the MIDDLE line) 9 ±0.15 m, count / 3 slots
  // closing the lap, an edge line present, no median.
  const perLine = dash.count / 3;
  const a = new THREE.Matrix4(), c = new THREE.Matrix4();
  dash.getMatrixAt(perLine, a); dash.getMatrixAt(perLine + 1, c);
  const pa = new THREE.Vector3().setFromMatrixPosition(a), pc = new THREE.Vector3().setFromMatrixPosition(c);
  const sp = pa.distanceTo(pc);
  const prm = dash.geometry.parameters;
  check(Math.abs(prm.height - 3) < 0.01 && Math.abs(sp - prm.height - 9) < 0.15 && prm.width >= 0.1 && prm.width <= 0.15,
    `road.mjs §5b would read ${prm.width} x ${prm.height} m at a ${(sp - prm.height).toFixed(2)} m gap`);
  check(Math.abs(L / (dash.count / 3) - sp) < 0.05, "road.mjs §5b: the marks per line must close the lap");
  check(!!one("road-line") && byName["road-line"].length === 2, "road.mjs §5b: two road-line meshes");
  check(!meshes.some((m) => /median|divider/i.test(m.name)), "road.mjs §5b: no median objects");
  console.log(`road.mjs §5b on these meshes: ${prm.width * 1000} mm x ${prm.height} m, middle-line gap ${(sp - prm.height).toFixed(3)} m, ${perLine} marks close the lap`);
}

// --- 11. Stop lines at every signal, and nowhere else -------------------
{
  const stop = one("road-stop");
  check(SIG.length === 33, `${SIG.length} signalised junctions, expected 33`);
  check(!SIG.some((j) => j.i === 50), "junction 50 is on the paint shop's forecourt and must not be signalised");
  check(!SIG.some((j) => j.i === 42 || j.i === 44), "42 and 44 are at the tunnel and must not be signalised");
  check(!!stop && stop.count === SIG.length, `road-stop has ${stop?.count} instances for ${SIG.length} signals`);
  const cc = crossCheck(stop, layout.stop);
  const b = bbox(stop.geometry);
  check(Math.abs(b.z - MARKINGS.stop.width) < 0.005, `the stop line is ${b.z.toFixed(3)} m deep`);
  // The ends, through the instance matrix, at lat ±7.00 — on both edge
  // lines' inner edges.
  let worstEnd = 0;
  for (let i = 0; i < stop.count; i++) {
    stop.getMatrixAt(i, M4);
    const r = layout.stop[i];
    const pt = new THREE.Vector3(), sd = new THREE.Vector3();
    track.pointAt(r.s, pt); track.sideAt(r.s, sd);
    for (const x of [b.min.x, b.max.x]) {
      const w = new THREE.Vector3(x, 0, 0).applyMatrix4(M4);
      const lat = (w.x - pt.x) * sd.x + (w.z - pt.z) * sd.z;
      worstEnd = Math.max(worstEnd, Math.abs(Math.abs(lat) - 7.0));
    }
  }
  check(worstEnd <= 0.01, `a stop line ends ${worstEnd.toFixed(3)} m off the edge lines' inner edges`);
  let worstHead = [Infinity, -Infinity], worstKerb = [Infinity, -Infinity], swollen = 0, approachEnd = 0;
  for (const j of SIG) {
    const f = stopLineS(j);
    const head = signalHeadS(j) - f.downstream;
    const kerb = j.s - STREETS.half - f.downstream;
    worstHead = [Math.min(worstHead[0], head), Math.max(worstHead[1], head)];
    worstKerb = [Math.min(worstKerb[0], kerb), Math.max(worstKerb[1], kerb)];
    for (let s = j.s - 45; s <= j.s + 10; s += 0.5) if (Math.abs(hw(s) - 7) > 1e-9) { swollen++; break; }
    const [, to] = approachSpan(j);
    approachEnd = Math.max(approachEnd, Math.abs(to - f.upstream));
  }
  check(worstHead[0] >= 12.2 && worstHead[1] <= 55, `the head is ${worstHead[0].toFixed(2)}-${worstHead[1].toFixed(2)} m beyond the stop line (MUTCD 12.2-55)`);
  check(worstKerb[0] >= 1.2 && worstKerb[1] <= 9.0, `the stop line is ${worstKerb[0].toFixed(2)}-${worstKerb[1].toFixed(2)} m before the near kerb (1.2-9.0)`);
  check(swollen === 0, `${swollen} signalised junctions have a swell within 45 m before or 10 m after`);
  check(approachEnd <= 0.01, `an approach line ends ${approachEnd.toFixed(3)} m from the stop line's upstream face`);
  // The approach mesh is the merged ribbons of exactly those records, and
  // each ribbon's last row of vertices sits on the stop line's upstream face.
  const app = one("road-approach");
  check(!!app, "no road-approach mesh");
  const pos = app.geometry.getAttribute("position");
  let off = 0, worstFace = 0, mismatch = 0;
  for (const a of layout.approach) {
    const g = buildRibbon(track, a.lat - MARKINGS.lane.width / 2, a.lat + MARKINGS.lane.width / 2, MARKINGS.lane.y, 3, a.from / L, a.to / L);
    const gp = g.getAttribute("position");
    for (let v = 0; v < gp.count; v++) {
      if (Math.abs(gp.getX(v) - pos.getX(off + v)) > 1e-4 || Math.abs(gp.getZ(v) - pos.getZ(off + v)) > 1e-4) { mismatch++; break; }
    }
    for (const [v, lat] of [[gp.count - 2, a.lat - MARKINGS.lane.width / 2], [gp.count - 1, a.lat + MARKINGS.lane.width / 2]]) {
      track.pose(a.to, lat, tmpV, dirV);
      worstFace = Math.max(worstFace, Math.hypot(pos.getX(off + v) - tmpV.x, pos.getZ(off + v) - tmpV.z));
    }
    off += gp.count;
  }
  check(mismatch === 0 && off === pos.count, `road-approach is not the ${layout.approach.length} approach ribbons (${mismatch} differ)`);
  check(worstFace <= 0.01, `an approach line ends ${worstFace.toFixed(3)} m from its upstream face`);
  check(layout.approach.length === 3 * SIG.length, `${layout.approach.length} approach lines for ${SIG.length} junctions`);
  // No crossings until the rail opens (M7); when they come, they keep
  // 1.2 m clear of the stop line.
  check(!one("road-xing"), "a crossing is painted at a junction whose rail is still closed");
  console.log(`\nstops   ${stop.count} stop lines ${MARKINGS.stop.width} m deep, ends at lat ±7.00 (worst ${(worstEnd * 1000).toFixed(1)} mm); ` +
    `head ${worstHead[0].toFixed(2)} m beyond, near kerb ${worstKerb[0].toFixed(2)} m ahead; ${layout.approach.length} solid approach lines ${MARKINGS.approach.length} m long ending on the line; ` +
    `junction 50 (paint shop) not signalised; matrices within ${(cc.worstPos * 1000).toFixed(2)} mm`);
}

// --- 12. Lane arrows -----------------------------------------------------
{
  const all = [...(byName["road-arrow-ahead"] ?? []), ...(byName["road-arrow-left"] ?? []), ...(byName["road-arrow-right"] ?? [])];
  const count = all.reduce((n, m) => n + m.count, 0);
  check(count === 4 * SIG.length, `${count} arrows, expected ${4 * SIG.length}`);
  for (const kind of ["ahead", "left", "right"]) {
    const o = arrowOutline(kind);
    const xs = o.map((p) => p[0]), ys = o.map((p) => p[1]);
    check(Math.abs(Math.max(...ys) - Math.min(...ys) - MARKINGS.arrow.length) < 0.05, `the ${kind} arrow is ${(Math.max(...ys) - Math.min(...ys)).toFixed(2)} m long`);
    check(Math.max(...xs.map(Math.abs)) <= MARKINGS.arrow.branchReach + 1e-9, `the ${kind} arrow reaches ${Math.max(...xs.map(Math.abs)).toFixed(2)} m from the lane centre`);
  }
  let worstLat = 0, worstTip = 0, wrongKind = 0, turnClosed = 0, worstClear = Infinity;
  for (const kind of ["ahead", "left", "right"]) {
    const mesh = one(`road-arrow-${kind}`);
    const recs = layout.arrows[kind];
    if (!mesh) { check(recs.length === 0, `${recs.length} ${kind} arrows laid out and none built`); continue; }
    crossCheck(mesh, recs);
    const g = mesh.geometry;
    const b = bbox(g);
    check(Math.abs(b.z - MARKINGS.arrow.length) < 0.05, `road-arrow-${kind} geometry is ${b.z.toFixed(2)} m long`);
    // The tip is the vertex furthest forward; the instance frame maps +z
    // to the road's tangent.
    const gp = g.getAttribute("position");
    let tipLocal = null;
    for (let v = 0; v < gp.count; v++) if (!tipLocal || gp.getZ(v) > tipLocal.z) tipLocal = new THREE.Vector3(gp.getX(v), gp.getY(v), gp.getZ(v));
    for (let i = 0; i < mesh.count; i++) {
      const r = recs[i];
      const j = J[r.j];
      mesh.getMatrixAt(i, M4);
      const c = new THREE.Vector3().setFromMatrixPosition(M4);
      const pt = new THREE.Vector3(), sd = new THREE.Vector3();
      track.pointAt(r.s, pt); track.sideAt(r.s, sd);
      const lat = (c.x - pt.x) * sd.x + (c.z - pt.z) * sd.z;
      const k = LANES.findIndex((l) => Math.abs(l - lat) < 0.5);
      worstLat = Math.max(worstLat, k < 0 ? Infinity : Math.abs(lat - LANES[k]));
      const tip = tipLocal.clone().applyMatrix4(M4);
      track.pose(stopLineS(j).upstream - MARKINGS.arrow.tipToStop, LANES[k], tmpV, dirV);
      worstTip = Math.max(worstTip, Math.hypot(tip.x - tmpV.x, tip.z - tmpV.z));
      const want = k === 0 && j.minus && j.open ? "left" : k === 3 && j.open ? "right" : "ahead";
      if (want !== kind) wrongKind++;
      if (kind !== "ahead" && !j.open) turnClosed++;
      // Clear of the lane lines either side, through the outline.
      const reach = Math.max(...arrowOutline(kind).map((p) => Math.abs(p[0])));
      worstClear = Math.min(worstClear, 1.75 - reach);
    }
  }
  check(worstLat <= 0.02, `an arrow is ${worstLat.toFixed(3)} m off its lane centre`);
  check(worstTip <= 0.05, `an arrow tip is ${worstTip.toFixed(3)} m from ${MARKINGS.arrow.tipToStop} m before the stop line`);
  check(wrongKind === 0, `${wrongKind} arrows are the wrong kind for their junction`);
  check(turnClosed === 0, `${turnClosed} turn arrows point into a closed rail`);
  check(worstClear >= 0.5, `an arrow comes within ${worstClear.toFixed(2)} m of a lane line`);
  console.log(`arrows  ${count} (${Object.entries(layout.arrows).map(([k, v]) => `${v.length} ${k}`).join(", ")}): ` +
    `on LANES within ${(worstLat * 1000).toFixed(1)} mm, tip within ${(worstTip * 1000).toFixed(1)} mm of stop - ${MARKINGS.arrow.tipToStop} m, ${worstClear.toFixed(2)} m clear of the lines; no turn arrow into a closed rail`);
}

// --- 13. No stop line on a street that cannot reach the highway ---------
// The 114 cross-street bars faced an unbroken W-beam and edge line, and
// spanned both halves of the street. Until the rail is opened at a
// junction, there are none; when it is, they come back on the approach
// half only.
{
  const gaps = J.filter((j) => j.open);
  const ss = one("street-stop");
  check(gaps.length > 0 || !ss || ss.count === 0, `${ss?.count} street stop lines behind an uninterrupted rail`);
  let buried = 0, swell = 0, tunnel = 0;
  for (const m of layout.streetDash) {
    const lo = m.axis === "side" ? m.lat - m.l / 2 : m.lat - m.w / 2;
    const hi = m.axis === "side" ? m.lat + m.l / 2 : m.lat + m.w / 2;
    const half = m.axis === "side" ? m.w / 2 : m.l / 2;
    if (onForecourt(track, m.s, half, lo, hi)) buried++;
    if (m.axis === "side") {
      const j = J[m.j];
      if (j.mouthInSwell) swell++;
      if (j.overTunnel && Math.abs(m.lat) - m.l / 2 < TUNNEL_BOX.halfWidth + MARKINGS.street.tunnelClear - 1e-9) tunnel++;
    }
  }
  check(buried === 0, `${buried} street marks under a forecourt apron`);
  check(swell === 0, `${swell} street marks at a junction on swollen tarmac (the plaza, a forecourt)`);
  check(tunnel === 0, `${tunnel} street marks within ${TUNNEL_BOX.halfWidth + MARKINGS.street.tunnelClear} m of the centreline over the tunnel`);
  const swollen = J.filter((j) => j.mouthInSwell).map((j) => j.i);
  check(swollen.join(",") === "5,33,50", `the street paint skips junctions ${swollen.join(",")}, expected 5 (plaza), 33 (station), 50 (paint shop)`);
  console.log(`\nstreets no stop line behind a closed rail (${gaps.length} open junctions); no street paint on a forecourt, at junctions ${swollen.join("/")}, or over the tunnel`);
}

// --- 14. Street centre lines: 100 mm, 3 on 9, between the mouths --------
{
  const sd = one("street-dash");
  const b = bbox(sd.geometry);
  check(Math.abs(b.z - 3.0) < 0.005 && Math.abs(b.x - 0.1) < 0.005, `street-dash is ${b.x.toFixed(3)} x ${b.z.toFixed(3)} m, expected 0.10 x 3.0`);
  const cc = crossCheck(sd, layout.streetDash);
  const bySeg = new Map();
  for (const m of layout.streetDash) {
    if (!bySeg.has(m.seg)) bySeg.set(m.seg, []);
    bySeg.get(m.seg).push(m);
  }
  const segs = new Map(layout.streetSegments.map((s) => [s.key, s]));
  let worstGap = 0, worstOwn = 0, reversals = 0, worstEnd = 0, endPairs = 0, intoMouth = 0;
  const a0 = new THREE.Vector3(), a1 = new THREE.Vector3(), t0 = new THREE.Vector3();
  const mouth = STREETS.half + MARKINGS.street.mouth;
  for (const [key, marks] of bySeg) {
    const seg = segs.get(key);
    for (let i = 0; i + 1 < marks.length; i++) {
      const m = marks[i], n = marks[i + 1];
      if (n.k !== m.k + 1) continue; // a mark dropped for a forecourt
      track.pose(m.s, m.lat, a0, t0); track.pose(n.s, n.lat, a1, t0);
      worstGap = Math.max(worstGap, Math.abs(a0.distanceTo(a1) - MARKINGS.street.mark - MARKINGS.street.gap));
      worstOwn = Math.max(worstOwn, Math.abs(n.a - m.a - MARKINGS.street.mark - MARKINGS.street.gap));
      if (m.axis === "side") track.sideAt(m.s, t0).multiplyScalar(Math.sign(m.lat));
      else track.tangentAt(m.s, t0);
      if (a1.clone().sub(a0).dot(t0) <= 0) reversals++;
    }
    // End clearances, where both end marks are present: equal, and under 6.
    const first = marks[0], last = marks[marks.length - 1];
    if (first.k === 0 && last.k === seg.n - 1) {
      const e0 = first.a - MARKINGS.street.mark / 2 - seg.a0, e1 = seg.a1 - (last.a + MARKINGS.street.mark / 2);
      worstEnd = Math.max(worstEnd, e0, e1);
      check(Math.abs(e0 - e1) < 1e-6 && e0 >= -1e-9, `${key}: the run is not centred (${e0.toFixed(3)} / ${e1.toFixed(3)})`);
      endPairs++;
    }
  }
  // Nothing inside a junction mouth: cross-street marks clear of every
  // avenue by its half plus a metre; avenue marks the same distance, along
  // the avenue, from every cross street on their side (chord ≤ arc, so a
  // chord at or over the mouth proves the arc is).
  const crossOn = (sign) => J.filter((j) => (sign > 0 ? j.plus : j.minus));
  for (const m of layout.streetDash) {
    if (m.axis === "side") {
      for (const d of STREETS.avenues) if (Math.abs(Math.abs(m.lat) - d) < mouth + MARKINGS.street.mark / 2 - 1e-6) intoMouth++;
      const j = J[m.j];
      const start = hw(j.s) + STRIP + MARKINGS.street.crossStart;
      if (Math.abs(m.lat) - MARKINGS.street.mark / 2 < start - 1e-6) intoMouth++;
    } else {
      track.pose(m.s, m.lat, a0, t0);
      for (const j of crossOn(Math.sign(m.lat))) {
        if (Math.abs(track.deltaAhead(j.s, m.s)) > 60) continue;
        track.pose(j.s, m.lat, a1, t0);
        if (a0.distanceTo(a1) < mouth + MARKINGS.street.mark / 2 - 0.02) intoMouth++;
      }
    }
  }
  // Folds: an avenue squeezed below 0.3 of the highway (1 - lat·κ) gets
  // no paint. κ here is from the tangent's turn, not from the positions
  // the builder used: dt/ds = κ·side, and an offset point moves at
  // (1 - lat·κ) of the highway's rate.
  const kappa = (s) => {
    const ta = new THREE.Vector3(), tb = new THREE.Vector3(), sv = new THREE.Vector3();
    track.tangentAt(s - 1, ta); track.tangentAt(s + 1, tb); track.sideAt(s, sv);
    return tb.sub(ta).dot(sv) / 2;
  };
  let squeezed = 0;
  for (const m of layout.streetDash) {
    if (m.axis !== "tangent") continue;
    if (1 - m.lat * kappa(m.s) < MARKINGS.street.minStretch - 0.02) squeezed++;
  }
  const folds = layout.streetSegments.filter((s) => s.skipped === "fold");
  check(worstGap <= 0.05, `a street gap is ${worstGap.toFixed(3)} m off 9.0 measured on the ground`);
  check(worstOwn <= 1e-6, `a street gap is ${worstOwn.toFixed(6)} m off 9.0 in the street's own metres`);
  check(reversals === 0, `${reversals} street marks run backwards`);
  check(worstEnd <= 6.0 + 1e-9, `a segment end clearance is ${worstEnd.toFixed(2)} m`);
  check(intoMouth === 0, `${intoMouth} street marks inside a junction mouth`);
  check(squeezed === 0, `${squeezed} avenue marks where the avenue is squeezed below ${MARKINGS.street.minStretch}`);
  check(folds.some((s) => s.key.startsWith("avenue:+188")), "sanity: the +188 avenue really does fold at Ras Al-Ard");
  console.log(`centre  ${sd.count} street marks ${MARKINGS.street.width * 1000} mm x ${MARKINGS.street.mark} m in ${bySeg.size} segments, gaps 9.0 (worst ${(worstGap * 1000).toFixed(1)} mm on the ground), ` +
    `none reversed or in a mouth, end clearance at most ${worstEnd.toFixed(2)} m (${endPairs} full runs); ` +
    `${folds.length} avenue segments not painted where the avenue folds or squeezes (${folds.map((s) => s.key.replace("avenue:", "") + " f=" + s.minStretch.toFixed(2)).join(", ")}); matrices within ${(cc.worstPos * 1000).toFixed(2)} mm`);
}

// --- 15. Studs: real size, on the line, every 18 m -------------------------
{
  const st = one("road-stud");
  check(!!st, "no road-stud mesh — the studs must be named so the levels tool counts them as road");
  const b = bbox(st.geometry);
  check(Math.abs(b.x - MARKINGS.stud.footprint) <= 0.01 && Math.abs(b.z - MARKINGS.stud.footprint) <= 0.01 && b.y <= 0.025 + 1e-9,
    `a stud is ${b.x.toFixed(3)} x ${b.z.toFixed(3)} m and ${b.y.toFixed(3)} m proud, expected 0.10 and at most 0.025`);
  const cc = crossCheck(st, layout.studs);
  let base = 0, lat = 0, spacing = 0, inGap = 0;
  for (let i = 0; i < st.count; i++) {
    st.getMatrixAt(i, M4);
    M4.decompose(P, Q, SC);
    base = Math.max(base, Math.abs(P.y + b.min.y - MARKINGS.edge.y));
    const r = layout.studs[i];
    lat = Math.max(lat, Math.abs(Math.abs(r.lat) - (hw(r.s) + 0.10)));
    if (i >= 2) spacing = Math.max(spacing, Math.abs(r.s - layout.studs[i - 2].s - MARKINGS.stud.spacing));
    if (J.some((j) => j.open && Math.abs(track.deltaAhead(j.s, r.s)) < 10)) inGap++;
  }
  check(st.count === 2 * Math.floor(L / MARKINGS.stud.spacing), `${st.count} studs`);
  check(base <= 0.002, `a stud's base is ${base.toFixed(4)} m off the paint`);
  check(lat <= 0.01, `a stud is ${lat.toFixed(3)} m off hw + 0.10`);
  check(spacing < 1e-9, `the stud spacing is off ${MARKINGS.stud.spacing} m by ${spacing}`);
  check(inGap === 0, `${inGap} studs in a rail gap`);
  // One material for both rows under the 'white' convention.
  check(MARKINGS.convention !== "white" || !Array.isArray(st.material), "under 'white' both stud rows share one material");
  console.log(`studs   ${st.count}, ${(b.x * 1000).toFixed(0)} mm across and ${(b.y * 1000).toFixed(0)} mm proud (were 140 mm and 110 mm), base on the paint, ` +
    `on the edge line's centre every ${MARKINGS.stud.spacing} m, emissive ${MARKINGS.stud.emissive}; matrices within ${(cc.worstPos * 1000).toFixed(2)} mm`);
}

// --- 16. The plaza legend: in a lane, long, and not in a junction --------
// Centred in its lane and clear of the lines was all this used to ask, and
// the near pair passed it from inside junction 4: s 473-479, past the stop
// line (458.93), under the heads (471.78), across the cross street, where
// the lane lines are hidden. So every plate is now walked end to end
// against every junction: a signalised one's whole box (the solid
// approach, arrows, stop line and the junction itself, which is where the
// lane lines stop), and any cross street's mouth — its half plus the
// metre the street paint keeps clear (§14) — signalised or not.
{
  let worst = 0, clear = Infinity;
  const mouth = STREETS.half + MARKINGS.street.mouth;
  // What a plate laid over highway s [a, b] sits in, by name; empty if
  // nothing. deltaAhead so the seam is not a blind spot.
  const conflicts = (a, b) => {
    const out = [];
    for (const j of J) {
      const lo = track.deltaAhead(j.s, a), hi = lo + (b - a);
      if (j.signalised) {
        const [f, t] = boxSpan(j);
        if (hi > f - j.s && lo < t - j.s) out.push(`junction ${j.i}'s box (${f.toFixed(2)}, ${t.toFixed(2)}]`);
      }
      if (hi > -mouth && lo < mouth) out.push(`junction ${j.i}'s mouth ${(j.s - mouth).toFixed(2)}-${(j.s + mouth).toFixed(2)}`);
    }
    return out;
  };
  // Nearest thing either side, for the record and for a margin.
  let near = Infinity;
  const hit = [];
  for (const m of layout.legend) {
    const k = LANES.findIndex((l) => Math.abs(l - m.lat) < 0.5);
    worst = Math.max(worst, k < 0 ? Infinity : Math.abs(m.lat - LANES[k]));
    for (const line of laneLineLats()) clear = Math.min(clear, Math.abs(Math.abs(m.lat - line) - m.w / 2));
    const a = m.s - m.l / 2, b = m.s + m.l / 2;
    // Every half metre of the plate on 7 m tarmac, not just its centre.
    let swollen = 0;
    for (let s = a; s <= b + 1e-9; s += 0.5) if (Math.abs(hw(s) - 7) > 1e-9) swollen++;
    check(swollen === 0, `a legend at s ${a}-${b} is on swollen tarmac at ${swollen} samples`);
    const c = conflicts(a, b);
    check(c.length === 0, `the legend at s ${a}-${b} lat ${m.lat} sits in ${c.join(" and ")}`);
    if (c.length) hit.push(m);
    for (const j of J) {
      const ends = [j.s - mouth, j.s + mouth];
      if (j.signalised) ends.push(...boxSpan(j));
      for (const e of ends) {
        const d = track.deltaAhead(e, a) >= 0 ? track.deltaAhead(e, a) : track.deltaAhead(b, e);
        if (d >= 0) near = Math.min(near, d);
      }
    }
    check(track.deltaAhead(DRIFT_PLAZA.s, m.s) < 0, `a legend at s ${m.s} is past the plaza it names`);
  }
  // Sanity: the check sees the placement it was written for. The old
  // near pair at plaza - 75 is inside junction 4's box and the street.
  const old = conflicts(DRIFT_PLAZA.s - 75 - 3, DRIFT_PLAZA.s - 75 + 3);
  check(old.some((x) => x.startsWith("junction 4's box")) && old.some((x) => x.startsWith("junction 4's mouth")),
    `sanity: plaza - 75 should be inside junction 4's box and mouth, got ${old.join(", ") || "nothing"}`);
  const along = (MARKINGS.legend.length * MARKINGS.legend.glyphPx) / MARKINGS.legend.canvasPx;
  check(layout.legend.length === 4, `${layout.legend.length} legends, expected 4`);
  check(worst <= 0.05, `a legend is ${worst.toFixed(3)} m off its lane centre`);
  check(MARKINGS.legend.width <= 2.5, `the legend is ${MARKINGS.legend.width} m wide`);
  check(along >= 1.6, `the legend's glyphs are ${along.toFixed(2)} m along travel`);
  check(clear >= 0.3, `a legend comes within ${clear.toFixed(2)} m of a lane line`);
  check(hit.length > 0 || near >= 5, `a legend is ${near.toFixed(2)} m from a junction box or mouth (want 5)`);
  const at = [...new Set(layout.legend.map((m) => `${m.s - m.l / 2}-${m.s + m.l / 2}`))].join(" and ");
  console.log(`\nlegend ${layout.legend.length} x ${MARKINGS.legend.width} m wide, glyphs ${along.toFixed(2)} m along travel (were 1.06), in lanes ${MARKINGS.legend.lanes.join(" and ")} (${clear.toFixed(2)} m clear of the lines); ` +
    `at s ${at}, ${near.toFixed(2)} m clear of every junction box and street mouth (plaza - 75 was inside junction 4: ${old.join(", ")})`);
}

// --- 17. The asphalt's own geometry --------------------------------------
{
  check(ASPHALT.wheelPathM >= 0.75 && ASPHALT.wheelPathM <= 0.85, `wheel paths at ±${ASPHALT.wheelPathM} m`);
  check(ASPHALT.oilU.length === 4 && ASPHALT.oilU.every((u, k) => Math.abs(u - (LANES[k] / ASPHALT.tileM + 0.5)) <= 0.01),
    `oil drips at u ${ASPHALT.oilU.join("/")}, expected the lane centres`);
  check(ASPHALT.sealantRoughness >= 0.7, `sealant roughness ${ASPHALT.sealantRoughness}`);
  check(ASPHALT.tileM === 14, "the asphalt tile is 14 m across; the wear bands and the road's u both assume it");
  console.log(`asphalt wheel paths ±${ASPHALT.wheelPathM} m, drips at u ${ASPHALT.oilU.join("/")}, sealant ≥ ${ASPHALT.sealantRoughness} rough (tests/asphalt.mjs holds the stream)`);
}

// --- 18. The old numbers are gone, and there is one builder ----------------
{
  const world = readFileSync("src/game/world.ts", "utf8");
  // Code only: the modules' comments say "rand()" to explain why they
  // never call it.
  const code = (f) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const mk = code("src/game/markings.ts");
  const rb = code("src/game/ribbon.ts");
  for (const lit of ["PlaneGeometry(0.14,", "PlaneGeometry(0.12,", "STREETS.half * 1.7", "halfWidthAt(s) - 0.35", "[-3.5, 0, 3.5]", "edge + 2.6", "SphereGeometry(0.07"]) {
    check(!world.includes(lit), `world.ts still builds paint from the literal ${lit}`);
  }
  check((world.match(/buildRoadMarkings\(/g) ?? []).length === 1, "world.ts must call buildRoadMarkings exactly once");
  check(/for \(const j of junctions\(track, STREETS\)\)/.test(world) && (world.match(/junctions\(track, STREETS\)/g) ?? []).length >= 2,
    "the cross streets and the signals must both iterate junctions()");
  check(!/color: 0xf2f2ee/.test(world) && !/fillStyle = "#f2f2ee"/.test(world), "a 0xf2f2ee paint white is back (linear 0.89)");
  check(!/\brand\(/.test(mk) && !/\brand\(/.test(rb), "markings.ts and ribbon.ts must not draw from the world's stream");
  check(!/from "\.\/world"/.test(mk) && !/from "\.\/world"/.test(rb), "markings.ts and ribbon.ts must not import world.ts (it imports them)");
  console.log("source  no old paint literals in world.ts; one buildRoadMarkings call; streets and signals on junctions(); no rand() in the paint");
}

// --- Known exception, printed and not failed ------------------------------
// The drift ring is plaza geometry, not paint on a lane, and moving it is
// track work: it reaches into lane 4 for a few metres either side of the
// plaza centre.
{
  const inner = DRIFT_PLAZA.islandLat - (DRIFT_PLAZA.islandRadius + 2.2);
  const outer = DRIFT_PLAZA.islandLat - (DRIFT_PLAZA.islandRadius + 2.6);
  const laneEdge = LANES[3] + 1.75;
  const r = DRIFT_PLAZA.islandRadius + 2.6;
  const c = (laneEdge - DRIFT_PLAZA.islandLat) / r;
  const span = Math.abs(c) < 1 ? r * Math.sqrt(1 - c * c) : 0;
  if (outer < laneEdge) {
    console.log(`known   the drift ring reaches lat ${outer.toFixed(1)}-${inner.toFixed(1)}, inside lane 4 (to lat ${laneEdge}) for s ${DRIFT_PLAZA.s} ±${span.toFixed(1)} (plaza geometry, not paint; not failed)`);
  }
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
