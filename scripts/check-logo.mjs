#!/usr/bin/env node
// The identity builds from nothing but itself.
//
//   npm run check:logo
//
// Every mark in press/logo is drawn in code and rendered through
// Chromium, which means the sources are HTML and the type is loaded by
// @font-face — and a @font-face whose src does not resolve DOES NOT
// FAIL. It falls through to the next family in the stack and the page
// renders anyway, in the wrong face, with nothing anywhere saying so.
//
// That is not hypothetical. Every source here loaded Big Shoulders and
// Geist Mono over an absolute file:// path into a skills cache outside
// the repository. The cache moved. The marks kept rendering: the lockups
// silently fell back to a generic sans, and the badge — whose SVG <text>
// named no fallback at all — set its monogram in a serif. The wordmark's
// letter-spacing had been hand-tuned against that fallback, so restoring
// the real face broke the one thing the lockup is for, which is the two
// words being the same width.
//
// So this checks the boring structural things a rendering pipeline
// cannot check for itself, and it checks them statically, in
// milliseconds, without a browser.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

const DIR = "press/logo";
const fail = [];
const sources = readdirSync(DIR).filter((f) => f.endsWith(".html"));

// ---- 1. Nothing reaches outside the repository ----------------------
//
// A path into a home directory, a build directory or a tool's cache is a
// path that works on the machine that wrote it and nowhere else. The
// exception is the system font directory: Noto Sans CJK is a 20 MB
// collection that ships with the container and is loaded with a local()
// first, so a url() into /usr/share/fonts is a documented fallback
// rather than a dependency.
const OUTSIDE_OK = /^\/usr\/share\/fonts\//;
for (const f of sources) {
  const src = readFileSync(join(DIR, f), "utf8");
  for (const m of src.matchAll(/url\("([^"]+)"\)/g)) {
    const u = m[1];
    if (u.startsWith("file://")) {
      const p = u.slice("file://".length);
      if (!OUTSIDE_OK.test(p)) {
        fail.push(`${f} loads a font from outside the repo: ${p}`);
      } else if (!existsSync(p)) {
        fail.push(`${f} names a system font that is not installed: ${p}`);
      }
      continue;
    }
    // Everything else must resolve inside press/logo.
    const p = resolve(DIR, u);
    if (!p.startsWith(resolve(DIR))) fail.push(`${f} escapes press/logo: ${u}`);
    else if (!existsSync(p)) fail.push(`${f} names a file that does not exist: ${u}`);
  }
}

// ---- 2. Every face a source asks for is actually vendored -----------
const faces = new Set();
for (const f of sources) {
  const src = readFileSync(join(DIR, f), "utf8");
  for (const m of src.matchAll(/url\("(fonts\/[^"]+)"\)/g)) faces.add(m[1]);
}
const missing = [...faces].filter((p) => !existsSync(join(DIR, p)));

// ---- 3. The renderer and the directory agree ------------------------
//
// Both directions. A job whose source is gone renders nothing and says
// "skip" in passing; an output nobody re-renders is a stale PNG that
// will be shipped one day because it is sitting in the folder looking
// like the others.
const render = readFileSync(join(DIR, "render.mjs"), "utf8");
const jobs = [...render.matchAll(/\{\s*file:\s*"([^"?]+)[^"]*",\s*out:\s*"([^"]+)"/g)]
  .map(([, file, out]) => ({ file, out }));
for (const j of jobs) {
  if (!existsSync(join(DIR, j.file))) fail.push(`render.mjs builds ${j.out} from a missing source: ${j.file}`);
  if (!existsSync(join(DIR, j.out))) fail.push(`render.mjs declares ${j.out} and it has never been rendered`);
}
// Plates rendered by something other than render.mjs. The rule being
// kept is "every PNG in here has a named producer", not "render.mjs
// makes all of them" — the crest sheet is drawn by the running game
// through a debug hook, which is the whole point of it, so it could
// never be a render.mjs job. Declaring it keeps the guard's teeth: an
// entry whose tool has gone is still a failure, and a PNG nobody claims
// is still a failure.
const FOREIGN = {
  "crew-crests.png": "tools/shots/crests.mjs",
};
for (const [out, tool] of Object.entries(FOREIGN)) {
  if (!existsSync(tool)) fail.push(`${out} is declared as rendered by ${tool}, and that file is gone`);
}
const declared = new Set([...jobs.map((j) => j.out), ...Object.keys(FOREIGN)]);
for (const f of readdirSync(DIR).filter((f) => f.endsWith(".png"))) {
  if (!declared.has(f)) fail.push(`${f} is in the folder and nothing renders it — stale, or renamed and not cleaned up`);
}
const built = new Set(jobs.map((j) => j.file));
for (const f of sources) {
  if (!built.has(f)) fail.push(`${f} is a source that render.mjs never builds`);
}

console.log(
  `${sources.length} sources, ${jobs.length} plates + ${Object.keys(FOREIGN).length} drawn by the game, ${faces.size} vendored faces  ` +
    (missing.length ? "FAIL" : "ok")
);
for (const m of missing) fail.push(`a source asks for ${m} and it is not vendored`);

if (fail.length) {
  console.error(`\n${fail.length} problem(s):\n`);
  for (const f of fail) console.error(`  ${f}`);
  console.error(
    `\nFonts live in press/logo/fonts. Nothing here may read one from outside\n` +
      `the repository: a missing @font-face src does not raise, it renders in\n` +
      `the wrong face and says nothing.`
  );
  process.exit(1);
}
console.log("the identity builds from nothing but itself.");
