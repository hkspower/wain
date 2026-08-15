#!/usr/bin/env node
// Lint the game's Arabic.
//
//   npm run check:arabic
//
// Arabic fails quietly in ways Latin does not. A string can look right
// in an editor and be wrong in a way no reviewer will spot: presentation
// forms pasted in instead of base letters, an invisible bidi control
// left over from a copy, two spellings of the same borrowed word in two
// menus. None of these throw, none of these render as tofu — they just
// look slightly off to someone who reads the language, which is exactly
// the audience this game is for.

import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
};

const AR = /[؀-ۿݐ-ݿ]/;
const files = walk("src");

/** Every string literal in the tree that contains Arabic. */
const strings = [];
for (const f of files) {
  const txt = readFileSync(f, "utf8");
  const lines = txt.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g)) {
      const v = m[1] ?? m[2] ?? m[3];
      if (v && AR.test(v)) strings.push({ file: f, line: i + 1, text: v });
    }
  });
}

const fail = [];
const bad = (s, why) => fail.push(`${s.file}:${s.line}  ${why}\n      ${s.text}`);

for (const s of strings) {
  const t = s.text;

  // Presentation forms. Base letters shape themselves; these are what
  // you get from copying rendered text out of a PDF or an image, and
  // they break search, selection and any font that lacks them.
  if (/[ﭐ-﷿ﹰ-﻿]/.test(t)) {
    bad(s, "contains Arabic PRESENTATION FORMS — paste the base letters instead");
  }
  // Invisible bidi controls, almost always a paste artifact. The CSS
  // already sets direction and unicode-bidi; these fight it.
  if (/[‎‏‪-‮⁦-⁩]/.test(t)) {
    bad(s, "contains an invisible bidi control character");
  }
  // Tatweel: hand-stretched letters. Justification is the renderer's job.
  if (/ـ/.test(t)) bad(s, "contains tatweel (kashida) — let the shaper set the width");
  // Both digit systems in one string reads as a typo — UNLESS the
  // string is bilingual, where each half correctly uses the digits of
  // its own language. "Flash 3x — لوّح بالضو ٣ مرات" is right, and the
  // first version of this rule called it a bug.
  const bilingual = /[A-Za-z]/.test(t);
  if (!bilingual && /[٠-٩]/.test(t) && /[0-9]/.test(t)) {
    bad(s, "mixes Arabic-Indic and ASCII digits in one Arabic string");
  }
  if (/  +/.test(t)) bad(s, "double space");
  if (t !== t.trim() && AR.test(t.trim())) bad(s, "leading or trailing whitespace");
}

// Borrowed words must be spelled ONE way. Each entry is the spelling
// that wins and the ones that must not appear alongside it.
const CANON = [
  { keep: "تيربو", banish: ["توربو", "تربو"], what: "turbo" },
  { keep: "نيترو", banish: ["نيتروجين"], what: "NOS (nitrous oxide, not nitrogen)" },
  { keep: "يلا", banish: ["يالله"], what: "yalla" },
  { keep: "بريك", banish: ["فرامل"], what: "brakes (the game speaks Gulf, not MSA)" },
];
for (const c of CANON) {
  for (const wrong of c.banish) {
    for (const s of strings) {
      if (s.text.includes(wrong)) {
        bad(s, `spells ${c.what} as "${wrong}" — this game uses "${c.keep}" everywhere`);
      }
    }
  }
}

console.log(`${strings.length} Arabic string literals across ${new Set(strings.map((s) => s.file)).size} files`);
if (fail.length) {
  console.error(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:\n`);
  for (const f of fail) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log("no presentation forms, no stray bidi controls, no tatweel,");
console.log("no mixed digit systems, and every borrowed word spelled one way.");
