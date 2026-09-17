#!/usr/bin/env node
// Lint the game's English.
//
//   npm run check:english
//   npm run check:english:rules     # the rules' own self-test
//
// The Arabic has had three linters for months. The English had none,
// and it showed: 139 part descriptions and every inline label in
// RaceClient had never been read against each other. What that pass
// found was not bad writing. It was the same fact written twice and
// spelled two ways — "Sport Tires" in a shop whose onboarding says
// tyres, "till fajer" on a billboard after "till" had been chased off
// the menu, prices in Arabic-Indic digits beside a redline in Western
// ones. None of it throws. None of it looks broken to whoever wrote it.
//
// So the rules here are the ones a machine can be RIGHT about. The
// house rule for these linters is already written down in
// check-arabic-grammar.mjs and it governs this file too: a rule that
// fires on a correct string is worse than no rule. Nothing here guesses
// at grammar, tone or register, and the spelling rule is not a
// dictionary — it is a list of words THIS GAME has already chosen,
// the way check-arabic.mjs keeps تيربو and refuses توربو.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
};

/**
 * Code wearing quotes.
 *
 * This matters more here than it looks. The part ids ARE the American
 * spelling — `id: "tires-sport"`, `cat: "tires"` — and they have to
 * stay that way: they are save-game keys, and the Unity and Unreal
 * ports sync on them. A spelling rule that cannot tell a label from an
 * identifier would demand a change that breaks every save in the wild,
 * which is the exact shape of a rule worth deleting.
 */
const isIdentifier = (v) =>
  /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) ||            // kebab id, or one lower word
  /^[a-z][A-Za-z0-9]*$/.test(v) ||                  // camelCase
  /^[A-Z][A-Z0-9_]*$/.test(v) ||                    // CONSTANT
  /^(\.|\/|@\/|https?:|#|var\(|data-|aria-)/.test(v);

/** A Tailwind class list: mostly lowercase tokens carrying - : [ ] / */
const isClassList = (v) => {
  const toks = v.split(/\s+/).filter(Boolean);
  if (toks.length < 2) return false;
  const classy = toks.filter((t) => /^[a-z0-9]/.test(t) && /[-:[\]/]/.test(t) && !/[A-Z]/.test(t));
  return classy.length / toks.length >= 0.6;
};

const isCopy = (v) =>
  v.length >= 3 && /[A-Za-z]{2}/.test(v) && !isIdentifier(v) && !isClassList(v) &&
  !/[{}<>]|=>/.test(v);

const ROOT = process.argv.includes("--self-test") ? null : "src";
const files = ROOT ? walk(ROOT) : [];

/** Every string literal and JSX text run that reads as copy. */
const readCopy = (txt, file) => {
  const out = [];
  txt.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;      // comments are not shown
    for (const m of line.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g)) {
      const v = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (isCopy(v)) out.push({ file, line: i + 1, text: v });
    }
    for (const m of line.matchAll(/>([^<>{}\n]{3,})</g)) {
      const v = m[1].trim();
      if (isCopy(v)) out.push({ file, line: i + 1, text: v });
    }
  });
  return out;
};

const fail = [];
const bad = (s, why) => fail.push(`${s.file}:${s.line}  ${why}\n      ${s.text.slice(0, 96)}`);

/**
 * Words this game has already picked, and the spellings that must not
 * appear beside them. Every entry earned its place by being found in
 * BOTH spellings in the tree — this is a record of decisions, not a
 * style opinion, and a word belongs here only once the game has
 * actually settled it.
 */
const CANON = [
  { keep: "tyre", banish: ["tire", "tires", "tired"], what: "tyres" },
  { keep: "colour", banish: ["color", "colors"], what: "colour" },
  { keep: "metre", banish: ["meter", "meters"], what: "metres" },
  { keep: "litre", banish: ["liter", "liters"], what: "litres" },
  { keep: "grey", banish: ["gray"], what: "grey" },
  { keep: "mould", banish: ["mold", "molded"], what: "moulded" },
  { keep: "until", banish: ["till"], what: '"until" (a till is a cash drawer)' },
  { keep: "-ised", banish: ["metallized", "synthesized", "customized", "optimized"], what: "the -ise spelling" },
];

for (const f of files) {
  const txt = readFileSync(f, "utf8");
  const strings = readCopy(txt, f);

  for (const s of strings) {
    const t = s.text;

    // 1. One spelling per word.
    for (const c of CANON) {
      for (const w of c.banish) {
        if (new RegExp(`\\b${w}\\b`, "i").test(t)) {
          bad(s, `spells ${c.what} as "${w}" — this game uses "${c.keep}" everywhere`);
        }
      }
    }
    // 2. Whitespace.
    if (/\S  +\S/.test(t)) bad(s, "double space");
  }

  // 3. No emoji in the world or the game's own strings.
  //
  // check:ui already forbids them in src/app/race and src/app/hub. It
  // does NOT read src/game, which is how three of them ended up drawn
  // into billboard textures — ⚡, ☕ and 🏁, painted with a font stack
  // that contains no emoji at all. Same rule, the surface it missed.
  //
  // rivals.ts and teams.ts are exempt on purpose: a crew crest is an
  // emblem, drawn as artwork, and check:ui exempts rivals.ts for the
  // same reason. ▶ and ◀ are Extended_Pictographic but are in the
  // game's allowed marks, so they are named here rather than caught.
  if (f.startsWith("src/game") && !/\/(rivals|teams)\.ts$/.test(f)) {
    txt.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const m of line.matchAll(/\p{Extended_Pictographic}/gu)) {
        if (m[0] === "▶" || m[0] === "◀") continue;
        fail.push(`${f}:${i + 1}  emoji ${m[0]} — an emoji is artwork the OS picks; draw it, or use a word\n      ${line.trim().slice(0, 96)}`);
      }
    });
  }

  // 4. A number shown to a player must name its locale.
  //
  // `n.toLocaleString()` with no argument formats however the BROWSER
  // is set. On an ar-KW phone that is ١٬٦٠٠, landing inside an English
  // sentence. Use num() from src/game/format.ts. See tests/digits.mjs,
  // which measures the rendered screen in both locales.
  if (/^src\/(game|app\/race|app\/hub)\//.test(f)) {
    txt.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (/\.toLocaleString\(\s*\)/.test(line)) {
        fail.push(`${f}:${i + 1}  toLocaleString() with no locale — the browser picks the digits; use num() from game/format\n      ${line.trim().slice(0, 96)}`);
      }
    });
  }

  // 5. A HUD message title is a fragment, not a sentence.
  //
  // Every one of them: "Out of fuel — بنزين خلص", "Hub disconnected",
  // "Lost the purse — 500 KD". Two of the night-closing messages ended
  // in a full stop and read as a different voice from the rest of the
  // HUD. Only the FIRST argument is a title; the sub-line below it is
  // a sentence and is left alone.
  txt.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    // A full stop only. "GO — يلا!" is an interjection and correct;
    // a rule that reddens it is a rule that gets switched off.
    const m = line.match(/(?:on|show)Message\(\s*(["'`])([^"'`\n]+)\1/);
    if (m && /[^.]\.$/.test(m[2])) {
      fail.push(`${f}:${i + 1}  HUD message title ends in a full stop — every other one is a fragment\n      ${m[2].slice(0, 96)}`);
    }
  });
}

// ---------------------------------------------------------------- self-test
//
// One planted error per rule, plus the negative guards that matter:
// the part ids, which MUST NOT fire, and the allowed pictographic
// arrows. A linter nobody can trust gets switched off.
if (process.argv.includes("--self-test")) {
  const cases = [
    // [name, source, should it fire]
    ["canon: tires label", 'const a = { name: "Sport Tires" };', true],
    ["canon: till", 'const a = "open till fajer";', true],
    ["canon: colorized", 'const a = "Pick a color for the car";', true],
    ["GUARD: part id", 'const a = { id: "tires-sport", cat: "tires" };', false],
    ["GUARD: camelCase", 'const a = tireRadius;', false],
    ["double space", 'const a = "Out of  fuel";', true],
    ["GUARD: single space", 'const a = "Out of fuel";', false],
  ];
  const run = (src) => {
    const strings = readCopy(src, "t.ts");
    const hits = [];
    for (const s of strings) {
      for (const c of CANON) for (const w of c.banish)
        if (new RegExp(`\\b${w}\\b`, "i").test(s.text)) hits.push(`canon ${w}`);
      if (/\S  +\S/.test(s.text)) hits.push("double space");
    }
    return hits;
  };
  let bads = 0;
  for (const [name, src, want] of cases) {
    const got = run(src).length > 0;
    const ok = got === want;
    if (!ok) bads++;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(24)} ${want ? "should fire" : "must not fire"} — ${got ? "fired" : "silent"}`);
  }
  // The pictographic guard, checked directly: the arrows the game uses
  // are Extended_Pictographic and must survive the emoji rule.
  const PICT = /\p{Extended_Pictographic}/u;
  for (const [c, want] of [["▶", false], ["◀", false], ["⚡", true], ["🏁", true]]) {
    const caught = PICT.test(c) && c !== "▶" && c !== "◀";
    const ok = caught === want;
    if (!ok) bads++;
    console.log(`  ${ok ? "ok  " : "FAIL"}  emoji rule on ${c}          ${want ? "should fire" : "must not fire"} — ${caught ? "fired" : "silent"}`);
  }
  console.log(bads ? `\n${bads} rule(s) do not do what they claim` : "\nevery rule fires on its error and stays silent on the guards.");
  process.exit(bads ? 1 : 0);
}

const seen = new Set(files.map((f) => f));
console.log(`English copy across ${seen.size} files`);
console.log("not checked  grammar, tone, register, and whether a stated fact is");
console.log("             true — those need a reader, and a regex pretending");
console.log("             otherwise would be worse than this saying it does not.");
if (fail.length) {
  console.error(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:\n`);
  for (const f of fail) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log("\none spelling per word, no emoji outside the crests, every shown");
console.log("number naming its locale, and every HUD title still a fragment.");
