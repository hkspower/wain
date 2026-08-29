// Every painted roof caps the glass it sits on.
//
//   npm run test:roofline      (no browser, no dev server)
//
// THE LAW
//
// A roof meets the side glass at a rail and stops. The only glass that
// may show past the paint is the seal — 15 mm, once per side.
//
// WHAT IT IS FOR
//
// The six cabin widths and the six roof widths used to be twelve
// unrelated literals, and every roof had come out at about 89% of its
// glass. On the built cars that left 69 to 103 mm of window running the
// full length of every roof, down both sides, on every car in the game.
// Nobody typed that on purpose: it is what a pair of numbers that ought
// to be related but are typed apart turns into, six times over.
//
// So the roof is derived from the cabin, and this checks that it still
// is — statically, because the question is whether two numbers in one
// file agree, and that should answer in milliseconds rather than needing
// a browser to draw a car first.
//
// The built car is checked too, by tools/shots/glasshouse.mjs, which
// measures the shells that actually came out. This is the cheap guard
// that runs every time; that is the expensive one that proves the cheap
// one is measuring the right thing.

import { readFileSync } from "node:fs";

const src = readFileSync("src/game/cars.ts", "utf8");
const fail = [];

// The seal, and the rule that uses it.
const seal = src.match(/const ROOF_SEAL = ([\d.]+);/);
if (!seal) fail.push("ROOF_SEAL is gone — nothing says how much glass may show past a roof");
const rule = src.match(/const roofWidth = \(cabin: number\): number => ([^;]+);/);
if (!rule) fail.push("roofWidth is gone — the roofs are back to being typed by hand");

if (seal) {
  const mm = Number(seal[1]) * 1000;
  // A seal is a seal. Past a couple of centimetres it is a gap, and at
  // zero the glass and the paint fight for the same pixels.
  if (!(mm >= 5 && mm <= 25)) fail.push(`ROOF_SEAL is ${mm} mm, which is not a seal`);
  console.log(`seal        ${mm.toFixed(0)} mm of glass may show down each side of a roof`);
}
if (rule && !/cabin - ROOF_SEAL \* 2/.test(rule[1])) {
  fail.push(`roofWidth is "${rule[1].trim()}" — a roof is the cabin less a seal on EACH side`);
}

// Every cabin width is named, and every roof is derived from one.
const cabins = [...src.matchAll(/const (\w+_CABIN_W) = ([\d.]+);/g)].map((m) => m[1]);
console.log(`cabins      ${cabins.length}: ${cabins.join(", ")}`);
if (cabins.length < 6) fail.push(`only ${cabins.length} cabin widths are named; there are six silhouettes`);

// Each named cabin must be used exactly twice: once as the canopy's own
// width, once inside the roof's roofWidth(). A cabin used once has a
// roof that is still a hand-typed number somewhere.
for (const c of cabins) {
  const asCanopy = new RegExp(`^  ${c},$`, "m").test(src);
  const asRoof = src.includes(`roofWidth(${c})`);
  if (!asCanopy) fail.push(`${c} is declared and no canopy is built with it`);
  if (!asRoof) fail.push(`${c} has no roof derived from it — that roof is still a loose number`);
}

// And nothing may go back to a bare literal in a roof extrusion.
const roofGeos = [...src.matchAll(/^const (\w*[Rr]oofGeo) = extrudeProfile\(([\s\S]*?)^\);$/gm)];
console.log(`roofs       ${roofGeos.length} roof extrusions`);
if (roofGeos.length < 6) fail.push(`found ${roofGeos.length} roof extrusions, expected six`);
for (const [, name, body] of roofGeos) {
  if (!/roofWidth\(\w+_CABIN_W\)/.test(body)) {
    fail.push(`${name} sets its width by hand instead of from the cabin it caps`);
  }
}

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nevery roof is the width of the glass under it, less the seal"
);
process.exit(fail.length ? 1 : 0);
