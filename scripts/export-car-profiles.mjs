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

/**
 * Numbers cars.ts writes as names.
 *
 * extrudeProfile used to be called with literals — `1.92, 0.15, 2` —
 * and this walked the tail of the call picking numbers out with a
 * regex. It is called with BODY_EDGE and a crown spec now, so that walk
 * read the bevel as 2 (the bottom-point count) and the bottom as null,
 * and wrote both into profiles.json without complaining. The Blender
 * loft then built the fleet with a 140 mm edge that cars.ts had cut to
 * 50 mm nine commits earlier.
 */
function constant(name) {
  const m = src.match(new RegExp(`const ${name}(?::\\s*number)?\\s*=\\s*(-?[\\d.]+)\\s*;`));
  if (!m) throw new Error(`constant ${name} not found in cars.ts`);
  return +m[1];
}

/**
 * cars.ts's own numeric vocabulary, evaluated rather than pattern-matched.
 *
 * `scalar` below used to accept a literal or the name of one, and that
 * was true right up until a width was written as `roofWidth(SEDAN_CABIN_W)`
 * — a call, not a name. The exporter threw, `npm run sync:models` stopped
 * working, and because the throw was upstream of the Blender step nobody
 * got a stale-model warning: the GLBs simply stayed as they were, thirteen
 * days and a dozen shape changes behind the cars. Every authored shell in
 * the game was built from a profile the source no longer described.
 *
 * So the walk resolves the same way objectLiteral does, and for the same
 * reason it gives: a regex reading structure is a bug waiting to happen.
 * Each `const NAME = <rhs>;` in cars.ts is evaluated in a scope built
 * from the ones before it, and anything that does not come out a number
 * or a function — anything touching THREE, a texture, a mesh — throws
 * and is simply left out. The scope ends up holding cars.ts's numbers
 * and its small arithmetic helpers, which is exactly what a profile
 * argument is allowed to be made of.
 */
const SCOPE = (() => {
  const scope = Object.create(null);
  const decl = /(?:^|\n)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([^;]+);/g;
  for (const [, name, rhs] of src.matchAll(decl)) {
    // Types are erased by hand here: the arrow helpers carry them, and
    // `(cabin: number): number => …` is not valid JavaScript.
    const js = rhs.replace(/:\s*number/g, "");
    try {
      const keys = Object.keys(scope);
      const value = new Function(...keys, `"use strict"; return (${js});`)(
        ...keys.map((k) => scope[k])
      );
      if (typeof value === "number" ? Number.isFinite(value) : typeof value === "function") {
        scope[name] = value;
      }
    } catch {
      // Not arithmetic. Not our business.
    }
  }
  return scope;
})();

/** The whole CROWN_BY_STYLE table, evaluated rather than regexed: it is
 *  nested objects and a regex reading them is a bug waiting to happen. */
function objectLiteral(decl) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error(`${decl} not found`);
  const open = src.indexOf("{", at);
  let depth = 0, end = open;
  for (; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}" && --depth === 0) break;
  }
  return new Function(`"use strict"; return ${src.slice(open, end + 1)};`)();
}

/** How far the whole body sits down from where the profiles are written.
 *  extrudeProfile applies this to every point before it builds anything,
 *  so a profile exported without it describes a car 86 mm in the air —
 *  which is most of why the shipped shells stand above the game's own
 *  roofline. */
const BODY_DROP = constant("BODY_DROP");
const CROWN_BY_STYLE = objectLiteral("const CROWN_BY_STYLE");

/** Split a call's arguments on the commas BETWEEN them. */
function splitArgs(body) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "[" || c === "{" || c === "(") depth++;
    else if (c === "]" || c === "}" || c === ")") depth--;
    else if (c === "," && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
  }
  out.push(body.slice(start));
  return out.map((a) => a.trim()).filter((a) => a.length);
}

/** A scalar argument: a literal, the name of one, or an expression over
 *  cars.ts's own numbers — `roofWidth(SEDAN_CABIN_W)` is all three of
 *  those things at once. */
function scalar(text) {
  const t = text.trim();
  if (/^-?[\d.]+$/.test(t)) return +t;
  if (/^[A-Za-z_$][\w$]*$/.test(t) && typeof SCOPE[t] === "number") return SCOPE[t];
  const keys = Object.keys(SCOPE);
  let value;
  try {
    value = new Function(...keys, `"use strict"; return (${t.replace(/:\s*number/g, "")});`)(
      ...keys.map((k) => SCOPE[k])
    );
  } catch (e) {
    throw new Error(`cannot evaluate "${t}" from cars.ts: ${e.message}`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`"${t}" did not evaluate to a number (got ${value})`);
  }
  return value;
}

/** Parse one `const <name> = extrudeProfile([...], width, bevel, bottom, crown);` */
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
  const args = splitArgs(src.slice(open + 1, end));
  if (args.length < 3) throw new Error(`${name}: expected at least points, width, bevel`);
  const points = [...args[0].matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)].map(
    // Dropped, because extrudeProfile drops them. The loft has to build
    // the car the game builds, not the one the source was written for.
    ([, x, y]) => [+x, +(+y - BODY_DROP).toFixed(6)]
  );
  if (points.length < 4) throw new Error(`${name}: only ${points.length} points`);
  const width = scalar(args[1]);
  const bevel = scalar(args[2]);
  const bottom = args.length > 3 ? scalar(args[3]) : 2;
  // `CROWN_BY_STYLE.zx.canopy` — the cross-section the shell is given
  // after extrusion. models.ts applies it to an authored shell at load
  // time; a loft that bakes it in gets there without the vertex walk.
  const crownPath = args[4]?.trim().split(".").slice(1);
  const crown = crownPath ? crownPath.reduce((o, k) => o?.[k], CROWN_BY_STYLE) : null;
  if (args[4] && !crown) throw new Error(`${name}: cannot resolve crown ${args[4]}`);
  return { points, width, bevel, bottom, crown };
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
