#!/usr/bin/env node
/**
 * Is the Flutter app's generated half current?   npm run audit:flutter
 *
 * Everything in `flutter_app/` that is DATA is generated from the site — the
 * catalogue, the design tokens, the search documents and synonyms, the parity
 * fixtures and the drawings — so that the native app cannot quietly disagree
 * with the web about what a place is called, what colour a category is, or
 * which result comes first. Each generator has a `--check` that re-renders and
 * diffs without writing; this runs them all.
 *
 * It exists because the failure is silent. A place added to `places.ts` with no
 * regeneration here ships a native app one place short, and nothing on either
 * side errors. (`content:check` does the same for docs/content.md.)
 *
 * The drawings need a real browser; set SKIP_ART=1 where there is none.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";

const checks = [
  ["catalogue", "gen-flutter-catalogue.mjs", "flutter:catalogue"],
  ["design tokens", "gen-flutter-tokens.mjs", "flutter:tokens"],
  ["search documents + parity cases", "gen-flutter-search.mjs", "flutter:search"],
  ["helper parity fixtures", "gen-flutter-fixtures.mjs", "flutter:fixtures"],
];
if (process.env.SKIP_ART !== "1") {
  if (existsSync(CHROMIUM) || process.env.CHROMIUM_PATH) checks.push(["drawings", "export-flutter-art.mjs", "flutter:art"]);
  else console.log("  – drawings skipped: no Chromium (set CHROMIUM_PATH, or SKIP_ART=1 to silence)");
}

let failed = 0;
for (const [label, script, npmScript] of checks) {
  try {
    const out = execFileSync("node", [join(ROOT, "scripts", script), "--check"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    console.log(`  ✓ ${label.padEnd(34)} ${out.trim()}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${label.padEnd(34)} stale — run \`npm run ${npmScript}\` and commit the result`);
    const msg = `${e.stderr ?? ""}${e.stdout ?? ""}`.trim();
    if (msg) console.log(msg.split("\n").map((l) => `      ${l}`).join("\n"));
  }
}
console.log(`\n${failed ? "✗" : "✓"} ${failed} stale generated file set${failed === 1 ? "" : "s"}`);
process.exit(failed ? 1 : 0);
