// The game is called Night Racer, and the saves are still where they were.
//
//   npm run test:name
//
// A rename is the cheapest change to describe and one of the easiest to
// get quietly, permanently wrong, because the same string does three
// different jobs in a codebase:
//
//   a LABEL     what a player reads. Should change.
//   an ID       a bundle id, an npm package name, a C++ module. Renaming
//               one is a migration, not an edit, so it should not change
//               on a whim.
//   an ADDRESS  a localStorage key. Renaming one does not move a save.
//               It ABANDONS it: the old key is still sitting there with
//               the player's garage, career, crew and money in it, and
//               the game is now looking somewhere else and finding a
//               brand new file. There is no error. The player just loses
//               everything and starts again on 10 KD.
//
// The fourteen `gulf-road-nights-*` keys are addresses. They keep the
// old name forever, and this file is what stops a future tidy-up from
// "finishing the job".

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { NAME } from "../src/lib/gameSite.ts";
import { RACE_OPEN_H, RACE_CLOSE_H } from "../src/game/clock.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// ---- 1. The saves did not move --------------------------------------
//
// Read out of the source rather than listed here: a list would have to be
// kept in step with the code, and the thing being protected is precisely
// that nobody edits these by hand.
const KEY = /"(gulf-road-nights-[a-z0-9-]*)"/g;
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if ([".ts", ".tsx", ".mjs", ".js"].includes(extname(e.name))) out.push(p);
  }
  return out;
};
// NOT this file. The first version scanned tests/ too, and this file
// names "gulf-road-nights-garage" a few lines down as the thing it is
// checking for — so it found its own string, reported fourteen keys and
// passed happily while the garage key was renamed out of mods.ts. A
// guard that reads its own assertion as evidence is not a guard.
const SELF = join("tests", "name.mjs");
const files = walk("src").concat(walk("scripts"), walk("server"))
  .filter((f) => f !== SELF);
const keys = new Set();
for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(KEY)) keys.add(m[1]);
console.log(
  `${keys.size} storage keys, all still addressed as they were  ` +
    check(keys.size >= 14, `only ${keys.size} keys found — if the prefix was renamed, every existing save is orphaned`)
);
// The garage is the one that hurts most, so it is named explicitly.
console.log(
  `the garage is where it has always been  ` +
    check(keys.has("gulf-road-nights-garage"), `"gulf-road-nights-garage" is gone: every player's cars, parts and money are unreachable`)
);

// ---- 2. The label did change, everywhere ----------------------------
//
// Comments and prose count. A codebase that half-renames reads as though
// two products are being maintained in one repository.
{
  const OLD = /Gulf Road Nights|ليالي شارع الخليج/;
  // Files allowed to say the old name because they are ABOUT the rename.
  const HISTORY = new Set([
    "src/lib/gameSite.ts",     // the constant, and why the keys did not follow it
    "tests/name.mjs",          // this file
    "OUTSTANDING.md",
    "press/logo/README.md",
  ]);
  const prose = [];
  const scan = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".next", ".git", "out", "dist"].includes(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) scan(p);
      else if ([".ts", ".tsx", ".mjs", ".js", ".md", ".html", ".css", ".cs", ".h", ".cpp", ".ini", ".json"].includes(extname(e.name)))
        prose.push(p);
    }
  };
  scan(".");
  const stale = prose.filter((p) => !HISTORY.has(p) && OLD.test(readFileSync(p, "utf8")));
  console.log(
    `${prose.length} text files carry the name, ${stale.length} still say the old one  ` +
      check(stale.length === 0, `not renamed: ${stale.slice(0, 8).join(", ")}${stale.length > 8 ? ` (+${stale.length - 8})` : ""}`)
  );
}

// ---- 3. The identifiers did NOT change ------------------------------
//
// A bundle id is what an app store, an installed app and a save
// directory are keyed on; the Unreal module name has to match its
// folder, its .uproject entry and its Build.cs class. Both are correct
// as they are, and both are exactly the kind of thing a global
// find-and-replace takes with it.
{
  const held = [
    ["capacitor.config.ts", "com.wain.gulfroadnights", "the iOS/Android bundle id"],
    ["desktop/package.json", "com.wain.gulfroadnights", "the desktop app id"],
    ["unreal/GulfRoadNights.uproject", '"Name": "GulfRoadNights"', "the Unreal module name"],
  ].filter(([f]) => existsSync(f));
  const moved = held.filter(([f, s]) => !readFileSync(f, "utf8").includes(s));
  console.log(
    `${held.length} identifiers deliberately unchanged  ` +
      check(moved.length === 0, `renamed something that is an id, not a label: ${moved.map(([f, , w]) => `${f} (${w})`).join(", ")}`)
  );
}

// ---- 4. The marks quote the game's own hours ------------------------
//
// The title lockup and the badge both draw the racing window: the bar
// under the wordmark and the lit arc on the badge rim are RACE_OPEN_H to
// RACE_CLOSE_H, to scale. A mark that quotes a figure the product has
// since changed is worse than one that quotes none, so the numbers are
// checked against the clock rather than trusted.
{
  const marks = ["press/logo/lockup.html", "press/logo/ar-lockup.html", "press/logo/badge.html"];
  const wrong = [];
  for (const f of marks) {
    const src = readFileSync(f, "utf8");
    const m = src.match(/const OPEN=([\d.+\-/*\s]+?), CLOSE=([\d.+\-/*\s]+?);/);
    if (!m) { wrong.push(`${f}: draws no window at all`); continue; }
    const open = eval(m[1]), close = eval(m[2]);
    if (open !== RACE_OPEN_H) wrong.push(`${f}: opens at ${open}, the game opens at ${RACE_OPEN_H}`);
    if (Math.abs(close - RACE_CLOSE_H) > 1e-9)
      wrong.push(`${f}: closes at ${close.toFixed(4)}, the game closes at ${RACE_CLOSE_H.toFixed(4)}`);
  }
  const hh = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  console.log(
    `${marks.length} marks draw the window ${hh(RACE_OPEN_H)}–${hh(RACE_CLOSE_H)}  ` +
      check(wrong.length === 0, wrong.join("; "))
  );
}

// ---- 5. And the name in the code is the name on the marks -----------
{
  const lockup = readFileSync("press/logo/lockup.html", "utf8");
  const [w1, w2] = NAME.en.split(" ");
  console.log(
    `the lockup sets "${NAME.en}" and "${NAME.ar}"  ` +
      check(!!w2, `NAME.en is "${NAME.en}" — the lockup is built from two stacked words`) +
      check(new RegExp(`wm-1">${w1}<`, "i").test(lockup), `the lockup's first word is not "${w1}"`) +
      check(new RegExp(`wm-2">${w2}<`, "i").test(lockup), `the lockup's second word is not "${w2}"`) +
      // Word by word, not as one string: the mark sets the leading word
      // in amber and the rest in paper, so the Arabic is deliberately
      // split across two spans and never appears contiguously in the
      // source. Checking for the whole phrase would fail on a mark that
      // is correct.
      check(NAME.ar.split(" ").every((w) => lockup.includes(w)),
        `the lockup is missing part of "${NAME.ar}"`)
  );
}

if (fail.length) {
  console.error(`\n${fail.length} failed:\n`);
  for (const f of fail) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`\nthe game is ${NAME.en} — ${NAME.ar} — and every save is where it was.`);
