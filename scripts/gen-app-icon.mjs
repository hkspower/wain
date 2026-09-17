#!/usr/bin/env node
/**
 * The App Store icon:  npm run icon:app   → public/brand/app-icon-1024.png
 *
 * Apple wants 1024×1024, and the largest thing this repository had was
 * `app-icon-512.png`. `@capacitor/assets` will happily accept a 512 and
 * upscale it, which is how a blurred icon reaches a store listing without
 * anyone deciding to ship one — the marketing icon is the single most-looked-at
 * asset an app has, and nothing fails when it is soft.
 *
 * So this renders at 1024 from the mark itself rather than resampling a PNG.
 * The geometry is read out of `src/components/WainLogo.tsx` at generation time,
 * for the reason gen-theme-boards.mjs gives at length: a traced copy goes on
 * looking right after it stops being true.
 *
 * TWO APPLE RULES ARE STRUCTURAL, not taste, and both are asserted below:
 *
 *   1. No alpha channel. An icon with transparency is rejected at upload —
 *      not at review, at upload — and the message names neither the file nor
 *      the reason clearly. `.flatten()` composites onto the ground and
 *      `channels === 3` proves it afterwards.
 *   2. Square, and no rounded corners of our own. iOS applies the superellipse
 *      mask itself; corners baked into the artwork get masked twice and show
 *      as a dark fringe.
 *
 * The composition deliberately MATCHES `app-icon-512.png` — same cream ground
 * (#fdfaf3), same 40% coverage, same slight upward bias — so the store icon and
 * the PWA icon are the same picture at two sizes. The 512 is not regenerated:
 * it is what the installed web app already shows, and changing it to suit a
 * store listing would be a redesign nobody asked for. That 40% is generous
 * margin by Apple's conventions and is the one thing here worth revisiting
 * deliberately rather than by accident.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/brand/app-icon-1024.png");
const LOGO = readFileSync(join(ROOT, "src/components/WainLogo.tsx"), "utf8");

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error(
    "gen-app-icon needs sharp, which this project does not depend on.\n" +
    "  npm i -D sharp\n" +
    "The icon is an on-demand artefact, so a normal build and deploy needs it never.",
  );
  process.exit(1);
}

/* ── the mark, lifted from the component ─────────────────────────────────── */

const grab = (re, what) => {
  const m = LOGO.match(re);
  if (!m) throw new Error(`gen-app-icon: could not find ${what} in WainLogo.tsx`);
  return m[1];
};
const VIEWBOX = grab(/viewBox="([^"]+)"/, "the viewBox").split(/\s+/).map(Number);
const KUWAIT = grab(/d="(M 31 24[^"]+)"/, "the Kuwait path");
const PIN = grab(/d="(M 58 54\.5[^"]+)"/, "the pin path");
const GLYPH_T = grab(/transform="(translate\(58 [^"]+)"/, "the ؟ transform");
const GLYPH = grab(/d="(M -4\.4[^"]+)"/, "the ؟ arc");

/* ── composition, measured off app-icon-512.png ──────────────────────────── */

const SIZE = 1024;
const GROUND = "#fdfaf3";
/** The mark spans 40% of the canvas and sits a touch above centre, as in 512. */
const COVERAGE = 0.4;
const CENTRE = { x: 0.504, y: 0.456 };

const [vx, vy, vw, vh] = VIEWBOX;
const markW = SIZE * COVERAGE;
const scale = markW / vw;
const markH = vh * scale;
const left = SIZE * CENTRE.x - markW / 2;
const top = SIZE * CENTRE.y - markH / 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${GROUND}"/>
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#57b0e3"/><stop offset="1" stop-color="#2277b4"/>
    </linearGradient>
    <linearGradient id="coral" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ef4d43"/><stop offset="1" stop-color="#b9241b"/>
    </linearGradient>
  </defs>
  <g transform="translate(${left - vx * scale} ${top - vy * scale}) scale(${scale})">
    <path d="${KUWAIT}" fill="url(#sea)" stroke="#ffffff" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="${PIN}" fill="url(#coral)" stroke="#ffffff" stroke-width="3.5" stroke-linejoin="round"/>
    <g transform="${GLYPH_T}" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round">
      <path d="${GLYPH}"/>
    </g>
    <circle cx="58" cy="36.8" r="2" fill="#ffffff"/>
  </g>
</svg>`;

const png = await sharp(Buffer.from(svg))
  .flatten({ background: GROUND }) // rule 1: no alpha reaches the file
  .png({ compressionLevel: 9 })
  .toBuffer();

writeFileSync(OUT, png);

/* ── prove it, rather than assume it ─────────────────────────────────────── */

const meta = await sharp(OUT).metadata();
const problems = [];
if (meta.width !== SIZE || meta.height !== SIZE) problems.push(`${meta.width}×${meta.height}, not ${SIZE}×${SIZE}`);
if (meta.hasAlpha || meta.channels !== 3) problems.push(`has an alpha channel (channels=${meta.channels})`);
if (problems.length) {
  console.error(`gen-app-icon: the written file is not submittable — ${problems.join("; ")}`);
  process.exit(1);
}
console.log(
  `gen-app-icon: public/brand/app-icon-1024.png — ${meta.width}×${meta.height}, ` +
  `${meta.channels} channels, no alpha, ${(png.length / 1024).toFixed(0)}KB ✓`,
);
