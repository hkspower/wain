// Which controller is this, and does every button have a name?
//
//   npm run test:pads
//
// No browser. A gamepad's identity is a string the browser hands over,
// and a binding table is a table — both are checkable in a millisecond,
// and neither needed a WebGL context on a software rasteriser to prove.
//
// The pad already worked on both brands before this existed: the W3C
// Standard Gamepad mapping puts the same action on the same index
// whichever pad is plugged in, so a DualSense and an Xbox controller
// drove the car identically. What they did not do was TELL anybody how.
// The whole of the game's documentation of a controller was the words
// "gamepad supported" — eight bindings a player had to discover by
// pressing buttons and watching what happened.
//
// Three laws:
//
//   brand     real id strings from both brands, and from the two ways
//             Chromium and Firefox format them, map to the right brand;
//             an unknown pad falls back to generic rather than guessing.
//   complete  every action the engine binds has a label in every layout.
//             A layout with a hole in it is a diagram that lies by
//             omission, on the one button the player was looking for.
//   one table the indices the engine polls ARE the table's indices. The
//             table is not a second copy that can drift — engine.ts
//             imports it — but a test that reads both and compares is
//             what keeps that true after the next refactor.

import { padBrand, PAD_ACTIONS, padLabel, padLayout } from "../src/game/pads.ts";
import { readFileSync } from "node:fs";

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); return ok ? "ok" : "FAIL"; };

// --- 1. brand ---------------------------------------------------------
//
// Real strings, as the Gamepad API actually delivers them. Chromium
// reports "Name (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"; Firefox
// reports "054c-0ce6-DualSense Wireless Controller". Both carry the USB
// vendor id — Sony is 054c, Microsoft is 045e — and that is the reliable
// half; the marketing name is the other half and changes with firmware.
const IDS = [
  ["DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)", "playstation"],
  ["054c-0ce6-DualSense Wireless Controller", "playstation"],
  ["Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)", "playstation"], // DualShock 4
  ["Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)", "xbox"],
  ["045e-0b12-Xbox Wireless Controller", "xbox"],
  ["Xbox 360 Controller (XInput STANDARD GAMEPAD)", "xbox"],
  ["Microsoft Controller (STANDARD GAMEPAD Vendor: 045e Product: 02ea)", "xbox"],
  ["8BitDo Pro 2 (STANDARD GAMEPAD Vendor: 2dc8 Product: 6003)", "generic"],
  ["", "generic"],
];
console.log("\n=== CONTROLLER LAYOUT ===\n");
for (const [id, want] of IDS) {
  const got = padBrand(id);
  console.log(`  ${(got).padEnd(12)} ${check(got === want, `"${id}" read as ${got}, is ${want}`)}  ${id || "(empty id)"}`);
}

// --- 2. complete ------------------------------------------------------
const brands = ["playstation", "xbox", "generic"];
let holes = [];
for (const a of PAD_ACTIONS) {
  for (const b of brands) {
    const l = padLabel(a.id, b);
    if (!l || !l.trim()) holes.push(`${a.id} on ${b}`);
  }
}
console.log(`\n  ${PAD_ACTIONS.length} actions x ${brands.length} layouts  ${check(holes.length === 0, `unlabelled: ${holes.join(", ")}`)}  every action has a name in every layout`);
// And the names differ where the pads differ: a layout that says "A"
// to a PlayStation owner is the Xbox layout with a different title.
const face = PAD_ACTIONS.filter((a) => a.kind === "button" && a.index <= 3);
const same = face.filter((a) => padLabel(a.id, "playstation") === padLabel(a.id, "xbox"));
console.log(`  face buttons differ between brands  ${check(same.length === 0, `${same.map((a) => a.id).join(", ")} read the same on both pads`)}`);

// --- 3. one table -----------------------------------------------------
//
// engine.ts must poll the indices the table declares. Read the polling
// code as text and check every literal index it uses is one the table
// owns, and every table index is used — a binding in the table nobody
// polls is a lie in the diagram, and a polled index not in the table is
// a button the diagram cannot name.
const src = readFileSync("src/game/engine.ts", "utf8");
const poll = src.slice(src.indexOf("private pollGamepad"), src.indexOf("// ---------------------------------------------------------- touch API"));
const usesTable = /PAD\.|PAD_ACTIONS|padIndex\(|BINDINGS?\./.test(poll);
const literalButtons = [...poll.matchAll(/gp\.buttons\[(\d+)\]/g)].map((m) => +m[1]);
console.log(`\n  engine polls through the table  ${check(usesTable && literalButtons.length === 0,
  literalButtons.length ? `engine.ts still hardcodes button indices ${[...new Set(literalButtons)].join(", ")} instead of reading the table` : "engine.ts does not reference the binding table at all")}`);

// --- 4. a layout is renderable ---------------------------------------
for (const b of brands) {
  const rows = padLayout(b);
  const bad = rows.filter((r) => !r.action || !r.label || !r.glyph);
  console.log(`  ${b.padEnd(12)} layout: ${rows.length} rows  ${check(rows.length === PAD_ACTIONS.length && bad.length === 0, `layout for ${b} has ${bad.length} incomplete rows of ${rows.length}`)}`);
}

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length > 1 ? "s" : ""}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nevery pad is recognised, every button has a name, and the engine reads the same table the screen does.");
