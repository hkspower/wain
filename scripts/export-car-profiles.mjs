#!/usr/bin/env node
// Regenerates tools/blender/profiles.json from src/game/cars.ts — the
// single source of truth for the car silhouettes. The Blender build
// (tools/blender/build_assets.py) lofts these exact profiles, so the
// authored shells land on the same STYLE_DIMS anchors the procedural
// detailing uses.
//
//   node scripts/export-car-profiles.mjs
//   npm run sync:models   (once wired into package.json)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// Comments go first: a ')' inside an inline comment would otherwise fool
// the paren-matching walk below into truncating a call mid-argument.
const src = readFileSync("src/game/cars.ts", "utf8").replace(/\/\/[^\n]*/g, "");

/** Parse one `const <name> = extrudeProfile([...], width, bevel[, bottom]);` */
function parseGeo(name) {
  const at = src.indexOf(`const ${name} = extrudeProfile(`);
  if (at < 0) throw new Error(`${name} not found`);
  const open = src.indexOf("(", at);
  // Walk to the matching close paren so nested brackets don't fool us
  let depth = 0;
  let end = open;
  for (; end < src.length; end++) {
    if (src[end] === "(") depth++;
    else if (src[end] === ")" && --depth === 0) break;
  }
  const body = src.slice(open + 1, end);

  const points = [...body.matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)].map(
    ([, x, y]) => [+x, +y]
  );
  if (points.length < 4) throw new Error(`${name}: only ${points.length} points`);

  // Trailing scalars after the points array: width, bevel, optional bottom
  const tailStart = body.lastIndexOf("]");
  const tail = [...body.slice(tailStart + 1).matchAll(/(-?[\d.]+)/g)].map(([v]) => +v);
  if (tail.length < 2) throw new Error(`${name}: missing width/bevel`);
  const [width, bevel, bottom = 2] = tail;
  return { points, width, bevel, bottom };
}

const styles = {
  sedan: { body: "bodyGeo", canopy: "canopyGeo", roof: "roofGeo" },
  zx: { body: "zxBodyGeo", canopy: "zxCanopyGeo", roof: "zxRoofGeo" },
  gtr: { body: "gtrBodyGeo", canopy: "gtrCanopyGeo", roof: "gtrRoofGeo" },
  rx7: { body: "rx7BodyGeo", canopy: "rx7CanopyGeo", roof: "rx7RoofGeo" },
};

const out = {};
for (const [style, geos] of Object.entries(styles)) {
  out[style] = {};
  for (const [part, name] of Object.entries(geos)) {
    out[style][part] = parseGeo(name);
  }
}

// The rig goes in the same file. The authored driver parts — helmet,
// gloves, the wheel rim, the pedal faces — have to land exactly on the
// joints the IK solves, so Blender reads the bone lengths and joint
// offsets from src/game/rig.ts rather than carrying its own copy. Same
// evaluated-literal trick the UE5 generator uses: the file holds
// expressions (`Math.PI * 0.72`) that a regex cannot read.
const rigSrc = readFileSync("src/game/rig.ts", "utf8");
const rigBody = rigSrc.match(/export const RIG = (\{[\s\S]*?\n\}) as const;/)?.[1];
if (!rigBody) throw new Error("rig parse failed: no `export const RIG = {...} as const;`");
out.rig = new Function(`"use strict"; return ${rigBody};`)();

mkdirSync("tools/blender", { recursive: true });
writeFileSync("tools/blender/profiles.json", JSON.stringify(out, null, 1) + "\n");
// Styles only — `out` also carries the rig block, whose groups have no
// profile points.
const n = Object.keys(styles).reduce(
  (a, style) => a + Object.values(out[style]).reduce((b, g) => b + g.points.length, 0),
  0
);
console.log(
  `profiles.json regenerated: ${Object.keys(out).length - 1} styles, ${n} profile points, ` +
    `${Object.values(out.rig).reduce((a, g) => a + Object.keys(g).length, 0)} rig constants.`
);
