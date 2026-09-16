// The Blender pipeline covers every car, not just the ones it already
// shipped a shell for.
//
//   npm run check:blender
//
// scripts/export-car-profiles.mjs used to hardcode four silhouettes —
// sedan, zx, gtr, rx7 — because those were the four that already had a
// GLB. Storm S8 (super), Jahra Pickup (pickup), Anniversary 30 (pony),
// Gulf Coupe RS and Sharq Hatch (hatch) were five cars on a body style
// the exporter had never heard of: their extrudeProfile calls in
// cars.ts could break outright and profiles.json would keep reporting
// success, because the four-style map never asked to read them.
//
// This checks three things have to agree, the same way the rig's
// flattening rule is checked in three places at once (see rig.ts):
//
//   1. every style a car in the catalogue actually wears has a Blender
//      profile (export-car-profiles.mjs's `styles` map);
//   2. every style with a profile is in build_assets.py's own default
//      --styles list, and nothing is in one list and not the other;
//   3. every style wired into models.ts's AUTHORED_SHELLS — the ones
//      the game will actually try to fetch a GLB for — has that GLB
//      sitting on disk. This is the 404-per-car-per-load the comment
//      above AUTHORED_SHELLS warns about, checked instead of hoped for.
//
// Static and fast: no bpy, no browser, no dev server. It cannot prove a
// GLB's geometry is correct — that needs an actual Blender run and
// tools/shots/shelldrift.mjs — but it proves the pipeline was TOLD
// about every car, which is the failure that skipped four styles for
// as long as nobody went looking.

import { readFileSync, existsSync, readdirSync } from "node:fs";

const carsSrc = readFileSync("src/game/cars.ts", "utf8");
const modsSrc = readFileSync("src/game/mods.ts", "utf8");
const exporterSrc = readFileSync("scripts/export-car-profiles.mjs", "utf8");
const buildPy = readFileSync("tools/blender/build_assets.py", "utf8");
const modelsSrc = readFileSync("src/game/models.ts", "utf8");

const fail = [];
const bad = (m) => fail.push(m);

/**
 * From the first `open` after the `=` that follows `needle`, to its
 * matching `close`, inclusive — `{`/`}` for an object literal, `[`/`]`
 * for an array. Searching from the `=` rather than from `needle`
 * itself matters for `export const CARS: CarModel[] = [...]`: the type
 * annotation's own empty `[]` sits between the name and the value, and
 * would otherwise be mistaken for the array literal it is annotating.
 */
function block(src, needle, open = "{", close = "}") {
  const at = src.indexOf(needle);
  if (at < 0) throw new Error(`"${needle}" not found`);
  const eq = src.indexOf("=", at);
  const o = src.indexOf(open, eq);
  let depth = 0, end = o;
  for (; end < src.length; end++) {
    if (src[end] === open) depth++;
    else if (src[end] === close && --depth === 0) break;
  }
  return src.slice(o, end + 1);
}

// ---- What BodyStyle the fleet is allowed to declare -------------------
const bodyStyleUnion = [
  ...carsSrc.match(/export type BodyStyle =[\s\S]*?;/)[0].matchAll(/"([a-z0-9]+)"/g),
].map((m) => m[1]);

// ---- What every car in the catalogue actually wears --------------------
// Split CARS' top-level objects by brace depth rather than by a per-car
// regex: a nested object (colours, a livery flag) contains `id:`-shaped
// text too, and the split has to stop at the FIRST closing brace back
// to depth zero, not the next `id:` it happens to see.
const carsArray = block(modsSrc, "export const CARS", "[", "]");
const carEntries = [];
{
  let depth = 0, start = -1;
  for (let i = 0; i < carsArray.length; i++) {
    const c = carsArray[i];
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) { carEntries.push(carsArray.slice(start, i + 1)); start = -1; } }
  }
}
const usedByStyle = new Map(); // style -> [car id, ...]
for (const entry of carEntries) {
  const id = entry.match(/id:\s*"([^"]+)"/)?.[1] ?? "(unnamed car)";
  // The game's own default — mods.ts: `bodyStyle: car.style ?? "sedan"`.
  const style = entry.match(/\bstyle:\s*"([^"]+)"/)?.[1] ?? "sedan";
  if (!usedByStyle.has(style)) usedByStyle.set(style, []);
  usedByStyle.get(style).push(id);
}
if (carEntries.length === 0) bad("found no cars in the CARS array — the brace walk broke");

// ---- What the Blender profile pipeline covers --------------------------
const stylesBlock = block(exporterSrc, "const styles = {");
const profileStyles = [...stylesBlock.matchAll(/^\s{2}([a-z0-9]+):\s*\{\s*body:/gm)].map((m) => m[1]);

// ---- What build_assets.py builds by default -----------------------------
const buildDefault = buildPy.match(/--styles",\s*default="([^"]+)"/)?.[1]?.split(",") ?? [];

// ---- What the game will actually fetch a GLB for, and what is on disk --
const authoredMatch = modelsSrc.match(/AUTHORED_SHELLS[^=]*=\s*new Set<BodyStyle>\(\[([^\]]*)\]\)/);
const authoredShells = authoredMatch ? [...authoredMatch[1].matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]) : [];
const onDisk = existsSync("public/models")
  ? readdirSync("public/models").filter((f) => /^car-[a-z0-9]+\.glb$/.test(f)).map((f) => f.slice(4, -4))
  : [];

// -------------------------------------------------------------- checks --

// 1. Every style a car wears has a profile.
for (const [style, ids] of usedByStyle) {
  if (!profileStyles.includes(style)) {
    bad(
      `${ids.length} car(s) on the "${style}" silhouette (${ids.join(", ")}) and ` +
        `scripts/export-car-profiles.mjs's styles map has no profile for it`
    );
  }
}
// A profile nobody drives is not a bug — a style can be added ahead of
// its first car — so this direction is a report, not a failure.
const profileOnly = profileStyles.filter((s) => !usedByStyle.has(s));

// 2. The profile map and build_assets.py's default agree, both ways.
for (const s of profileStyles) {
  if (!buildDefault.includes(s)) {
    bad(`"${s}" has a Blender profile and tools/blender/build_assets.py's default --styles does not build it`);
  }
}
for (const s of buildDefault) {
  if (!profileStyles.includes(s)) {
    bad(`tools/blender/build_assets.py's default --styles builds "${s}" and export-car-profiles.mjs has no profile for it`);
  }
}

// 3. Every style the game will fetch a shell for has that shell on disk.
for (const s of authoredShells) {
  if (!onDisk.includes(s)) {
    bad(`models.ts wires up an authored shell for "${s}" and public/models/car-${s}.glb is not on disk — that is a 404 per car per load`);
  }
}
// The reverse — a GLB on disk that AUTHORED_SHELLS never asks for — is
// dead weight, not a break, so it is reported alongside the summary
// rather than failed.
const shippedNotWired = onDisk.filter((s) => !authoredShells.includes(s));

// ------------------------------------------------------------- report --
const usedStyles = [...usedByStyle.keys()];
console.log(
  `${carEntries.length} cars across ${usedStyles.length} of the fleet's ${bodyStyleUnion.length} declared body styles`
);
console.log(`profile pipeline   ${profileStyles.length}/${bodyStyleUnion.length} styles: ${profileStyles.sort().join(", ")}`);
console.log(`shipped on disk    ${onDisk.length}/${bodyStyleUnion.length} styles: ${onDisk.sort().join(", ") || "(none)"}`);
const stillProcedural = usedStyles.filter((s) => !authoredShells.includes(s)).sort();
if (stillProcedural.length) {
  const readyNotBuilt = stillProcedural.filter((s) => profileStyles.includes(s));
  console.log(
    `still procedural   ${stillProcedural.join(", ")}` +
      (readyNotBuilt.length
        ? ` (${readyNotBuilt.join(", ")} pipeline-ready — need bpy: pip install bpy && npm run sync:models)`
        : "")
  );
}
if (profileOnly.length) console.log(`unused profiles    ${profileOnly.join(", ")} — no car wears them yet`);
if (shippedNotWired.length) console.log(`shipped, not wired ${shippedNotWired.join(", ")} — GLB on disk, AUTHORED_SHELLS does not ask for it`);

console.log(
  fail.length
    ? `\n${fail.length} problem(s):\n - ${fail.join("\n - ")}`
    : "\nevery car's silhouette is covered by the Blender pipeline, and every authored shell the game asks for is on disk."
);
process.exit(fail.length ? 1 : 0);
