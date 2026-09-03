#!/usr/bin/env node
/**
 * The map's arithmetic:  npm run test:map
 *
 * No browser. Everything here is a pure function of the catalogue and a frame
 * size, and the failures it guards against are silent — a pin lands somewhere
 * plausible-looking and nothing in the app ever says it is wrong.
 *
 * The bug this exists for: `spreadPins` nudges overlapping pins apart, and its
 * only limit was one pin width — a distance in SCREEN units. On a tight view
 * that is metres. On a wide one it is kilometres, and it was: a phone-width
 * search map showing every place drew a pin 10.9km from its place, and
 * Al-Khiran's page — whose nearest neighbours are tens of kilometres off, so
 * the frame spans 230km — drew one 24.5km out. Both looked completely normal.
 *
 * So the invariant under test is stated on the ground, not on the screen:
 * NO PIN IS EVER DRAWN MORE THAN `MAX_PIN_SHIFT_M` FROM THE PLACE IT NAMES.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Load the real modules rather than reimplementing them, so this can never
 *  quietly disagree with what the app ships. */
const tmp = mkdtempSync(join(tmpdir(), "wain-map-"));
const bundle = (rel, name) => {
  const out = join(tmp, name);
  execSync(
    `npx -y esbuild ${JSON.stringify(join(ROOT, rel))} --bundle --format=esm ` +
      `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(out)} --log-level=error`,
    { cwd: ROOT, stdio: "pipe" }
  );
  return pathToFileURL(out).href;
};
const M = await import(bundle("src/lib/map-frame.ts", "map-frame.mjs"));
const { places } = await import(bundle("src/lib/places.ts", "places.mjs"));
rmSync(tmp, { recursive: true, force: true });

const {
  fitFrame, fitFrameAround, project, unproject, spreadPins,
  zoomFrame, centreFrame, frameWidthMetres, pinShiftCap, MAX_PIN_SHIFT_M,
} = M;

/**
 * The pin's reach above its own coordinate, in px — `pinHeadroom` in MapPin.
 *
 * Reimplemented here rather than imported because MapPin is a client component
 * and bundling it would drag React in for one multiplication. The shape of the
 * formula is asserted against the component's source further down, so the two
 * cannot drift apart in silence.
 */
const pinHeadroom = (size) => (size + Math.round(size * 0.34) * Math.SQRT1_2) * 1.1;
/** What the two maps actually pass. */
const SEARCH_PIN_PX = 32;
const NEAR_PIN_PX = 26;

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? `\n      ${d}` : ""}`); }
};

const R = 6_371_000;
const rd = (x) => (x * Math.PI) / 180;
const metres = (a, b) => {
  const dl = rd(b.lat - a.lat), dg = rd(b.lng - a.lng);
  const h =
    Math.sin(dl / 2) ** 2 +
    Math.cos(rd(a.lat)) * Math.cos(rd(b.lat)) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const CATS = [...new Set(places.map((p) => p.category))];
/** Real frame widths: smallest phone, common phones, tablet, desktop column. */
const WIDTHS = [320, 358, 390, 540, 720, 1100];

/**
 * The worst displacement, in metres, over one rendered map.
 * `capped: false` reproduces the old behaviour, which is what makes the
 * invariant test below meaningful rather than vacuous.
 */
function displacement(pts, frameW, pinPx, { capped = true, around = null } = {}) {
  const maxAspect = frameW < 420 ? 1.7 : 2.4;
  // The same headroom the components ask for, so this measures what ships.
  const headroom = pinHeadroom(around ? NEAR_PIN_PX : SEARCH_PIN_PX);
  const f = around
    ? fitFrameAround(around, pts.filter((p) => p !== around), { maxAspect, padding: 1.25, headroom, frameW })
    : fitFrame(pts, { maxAspect, headroom, frameW });
  const raw = pts.map((p) => project(f, p));
  const size = pinPx / frameW;
  const out = spreadPins(raw, size, f.aspect, capped ? pinShiftCap(f, size) : size);
  const width = frameWidthMetres(f);
  let worst = 0, who = null, moved = 0;
  out.forEach((o, i) => {
    const dx = o.x - raw[i].x;
    const dy = (o.y - raw[i].y) / f.aspect; // both in units of frame width
    const shift = Math.hypot(dx, dy) * width;
    if (shift > 1e-6) moved++;
    if (shift > worst) { worst = shift; who = pts[i].slug; }
  });
  return { worst, who, moved, width, frame: f, out, raw };
}

console.log("\n── the projection is exact ──");
{
  const f = fitFrame(places);
  let worst = 0, who = null;
  for (const p of places) {
    const q = project(f, p);
    const back = unproject(f, q.x, q.y);
    const e = metres(p, back);
    if (e > worst) { worst = e; who = p.slug; }
  }
  ok(`project → unproject round-trips to under a millimetre (worst ${worst.toExponential(2)}m, ${who})`,
    worst < 0.001, `${worst}m`);

  const inside = places.every((p) => {
    const q = project(f, p);
    return q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1;
  });
  ok("every place lands inside its own frame", inside);

  const hav = metres(unproject(f, 0, 0.5), unproject(f, 1, 0.5));
  const err = Math.abs(frameWidthMetres(f) - hav) / hav;
  ok(`frameWidthMetres agrees with haversine to 0.1% (${(err * 100).toFixed(4)}%)`, err < 0.001);
}

console.log("\n── the frame keeps the shape it promises ──");
{
  const f = fitFrame(places);
  // The embed fits the bbox to the frame; if the two aspects disagree, every
  // overlaid pin is wrong. So the bbox must actually BE f.aspect.
  const [w, s, e, n] = f.bbox.split(",").map(Number);
  const bboxAspect =
    (rd(e) - rd(w)) /
    (Math.log(Math.tan(Math.PI / 4 + rd(n) / 2)) - Math.log(Math.tan(Math.PI / 4 + rd(s) / 2)));
  ok(`bbox aspect matches frame aspect (${bboxAspect.toFixed(6)} vs ${f.aspect.toFixed(6)})`,
    Math.abs(bboxAspect - f.aspect) < 1e-9);

  const z = zoomFrame(f, 2);
  ok("zoomFrame keeps the aspect", Math.abs(z.hx / z.hy - f.aspect) < 1e-9);
  const c = centreFrame(f, { lat: 29.37, lng: 47.98 });
  ok("centreFrame keeps the half-spans", c.hx === f.hx && c.hy === f.hy);
}

console.log("\n── no pin is drawn far from its place ──");
{
  // Search maps: every category, and the whole catalogue, at every width.
  let worst = 0, where = null, checks = 0;
  for (const set of [places, ...CATS.map((c) => places.filter((p) => p.category === c))]) {
    if (!set.length) continue;
    for (const w of WIDTHS) {
      const d = displacement(set, w, 32);
      checks++;
      if (d.worst > worst) { worst = d.worst; where = `${d.who} @${w}px`; }
    }
  }
  ok(`search maps: worst ${worst.toFixed(1)}m over ${checks} frames (cap ${MAX_PIN_SHIFT_M}m)`,
    worst <= MAX_PIN_SHIFT_M + 1e-6, `${worst}m at ${where}`);

  // Place pages: subject plus its four nearest, which is what the page shows.
  let pWorst = 0, pWhere = null;
  for (const p of places) {
    const near = places
      .filter((q) => q !== p)
      .map((q) => ({ q, d: metres(p, q) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((x) => x.q);
    for (const w of WIDTHS) {
      const d = displacement([p, ...near], w, 40, { around: p });
      if (d.worst > pWorst) { pWorst = d.worst; pWhere = `${p.slug} @${w}px`; }
    }
  }
  ok(`place pages: worst ${pWorst.toFixed(1)}m over ${places.length * WIDTHS.length} frames`,
    pWorst <= MAX_PIN_SHIFT_M + 1e-6, `${pWorst}m at ${pWhere}`);
}

console.log("\n── the test can actually fail ──");
{
  // Without the cap the violation must reappear, or the two assertions above
  // prove nothing. These are the exact numbers the fix was written against.
  const uncapped = displacement(places, 358, 32, { capped: false });
  ok(`uncapped, a phone search map still misplaces a pin by kilometres (${(uncapped.worst / 1000).toFixed(2)}km)`,
    uncapped.worst > 1000, `only ${uncapped.worst.toFixed(0)}m — the guard may no longer be reachable`);

  const khiran = places.find((p) => p.slug === "khiran");
  if (khiran) {
    const near = places
      .filter((q) => q !== khiran)
      .map((q) => ({ q, d: metres(khiran, q) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((x) => x.q);
    const u = displacement([khiran, ...near], 358, 40, { capped: false, around: khiran });
    ok(`uncapped, Al-Khiran's page misplaces a pin by kilometres (${(u.worst / 1000).toFixed(2)}km)`,
      u.worst > 1000, `only ${u.worst.toFixed(0)}m`);
  }
}

console.log("\n── the cap tightens the nudge without disabling it ──");
{
  // The point of spreading is that stacked pins can be tapped. A cap that
  // stopped separating anything would pass the invariant and break the map.
  const before = displacement(places, 358, 32, { capped: false });
  const after = displacement(places, 358, 32);
  ok(`the same pins still separate (${after.moved} moved, was ${before.moved})`,
    after.moved >= before.moved * 0.9 && after.moved > 0,
    `${after.moved} vs ${before.moved}`);

  // The tightest real pair — Grand Mosque and Liberation Tower, 68m apart —
  // is what MAX_PIN_SHIFT_M was sized for, so it must still come apart.
  const pair = ["grand-mosque", "liberation-tower"].map((s) => places.find((p) => p.slug === s));
  if (pair.every(Boolean)) {
    const d = displacement(pair, 358, 40, { around: pair[0] });
    const gap = Math.hypot(d.out[0].x - d.out[1].x, (d.out[0].y - d.out[1].y) / d.frame.aspect);
    ok(`the closest pair (68m apart) still separates by a full pin (${(gap * 358).toFixed(0)}px)`,
      gap >= 40 / 358 - 1e-9, `${(gap * 358).toFixed(1)}px`);
  }
}

console.log("\n── pins stay put and stay stable ──");
{
  // Nothing collides in a small spread set, so positions must be exact.
  const four = places.filter((p) => p.category === "landmarks").slice(0, 4);
  const d = displacement(four, 1100, 32);
  ok("a well-spread set is not moved at all", d.moved === 0, `${d.moved} moved`);

  // Same input, same output — the coincident-point tiebreak is index-based on
  // purpose, so a re-render must not shuffle the map.
  const a = displacement(places, 390, 32).out;
  const b = displacement(places, 390, 32).out;
  ok("spreading is deterministic", a.every((p, i) => p.x === b[i].x && p.y === b[i].y));

  // Every pin, moved or not, must still be inside the frame.
  const all = displacement(places, 390, 32);
  const inside = all.out.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1.0001);
  ok("no pin is pushed outside the frame", inside);
}

console.log("\n── the frame stays a real place on Earth ──");
{
  // The picker's − button doubles the half-span per press, and it had a floor
  // and no ceiling. Fifteen presses took the east edge to 273° — not a wide
  // map, an invalid one, handed to the OSM embed as fact.
  const start = fitFrame([{ lat: 29.3759, lng: 47.9774 }], { minAspect: 1.6, maxAspect: 1.6 });
  let z = start;
  for (let i = 0; i < 40; i++) z = zoomFrame(z, 2);
  const [w, s, e, n] = z.bbox.split(",").map(Number);
  ok("forty presses of «تصغير» still describe a real bbox",
    w >= -180 && e <= 180 && s >= -90 && n <= 90 && Number.isFinite(w + s + e + n),
    `W=${w.toFixed(1)} S=${s.toFixed(1)} E=${e.toFixed(1)} N=${n.toFixed(1)}`);

  // The ceiling clamps hx and DERIVES hy, because clamping the two separately
  // is exactly how a bbox stops matching its frame and every pin drifts.
  const bboxAspect = (M.rad(e) - M.rad(w)) / (M.mercY(n) - M.mercY(s));
  ok("and the aspect survives the clamp", Math.abs(bboxAspect - z.aspect) < 1e-9,
    `${bboxAspect.toFixed(6)} vs ${z.aspect.toFixed(6)}`);

  ok("zooming in still zooms in", zoomFrame(start, 0.5).hx < start.hx);
  ok("in then out is lossless", zoomFrame(zoomFrame(start, 0.5), 2).hx === start.hx);
}

console.log("\n── no points is a mistake, and it says so ──");
{
  // Math.min(...[]) is Infinity and Math.max(...[]) is -Infinity, so this used
  // to return a centre of NaN and reach the iframe as bbox=NaN,NaN,NaN,NaN — a
  // blank map with nothing anywhere saying why. Unreachable today: SearchMap
  // guards it twice and the other two callers always pass a point.
  let threw = false;
  try { fitFrame([]); } catch { threw = true; }
  ok("fitFrame([]) throws instead of returning NaN", threw);

  const live = [
    ["SearchMap", "src/components/SearchMap.tsx"],
    ["PlaceMapFrame", "src/components/PlaceMapFrame.tsx"],
    ["CoordinatePicker", "src/components/CoordinatePicker.tsx"],
  ];
  const src = (p) => readFileSync(join(ROOT, p), "utf8");
  ok("SearchMap still guards the empty case it can actually hit",
    /places\.length && frameW > 0/.test(src(live[0][1])) && /places\.length === 0\) return null/.test(src(live[0][1])));
  ok("and no caller was left throwing at a visitor",
    !/fitFrame\(\s*\[\s*\]/.test(live.map(([, p]) => src(p)).join("\n")));
}

console.log("\n── there is room above the top pin for the pin ──");
{
  /**
   * A pin points at its place from above it, so the frame has to hold the pin
   * and not only the point. It did not, and the browser measurement said so:
   * 79 of 438 drawn pins were cut off by the top of their own frame, the worst
   * losing 23 of its 32 pixels — always the northernmost result, which is a
   * place the search had just decided was worth showing.
   *
   * Stated in pixels because that is what clips: the pin is a fixed size and
   * the frame is not.
   */
  const clearanceTop = (f, pts, frameW) => {
    const h = frameW / f.aspect;
    return Math.min(...pts.map((p) => project(f, p).y)) * h;
  };
  const clearanceBottom = (f, pts, frameW) => {
    const h = frameW / f.aspect;
    return (1 - Math.max(...pts.map((p) => project(f, p).y))) * h;
  };

  const SETS = [places, ...CATS.map((c) => places.filter((p) => p.category === c))].filter((s) => s.length);
  const want = pinHeadroom(SEARCH_PIN_PX);

  let worstShort = 0, shortWhere = null, escaped = 0, worstGrowth = 1, growthWhere = null;
  let bareShort = 0; // the same measurement with the fix removed
  for (const set of SETS) {
    for (const w of WIDTHS) {
      const maxAspect = w < 420 ? 1.7 : 2.4;
      const bare = fitFrame(set, { maxAspect });
      const f = fitFrame(set, { maxAspect, headroom: want, frameW: w });

      const short = want - clearanceTop(f, set, w);
      if (short > worstShort) { worstShort = short; shortWhere = `${set.length} places @${w}px`; }
      bareShort = Math.max(bareShort, want - clearanceTop(bare, set, w));

      // Making room must not push a place out of the picture, at either end.
      if (set.some((p) => { const q = project(f, p); return q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1; })) escaped++;
      if (clearanceBottom(f, set, w) < -1e-6) escaped++;

      const growth = f.hx / bare.hx;
      if (growth > worstGrowth) { worstGrowth = growth; growthWhere = `${set.length} places @${w}px`; }
    }
  }

  ok(`every search frame clears ${want.toFixed(0)}px above its top pin (worst short by ${worstShort.toFixed(1)}px)`,
    worstShort <= 0.5, `${worstShort.toFixed(1)}px at ${shortWhere}`);
  ok(`and without it the top pin is cut off (short by ${bareShort.toFixed(1)}px)`,
    bareShort > 5, `only ${bareShort.toFixed(1)}px — the guard may no longer be reachable`);
  ok("no place is pushed out of the frame to make the room", escaped === 0, `${escaped} frames`);
  // The room is taken from the bottom margin before it is taken from the zoom,
  // so the common case must cost no detail worth speaking of.
  ok(`the view is barely widened for it (worst ×${worstGrowth.toFixed(3)})`,
    worstGrowth < 1.25, `×${worstGrowth.toFixed(3)} at ${growthWhere}`);

  // Place pages: the subject is centred BECAUSE the page asks where it is, so
  // this is the one frame that may not slide to find its headroom.
  let offCentre = 0, pShort = 0;
  const nearWant = pinHeadroom(NEAR_PIN_PX);
  for (const p of places) {
    const near = places
      .filter((q) => q !== p)
      .map((q) => ({ q, d: metres(p, q) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((x) => x.q);
    for (const w of WIDTHS) {
      const f = fitFrameAround(p, near, { maxAspect: w < 420 ? 1.7 : 2.4, padding: 1.25, headroom: nearWant, frameW: w });
      const q = project(f, p);
      offCentre = Math.max(offCentre, Math.abs(q.x - 0.5), Math.abs(q.y - 0.5));
      pShort = Math.max(pShort, nearWant - clearanceTop(f, [p, ...near], w));
    }
  }
  ok(`the place page keeps its subject dead centre (worst ${offCentre.toExponential(1)} of the frame)`,
    offCentre < 1e-9, `${offCentre}`);
  ok(`and still clears ${nearWant.toFixed(0)}px above its top neighbour (worst short by ${pShort.toFixed(1)}px)`,
    pShort <= 0.5, `${pShort.toFixed(1)}px`);

  // The bbox is what the embed draws; if the room were added to one axis only,
  // the ground would stop matching the pins over it.
  const f = fitFrame(places, { maxAspect: 1.7, headroom: want, frameW: 390 });
  const [W, S, E, N] = f.bbox.split(",").map(Number);
  const bboxAspect =
    (rd(E) - rd(W)) /
    (Math.log(Math.tan(Math.PI / 4 + rd(N) / 2)) - Math.log(Math.tan(Math.PI / 4 + rd(S) / 2)));
  ok("the bbox still matches the frame it made room in",
    Math.abs(bboxAspect - f.aspect) < 1e-9, `${bboxAspect} vs ${f.aspect}`);

  // Asking for the impossible must degrade, not produce a map of the region.
  const silly = fitFrame(places, { maxAspect: 1.7, headroom: 100_000, frameW: 390 });
  ok("an absurd headroom is capped rather than obeyed",
    silly.hx / fitFrame(places, { maxAspect: 1.7 }).hx < 4,
    `×${(silly.hx / fitFrame(places, { maxAspect: 1.7 }).hx).toFixed(1)}`);

  // The number above is the pin's own geometry. If MapPin's changes and this
  // does not, the frame quietly stops making room for the thing it draws.
  const pinSrc = readFileSync(join(ROOT, "src/components/MapPin.tsx"), "utf8");
  ok("pinHeadroom is still the head plus half the nose's diagonal, hovered",
    /return \(size \+ Math\.round\(size \* 0\.34\) \* Math\.SQRT1_2\) \* HOVER_SCALE;/.test(pinSrc) &&
    /HOVER_SCALE = 1\.1/.test(pinSrc));
  ok("and both maps ask the frame for it",
    /headroom: pinHeadroom\(PIN_PX\)/.test(readFileSync(join(ROOT, "src/components/SearchMap.tsx"), "utf8")) &&
    /headroom: pinHeadroom\(NEAR_PIN_PX\)/.test(readFileSync(join(ROOT, "src/components/PlaceMapFrame.tsx"), "utf8")));
}

console.log("\n── clicking the picker means what it says ──");
{
  // Nothing covered this, and it is the only map that WRITES data: a wrong
  // unproject here puts a business's pin in the wrong place permanently.
  const P = { lat: 29.3759, lng: 47.9774 };
  const f = fitFrame([P], { minAspect: 1.6, maxAspect: 1.6 });
  ok("a click at dead centre returns the centre", metres(P, unproject(f, 0.5, 0.5)) < 0.01,
    `${metres(P, unproject(f, 0.5, 0.5)).toFixed(4)}m`);

  let worst = 0;
  for (const frame of [f, zoomFrame(f, 0.5), zoomFrame(f, 2), centreFrame(f, { lat: 29.1, lng: 48.1 })])
    for (const x of [0, 0.13, 0.5, 0.87, 1])
      for (const y of [0, 0.13, 0.5, 0.87, 1]) {
        const back = project(frame, unproject(frame, x, y));
        worst = Math.max(worst, Math.abs(back.x - x), Math.abs(back.y - y));
      }
  ok("click → coordinate → pin round-trips through zoom and re-centre",
    worst < 1e-9, `worst ${worst.toExponential(2)} of the frame`);
}

console.log(
  `\n${fails.length ? "✗" : "✓"} map-frame: ${pass} passed` +
    (fails.length ? `, ${fails.length} failed\n  ${fails.join("\n  ")}` : "")
);
process.exit(fails.length ? 1 : 0);
