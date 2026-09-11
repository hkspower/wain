#!/usr/bin/env node
// Arabic must not be letter-spaced, checked in the SOURCE.
//
//   npm run check:arabic:type
//
// globals.css states the rule in three places and means it: Arabic is
// cursive, the letters join, and letter-spacing does not letterspace the
// word — it BREAKS it into disconnected glyphs. It is the one
// typographic error in this project that is not a matter of degree.
//
// tools/shots/type.mjs already checks it, correctly, and reported zero.
// It walks the running game and flags any run of text where
// `arabic && tracking > 0.01`. That logic is right. What it cannot do is
// see a screen nobody opened: it visits the menu, the garage and the
// race HUD, so the settings panel, the onboarding flow, the tint tab and
// the pre-battle cinematic were never on screen and were never measured.
// It said 0 because it looked at four screens, not because the game has
// none — and an audit found the violations on exactly the screens it
// does not open.
//
// A rendered walk can only ever see the states it drives the game into.
// The source is always all there. So this is the static half of the same
// rule, and the two are complementary rather than redundant: this one
// cannot tell what a class computes to at runtime, and that one cannot
// open every modal in the game.
//
// WHAT COUNTS AS TRACKED
//
// The tracking comes from the class on the ELEMENT, and Arabic written
// as a bare text node inherits it. .grn-label is 0.22em and uppercase,
// .grn-btn is 0.06em, .grn-poster is 0.02em, and any Tailwind tracking-*
// utility sets it directly. Arabic wrapped in .grn-ar / .grn-ar-display /
// .grn-ar-poster is exempt: those set letter-spacing themselves and are
// the established way to put Arabic inside a Latin label — line 4158 of
// RaceClient.tsx does it correctly, three lines from one that does not.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
/** Classes that put letter-spacing on whatever text they contain. */
const TRACKS = /\bgrn-label\b|\bgrn-btn\b|\bgrn-poster\b|\btracking-\[|\btracking-(wide|wider|widest)\b/;
/** Wrappers that set their own spacing and are the correct fix. */
const EXEMPT = /\bgrn-ar\b|\bgrn-ar-display\b|\bgrn-ar-poster\b|\bgrn-ar-sign\b/;
/** How far above a text node its opening tag can sit. Every violation
 *  found so far is 1-2 lines; 4 is slack, and a miss here is a false
 *  NEGATIVE, which is the safe direction for a check that fails a build. */
const LOOKBACK = 4;

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
};

const bad = [];
for (const file of walk("src")) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!ARABIC.test(line)) continue;
    // Comments are not rendered text. Caught by this check's own first
    // run: the comment written to EXPLAIN a fix quoted the Arabic it was
    // about, sat under the same className, and was duly reported as the
    // fault it had just repaired.
    if (/^\s*(\{\s*)?\/\*|^\s*\/\/|^\s*\*/.test(line)) continue;
    // Arabic already inside an exempt wrapper on its own line is fine.
    if (EXEMPT.test(line)) continue;
    for (let b = 0; b <= LOOKBACK && i - b >= 0; b++) {
      const up = lines[i - b];
      const m = up.match(/className=[{"`]([^"`}]*)/);
      if (!m) continue;
      if (TRACKS.test(m[1]) && !EXEMPT.test(m[1])) {
        bad.push({
          file,
          line: i + 1,
          cls: (m[1].match(TRACKS) || [""])[0],
          text: line.trim().slice(0, 68),
        });
      }
      break; // nearest className wins
    }
  }
}

// ---- the rule, pointed at strings whose answer is known ------------
//
// check-arabic-grammar.mjs sets the standard: "A rule that cannot be
// pointed at a known-bad string cannot be shown to work." Run with
// --self-test.
if (process.argv.includes("--self-test")) {
  const CASES = [
    ['<h3 className="grn-label">A · \u0627\u0644\u062f\u0642\u0629</h3>', true, "bare Arabic in a tracked label"],
    ['<h3 className="grn-label">A · <span className="grn-ar" lang="ar">\u0627\u0644\u062f\u0642\u0629</span></h3>', false, "wrapped Arabic is exempt"],
    ['<p className="text-sm">\u0627\u0644\u062f\u0642\u0629</p>', false, "no tracking class, nothing to inherit"],
    ['{/* \u0627\u0644\u062f\u0642\u0629 */}', false, "a comment is not rendered text"],
  ];
  let bad2 = 0;
  for (const [src, want, why] of CASES) {
    const ls = ['<div className="grn-label">', src, "</div>"];
    let hit = false;
    for (let i = 0; i < ls.length; i++) {
      const L = ls[i];
      if (!ARABIC.test(L) || EXEMPT.test(L)) continue;
      if (/^\s*(\{\s*)?\/\*|^\s*\/\/|^\s*\*/.test(L)) continue;
      for (let b = 0; b <= LOOKBACK && i - b >= 0; b++) {
        const m = ls[i - b].match(/className=[{"`]([^"`}]*)/);
        if (!m) continue;
        if (TRACKS.test(m[1]) && !EXEMPT.test(m[1])) hit = true;
        break;
      }
    }
    const ok = hit === want;
    if (!ok) bad2++;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${why}`);
  }
  console.log(bad2 ? "\nthe rule does not do what it says" : "\nthe rule fires on the bad string and not on the good ones");
  process.exit(bad2 ? 1 : 0);
}

console.log(`${walk("src").length} .tsx files scanned for Arabic under a tracking class\n`);
if (!bad.length) {
  console.log("no Arabic is letter-spaced: every one is wrapped in a face of its own.");
  process.exit(0);
}
for (const b of bad) console.log(`  ${b.file}:${b.line}  (${b.cls})\n      ${b.text}`);
console.error(
  `\n${bad.length} run(s) of Arabic inherit letter-spacing from the element holding them.\n` +
    `Arabic is cursive: spacing it apart does not letterspace the word, it breaks\n` +
    `the joins. Wrap it: <span className="grn-ar" lang="ar">…</span>`
);
process.exit(1);
