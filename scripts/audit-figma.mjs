#!/usr/bin/env node
/**
 * Has the Figma library gone stale?   npm run audit:figma
 *
 * Two checks already carry «figma» in their name and neither of them has ever
 * looked at Figma. `design:check` and `figma:icons:check` compare the code
 * against files in this repository — the design-system page, the two SVG import
 * sheets — and both print «all current», which reads like a statement about the
 * library. It is not. The library lives in a Figma file that took 99 variables,
 * 7 effect styles and 30 text styles through the MCP server months ago, and
 * nothing since has been able to tell whether a single one of them still
 * matches the site.
 *
 * ## Why this cannot just read the file
 *
 * Figma's Variables REST API is Enterprise-only, and this account is on
 * Starter. The MCP server can read the file, but an npm script cannot call it —
 * it is a tool an assistant holds, not an HTTP endpoint with a token. So there
 * is no way for a scheduled check to look at Figma directly, and pretending
 * otherwise would produce exactly the kind of check this file exists to
 * replace.
 *
 * ## What it does instead
 *
 * Staleness has one cause: the code moved after the push. So the push records
 * what it put there — `docs/figma/variables.json`, written from the file itself
 * — and this compares today's tokens against that snapshot. It cannot see
 * somebody editing a colour inside Figma, and it says so rather than implying
 * otherwise. It catches the thing that actually happens, which is forty commits
 * of design work landing in `globals.css` while the library sits at the values
 * it was given in August.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = join(ROOT, "src/app/globals.css");
const SNAPSHOT = join(ROOT, "docs/figma/variables.json");

/**
 * The tokens as the browser sees them.
 *
 * Read out of the `@theme` block rather than a hand-kept list, for the same
 * reason gen-design-system renders the real components: a second copy of the
 * palette is a second thing to forget to update. Trailing comments carry the
 * contrast ratios and are not part of the value.
 */
function codeTokens() {
  const css = readFileSync(CSS, "utf8");
  const tokens = new Map();
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
    const value = m[2].replace(/\/\*[\s\S]*?\*\//g, "").trim().toLowerCase();
    // First definition wins: later ones are overrides inside media queries and
    // are not what the library was given.
    if (!tokens.has(m[1])) tokens.set(m[1], value);
  }
  return tokens;
}

const tokens = codeTokens();

if (!existsSync(SNAPSHOT)) {
  console.log("\n── the Figma library ──");
  console.log(`  ⚠ no snapshot at docs/figma/variables.json, so nothing can be compared.`);
  console.log(`    ${tokens.size} tokens are defined in src/app/globals.css today.`);
  console.log("");
  console.log("    The snapshot is written by reading the library's variables out of the");
  console.log("    Figma file. Until it exists, «design:check» and «figma:icons:check»");
  console.log("    green mean the local artefacts are current — they say nothing at all");
  console.log("    about the library, and this is the check that says so out loud.");
  console.log("\n0 errors, 1 note");
  process.exit(0);
}

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const pushed = new Map(Object.entries(snap.variables ?? {}));

console.log("\n── the Figma library, against the code ──");
console.log(`  file   ${snap.file ?? "(not recorded)"}`);
console.log(`  read   ${snap.readAt ?? "(unknown)"}${snap.readBy ? ` by ${snap.readBy}` : ""}`);
console.log(`  holds  ${pushed.size} variables · code defines ${tokens.size} tokens\n`);

const changed = [];
const missing = [];
for (const [name, value] of tokens) {
  if (!pushed.has(name)) missing.push(name);
  else if (pushed.get(name).toLowerCase() !== value) changed.push([name, pushed.get(name), value]);
}
const orphaned = [...pushed.keys()].filter((k) => !tokens.has(k));

let problems = 0;
if (changed.length) {
  console.log(`  ⚠ ${changed.length} token(s) have moved since the library was given them:`);
  for (const [name, was, now] of changed.slice(0, 12)) console.log(`      ${name}   ${was} → ${now}`);
  if (changed.length > 12) console.log(`      … and ${changed.length - 12} more`);
  problems += changed.length;
}
if (missing.length) {
  console.log(`\n  ⚠ ${missing.length} token(s) exist in the code and not in the library:`);
  for (const name of missing.slice(0, 12)) console.log(`      ${name} = ${tokens.get(name)}`);
  if (missing.length > 12) console.log(`      … and ${missing.length - 12} more`);
  problems += missing.length;
}
if (orphaned.length) {
  console.log(`\n  ⚠ ${orphaned.length} variable(s) in the library that the code no longer defines:`);
  for (const name of orphaned.slice(0, 12)) console.log(`      ${name}`);
  if (orphaned.length > 12) console.log(`      … and ${orphaned.length - 12} more`);
  problems += orphaned.length;
}

if (!problems) {
  console.log("  ✓ every token in the code matches the value the library was given.");
}

console.log(
  "\n  This compares the code against a SNAPSHOT of the library, not against the\n" +
    "  library. A value edited inside Figma since the snapshot was read is\n" +
    "  invisible here — Figma's Variables API is Enterprise-only and this account\n" +
    "  is on Starter, so there is no way for a script to look. Re-read the file\n" +
    "  through the MCP server to refresh it."
);
console.log(`\n0 errors, ${problems} notes`);
// Never fails the build. A stale library is a real problem and not a broken
// site, and a scan that cannot go green is a scan people stop reading.
process.exit(0);
