#!/usr/bin/env node
// Turn the reference stills into the website's images.
//
//   npm run shots            # capture press/shots/*.png from the game
//   npm run site:images      # then this: public/game/*.webp
//
// The stills are 1600x900 PNGs of 1.3-2 MB each, which is the right
// format for comparing two builds frame by frame and the wrong one for
// a page someone opens on a phone on the corniche. Every gallery image
// is written at two widths so the browser can pick — 1600 for a desktop
// and 800 for everything else — and the pair costs about a twentieth of
// what the PNG did.
//
// Nothing here invents an image. If a still is missing, this says which
// one and exits non-zero rather than shipping a gap.
import sharp from "sharp";
import { existsSync, mkdirSync, statSync } from "node:fs";

const SRC = "press/shots";
const OUT = "public/game";

// The gallery, and only the gallery. This list is checked against
// GALLERY in src/lib/gameSite.ts by tests/site.mjs, so a shot added to
// the page without being built here fails the suite rather than showing
// a broken image.
const SHOTS = [
  "night", "towers", "rain", "city", "coast", "love",
  "station", "drift", "ring", "dawn", "menu", "towersday",
];

const WIDTHS = [1600, 800];
// 82 rather than the default 80, measured on night.png: the night sky is
// a wide, smooth gradient and it is the first thing to band. At 80 the
// banding is visible on a good screen; at 82 it is not, for 4% more
// bytes. Above 85 the file grows without the picture changing.
const QUALITY = 82;

mkdirSync(OUT, { recursive: true });

const missing = SHOTS.filter((s) => !existsSync(`${SRC}/${s}.png`));
if (missing.length) {
  console.error(`missing stills: ${missing.join(", ")}`);
  console.error(`run: npm run shots -- ${missing.join(" ")}`);
  process.exit(1);
}

let before = 0, after = 0;
for (const name of SHOTS) {
  const src = `${SRC}/${name}.png`;
  before += statSync(src).size;
  for (const w of WIDTHS) {
    const dst = w === WIDTHS[0] ? `${OUT}/${name}.webp` : `${OUT}/${name}@${w}.webp`;
    await sharp(src).resize({ width: w }).webp({ quality: QUALITY }).toFile(dst);
    after += statSync(dst).size;
  }
  console.log(`${name.padEnd(10)} ${WIDTHS.map((w) => `${w}w`).join(" + ")}`);
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`\n${SHOTS.length} shots: ${mb(before)} of PNG -> ${mb(after)} of WebP`);
