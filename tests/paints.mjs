// The paint booth: distinct colours, all of them buyable, all of them named.
//
//   npm run test:paints      (no browser, no dev server)
//
// THE LAW THIS EXISTS FOR
//
// No two paints may be perceptually close. A colour wheel cut into
// twenty-four equal slices gives four blues nobody can tell apart on a
// dark road, which is one blue that cost four times — and it is the
// failure a palette drifts into one well-meant addition at a time,
// because each new colour is only compared against the one beside it in
// the file.
//
// MEASURED IN CIELAB, NOT IN HEX
//
// The distance between two hex triples is not a distance anybody sees.
// sRGB is not perceptually uniform: it spreads the greens out and packs
// the blues together, so a naive metric calls two navies far apart and
// two creams identical. That instrument would let exactly the palette
// this test exists to prevent pass with a clean bill.
//
// So: sRGB to linear, linear to XYZ under D65, XYZ to Lab, and CIEDE2000
// between the pairs. CIEDE2000 rather than the 1976 straight line
// because 76 is badly wrong in the saturated regions, which is where
// half of a car palette lives.

import {
  PAINTS, GLOWS, COVERS, PAINT_HEX, GLOW_HEX, COVER_HEX,
  CARBON_KG, NOMINAL_CAR_KG, swatch, paintFromSwatch, lab, deltaE,
} from "../src/game/paints.ts";
import { PARTS } from "../src/game/mods.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

// --- colour science ---------------------------------------------------

// The metric now lives in src/game/paints.ts, imported above: a tool
// that searches for a colour the wall does not already have needs the
// same CIEDE2000, and two copies of eighty lines of standard constants
// are two copies that can disagree.

// Sanity: the instrument before the measurement. A metric that says a
// colour differs from itself, or that black and white are close, is not
// measuring what it claims to and every number after it is noise.
{
  check(deltaE(0x336699, 0x336699) < 1e-9, "the metric says a colour differs from itself");
  const bw = deltaE(0x000000, 0xffffff);
  check(bw > 95, `the metric puts black and white only ${bw.toFixed(1)} apart`);
  // A known CIEDE2000 pair: these two greys are ~1 JND apart.
  const near = deltaE(0x808080, 0x848484);
  check(near > 0.5 && near < 4, `two near-identical greys measured ${near.toFixed(2)}`);
  console.log(`metric   self 0.00, black/white ${bw.toFixed(1)}, near-greys ${near.toFixed(2)}`);
}

// --- 1. No two paints are perceptually close --------------------------
//
// 12 is a comfortable margin above the ~2.3 that counts as one just
// noticeable difference on a screen you are looking at directly. A car
// is small, moving, lit by sodium, and half in shadow, so the margin has
// to be far wider than "a careful eye can tell in a lab".
const MIN_DE = 12;
{
  let worst = { d: Infinity, a: "", b: "" };
  for (let i = 0; i < PAINTS.length; i++) {
    for (let j = i + 1; j < PAINTS.length; j++) {
      const d = deltaE(PAINTS[i].hex, PAINTS[j].hex);
      if (d < worst.d) worst = { d, a: PAINTS[i].id, b: PAINTS[j].id };
      if (d < MIN_DE) {
        fail.push(
          `${PAINTS[i].id} and ${PAINTS[j].id} are only ${d.toFixed(1)} apart ` +
          `(${swatch(PAINTS[i].hex)} / ${swatch(PAINTS[j].hex)}) — that is one colour sold twice`
        );
      }
    }
  }
  const pairs = (PAINTS.length * (PAINTS.length - 1)) / 2;
  console.log(
    `paints   ${PAINTS.length} colours, ${pairs} pairs; closest is ` +
    `${worst.a} / ${worst.b} at dE ${worst.d.toFixed(1)} (floor ${MIN_DE})`
  );
}

// --- 2. Underglow, same law, its own floor ----------------------------
//
// Looser, because a neon is seen as light on tarmac rather than as a
// panel in daylight: it blooms, and two glows that measure close as
// pigment still read apart as a pool of colour under a car.
{
  let worst = { d: Infinity, a: "", b: "" };
  for (let i = 0; i < GLOWS.length; i++) {
    for (let j = i + 1; j < GLOWS.length; j++) {
      const d = deltaE(GLOWS[i].hex, GLOWS[j].hex);
      if (d < worst.d) worst = { d, a: GLOWS[i].id, b: GLOWS[j].id };
      if (d < 9) fail.push(`${GLOWS[i].id} and ${GLOWS[j].id} are only ${d.toFixed(1)} apart`);
    }
  }
  console.log(`glows    ${GLOWS.length} colours; closest ${worst.a} / ${worst.b} at dE ${worst.d.toFixed(1)}`);
}

// --- 2b. Engine covers, and why their floor is different --------------
//
// A cam cover is seen through a vent, in shadow, at roughly a hand's
// width. Six colours, and they only have to be told apart from each
// other — a cover is never seen beside a body panel closely enough for
// the two to be confused, so they are not measured against the paint.
{
  let worst = { d: Infinity, a: "", b: "" };
  for (let i = 0; i < COVERS.length; i++) {
    for (let j = i + 1; j < COVERS.length; j++) {
      const d = deltaE(COVERS[i].hex, COVERS[j].hex);
      if (d < worst.d) worst = { d, a: COVERS[i].id, b: COVERS[j].id };
      if (d < 12) {
        fail.push(`${COVERS[i].id} and ${COVERS[j].id} are only ${d.toFixed(1)} apart`);
      }
    }
  }
  console.log(`covers   ${COVERS.length} colours; closest ${worst.a} / ${worst.b} at dE ${worst.d.toFixed(1)}`);
}

// --- 2c. Carbon is bought for what it takes off -----------------------
{
  check(CARBON_KG.none === 0, "the steel option saves weight");
  check(CARBON_KG.full > CARBON_KG.panels, "Full Dry Carbon saves no more than the cheaper package");
  // Real panels, real numbers. A bonnet is 8-12 kg, a boot lid 6-8, mirror
  // caps under 2, a roof skin 10-14 — so a package is tens of kilos and
  // not hundreds. A hundred kilos off a road car is not a carbon bonnet,
  // it is a stripped interior and a different mod.
  check(CARBON_KG.panels >= 10 && CARBON_KG.panels <= 40, `the package saves ${CARBON_KG.panels} kg`);
  check(CARBON_KG.full <= 60, `full dry carbon claims ${CARBON_KG.full} kg, which is not bodywork`);
  check(NOMINAL_CAR_KG > 900 && NOMINAL_CAR_KG < 2200, `a nominal car weighs ${NOMINAL_CAR_KG} kg`);
  const gain = CARBON_KG.full / NOMINAL_CAR_KG;
  console.log(`carbon   ${CARBON_KG.panels} kg and ${CARBON_KG.full} kg off ${NOMINAL_CAR_KG} — up to ${(gain * 100).toFixed(1)}% lighter`);
  // The reason to buy it is the weave, not the lap time.
  check(gain < 0.06, `carbon is worth ${(gain * 100).toFixed(1)}%, which is a power part wearing a body kit's name`);
}

// --- 2d. The three finishes are three different objects ---------------
//
// Gloss is a mirror over flake; matte is pigment under a flat wrap;
// satin sits between. Each of those is a claim about MATERIAL numbers,
// and the one that was silently false for the whole life of the finish
// system was metalness: matte kept the paint's full metalness, and a
// metal has no diffuse term, so a matte car was a dim blue mirror of a
// suppressed environment instead of the colour anybody bought.
{
  const { FINISHES } = await import("../src/game/mods.ts");
  const g = FINISHES.gloss, sa = FINISHES.satin, m = FINISHES.matte;
  check(g.metalScale === 1, "gloss no longer keeps the measured metalness curve as-is");
  check(sa.metalScale < g.metalScale && sa.metalScale > m.metalScale,
    "satin does not sit between gloss and matte in metalness");
  check(m.metalScale <= 0.3,
    `matte keeps ${m.metalScale} of the paint's metalness — that is a mirror, not a pigment`);
  check(m.metalScale > 0,
    "matte at zero metalness loses the last of the flake; a wrap dulls it, it does not erase it");
  // The orderings the finishes have always promised, pinned so a future
  // tweak to one axis cannot quietly cross another.
  check(g.clearcoat > sa.clearcoat && sa.clearcoat > m.clearcoat, "clearcoat does not step down gloss>satin>matte");
  check(g.envScale > sa.envScale && sa.envScale > m.envScale, "env contribution does not step down gloss>satin>matte");
  check(m.roughnessAdd > sa.roughnessAdd && sa.roughnessAdd > g.roughnessAdd, "roughness does not step up gloss<satin<matte");
  console.log(
    `finishes metalness kept: gloss ${g.metalScale}, satin ${sa.metalScale}, matte ${m.metalScale}`
  );
}

// --- 3. Nothing is unbuyable, and nothing is unpaintable ---------------
//
// A swatch with no part is a colour nobody can have; a part with no
// swatch renders as whatever the fallback happens to be. Both are silent.
{
  const catalogue = new Set(PARTS.filter((p) => p.cat === "paint").map((p) => p.id));
  const glowParts = new Set(PARTS.filter((p) => p.cat === "glow").map((p) => p.id));
  const coverParts = new Set(PARTS.filter((p) => p.cat === "cover").map((p) => p.id));
  for (const c of COVERS) {
    check(coverParts.has(c.id), `${c.id} has a colour and nothing in the garage sells it`);
  }
  for (const id of coverParts) {
    if (id === "cover-none") continue; // the stock black cover has no chosen colour
    check(COVER_HEX[id] !== undefined, `the garage sells ${id} and no colour says what shade it is`);
  }
  for (const p of PAINTS) {
    check(catalogue.has(p.id), `${p.id} has a swatch and nothing in the garage sells it`);
  }
  for (const id of catalogue) {
    check(PAINT_HEX[id] !== undefined, `the garage sells ${id} and no swatch says what colour it is`);
  }
  for (const g of GLOWS) {
    check(glowParts.has(g.id), `${g.id} has a colour and nothing in the garage sells it`);
  }
  for (const id of glowParts) {
    if (id === "glow-none") continue; // the absence of a glow has no colour
    check(GLOW_HEX[id] !== undefined, `the garage sells ${id} and no colour says what it glows`);
  }
  console.log(`catalogue  ${catalogue.size} paints and ${glowParts.size - 1} glows, all matched both ways`);
}

// --- 4. Every one is named, in both languages, and priced -------------
{
  const byId = new Map(PARTS.map((p) => [p.id, p]));
  const names = new Set();
  for (const p of [...PAINTS, ...GLOWS, ...COVERS]) {
    const part = byId.get(p.id);
    if (!part) continue; // reported above
    check(part.name.trim().length > 0, `${p.id} has no English name`);
    check(/[؀-ۿ]/.test(part.ar), `${p.id} has no Arabic name ("${part.ar}")`);
    if (names.has(part.name)) fail.push(`two colours are both called "${part.name}"`);
    names.add(part.name);
    check(part.price >= 0 && part.price <= 600, `${p.id} costs ${part.price} KD`);
  }
  console.log(`names    ${names.size} distinct names, all bilingual, all priced`);
}

// --- 5. The swatch round trip -----------------------------------------
//
// The hub stores a colour as a CSS string. If swatch() and
// paintFromSwatch() disagree by so much as a case, every returning
// player's colour stops being recognised as one of the game's.
{
  for (const p of PAINTS) {
    const css = swatch(p.hex);
    check(/^#[0-9a-f]{6}$/.test(css), `${p.id} renders as "${css}"`);
    check(paintFromSwatch(css)?.id === p.id, `${p.id} did not survive the swatch round trip`);
    check(paintFromSwatch(css.toUpperCase())?.id === p.id, `${p.id} is not recognised in upper case`);
  }
  check(paintFromSwatch("#123456") === null, "an unknown colour was matched to a paint");
  check(paintFromSwatch("") === null, "an empty string was matched to a paint");
  console.log("swatches round trip in both cases, and an unknown colour stays unknown");
}

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nevery colour in the booth is one a player can tell from the others"
);
process.exit(fail.length ? 1 : 0);
