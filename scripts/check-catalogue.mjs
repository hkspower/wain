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
const engines = readFileSync("src/game/engines.ts", "utf8");

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

// The engine bay is the one place where a shop entry and a piece of
// physics are two separate objects that have to describe the same thing.
// A part with no spec sells the player an engine the sim has never heard
// of; a spec with no part is an engine nobody can buy. Both directions,
// because each fails silently on its own.
const specIds = [...engines.matchAll(/^\s{4}id: "([^"]+)",$/gm)].map((m) => m[1]);
const engineParts = (partCats.get("engine") ?? []).map((id) => id.replace(/^engine-/, ""));
for (const id of specIds) {
  if (!engineParts.includes(id)) {
    fail.push(`engines.ts defines "${id}" and the catalogue has no engine-${id} to buy it with`);
  }
}
for (const id of engineParts) {
  if (!specIds.includes(id)) {
    fail.push(`the catalogue sells engine-${id} and engines.ts has no such engine`);
  }
}

console.log(
  `${[...partCats.values()].flat().length} parts in ${partCats.size} categories, ` +
    `${shown.size} sections in the garage; ` +
    `${specIds.length} engines, all of them on sale`
);
if (fail.length) {
  console.error(`\n${fail.length} unreachable:\n`);
  for (const f of fail) console.error(`  ${f}`);
  if (fail.some((f) => f.includes("section"))) {
    console.error(`\nAdd the category to PERFORMANCE_CATS or STYLE_CATS in Garage.tsx.`);
  }
  if (fail.some((f) => f.includes("engine"))) {
    console.error(`\nEngine ids in engines.ts and "engine-<id>" parts in mods.ts must match.`);
  }
  process.exit(1);
}
console.log("every part is reachable in the garage.");
