#!/usr/bin/env node
// Every part in the catalogue must be reachable in the garage.
//
//   npm run check:parts
//
// A part that exists in mods.ts and in none of the garage's tab lists is
// money the player cannot spend and a feature nobody can find. It is not
// a loud failure either: the shop simply renders without it, and nothing
// anywhere says so. That is exactly what happened to the exhaust tiers
// the moment they moved out of the internals section into their own
// category — three parts, priced and described, invisible.
//
// Static on purpose: this is a question about two source files agreeing,
// and it should answer in milliseconds without a browser.

import { readFileSync } from "node:fs";

const mods = readFileSync("src/game/mods.ts", "utf8");
const garage = readFileSync("src/app/race/Garage.tsx", "utf8");

// Categories that actually have parts in them.
const partCats = new Map();
for (const m of mods.matchAll(/\{\s*id:\s*"([^"]+)",\s*cat:\s*"([^"]+)"/g)) {
  const [, id, cat] = m;
  if (!partCats.has(cat)) partCats.set(cat, []);
  partCats.get(cat).push(id);
}

// Categories the garage renders a section for.
const shown = new Set(
  [...garage.matchAll(/\{\s*cat:\s*"([^"]+)",\s*label:/g)].map((m) => m[1])
);

const fail = [];
for (const [cat, ids] of partCats) {
  if (!shown.has(cat)) {
    fail.push(`"${cat}" has ${ids.length} part(s) and no section in the garage: ${ids.join(", ")}`);
  }
}
for (const cat of shown) {
  if (!partCats.has(cat)) fail.push(`the garage renders a "${cat}" section with no parts in it`);
}

console.log(
  `${[...partCats.values()].flat().length} parts in ${partCats.size} categories, ` +
    `${shown.size} sections in the garage`
);
if (fail.length) {
  console.error(`\n${fail.length} unreachable:\n`);
  for (const f of fail) console.error(`  ${f}`);
  console.error(`\nAdd the category to PERFORMANCE_CATS or STYLE_CATS in Garage.tsx.`);
  process.exit(1);
}
console.log("every part is reachable in the garage.");
