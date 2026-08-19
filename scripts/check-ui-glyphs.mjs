#!/usr/bin/env node
// Keep emoji out of the game's UI.
//
//   npm run check:ui
//
// An emoji is not an icon. It is a small full-colour cartoon whose
// artwork is chosen by the operating system: Apple draws one thing,
// Google another, and Windows refuses to draw national flags at all and
// substitutes the letters. Five of them down the left of a menu set in
// condensed italic caps on near-black was the single thing in this
// interface that looked like a toy — and it looked like a different toy
// on every machine.
//
// Icons are drawn instead, in src/app/race/Icons.tsx: one stroke weight
// on one grid, taking the colour of whatever row they sit in. This check
// is what stops the next hurried edit from reaching for the keyboard
// picker again.
//
// Typographic marks are NOT emoji and are left alone — an arrow, a
// check, a cross, a geometric triangle are all set by the text font in
// the text colour, which is the whole distinction being drawn here.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// The game's interface — where icons live and where an emoji is a
// stand-in for one. Deliberately NOT covered:
//   · the marketing pages, a different surface with a different
//     convention, where an emoji next to a category name is normal web;
//   · src/game/rivals.ts and the engine's driver cards, where a flag is
//     DATA about a driver's nationality rather than an icon. The UI
//     draws it (see the Flag component in RaceClient) instead of asking
//     the platform for a picture; the value itself stays as it is.
const ROOTS = ["src/app/race", "src/app/hub"];

/** Pictographs, emoji and regional-indicator flags. */
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

/** Marks that are typography, not pictures: they render in the text
 *  font, in the text colour, at the text weight. */
const ALLOWED = new Set([
  "→", "←", "↑", "↓", "▸", "▶", "◀", "▲", "▼", "·", "✓", "✕", "×", "—", "–",
  "⛶", // fullscreen: a geometric box, monochrome everywhere
  "⇅", // cycle: paired arrows, set by the text font like any arrow
]);

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
};

const files = ROOTS.flatMap((r) => walk(r));
const bad = [];
let scanned = 0;

for (const f of files) {
  scanned++;
  const lines = readFileSync(f, "utf8").split("\n");
  // Comments describe what was removed and why, and say it by quoting
  // the emoji — so they have to come out before the scan, block comments
  // included. The first version stripped only single-line ones and the
  // icon module's own documentation failed the check it exists to serve.
  let inBlock = false;
  lines.forEach((line, i) => {
    let code = line;
    if (inBlock) {
      const end = code.indexOf("*/");
      if (end < 0) return;
      code = code.slice(end + 2);
      inBlock = false;
    }
    code = code.replace(/\/\*.*?\*\//g, "");
    const open = code.indexOf("/*");
    if (open >= 0) {
      inBlock = true;
      code = code.slice(0, open);
    }
    code = code.replace(/\/\/.*$/, "");
    for (const ch of code) {
      if (!EMOJI.test(ch) || ALLOWED.has(ch)) continue;
      bad.push(`${f}:${i + 1}  ${JSON.stringify(ch)}  ${line.trim().slice(0, 74)}`);
    }
  });
}

console.log(`${scanned} game UI files scanned for emoji`);
if (bad.length) {
  console.error(`\n${bad.length} emoji in the game's interface:\n`);
  for (const b of bad) console.error(`  ${b}`);
  console.error(`\nDraw it in src/app/race/Icons.tsx instead, or drop it:`);
  console.error(`an emoji is artwork the operating system picks, not an icon.`);
  process.exit(1);
}
console.log("no emoji — every icon in the game UI is drawn.");
