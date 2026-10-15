#!/usr/bin/env node
// Every Unity script class lives in a file of its own name.
//
//   node scripts/check-unity-monobehaviours.mjs     (first step of npm run check:unity-compile)
//
// Unity ties a MonoBehaviour or ScriptableObject to its MonoScript asset by
// FILE NAME: CarRig must be in CarRig.cs. One in a file of another name
// still compiles — dotnet build, and so check:unity-compile, cannot see
// the difference — but Unity cannot serialize it. AddComponent works at
// runtime; a prefab saved with it comes back with "The referenced script
// on this Behaviour is missing", and the baked cars lose their CarRig.
// That is how CarRig and ProbeFollower shipped inside CarModel.cs and
// NightReflections.cs. This is the check that would have caught it.
//
// Scans unity/Assets/**/*.cs. A class counts when its FIRST base type is
// MonoBehaviour, ScriptableObject, Editor, EditorWindow or
// StateMachineBehaviour (bare or namespace-qualified). Only direct
// derivation is seen: a class of a class of MonoBehaviour is not, which
// is the cost of not running a compiler. Flags:
//   - such a class in a file whose base name is not the class name;
//   - a file defining more than one such class (Unity takes one per file).
// Exits 1 with every finding, 0 when clean.

import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "unity", "Assets");
const BASES = new Set(["MonoBehaviour", "ScriptableObject", "Editor", "EditorWindow", "StateMachineBehaviour"]);

/** Every .cs under dir, skipping what Unity skips (dot-folders, Foo~). */
function* scripts(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name.endsWith("~")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* scripts(p);
    else if (e.name.endsWith(".cs")) yield p;
  }
}

/** The source with comments and string/char literals blanked (newlines
 *  kept, so line numbers survive) — a "class Foo : MonoBehaviour" in a doc
 *  comment or a string must not count. */
function strip(src) {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'" || ((c === "@" || c === "$") && (n === '"' || (n === "@" || n === "$") && src[i + 2] === '"'))) {
      // Regular, verbatim (@"", "" escapes) and interpolated strings, and
      // char literals. Interpolation holes are blanked with the rest.
      let j = i;
      let verbatim = false;
      while (src[j] === "@" || src[j] === "$") { if (src[j] === "@") verbatim = true; j++; }
      const q = src[j++];
      while (j < src.length) {
        if (!verbatim && src[j] === "\\") { j += 2; continue; }
        if (src[j] === q) {
          if (verbatim && src[j + 1] === q) { j += 2; continue; }
          j++;
          break;
        }
        if (!verbatim && src[j] === "\n") break; // unterminated; stop at the line
        j++;
      }
      out += src.slice(i, j).replace(/[^\n]/g, " ");
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const CLASS = /\bclass\s+([A-Za-z_]\w*)\s*(<[^>{]*>)?\s*:\s*([A-Za-z_][\w.]*)/g;

const problems = [];
let files = 0, found = 0;
for (const file of scripts(ASSETS)) {
  files++;
  const rel = relative(ROOT, file);
  const code = strip(readFileSync(file, "utf8"));
  const name = basename(file, ".cs");
  const classes = [];
  for (const m of code.matchAll(CLASS)) {
    const base = m[3].split(".").pop();
    if (!BASES.has(base)) continue;
    const line = code.slice(0, m.index).split("\n").length;
    classes.push({ cls: m[1], generic: !!m[2], base, line });
  }
  found += classes.length;
  for (const c of classes)
    if (c.cls !== name)
      problems.push(
        `${rel}:${c.line}: class ${c.cls} : ${c.base} is in ${name}.cs — Unity only serializes it from ${c.cls}.cs ` +
          `(move it to ${join(relative(ROOT, dirname(file)), `${c.cls}.cs`)})`
      );
  if (classes.length > 1)
    problems.push(
      `${rel}: ${classes.length} Unity script classes in one file (${classes.map((c) => c.cls).join(", ")}) — ` +
        `one per file, each in a file of its own name`
    );
}

if (problems.length) {
  console.error(`check-unity-monobehaviours: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nA MonoBehaviour, ScriptableObject, Editor, EditorWindow or StateMachineBehaviour must be the only one in a file" +
      "\nnamed after it, or Unity drops it from every prefab and asset that uses it (\"missing script\")."
  );
  process.exit(1);
}
console.log(`check-unity-monobehaviours: ${found} Unity script classes in ${files} files, each in a file of its own name.`);
